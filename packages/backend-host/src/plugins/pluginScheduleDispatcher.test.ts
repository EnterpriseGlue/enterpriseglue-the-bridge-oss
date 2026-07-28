import { generateKeyPairSync } from 'node:crypto';

import {
  parseEnterpriseGluePluginManifestV1,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import { PluginScheduleDispatcherV1 } from './pluginScheduleDispatcher.js';
import type {
  ClaimedPluginScheduledJobV1,
  PluginScheduleDeliveryStoreV1,
  PluginScheduledJobSafeSummaryV1,
} from './pluginScheduleStore.js';

const pluginId = 'io.enterpriseglue.reference';
const operationId = `${pluginId}.deliver-refresh`;
const jobType = `${pluginId}.refresh-index`;
const hash = 'a'.repeat(64);

const manifest = parseEnterpriseGluePluginManifestV1({
  apiVersion: 'plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePlugin',
  metadata: {
    id: pluginId,
    version: '1.0.0',
    displayName: 'Reference',
    publisher: 'io.enterpriseglue',
  },
  compatibility: {
    host: '>=0.4.0 <0.5.0',
    sdk: '^0.1.0',
    backendProtocol: 1,
    requiredSlots: [],
  },
  deployment: {
    backend: {
      image: `registry.example/reference@sha256:${'b'.repeat(64)}`,
      healthPath: '/_plugin/health',
      readyPath: '/_plugin/ready',
      protocolPath: '/_plugin/capabilities',
      operations: [
        {
          operationId,
          method: 'POST',
          path: 'v1/jobs/refresh',
          requestSchema: {
            path: 'schemas/scheduled-job.json',
            sha256: hash,
          },
          responseSchema: {
            path: 'schemas/scheduled-job-receipt.json',
            sha256: hash,
          },
          requiredPermissions: ['host.jobs.schedule_fixed'],
          maxRequestBytes: 4_096,
          maxResponseBytes: 4_096,
          timeoutMs: 5_000,
          streaming: 'none',
        },
      ],
    },
  },
  scope: { installation: 'deployment', enablement: 'tenant' },
  permissions: {
    required: ['host.jobs.schedule_fixed'],
    optional: [],
  },
  network: { egressPolicy: 'none' },
  entitlement: { provider: 'none' },
  dependencies: [],
  conflicts: [],
  events: { subscriptions: [] },
  jobs: {
    fixedSchedules: [
      {
        jobType,
        deliveryOperationId: operationId,
        allowedIntervalsSeconds: [3600],
        permission: 'host.jobs.schedule_fixed',
        maxAttempts: 3,
      },
    ],
  },
  contributions: [],
});

const resources: PluginResourceDescriptorV1 = {
  apiVersion: 'resources.plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePluginResources',
  service: {
    containerPort: 8080,
    runAsNonRoot: true,
    readOnlyRootFilesystem: true,
    tmpfsMiB: 32,
    cpuLimit: '250m',
    memoryLimitMiB: 256,
  },
  configuration: [],
  storage: [],
  network: { ingress: 'host-gateway-only', egressPolicy: 'none' },
  probes: {
    healthPath: '/_plugin/health',
    readyPath: '/_plugin/ready',
    initialDelaySeconds: 1,
    periodSeconds: 10,
    timeoutSeconds: 2,
    failureThreshold: 3,
  },
};

const record = {
  pluginId,
  manifest,
  resources,
  grantedPermissions: ['host.jobs.schedule_fixed'] as const,
};

function claimed(): ClaimedPluginScheduledJobV1 {
  return {
    jobRef: 'job-1',
    pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    operationId,
    attempt: 1,
    maxAttempts: 3,
    leaseOwner: 'schedule-worker-1',
    request: {
      apiVersion: 'scheduled-job-delivery.plugin.enterpriseglue.io/v1',
      deliveryId: 'scheduled-delivery-1',
      jobRef: 'job-1',
      jobType,
      operationId,
      scheduledFor: '2026-07-25T00:00:00.000Z',
      attempt: 1,
    },
  };
}

describe('PluginScheduleDispatcherV1', () => {
  it('signs, schema-checks, and completes a fixed-schedule delivery', async () => {
    const pair = generateKeyPairSync('ed25519');
    const completions: Array<{ status: string; reasonCode: string }> = [];
    let claimedOnce = false;
    const store = unusedStore({
      claimDue: async () => {
        if (claimedOnce) return [];
        claimedOnce = true;
        return [claimed()];
      },
      complete: async (input) => {
        completions.push({
          status: input.receipt.status,
          reasonCode: input.receipt.reasonCode,
        });
        return summary(input.receipt.reasonCode);
      },
    });
    const fetchMock = vi.fn(
      async (url: string, init?: { headers?: unknown }) => {
        if (url.endsWith('/_plugin/capabilities')) {
          return new Response(
            JSON.stringify({
              protocol: 'backend.plugin.enterpriseglue.io/v1',
              pluginId,
              pluginVersion: '1.0.0',
              apiRevision: '1',
              schemaRevision: 1,
              operations: [
                {
                  operationId,
                  requestSchemaSha256: hash,
                  responseSchemaSha256: hash,
                },
              ],
              optionalFeatures: [],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        expect(init?.headers).toEqual(
          expect.objectContaining({
            'X-EnterpriseGlue-Plugin-Invocation': expect.any(String),
          }),
        );
        return new Response(
          JSON.stringify({
            apiVersion:
              'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
            deliveryId: 'scheduled-delivery-1',
            status: 'accepted',
            reasonCode: 'accepted',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    );
    const assertOperationPayload = vi.fn(async () => undefined);
    const dispatcher = new PluginScheduleDispatcherV1(
      {
        backendRecord: async () => record,
        assertOperationPayload,
      },
      { isExecutionAllowed: async () => true },
      {
        deploymentRef: 'deployment-1',
        invocationPrivateKey: async () =>
          pair.privateKey
            .export({ type: 'pkcs8', format: 'pem' })
            .toString(),
        store,
        fetch: fetchMock as never,
        workerRef: 'schedule-worker-1',
      },
    );

    await dispatcher.runOnce();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assertOperationPayload).toHaveBeenCalledTimes(2);
    expect(completions).toEqual([
      { status: 'accepted', reasonCode: 'accepted' },
    ]);
  });

  it('permanently rejects delivery when the tenant is disabled', async () => {
    let receiptStatus: string | undefined;
    const store = unusedStore({
      claimDue: async () => [claimed()],
      complete: async (input) => {
        receiptStatus = input.receipt.status;
        return summary(input.receipt.reasonCode);
      },
    });
    const dispatcher = new PluginScheduleDispatcherV1(
      {
        backendRecord: async () => record,
        assertOperationPayload: async () => undefined,
      },
      { isExecutionAllowed: async () => false },
      {
        deploymentRef: 'deployment-1',
        invocationPrivateKey: async () => 'unused',
        store,
        fetch: vi.fn() as never,
        workerRef: 'schedule-worker-1',
      },
    );

    await dispatcher.runOnce();

    expect(receiptStatus).toBe('permanent_rejected');
  });
});

function unusedStore(
  overrides: Partial<PluginScheduleDeliveryStoreV1>,
): PluginScheduleDeliveryStoreV1 {
  return {
    claimDue: async () => [],
    complete: async () => summary('unused'),
    setPaused: async () => summary('unused'),
    ...overrides,
  };
}

function summary(reasonCode: string): PluginScheduledJobSafeSummaryV1 {
  return {
    jobRef: 'job-1',
    pluginId,
    tenantRef: 'tenant-1',
    jobType,
    status: 'scheduled',
    revision: 2,
    attempt: 0,
    maxAttempts: 3,
    reasonCode,
    nextRunAt: 1,
    updatedAt: 1,
  };
}
