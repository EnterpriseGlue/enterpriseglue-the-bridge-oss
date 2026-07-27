import { generateKeyPairSync } from 'node:crypto';

import {
  parseEnterpriseGluePluginManifestV1,
  type PluginPermissionV1,
} from '@enterpriseglue/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { signPluginInvocationV1 } from './gateway.js';
import {
  executePluginIdentityBrokerV1,
  executePluginDiagnosticCollectionBrokerV1,
  executePluginDiagnosticCollectorStatusBrokerV1,
  executePluginFixedScheduleBrokerV1,
  executePluginNotificationBrokerV1,
  executePluginResourceBrokerV1,
  executePluginStorageBrokerV1,
  HostBrokerErrorV1,
  type PluginStorageStoreV1,
} from './hostBroker.js';

const PLUGIN_ID = 'io.enterpriseglue.example';
const OPERATION_ID = `${PLUGIN_ID}.analyze`;
const permissions: PluginPermissionV1[] = [
  'host.identity.read_safe',
  'host.engine.incidents.read_metadata',
  'host.engine.diagnostics.collect_sanitized',
  'host.plugin_storage.tenant',
  'host.notifications.publish_safe',
  'host.jobs.schedule_fixed',
];
const keys = generateKeyPairSync('ed25519');

function record() {
  return {
    pluginId: PLUGIN_ID,
    grantedPermissions: permissions,
    manifest: parseEnterpriseGluePluginManifestV1({
      apiVersion: 'plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePlugin',
      metadata: {
        id: PLUGIN_ID,
        version: '1.0.0',
        displayName: 'Example',
        publisher: 'io.enterpriseglue',
      },
      compatibility: {
        host: '^0.4.0',
        sdk: '^0.1.0',
        backendProtocol: 1,
        requiredSlots: [],
      },
      deployment: {
        backend: {
          image: `ghcr.io/enterpriseglue/example@sha256:${'a'.repeat(64)}`,
          healthPath: '/_plugin/health',
          readyPath: '/_plugin/ready',
          protocolPath: '/_plugin/capabilities',
          operations: [
            {
              operationId: OPERATION_ID,
              method: 'POST',
              path: 'v1/analyze',
              requestSchema: {
                path: 'schemas/request.json',
                sha256: 'b'.repeat(64),
              },
              responseSchema: {
                path: 'schemas/response.json',
                sha256: 'c'.repeat(64),
              },
              requiredPermissions: permissions,
              resourceBinding: {
                kind: 'engine',
                source: 'body',
                field: 'engineRef',
              },
              maxRequestBytes: 4096,
              maxResponseBytes: 4096,
              timeoutMs: 1000,
              streaming: 'none',
            },
          ],
        },
      },
      scope: { installation: 'deployment', enablement: 'tenant' },
      permissions: { required: permissions, optional: [] },
      network: { egressPolicy: 'none' },
      entitlement: { provider: 'none' },
      dependencies: [],
      conflicts: [],
      events: { subscriptions: [] },
      jobs: {
        fixedSchedules: [
          {
            jobType: `${PLUGIN_ID}.refresh-index`,
            deliveryOperationId: OPERATION_ID,
            allowedIntervalsSeconds: [3600, 86400],
            permission: 'host.jobs.schedule_fixed',
            maxAttempts: 5,
          },
        ],
      },
      contributions: [],
    }),
  };
}

function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return signPluginInvocationV1(
    {
      iss: 'enterpriseglue-oss',
      aud: PLUGIN_ID,
      sub: 'subject-1',
      iat: now,
      exp: now + 30,
      jti: `invocation-${Math.random()}`,
      tenantRef: 'tenant-1',
      deploymentRef: 'deployment-1',
      operationId: OPERATION_ID,
      grantedPermissions: permissions,
      resourceRefs: [{ kind: 'engine', ref: 'engine-1' }],
      correlationId: 'correlation-1',
      ...overrides,
    },
    keys.privateKey,
  );
}

function replayStore() {
  const consumed = new Set<string>();
  return {
    consume: async (jti: string) => {
      if (consumed.has(jti)) return false;
      consumed.add(jti);
      return true;
    },
  };
}

const base = {
  record: record(),
  invocationPublicKey: keys.publicKey,
  expectedDeploymentRef: 'deployment-1',
};

