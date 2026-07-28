import { generateKeyPairSync } from 'node:crypto';

import {
  parseEnterpriseGluePluginManifestV1,
  type PluginHostEventV1,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';

import { PluginEventDispatcherV1 } from './pluginEventDispatcher.js';
import type {
  ClaimedPluginEventV1,
  PluginEventDeliveryStoreV1,
  PluginEventSafeSummaryV1,
} from './pluginEventDeliveryStore.js';
import type { PluginEventSubscriberRecordV1 } from './pluginRuntime.js';

const pluginId = 'io.enterpriseglue.reference';
const operationId = `${pluginId}.consume-incident`;
const hash = 'a'.repeat(64);
const event = {
  specversion: '1.0',
  id: 'event-1',
  source: 'enterpriseglue-oss',
  type: 'io.enterpriseglue.host.incident.v1',
  subject: 'incident-1',
  time: '2026-07-24T00:00:00.000Z',
  dataschema: 'https://schemas.enterpriseglue.io/events/incident-v1.json',
  tenantRef: 'tenant-1',
  data: {
    engineRef: 'engine-1',
    incidentRef: 'incident-1',
    incidentType: 'failedJob',
  },
} satisfies PluginHostEventV1;

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
          path: 'v1/events/incidents',
          requestSchema: { path: 'schemas/event.json', sha256: hash },
          responseSchema: { path: 'schemas/receipt.json', sha256: hash },
          requiredPermissions: ['host.events.subscribe.incident'],
          maxRequestBytes: 16_384,
          maxResponseBytes: 4_096,
          timeoutMs: 5_000,
          streaming: 'none',
        },
      ],
    },
  },
  scope: { installation: 'deployment', enablement: 'tenant' },
  permissions: {
    required: ['host.events.subscribe.incident'],
    optional: [],
  },
  network: { egressPolicy: 'none' },
  entitlement: { provider: 'none' },
  dependencies: [],
  conflicts: [],
  events: {
    subscriptions: [
      {
        type: 'io.enterpriseglue.host.incident.v1',
        deliveryOperationId: operationId,
        schema: { path: 'schemas/incident.json', sha256: hash },
        permission: 'host.events.subscribe.incident',
        maxAttempts: 3,
      },
    ],
  },
  jobs: { fixedSchedules: [] },
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

const subscriber = {
  pluginId,
  version: '1.0.0',
  manifest,
  resources,
  grantedPermissions: ['host.events.subscribe.incident'],
  subscription: manifest.events.subscriptions[0]!,
} satisfies PluginEventSubscriberRecordV1;

function claimed(): ClaimedPluginEventV1 {
  return {
    deliveryId: 'delivery-1',
    pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    attempt: 1,
    maxAttempts: 3,
    leaseOwner: 'worker-1',
    request: {
      apiVersion: 'event-delivery.plugin.enterpriseglue.io/v1',
      deliveryId: 'delivery-1',
      operationId,
      subscriptionType: event.type,
      attempt: 1,
      event,
    },
  };
}

describe('PluginEventDispatcherV1', () => {
  it('queues only a declared, granted, enabled tenant subscription', async () => {
    const enqueue = vi.fn(async () => ({ deliveryId: 'delivery-1' }));
    const store = unusedStore({ enqueue });
    const dispatcher = new PluginEventDispatcherV1(
      {
        eventSubscribers: async () => [subscriber],
        backendRecord: async () => subscriber,
        assertOperationPayload: async () => undefined,
      },
      { isExecutionAllowed: async () => true },
      {
        deploymentRef: 'deployment-1',
        invocationPrivateKey: async () => 'unused',
        store,
        workerRef: 'worker-1',
      },
    );

    await expect(dispatcher.publish(event)).resolves.toEqual({
      eventId: 'event-1',
      queued: [{ pluginId, deliveryId: 'delivery-1' }],
      failed: [],
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId,
        tenantRef: 'tenant-1',
        operationId,
        maxAttempts: 3,
      }),
    );
  });

  it('isolates one subscriber enqueue failure from another subscriber', async () => {
    const first = {
      ...subscriber,
      pluginId: 'io.enterpriseglue.first',
    } as PluginEventSubscriberRecordV1;
    const second = {
      ...subscriber,
      pluginId: 'io.enterpriseglue.second',
    } as PluginEventSubscriberRecordV1;
    const store = unusedStore({
      enqueue: async (input) => {
        if (input.pluginId === first.pluginId) {
          throw new Error('synthetic subscriber failure');
        }
        return { deliveryId: 'delivery-second' };
      },
    });
    const dispatcher = new PluginEventDispatcherV1(
      {
        eventSubscribers: async () => [first, second],
        backendRecord: async () => subscriber,
        assertOperationPayload: async () => undefined,
      },
      { isExecutionAllowed: async () => true },
      {
        deploymentRef: 'deployment-1',
        invocationPrivateKey: async () => 'unused',
        store,
        workerRef: 'worker-1',
      },
    );

    await expect(dispatcher.publish(event)).resolves.toEqual({
      eventId: 'event-1',
      queued: [
        {
          pluginId: 'io.enterpriseglue.second',
          deliveryId: 'delivery-second',
        },
      ],
      failed: [
        {
          pluginId: 'io.enterpriseglue.first',
          reasonCode: 'subscriber_unavailable',
        },
      ],
    });
  });

  it('signs, schema-checks, and completes an actual sidecar delivery', async () => {
    const pair = generateKeyPairSync('ed25519');
    const completion: Array<{ status: string; reasonCode: string }> = [];
    let claimedOnce = false;
    const store = unusedStore({
      claimDue: async () => {
        if (claimedOnce) return [];
        claimedOnce = true;
        return [claimed()];
      },
      complete: async (input) => {
        completion.push({
          status: input.receipt.status,
          reasonCode: input.receipt.reasonCode,
        });
        return summary(input.receipt.reasonCode);
      },
    });
    const fetchMock = vi.fn(async (url: string, init?: { headers?: unknown }) => {
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
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      expect(init?.headers).toEqual(
        expect.objectContaining({
          'X-EnterpriseGlue-Plugin-Invocation': expect.any(String),
        }),
      );
      return new Response(
        JSON.stringify({
          apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
          deliveryId: 'delivery-1',
          status: 'accepted',
          reasonCode: 'accepted',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const assertOperationPayload = vi.fn(async () => undefined);
    const dispatcher = new PluginEventDispatcherV1(
      {
        eventSubscribers: async () => [subscriber],
        backendRecord: async () => subscriber,
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
        workerRef: 'worker-1',
      },
    );

    await dispatcher.runOnce();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(assertOperationPayload).toHaveBeenCalledTimes(2);
    expect(completion).toEqual([
      { status: 'accepted', reasonCode: 'accepted' },
    ]);
  });
});

function unusedStore(
  overrides: Partial<PluginEventDeliveryStoreV1>,
): PluginEventDeliveryStoreV1 {
  return {
    enqueue: async () => ({ deliveryId: 'unused' }),
    claimDue: async () => [],
    complete: async () => summary('unused'),
    requeueDeadLetter: async () => summary('unused'),
    ...overrides,
  };
}

function summary(reasonCode: string): PluginEventSafeSummaryV1 {
  return {
    deliveryId: 'delivery-1',
    pluginId,
    tenantRef: 'tenant-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    status: 'delivered',
    attempt: 1,
    maxAttempts: 3,
    reasonCode,
    nextAttemptAt: 1,
    updatedAt: 1,
  };
}
