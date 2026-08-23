import { generateKeyPairSync } from 'node:crypto';

import {
  parseEnterpriseGluePluginManifestV1,
  type PluginResourceDescriptorV1,
} from '@enterpriseglue/plugin-sdk';
import {
  PluginGatewayAdmissionControllerV1,
  PluginGatewayCircuitBreakerV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import { describe, expect, it, vi } from 'vitest';

import { PluginContributionAvailabilityDispatcherV1 } from './pluginContributionAvailabilityDispatcher.js';
import { MemoryPluginContributionAvailabilityStoreV1 } from './pluginContributionAvailabilityStore.js';

const pluginId = 'io.enterpriseglue.reference';
const operationId = `${pluginId}.refresh-availability`;
const hash = 'a'.repeat(64);
const version = '1.0.0';
const gatedIds = [
  `${pluginId}.home`,
  `${pluginId}.navigation`,
  `${pluginId}.action`,
];

const manifest = parseEnterpriseGluePluginManifestV1({
  apiVersion: 'plugin.enterpriseglue.io/v1',
  kind: 'EnterpriseGluePlugin',
  metadata: {
    id: pluginId,
    version,
    displayName: 'Reference',
    publisher: 'io.enterpriseglue',
  },
  compatibility: {
    host: '>=0.4.0 <0.5.0',
    sdk: '^0.1.0',
    frontendProtocol: 1,
    backendProtocol: 1,
    requiredSlots: ['mission-control.incident.actions.v1'],
  },
  deployment: {
    frontend: {
      entry: 'frontend/index.js',
      sha256: hash,
      shared: {
        react: '19.2.6',
        reactDom: '19.2.6',
        router: '7.18.1',
        carbonReact: '1.107.0',
        pluginSdk: '0.1.0',
      },
    },
    backend: {
      image: `registry.example/reference@sha256:${'b'.repeat(64)}`,
      healthPath: '/_plugin/health',
      readyPath: '/_plugin/ready',
      protocolPath: '/_plugin/capabilities',
      operations: [
        {
          operationId,
          method: 'POST',
          path: 'v1/contribution-availability',
          requestSchema: {
            path: 'schemas/availability-request.json',
            sha256: hash,
          },
          responseSchema: {
            path: 'schemas/availability-response.json',
            sha256: hash,
          },
          requiredPermissions: ['host.identity.read_safe'],
          maxRequestBytes: 1024,
          maxResponseBytes: 16_384,
          timeoutMs: 5_000,
          streaming: 'none',
        },
      ],
    },
  },
  scope: { installation: 'deployment', enablement: 'tenant' },
  permissions: {
    required: ['host.identity.read_safe'],
    optional: [],
  },
  network: { egressPolicy: 'none' },
  entitlement: { provider: 'none' },
  dependencies: [],
  conflicts: [],
  events: { subscriptions: [] },
  contributionAvailability: {
    refreshOperationId: operationId,
    refreshIntervalSeconds: 300,
    maximumStalenessSeconds: 900,
    gatedContributionIds: gatedIds,
  },
  contributions: [
    {
      id: gatedIds[0],
      kind: 'route',
      scope: 'tenant',
      relativePath: 'reference',
    },
    {
      id: gatedIds[1],
      kind: 'navigation',
      routeId: gatedIds[0],
      section: 'tenant',
    },
    {
      id: gatedIds[2],
      kind: 'slot',
      slot: 'mission-control.incident.actions.v1',
    },
  ],
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

describe('PluginContributionAvailabilityDispatcherV1', () => {
  it('refreshes through signed admission and persists only the exact gated set', async () => {
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    const projection = {
      apiVersion:
        'contribution-availability.plugin.enterpriseglue.io/v1',
      evaluatedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 900_000).toISOString(),
      contributions: gatedIds.map((contributionId) => ({
        contributionId,
        available: true,
        reasonCode: 'available',
      })),
    };
    const { dispatcher, store, fetchMock } = fixtureFor(
      projection,
      now,
    );

    await dispatcher.runOnce();

    await expect(
      store.readCurrent({
        deploymentRef: 'deployment-1',
        tenantRef: 'tenant-1',
        pluginId,
        pluginVersion: version,
        installerRevision: 7,
        now,
      }),
    ).resolves.toEqual(projection);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a valid-looking projection that omits a gated contribution', async () => {
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    const { dispatcher, store } = fixtureFor(
      {
        apiVersion:
          'contribution-availability.plugin.enterpriseglue.io/v1',
        evaluatedAt: new Date(now).toISOString(),
        validUntil: new Date(now + 900_000).toISOString(),
        contributions: gatedIds.slice(0, 2).map((contributionId) => ({
          contributionId,
          available: true,
          reasonCode: 'available',
        })),
      },
      now,
    );

    await dispatcher.runOnce();

    await expect(
      store.readCurrent({
        deploymentRef: 'deployment-1',
        tenantRef: 'tenant-1',
        pluginId,
        pluginVersion: version,
        installerRevision: 7,
        now,
      }),
    ).resolves.toBeNull();
  });
});

function fixtureFor(projection: unknown, now: number) {
  const pair = generateKeyPairSync('ed25519');
  const store = new MemoryPluginContributionAvailabilityStoreV1();
  const fetchMock = vi.fn(
    async (url: string, init?: { headers?: unknown }) => {
      if (url.endsWith('/_plugin/capabilities')) {
        return jsonResponse({
          protocol: 'backend.plugin.enterpriseglue.io/v1',
          pluginId,
          pluginVersion: version,
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
        });
      }
      expect(init?.headers).toEqual(
        expect.objectContaining({
          'X-EnterpriseGlue-Plugin-Invocation': expect.any(String),
        }),
      );
      return jsonResponse(projection);
    },
  );
  const dispatcher = new PluginContributionAvailabilityDispatcherV1(
    {
      controlSnapshot: async () => ({
        revision: 7,
        records: [
          {
            pluginId,
            version,
            displayName: 'Reference',
            publisher: 'io.enterpriseglue',
            bundleDigest: `registry.example/reference@sha256:${'b'.repeat(64)}`,
            manifestSha256: hash,
            sourceRecordHash: hash,
            installerEnabled: true,
            enablementScope: 'tenant',
            compatible: true,
            healthy: true,
            entitled: 'not_required',
            reasonCode: 'none',
            grantedPermissions: ['host.identity.read_safe'],
          },
        ],
      }),
      backendRecord: async () => ({
        pluginId,
        version,
        manifest,
        resources,
        grantedPermissions: ['host.identity.read_safe'],
      }),
      assertOperationPayload: async () => undefined,
    },
    {
      enabledTenantRefs: async () => ['tenant-1'],
      isExecutionAllowed: async () => true,
    },
    {
      deploymentRef: 'deployment-1',
      invocationPrivateKey: async () =>
        pair.privateKey
          .export({ type: 'pkcs8', format: 'pem' })
          .toString(),
      admission: new PluginGatewayAdmissionControllerV1({
        windowMs: 60_000,
        maxRequestsPerSubjectOperation: 10,
        maxRequestsPerPlugin: 10,
        maxConcurrentPerOperation: 2,
      }),
      circuitBreaker: new PluginGatewayCircuitBreakerV1({
        failureThreshold: 3,
        openMs: 30_000,
      }),
      store,
      fetch: fetchMock as never,
      now: () => now,
      workerRef: 'availability-worker-1',
    },
  );
  return { dispatcher, store, fetchMock };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
