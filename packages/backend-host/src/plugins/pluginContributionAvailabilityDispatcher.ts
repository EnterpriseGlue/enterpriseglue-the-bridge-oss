import { randomUUID } from 'node:crypto';

import {
  pluginContributionAvailabilityProjectionV1Schema,
  type EnterpriseGluePluginManifestV1,
  type PluginContributionAvailabilityProjectionV1,
  type PluginId,
  type PluginPermissionV1,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';
import {
  PluginGatewayCircuitBreakerV1,
  signPluginInvocationV1,
  validatePluginBackendCapabilitiesV1,
  type PluginGatewayAdmissionV1,
  type PluginGatewayCircuitLeaseV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import { fetch, type Dispatcher, type RequestInit } from 'undici';

import type { PluginControlPlaneV1 } from './pluginControlPlane.js';
import {
  DatabasePluginContributionAvailabilityStoreV1,
  type ClaimedPluginContributionAvailabilityV1,
  type PluginContributionAvailabilityStoreV1,
  type PluginContributionAvailabilityTargetV1,
} from './pluginContributionAvailabilityStore.js';
import type { PluginControlSourceSnapshotV1 } from './pluginRuntime.js';

const CAPABILITY_DOCUMENT_MAX_BYTES = 1024 * 1024;
const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_LIMIT = 10;

type FetchV1 = (
  input: string,
  init?: RequestInit & { dispatcher?: Dispatcher },
) => ReturnType<typeof fetch>;

interface PluginAvailabilityBackendRecordV1 {
  pluginId: PluginId;
  version: string;
  manifest: EnterpriseGluePluginManifestV1;
  resources: PluginResourceDescriptorV1;
  grantedPermissions: readonly PluginPermissionV1[];
}

export interface PluginContributionAvailabilityRuntimePortV1 {
  controlSnapshot(): Promise<PluginControlSourceSnapshotV1>;
  backendRecord(
    pluginId: string,
  ): Promise<PluginAvailabilityBackendRecordV1 | null>;
  assertOperationPayload(
    pluginId: string,
    operationId: string,
    direction: 'request' | 'response',
    value: unknown,
  ): Promise<void>;
}

export interface PluginContributionAvailabilityDispatcherOptionsV1 {
  deploymentRef: string;
  invocationPrivateKey: () => Promise<string | Buffer>;
  admission: PluginGatewayAdmissionV1;
  circuitBreaker: PluginGatewayCircuitBreakerV1;
  store?: PluginContributionAvailabilityStoreV1;
  fetch?: FetchV1;
  now?: () => number;
  workerRef?: string;
  intervalMs?: number;
  leaseMs?: number;
  limit?: number;
}

export class PluginContributionAvailabilityDispatcherV1 {
  readonly store: PluginContributionAvailabilityStoreV1;
  private readonly fetch: FetchV1;
  private readonly now: () => number;
  private readonly workerRef: string;
  private readonly intervalMs: number;
  private readonly leaseMs: number;
  private readonly limit: number;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly runtime: PluginContributionAvailabilityRuntimePortV1,
    private readonly control: Pick<
      PluginControlPlaneV1,
      'enabledTenantRefs' | 'isExecutionAllowed'
    >,
    private readonly options: PluginContributionAvailabilityDispatcherOptionsV1,
  ) {
    this.store =
      options.store ?? new DatabasePluginContributionAvailabilityStoreV1();
    this.fetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.workerRef =
      options.workerRef ??
      `plugin-availability-worker-${process.pid}-${randomUUID()}`;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.limit = options.limit ?? DEFAULT_LIMIT;
    if (
      !/^[A-Za-z0-9._:-]{1,256}$/.test(this.workerRef) ||
      !boundedInteger(this.intervalMs, 100, 60_000) ||
      !boundedInteger(this.leaseMs, 1_000, 10 * 60_000) ||
      !boundedInteger(this.limit, 1, 100)
    ) {
      throw new Error('plugin_contribution_availability_options_invalid');
    }
  }

  async runOnce(): Promise<void> {
    const now = this.now();
    const snapshot = await this.runtime.controlSnapshot();
    const targets = await this.targets(snapshot);
    await this.store.reconcileTargets(targets, now);
    const claims = await this.store.claimDue({
      workerRef: this.workerRef,
      now,
      leaseMs: this.leaseMs,
      limit: this.limit,
    });
    for (const claim of claims) {
      await this.refresh(claim).catch(async () => {
        await this.store.completeFailure(
          claim,
          'refresh_failed',
          this.now() +
            retryDelayMs(
              claim.refreshIntervalSeconds,
              claim.consecutiveFailures,
            ),
          this.now(),
        );
      });
    }
  }

  start(): void {
    if (this.timer) return;
    void this.runOnce().catch(() => {
      console.error('[Plugin availability] Initial refresh cycle failed');
    });
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.runOnce()
        .catch(() => {
          console.error('[Plugin availability] Refresh cycle failed');
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

  private async targets(
    snapshot: PluginControlSourceSnapshotV1,
  ): Promise<PluginContributionAvailabilityTargetV1[]> {
    const targets: PluginContributionAvailabilityTargetV1[] = [];
    for (const source of snapshot.records) {
      const record = await this.runtime.backendRecord(source.pluginId);
      const declaration = record?.manifest.contributionAvailability;
      if (
        !record ||
        record.version !== source.version ||
        !declaration
      ) {
        continue;
      }
      const tenantRefs = await this.control.enabledTenantRefs(source.pluginId);
      for (const tenantRef of tenantRefs) {
        targets.push({
          deploymentRef: this.options.deploymentRef,
          tenantRef,
          pluginId: source.pluginId,
          pluginVersion: source.version,
          installerRevision: snapshot.revision,
          refreshIntervalSeconds: declaration.refreshIntervalSeconds,
          maximumStalenessSeconds: declaration.maximumStalenessSeconds,
        });
      }
    }
    return targets;
  }

  private async refresh(
    claim: ClaimedPluginContributionAvailabilityV1,
  ): Promise<void> {
    const record = await this.runtime.backendRecord(claim.pluginId);
    const declaration = record?.manifest.contributionAvailability;
    const backend = record?.manifest.deployment.backend;
    const operation = backend?.operations.find(
      (candidate) =>
        candidate.operationId === declaration?.refreshOperationId,
    );
    if (
      !record ||
      record.version !== claim.pluginVersion ||
      !declaration ||
      !backend ||
      !operation ||
      operation.method !== 'POST' ||
      operation.streaming !== 'none' ||
      !(await this.control.isExecutionAllowed(
        claim.pluginId,
        claim.tenantRef,
      ))
    ) {
      throw new Error('plugin_contribution_availability_inactive');
    }

    const requestBody = {};
    await this.runtime.assertOperationPayload(
      record.pluginId,
      operation.operationId,
      'request',
      requestBody,
    );
    const admission = await this.options.admission.acquire({
      pluginId: record.pluginId,
      operationId: operation.operationId,
      tenantRef: claim.tenantRef,
      subjectRef: 'enterpriseglue-availability-scheduler',
      leaseTtlMs: Math.min(operation.timeoutMs + 10_000, 10 * 60_000),
    });
    let circuit: PluginGatewayCircuitLeaseV1 | undefined;
    try {
      circuit = this.options.circuitBreaker.acquire(
        record.pluginId,
        operation.operationId,
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
      if (
        !capabilitiesResponse.ok ||
        !isJson(capabilitiesResponse.headers.get('content-type'))
      ) {
        throw new Error('plugin_contribution_availability_capability_failed');
      }
      validatePluginBackendCapabilitiesV1(
        record.manifest,
        JSON.parse(capabilityBytes.toString('utf8')),
      );

      const issuedAtSeconds = Math.floor(this.now() / 1_000);
      const correlationId = randomUUID();
      const token = signPluginInvocationV1(
        {
          iss: 'enterpriseglue-oss',
          aud: record.pluginId,
          sub: 'enterpriseglue-availability-scheduler',
          iat: issuedAtSeconds,
          exp: issuedAtSeconds + 30,
          jti: randomUUID(),
          tenantRef: claim.tenantRef,
          deploymentRef: claim.deploymentRef,
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
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(operation.timeoutMs),
      });
      const bytes = await boundedBytes(response, operation.maxResponseBytes);
      if (
        response.status < 200 ||
        response.status >= 300 ||
        !isJson(response.headers.get('content-type'))
      ) {
        throw new Error('plugin_contribution_availability_refresh_rejected');
      }
      const projection =
        pluginContributionAvailabilityProjectionV1Schema.parse(
          JSON.parse(bytes.toString('utf8')),
        );
      await this.runtime.assertOperationPayload(
        record.pluginId,
        operation.operationId,
        'response',
        projection,
      );
      assertProjection(
        projection,
        declaration.gatedContributionIds,
        declaration.maximumStalenessSeconds,
        this.now(),
      );
      const saved = await this.store.completeSuccess(
        claim,
        projection,
        this.now() + declaration.refreshIntervalSeconds * 1_000,
        this.now(),
      );
      if (!saved) {
        throw new Error('plugin_contribution_availability_claim_lost');
      }
      circuit.succeed();
    } catch (error) {
      circuit?.fail();
      throw error;
    } finally {
      await admission.release();
    }
  }
}

function assertProjection(
  projection: PluginContributionAvailabilityProjectionV1,
  gatedContributionIds: readonly string[],
  maximumStalenessSeconds: number,
  now: number,
): void {
  const expected = new Set(gatedContributionIds);
  const actual = new Set(
    projection.contributions.map((entry) => entry.contributionId),
  );
  const evaluatedAt = Date.parse(projection.evaluatedAt);
  const validUntil = Date.parse(projection.validUntil);
  if (
    actual.size !== expected.size ||
    [...actual].some((contributionId) => !expected.has(contributionId)) ||
    evaluatedAt > now + 30_000 ||
    evaluatedAt < now - maximumStalenessSeconds * 1_000 ||
    validUntil <= now ||
    validUntil > evaluatedAt + maximumStalenessSeconds * 1_000
  ) {
    throw new Error('plugin_contribution_availability_projection_invalid');
  }
}

async function boundedBytes(
  response: Awaited<ReturnType<FetchV1>>,
  maximum: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) {
    throw new Error('plugin_contribution_availability_response_too_large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maximum) {
    throw new Error('plugin_contribution_availability_response_too_large');
  }
  return bytes;
}

function pluginServiceBaseUrl(
  record: Pick<PluginAvailabilityBackendRecordV1, 'pluginId' | 'resources'>,
): string {
  return `http://eg-plugin-${record.pluginId.replace(/\./g, '-')}:${
    record.resources.service.containerPort
  }`;
}

function isJson(contentType: string | null): boolean {
  return (
    contentType !== null &&
    /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)
  );
}

function retryDelayMs(
  refreshIntervalSeconds: number,
  consecutiveFailures: number,
): number {
  const backoffSeconds =
    60 * 2 ** Math.min(Math.max(consecutiveFailures, 0), 4);
  return Math.min(
    Math.max(refreshIntervalSeconds, 60),
    backoffSeconds,
    300,
  ) * 1_000;
}

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
