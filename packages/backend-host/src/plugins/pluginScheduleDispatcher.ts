import { randomUUID } from 'node:crypto';

import {
  pluginScheduledJobReceiptV1Schema,
  type EnterpriseGluePluginManifestV1,
  type PluginId,
  type PluginPermissionV1,
  type PluginResourceDescriptorV1,
  type PluginScheduledJobReceiptV1,
} from '@enterpriseglue/plugin-sdk';
import {
  signPluginInvocationV1,
  validatePluginBackendCapabilitiesV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import { fetch, type Dispatcher, type RequestInit } from 'undici';

import type { PluginControlPlaneV1 } from './pluginControlPlane.js';
import {
  DatabasePluginScheduleStoreV1,
  PluginScheduleDeliveryCoordinatorV1,
  type ClaimedPluginScheduledJobV1,
  type PluginScheduleDeliveryStoreV1,
  type PluginScheduledJobSafeSummaryV1,
} from './pluginScheduleStore.js';

const CAPABILITY_DOCUMENT_MAX_BYTES = 1024 * 1024;
const DEFAULT_INTERVAL_MS = 2_000;

type FetchV1 = (
  input: string,
  init?: RequestInit & { dispatcher?: Dispatcher },
) => ReturnType<typeof fetch>;

interface PluginScheduledJobBackendRecordV1 {
  pluginId: PluginId;
  manifest: EnterpriseGluePluginManifestV1;
  resources: PluginResourceDescriptorV1;
  grantedPermissions: readonly PluginPermissionV1[];
}

export interface PluginScheduleRuntimePortV1 {
  backendRecord(
    pluginId: string,
  ): Promise<PluginScheduledJobBackendRecordV1 | null>;
  assertOperationPayload(
    pluginId: string,
    operationId: string,
    direction: 'request' | 'response',
    value: unknown,
  ): Promise<void>;
}

export interface PluginScheduleDispatcherOptionsV1 {
  deploymentRef: string;
  invocationPrivateKey: () => Promise<string | Buffer>;
  store?: PluginScheduleDeliveryStoreV1;
  fetch?: FetchV1;
  workerRef?: string;
  intervalMs?: number;
}

/**
 * Delivers host-owned fixed-schedule ticks. The sidecar receives no arbitrary
 * payload and cannot control its destination, credentials, or execution time.
 */
export class PluginScheduleDispatcherV1 {
  private readonly coordinator: PluginScheduleDeliveryCoordinatorV1;
  private readonly fetch: FetchV1;
  private readonly workerRef: string;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly runtime: PluginScheduleRuntimePortV1,
    private readonly control: Pick<PluginControlPlaneV1, 'isExecutionAllowed'>,
    private readonly options: PluginScheduleDispatcherOptionsV1,
  ) {
    this.coordinator = new PluginScheduleDeliveryCoordinatorV1(
      options.store ?? new DatabasePluginScheduleStoreV1(),
    );
    this.fetch = options.fetch ?? fetch;
    this.workerRef =
      options.workerRef ??
      `plugin-schedule-worker-${process.pid}-${randomUUID()}`;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (
      !/^[A-Za-z0-9._:-]{1,256}$/.test(this.workerRef) ||
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 100 ||
      this.intervalMs > 60_000
    ) {
      throw new Error('plugin_schedule_dispatcher_options_invalid');
    }
  }

  async runOnce(): Promise<PluginScheduledJobSafeSummaryV1[]> {
    return this.coordinator.runOnce({
      workerRef: this.workerRef,
      deliver: (job) => this.deliver(job),
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runOnce()
        .catch(() => {
          console.error('[Plugin schedule dispatcher] Delivery cycle failed');
        })
        .finally(() => {
          this.running = false;
        });
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async deliver(
    job: ClaimedPluginScheduledJobV1,
  ): Promise<PluginScheduledJobReceiptV1> {
    const record = await this.runtime.backendRecord(job.pluginId);
    const backend = record?.manifest.deployment.backend;
    const schedule = record?.manifest.jobs.fixedSchedules.find(
      (candidate) =>
        candidate.jobType === job.request.jobType &&
        candidate.deliveryOperationId === job.operationId,
    );
    const operation = backend?.operations.find(
      (candidate) =>
        candidate.operationId === job.operationId &&
        candidate.method === 'POST' &&
        candidate.streaming === 'none',
    );
    if (
      !record ||
      !backend ||
      !schedule ||
      !operation ||
      schedule.permission !== 'host.jobs.schedule_fixed' ||
      !record.grantedPermissions.includes(schedule.permission) ||
      !operation.requiredPermissions.includes(schedule.permission) ||
      !(await this.control.isExecutionAllowed(record.pluginId, job.tenantRef))
    ) {
      return receipt(
        job.request.deliveryId,
        'permanent_rejected',
        'schedule_inactive',
      );
    }
    if (
      Buffer.byteLength(JSON.stringify(job.request), 'utf8') >
      operation.maxRequestBytes
    ) {
      return receipt(
        job.request.deliveryId,
        'permanent_rejected',
        'request_too_large',
      );
    }
    await this.runtime.assertOperationPayload(
      record.pluginId,
      operation.operationId,
      'request',
      job.request,
    );

    const baseUrl = pluginServiceBaseUrl(record);
    const capabilitiesResponse = await this.fetch(
      `${baseUrl}${backend.protocolPath}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(operation.timeoutMs, 5_000)),
      },
    );
    const capabilityBytes = await boundedBytes(
      capabilitiesResponse,
      CAPABILITY_DOCUMENT_MAX_BYTES,
    );
    if (!capabilitiesResponse.ok) {
      throw new Error('plugin_schedule_capability_unavailable');
    }
    if (!isJson(capabilitiesResponse.headers.get('content-type'))) {
      throw new Error('plugin_schedule_capability_invalid');
    }
    validatePluginBackendCapabilitiesV1(
      record.manifest,
      JSON.parse(capabilityBytes.toString('utf8')),
    );

    const now = Math.floor(Date.now() / 1_000);
    const correlationId = randomUUID();
    const token = signPluginInvocationV1(
      {
        iss: 'enterpriseglue-oss',
        aud: record.pluginId,
        sub: 'enterpriseglue-job-scheduler',
        iat: now,
        exp: now + 30,
        jti: randomUUID(),
        tenantRef: job.tenantRef,
        deploymentRef: this.options.deploymentRef,
        operationId: operation.operationId,
        grantedPermissions: [...record.grantedPermissions],
        resourceRefs: [],
        correlationId,
      },
      await this.options.invocationPrivateKey(),
    );
    const response = await this.fetch(`${baseUrl}/${operation.path}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-EnterpriseGlue-Plugin-Invocation': token,
        'X-Correlation-ID': correlationId,
      },
      body: JSON.stringify(job.request),
      signal: AbortSignal.timeout(operation.timeoutMs),
    });
    const bytes = await boundedBytes(response, operation.maxResponseBytes);
    if (response.status >= 500) {
      throw new Error('plugin_schedule_sidecar_unavailable');
    }
    if (response.status < 200 || response.status >= 300) {
      return receipt(
        job.request.deliveryId,
        'permanent_rejected',
        'plugin_rejected',
      );
    }
    if (!isJson(response.headers.get('content-type'))) {
      throw new Error('plugin_schedule_response_invalid');
    }
    const parsed = pluginScheduledJobReceiptV1Schema.parse(
      JSON.parse(bytes.toString('utf8')),
    );
    await this.runtime.assertOperationPayload(
      record.pluginId,
      operation.operationId,
      'response',
      parsed,
    );
    if (parsed.deliveryId !== job.request.deliveryId) {
      throw new Error('plugin_schedule_receipt_mismatch');
    }
    return parsed;
  }
}

async function boundedBytes(
  response: Awaited<ReturnType<FetchV1>>,
  maximum: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw new Error('plugin_schedule_response_too_large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw new Error('plugin_schedule_response_too_large');
  }
  return bytes;
}

function pluginServiceBaseUrl(
  record: Pick<PluginScheduledJobBackendRecordV1, 'pluginId' | 'resources'>,
): string {
  return `http://eg-plugin-${record.pluginId.replace(/\./g, '-')}:${
    record.resources.service.containerPort
  }`;
}

function receipt(
  deliveryId: string,
  status: PluginScheduledJobReceiptV1['status'],
  reasonCode: string,
): PluginScheduledJobReceiptV1 {
  return pluginScheduledJobReceiptV1Schema.parse({
    apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
    deliveryId,
    status,
    reasonCode,
  });
}

function isJson(contentType: string | null): boolean {
  return (
    contentType !== null &&
    /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)
  );
}
