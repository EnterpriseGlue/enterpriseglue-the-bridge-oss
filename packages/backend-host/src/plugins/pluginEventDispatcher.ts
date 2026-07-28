import { randomUUID } from 'node:crypto';

import {
  pluginEventReceiptV1Schema,
  pluginHostEventV1Schema,
  type PluginEventReceiptV1,
  type PluginHostEventV1,
} from '@enterpriseglue/plugin-sdk';
import {
  signPluginInvocationV1,
  validatePluginBackendCapabilitiesV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import { fetch, type Dispatcher, type RequestInit } from 'undici';

import type { PluginControlPlaneV1 } from './pluginControlPlane.js';
import {
  DatabasePluginEventDeliveryStoreV1,
  PluginEventDeliveryCoordinatorV1,
  type ClaimedPluginEventV1,
  type PluginEventDeliveryStoreV1,
  type PluginEventSafeSummaryV1,
} from './pluginEventDeliveryStore.js';
import type {
  PluginEventSubscriberRecordV1,
} from './pluginRuntime.js';

const CAPABILITY_DOCUMENT_MAX_BYTES = 1024 * 1024;
const DEFAULT_INTERVAL_MS = 2_000;

type FetchV1 = (
  input: string,
  init?: RequestInit & { dispatcher?: Dispatcher },
) => ReturnType<typeof fetch>;

export interface PluginEventDispatcherOptionsV1 {
  deploymentRef: string;
  invocationPrivateKey: () => Promise<string | Buffer>;
  store?: PluginEventDeliveryStoreV1;
  fetch?: FetchV1;
  workerRef?: string;
  intervalMs?: number;
}

export interface PluginEventPublishResultV1 {
  eventId: string;
  queued: Array<{ pluginId: string; deliveryId: string }>;
  failed: Array<{ pluginId: string; reasonCode: 'subscriber_unavailable' }>;
}

export interface PluginEventRuntimePortV1 {
  eventSubscribers(
    eventType: PluginHostEventV1['type'],
  ): Promise<PluginEventSubscriberRecordV1[]>;
  backendRecord(
    pluginId: string,
  ): Promise<Omit<PluginEventSubscriberRecordV1, 'subscription'> | null>;
  assertOperationPayload(
    pluginId: string,
    operationId: string,
    direction: 'request' | 'response',
    value: unknown,
  ): Promise<void>;
}

/**
 * Host-owned, durable delivery of closed, minimized events to plugin sidecars.
 *
 * Plugins cannot select a destination, inject credentials, subscribe to an
 * undeclared event, or receive an event for a disabled tenant. Each delivery is
 * authorized again immediately before dispatch so disable and entitlement
 * changes take effect even for already queued work.
 */
export class PluginEventDispatcherV1 {
  private readonly store: PluginEventDeliveryStoreV1;
  private readonly coordinator: PluginEventDeliveryCoordinatorV1;
  private readonly fetch: FetchV1;
  private readonly workerRef: string;
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly runtime: PluginEventRuntimePortV1,
    private readonly control: Pick<PluginControlPlaneV1, 'isExecutionAllowed'>,
    private readonly options: PluginEventDispatcherOptionsV1,
  ) {
    this.store = options.store ?? new DatabasePluginEventDeliveryStoreV1();
    this.coordinator = new PluginEventDeliveryCoordinatorV1(this.store);
    this.fetch = options.fetch ?? fetch;
    this.workerRef =
      options.workerRef ?? `plugin-event-worker-${process.pid}-${randomUUID()}`;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (
      !/^[A-Za-z0-9._:-]{1,256}$/.test(this.workerRef) ||
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 100 ||
      this.intervalMs > 60_000
    ) {
      throw new Error('plugin_event_dispatcher_options_invalid');
    }
  }

  async publish(eventInput: PluginHostEventV1): Promise<PluginEventPublishResultV1> {
    const event = pluginHostEventV1Schema.parse(eventInput);
    const tenantRef = event.tenantRef;
    if (!tenantRef) {
      throw new Error('plugin_event_tenant_required');
    }
    const subscribers = await this.runtime.eventSubscribers(event.type);
    const queued: PluginEventPublishResultV1['queued'] = [];
    const failed: PluginEventPublishResultV1['failed'] = [];
    for (const subscriber of subscribers) {
      try {
        const permission = subscriber.subscription.permission;
        if (
          !subscriber.grantedPermissions.includes(permission) ||
          !(await this.control.isExecutionAllowed(
            subscriber.pluginId,
            tenantRef,
          ))
        ) {
          continue;
        }
        const result = await this.store.enqueue({
          pluginId: subscriber.pluginId,
          deploymentRef: this.options.deploymentRef,
          tenantRef,
          subscriptionType: subscriber.subscription.type,
          operationId: subscriber.subscription.deliveryOperationId,
          maxAttempts: subscriber.subscription.maxAttempts,
          event,
        });
        queued.push({
          pluginId: subscriber.pluginId,
          deliveryId: result.deliveryId,
        });
      } catch {
        failed.push({
          pluginId: subscriber.pluginId,
          reasonCode: 'subscriber_unavailable',
        });
      }
    }
    return { eventId: event.id, queued, failed };
  }

  async runOnce(): Promise<PluginEventSafeSummaryV1[]> {
    return this.coordinator.runOnce({
      workerRef: this.workerRef,
      deliver: (delivery) => this.deliver(delivery),
    });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runOnce()
        .catch(() => {
          console.error('[Plugin event dispatcher] Delivery cycle failed');
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
    delivery: ClaimedPluginEventV1,
  ): Promise<PluginEventReceiptV1> {
    const record = await this.runtime.backendRecord(delivery.pluginId);
    const backend = record?.manifest.deployment.backend;
    const subscription = record?.manifest.events.subscriptions.find(
      (candidate) =>
        candidate.type === delivery.request.subscriptionType &&
        candidate.deliveryOperationId === delivery.request.operationId,
    );
    const operation = backend?.operations.find(
      (candidate) =>
        candidate.operationId === delivery.request.operationId &&
        candidate.method === 'POST' &&
        candidate.streaming === 'none',
    );
    if (
      !record ||
      !backend ||
      !subscription ||
      !operation ||
      !record.grantedPermissions.includes(subscription.permission) ||
      !operation.requiredPermissions.includes(subscription.permission) ||
      !(await this.control.isExecutionAllowed(
        record.pluginId,
        delivery.tenantRef,
      ))
    ) {
      return receipt(delivery.deliveryId, 'permanent_rejected', 'subscription_inactive');
    }

    const requestBytes = Buffer.byteLength(
      JSON.stringify(delivery.request),
      'utf8',
    );
    if (requestBytes > operation.maxRequestBytes) {
      return receipt(delivery.deliveryId, 'permanent_rejected', 'event_too_large');
    }
    await this.runtime.assertOperationPayload(
      record.pluginId,
      operation.operationId,
      'request',
      delivery.request,
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
      throw new Error('plugin_event_capability_unavailable');
    }
    if (!isJson(capabilitiesResponse.headers.get('content-type'))) {
      throw new Error('plugin_event_capability_invalid');
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
        sub: 'enterpriseglue-event-dispatcher',
        iat: now,
        exp: now + 30,
        jti: randomUUID(),
        tenantRef: delivery.tenantRef,
        deploymentRef: this.options.deploymentRef,
        operationId: operation.operationId,
        grantedPermissions: record.grantedPermissions,
        resourceRefs: eventResourceRefs(delivery.request.event),
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
      body: JSON.stringify(delivery.request),
      signal: AbortSignal.timeout(operation.timeoutMs),
    });
    const bytes = await boundedBytes(response, operation.maxResponseBytes);
    if (response.status >= 500) {
      throw new Error('plugin_event_sidecar_unavailable');
    }
    if (response.status < 200 || response.status >= 300) {
      return receipt(delivery.deliveryId, 'permanent_rejected', 'plugin_rejected');
    }
    if (!isJson(response.headers.get('content-type'))) {
      throw new Error('plugin_event_response_invalid');
    }
    const parsed = pluginEventReceiptV1Schema.parse(
      JSON.parse(bytes.toString('utf8')),
    );
    await this.runtime.assertOperationPayload(
      record.pluginId,
      operation.operationId,
      'response',
      parsed,
    );
    if (parsed.deliveryId !== delivery.deliveryId) {
      throw new Error('plugin_event_receipt_mismatch');
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
    throw new Error('plugin_event_response_too_large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw new Error('plugin_event_response_too_large');
  }
  return bytes;
}

function pluginServiceBaseUrl(
  record: Pick<PluginEventSubscriberRecordV1, 'pluginId' | 'resources'>,
): string {
  return `http://eg-plugin-${record.pluginId.replace(/\./g, '-')}:${
    record.resources.service.containerPort
  }`;
}

function eventResourceRefs(event: PluginHostEventV1) {
  const refs: Array<{ kind: 'engine' | 'incident' | 'failed_job'; ref: string }> =
    [{ kind: 'engine', ref: event.data.engineRef }];
  if (event.type === 'io.enterpriseglue.host.incident.v1') {
    refs.push({ kind: 'incident', ref: event.data.incidentRef });
  } else if (event.type === 'io.enterpriseglue.host.failed-job.v1') {
    refs.push({ kind: 'failed_job', ref: event.data.jobRef });
  }
  return refs;
}

function receipt(
  deliveryId: string,
  status: PluginEventReceiptV1['status'],
  reasonCode: string,
): PluginEventReceiptV1 {
  return pluginEventReceiptV1Schema.parse({
    apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
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