describe('host broker runtime', () => {
  it('derives safe identity only from a verified invocation', async () => {
    await expect(
      executePluginIdentityBrokerV1({
        ...base,
        request: {
          apiVersion: 'identity-request.plugin.enterpriseglue.io/v1',
          callId: 'identity-1',
          operationId: OPERATION_ID,
        },
        invocationToken: token(),
        replayStore: replayStore(),
      }),
    ).resolves.toMatchObject({
      subjectRef: 'subject-1',
      tenantRef: 'tenant-1',
      deploymentRef: 'deployment-1',
    });
  });

  it('requires resource binding and returns only a closed metadata response', async () => {
    await expect(
      executePluginResourceBrokerV1({
        ...base,
        request: {
          apiVersion: 'resource-request.plugin.enterpriseglue.io/v1',
          callId: 'resource-1',
          operationId: OPERATION_ID,
          kind: 'incident',
          engineRef: 'engine-1',
          incidentRef: 'incident-1',
        },
        invocationToken: token(),
        replayStore: replayStore(),
        load: async () => ({
          apiVersion: 'resource.plugin.enterpriseglue.io/v1',
          kind: 'incident',
          engineRef: 'engine-1',
          incidentRef: 'incident-1',
          incidentType: 'failedJob',
          errorCode: 'OPTIMISTIC_LOCK',
        }),
      }),
    ).resolves.toMatchObject({ incidentType: 'failedJob' });

    await expect(
      executePluginResourceBrokerV1({
        ...base,
        request: {
          apiVersion: 'resource-request.plugin.enterpriseglue.io/v1',
          callId: 'resource-2',
          operationId: OPERATION_ID,
          kind: 'incident',
          engineRef: 'engine-2',
          incidentRef: 'incident-1',
        },
        invocationToken: token(),
        replayStore: replayStore(),
        load: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'resource_denied' });
  });

  it('applies tenant/plugin scope and optimistic storage contracts', async () => {
    const seen: unknown[] = [];
    const store: PluginStorageStoreV1 = {
      execute: async (input) => {
        seen.push(input);
        return {
          apiVersion: 'storage-result.plugin.enterpriseglue.io/v1',
          action: 'put',
          revision: 'r1',
        };
      },
    };
    await expect(
      executePluginStorageBrokerV1({
        ...base,
        request: {
          apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
          callId: 'storage-1',
          operationId: OPERATION_ID,
          action: 'put',
          scope: 'tenant',
          key: 'automation/cursor',
          value: { cursor: 3 },
        },
        invocationToken: token(),
        replayStore: replayStore(),
        store,
      }),
    ).resolves.toMatchObject({ revision: 'r1' });
    expect(seen).toContainEqual(
      expect.objectContaining({
        pluginId: PLUGIN_ID,
        tenantRef: 'tenant-1',
        key: 'automation/cursor',
      }),
    );
  });

  it('keeps manual and metadata diagnostics artifact-free and raw-upload impossible', async () => {
    const request = {
      apiVersion:
        'diagnostic-collection-request.plugin.enterpriseglue.io/v1' as const,
      callId: 'diagnostic-manual',
      operationId: OPERATION_ID,
      engineRef: 'engine-1',
      trigger: { kind: 'incident' as const, incidentRef: 'incident-1' },
      profile: 'incident_minimal' as const,
      mode: 'manual' as const,
      idempotencyKey: 'diagnostic-1',
    };
    await expect(
      executePluginDiagnosticCollectionBrokerV1({
        ...base,
        request,
        invocationToken: token(),
        replayStore: replayStore(),
      }),
    ).resolves.toMatchObject({
      status: 'requires_confirmation',
      filteringBoundary: 'not_applicable',
      rawUploadPermitted: false,
    });
    await expect(
      executePluginDiagnosticCollectionBrokerV1({
        ...base,
        request: {
          ...request,
          callId: 'diagnostic-metadata',
          mode: 'metadata_auto',
        },
        invocationToken: token(),
        replayStore: replayStore(),
      }),
    ).resolves.toMatchObject({
      status: 'metadata_ready',
      rawUploadPermitted: false,
    });
  });

  it('requires an explicit local collector policy for automatic sanitized bundles', async () => {
    const request = {
      apiVersion:
        'diagnostic-collection-request.plugin.enterpriseglue.io/v1' as const,
      callId: 'diagnostic-sanitized',
      operationId: OPERATION_ID,
      engineRef: 'engine-1',
      trigger: { kind: 'engine' as const },
      profile: 'engine_health' as const,
      mode: 'sanitized_bundle_auto' as const,
      idempotencyKey: 'diagnostic-2',
      consumerContextRef: 'case-1',
    };
    await expect(
      executePluginDiagnosticCollectionBrokerV1({
        ...base,
        request,
        invocationToken: token(),
        replayStore: replayStore(),
      }),
    ).resolves.toMatchObject({
      status: 'rejected',
      reasonCode: 'automatic_collection_disabled',
      rawUploadPermitted: false,
    });
    await expect(
      executePluginDiagnosticCollectionBrokerV1({
        ...base,
        request: { ...request, callId: 'diagnostic-sanitized-enabled' },
        invocationToken: token(),
        replayStore: replayStore(),
        allowSanitizedBundleAuto: true,
        collector: {
          collect: async () => ({
            intentRef: 'diagnostic-safe-1',
            status: 'sanitized_bundle_ready',
            filteringBoundary: 'enterpriseglue_backend',
            reasonCode: 'locally_filtered',
            consumerContextRef: 'case-1',
            artifactRef: 'artifact-1',
          }),
        },
      }),
    ).resolves.toMatchObject({
      status: 'sanitized_bundle_ready',
      filteringBoundary: 'enterpriseglue_backend',
      rawUploadPermitted: false,
      consumerContextRef: 'case-1',
      artifactRef: 'artifact-1',
    });
  });

  it('returns only deployment-owned collector health classes', async () => {
    const request = {
      apiVersion:
        'diagnostic-collector-status-request.plugin.enterpriseglue.io/v1' as const,
      callId: 'diagnostic-status-1',
      operationId: OPERATION_ID,
    };
    await expect(
      executePluginDiagnosticCollectorStatusBrokerV1({
        ...base,
        request,
        invocationToken: token(),
        replayStore: replayStore(),
        now: () => new Date('2026-07-26T00:00:00.000Z'),
      }),
    ).resolves.toEqual({
      apiVersion:
        'diagnostic-collector-status.plugin.enterpriseglue.io/v1',
      state: 'disabled',
      reasonCode: 'collector_not_configured',
      collectionPermission: 'granted',
      sourceClass: 'none',
      filteringBoundary: 'enterpriseglue_backend',
      rawUploadPermitted: false,
      browserEditable: false,
      checkedAt: '2026-07-26T00:00:00.000Z',
    });
    await expect(
      executePluginDiagnosticCollectorStatusBrokerV1({
        ...base,
        request: { ...request, callId: 'diagnostic-status-2' },
        invocationToken: token(),
        replayStore: replayStore(),
        collector: {
          collect: async () => {
            throw new Error('not_used');
          },
          status: async ({ claims }) => {
            expect(claims.tenantRef).toBe('tenant-1');
            return {
              state: 'ready',
              reasonCode: 'collector_ready',
              sourceClass: 'single',
              filteringBoundary: 'enterpriseglue_backend',
              checkedAt: '2026-07-26T00:00:00.000Z',
            };
          },
        },
      }),
    ).resolves.toMatchObject({
      state: 'ready',
      collectionPermission: 'granted',
      sourceClass: 'single',
      rawUploadPermitted: false,
      browserEditable: false,
    });
  });

  it('publishes a host-rendered notification only to the signed subject', async () => {
    const seen: unknown[] = [];
    await expect(
      executePluginNotificationBrokerV1({
        ...base,
        request: {
          apiVersion:
            'notification-publish-request.plugin.enterpriseglue.io/v1',
          callId: 'notification-1',
          operationId: OPERATION_ID,
          templateId: 'host.plugin.action-required.v1',
          reasonCode: 'analysis_needs_attention',
          resource: { kind: 'engine', ref: 'engine-1' },
          occurrenceCount: 2,
          idempotencyKey: 'notification-key-1',
        },
        invocationToken: token(),
        replayStore: replayStore(),
        publisher: {
          publish: async (input) => {
            seen.push(input);
            return {
              apiVersion:
                'notification-publish-result.plugin.enterpriseglue.io/v1',
              notificationRef: 'notification-1',
              status: 'published',
            };
          },
        },
      }),
    ).resolves.toMatchObject({ status: 'published' });
    expect(seen).toContainEqual(
      expect.objectContaining({
        tenantRef: 'tenant-1',
        subjectRef: 'subject-1',
      }),
    );

    await expect(
      executePluginNotificationBrokerV1({
        ...base,
        request: {
          apiVersion:
            'notification-publish-request.plugin.enterpriseglue.io/v1',
          callId: 'notification-unbound',
          operationId: OPERATION_ID,
          templateId: 'host.plugin.operation-failed.v1',
          reasonCode: 'analysis_failed',
          resource: { kind: 'incident', ref: 'incident-not-in-token' },
          idempotencyKey: 'notification-key-2',
        },
        invocationToken: token(),
        replayStore: replayStore(),
        publisher: {
          publish: async () => Promise.reject(new Error('must not run')),
        },
      }),
    ).rejects.toMatchObject({ code: 'resource_denied' });
  });

  it('schedules only manifest-declared job types and intervals', async () => {
    const seen: unknown[] = [];
    await expect(
      executePluginFixedScheduleBrokerV1({
        ...base,
        request: {
          apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
          callId: 'schedule-1',
          operationId: OPERATION_ID,
          action: 'upsert',
          jobType: `${PLUGIN_ID}.refresh-index`,
          intervalSeconds: 3600,
          idempotencyKey: 'schedule-key-1',
        },
        invocationToken: token(),
        replayStore: replayStore(),
        store: {
          execute: async (input) => {
            seen.push(input);
            return {
              apiVersion:
                'fixed-schedule-result.plugin.enterpriseglue.io/v1',
              jobRef: 'job-1',
              status: 'scheduled',
              nextRunAt: '2026-07-25T02:00:00.000Z',
              revision: 1,
            };
          },
        },
      }),
    ).resolves.toMatchObject({ status: 'scheduled', revision: 1 });
    expect(seen).toContainEqual(
      expect.objectContaining({
        tenantRef: 'tenant-1',
        subjectRef: 'subject-1',
        allowedIntervalsSeconds: [3600, 86400],
        maxAttempts: 5,
      }),
    );

    await expect(
      executePluginFixedScheduleBrokerV1({
        ...base,
        request: {
          apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
          callId: 'schedule-denied',
          operationId: OPERATION_ID,
          action: 'upsert',
          jobType: `${PLUGIN_ID}.refresh-index`,
          intervalSeconds: 600,
          idempotencyKey: 'schedule-key-2',
        },
        invocationToken: token(),
        replayStore: replayStore(),
        store: {
          execute: async () => Promise.reject(new Error('must not run')),
        },
      }),
    ).rejects.toMatchObject({ code: 'schedule_interval_denied' });
  });

  it('fails closed on missing grant, replay, deployment mismatch, and large values', async () => {
    const sharedReplay = replayStore();
    const replayToken = token({ jti: 'same-invocation' });
    const identityInput = {
      ...base,
      request: {
        apiVersion: 'identity-request.plugin.enterpriseglue.io/v1' as const,
        callId: 'identity-replay',
        operationId: OPERATION_ID,
      },
      invocationToken: replayToken,
      replayStore: sharedReplay,
    };
    await executePluginIdentityBrokerV1(identityInput);
    await expect(
      executePluginIdentityBrokerV1(identityInput),
    ).rejects.toMatchObject({ code: 'invocation_replayed' });

    await expect(
      executePluginIdentityBrokerV1({
        ...identityInput,
        invocationToken: token({ deploymentRef: 'another-deployment' }),
        replayStore: replayStore(),
      }),
    ).rejects.toMatchObject({ code: 'deployment_mismatch' });

    const tooLarge = executePluginStorageBrokerV1({
      ...base,
      request: {
        apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
        callId: 'storage-large',
        operationId: OPERATION_ID,
        action: 'put',
        scope: 'tenant',
        key: 'large',
        value: 'x'.repeat(70_000),
      },
      invocationToken: token(),
      replayStore: replayStore(),
      store: { execute: async () => Promise.reject(new Error('not called')) },
    });
    await expect(tooLarge).rejects.toBeInstanceOf(HostBrokerErrorV1);
    await expect(tooLarge).rejects.toMatchObject({
      code: 'storage_value_too_large',
    });
  });
});
