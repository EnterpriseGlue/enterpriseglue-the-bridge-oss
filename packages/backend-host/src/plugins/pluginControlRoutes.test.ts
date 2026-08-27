import type { AddressInfo } from 'node:net';

import {
  createPluginPlatformCapabilityCatalogV1,
  type PluginId,
} from '@enterpriseglue/plugin-sdk';
import express, { type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';

import {
  MemoryPluginControlStoreV1,
  PluginControlPlaneV1,
} from './pluginControlPlane.js';
import { registerPluginControlRoutesV1 } from './pluginControlRoutes.js';
import { PluginDiagnosticMetricsRegistryV1 } from './pluginDiagnosticMetrics.js';
import { PluginEventMetricsRegistryV1 } from './pluginEventMetrics.js';
import type { PluginEventOperationsStoreV1 } from './pluginEventDeliveryStore.js';
import type { PluginControlSourceSnapshotV1 } from './pluginRuntime.js';

const pluginId = 'io.enterpriseglue.reference' as PluginId;

function capabilityCatalog() {
  return createPluginPlatformCapabilityCatalogV1({
    hostVersion: '0.4.6',
    sdkVersion: '0.1.0',
    sharedFrontend: {
      react: '19.2.6',
      reactDom: '19.2.6',
      router: '7.18.1',
      carbonReact: '1.107.0',
      pluginSdk: '0.1.0',
    },
    egressPolicies: ['approved-cloud'],
    trustedPublishers: ['io.enterpriseglue'],
  });
}

function fixture(
  tenantActivationPolicy: 'direct' | 'approval_required' = 'direct',
) {
  let sourceReads = 0;
  const snapshot: PluginControlSourceSnapshotV1 = {
    revision: 1,
    deploymentExecution: {
      apiVersion:
        'deployment-execution-observation.plugin.enterpriseglue.io/v1',
      observedFrom: 'local_execution_mirror',
      workloadReconciliation: 'not_checked',
      observationState: 'current',
      observationReason: 'none',
      desiredRevision: 1,
      planSha256: 'd'.repeat(64),
      execution: {
        executionId: 'execution-route-0001',
        executionRevision: 2,
        desiredRevision: 1,
        planSha256: 'd'.repeat(64),
        pluginId,
        operation: 'install',
        status: 'queued',
        completedPhases: ['stage'],
        nextPhase: 'commit',
        reasonCode: 'none',
        updatedAt: '2026-07-24T01:00:00.000Z',
        leaseExpiresAt: null,
      },
    },
    records: [
      {
        pluginId,
        version: '1.0.0',
        displayName: 'Reference plugin',
        publisher: 'io.enterpriseglue' as PluginId,
        bundleDigest: `registry.example/reference@sha256:${'a'.repeat(64)}`,
        manifestSha256: 'b'.repeat(64),
        sourceRecordHash: 'c'.repeat(64),
        installerEnabled: true,
        enablementScope: 'tenant',
        compatible: true,
        healthy: true,
        entitled: 'not_required',
        reasonCode: 'none',
        grantedPermissions: ['host.identity.read_safe'],
      },
    ],
  };
  const source = {
    async controlSnapshot() {
      sourceReads += 1;
      return structuredClone(snapshot);
    },
  };
  const control = new PluginControlPlaneV1(
    source,
    new MemoryPluginControlStoreV1(),
    {
      defaultTenantRef: 'default-tenant-id',
      tenantActivationPolicy,
      now: () => new Date('2026-07-24T01:00:00.000Z'),
    },
  );
  return {
    control,
    sourceReads: () => sourceReads,
  };
}

const allowAdmin: RequestHandler = (request, _response, next) => {
  request.user = {
    userId: 'admin-1',
    platformRole: 'admin',
  } as NonNullable<typeof request.user>;
  request.tenant = {
    tenantId: 'default-tenant-id',
    tenantSlug: 'default',
  };
  next();
};

const deny: RequestHandler = (_request, response) => {
  response.status(403).json({ code: 'access_denied' });
};

const allowAlpha: RequestHandler = (request, _response, next) => {
  request.user = {
    userId: 'alpha-user',
    platformRole: 'user',
  } as NonNullable<typeof request.user>;
  request.tenant = {
    tenantId: 'tenant-alpha',
    tenantSlug: 'alpha',
  };
  next();
};

const allowWorkload: RequestHandler = (request, _response, next) => {
  request.serviceAccount = {
    id: 'cloud-controller',
    scopes: ['tenant:lifecycle'],
  } as NonNullable<typeof request.serviceAccount>;
  next();
};

describe('plugin control routes', () => {
  it('runs authorization before reading installer or lifecycle state', async () => {
    const test = fixture();
    const diagnosticMetrics = new PluginDiagnosticMetricsRegistryV1();
    const eventMetrics = new PluginEventMetricsRegistryV1();
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, test.control, {
      deploymentAdminMiddleware: [deny],
      tenantAdminMiddleware: [deny],
      diagnosticMetrics,
      eventMetrics,
      capabilityCatalog: capabilityCatalog(),
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/plugin-platform/v1/plugins`,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ code: 'access_denied' });
      expect(test.sourceReads()).toBe(0);
      const capabilities = await fetch(
        `${baseUrl}/api/plugin-platform/v1/capabilities`,
      );
      expect(capabilities.status).toBe(403);
      expect(test.sourceReads()).toBe(0);
      const execution = await fetch(
        `${baseUrl}/api/plugin-platform/v1/deployment-execution`,
      );
      expect(execution.status).toBe(403);
      expect(test.sourceReads()).toBe(0);
      const metrics = await fetch(
        `${baseUrl}/api/plugin-platform/v1/metrics/diagnostics`,
      );
      expect(metrics.status).toBe(403);
      expect(test.sourceReads()).toBe(0);
      const eventMetricResponse = await fetch(
        `${baseUrl}/api/plugin-platform/v1/metrics/events`,
      );
      expect(eventMetricResponse.status).toBe(403);
      expect(test.sourceReads()).toBe(0);
    });
  });

  it('uses the read and manage authorization lanes independently', async () => {
    const test = fixture();
    const denyWith = (status: number, lane: string): RequestHandler => (
      _request,
      response,
    ) => response.status(status).json({ lane });
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, test.control, {
      deploymentReadMiddleware: [denyWith(418, 'deployment-read')],
      deploymentManageMiddleware: [denyWith(419, 'deployment-manage')],
      tenantReadMiddleware: [denyWith(420, 'tenant-read')],
      tenantManageMiddleware: [denyWith(421, 'tenant-manage')],
      tenantRequestMiddleware: [denyWith(422, 'tenant-request')],
    });

    await withServer(app, async (baseUrl) => {
      await expect(
        fetch(`${baseUrl}/api/plugin-platform/v1/plugins`),
      ).resolves.toMatchObject({ status: 418 });
      await expect(
        fetch(`${baseUrl}/api/plugin-platform/v1/plugins/${pluginId}/disable`, {
          method: 'POST',
        }),
      ).resolves.toMatchObject({ status: 419 });
      await expect(
        fetch(
          `${baseUrl}/t/default/api/plugin-platform/v1/plugins/${pluginId}/enablement`,
        ),
      ).resolves.toMatchObject({ status: 420 });
      await expect(
        fetch(
          `${baseUrl}/t/default/api/plugin-platform/v1/plugins/${pluginId}/enablement`,
          { method: 'PUT' },
        ),
      ).resolves.toMatchObject({ status: 421 });
      await expect(
        fetch(
          `${baseUrl}/api/t/default/apps/${pluginId}/activation-request`,
          { method: 'POST' },
        ),
      ).resolves.toMatchObject({ status: 422 });
      await expect(
        fetch(
          `${baseUrl}/api/workloads/tenants/default-tenant-id/apps/${pluginId}/eligibility`,
          { method: 'PUT' },
        ),
      ).resolves.toMatchObject({ status: 401 });
    });
    expect(test.sourceReads()).toBe(0);
  });

  it('keeps eligibility ingestion workload-only and returns only the safe projection', async () => {
    const calls: unknown[] = [];
    const projection = {
      apiVersion: 'tenant-eligibility-projection.plugin.enterpriseglue.io/v1' as const,
      pluginId,
      pluginVersion: '1.0.0',
      state: 'active' as const,
      effectiveFrom: null,
      effectiveUntil: '2026-08-29T01:00:00.000Z',
      limitsHash: 'a'.repeat(64),
      revision: 4,
      issuer: 'https://control.enterpriseglue.example',
      expiresAt: '2026-08-29T02:00:00.000Z',
      projectionRef: 'projection-safe-ref',
    };
    const control = {
      async applyTenantEligibility(input: unknown) {
        calls.push(input);
        return projection;
      },
      async getTenantEligibility() {
        return projection;
      },
    } as unknown as PluginControlPlaneV1;
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, control, {
      deploymentAdminMiddleware: [deny],
      tenantReadMiddleware: [allowAlpha],
      tenantManageMiddleware: [deny],
      tenantRequestMiddleware: [deny],
      eligibilityWorkloadMiddleware: [allowWorkload],
    });

    await withServer(app, async (baseUrl) => {
      const applied = await fetch(
        `${baseUrl}/api/workloads/tenants/tenant-alpha/apps/${pluginId}/eligibility`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ signedProjection: 'signed.eligibility.projection-value' }),
        },
      );
      expect(applied.status).toBe(200);
      expect(applied.headers.get('cache-control')).toBe('no-store');
      expect(await applied.json()).toEqual(projection);
      expect(calls).toEqual([
        expect.objectContaining({
          pluginId,
          tenantRef: 'tenant-alpha',
          signedProjection: 'signed.eligibility.projection-value',
          actorRef: 'cloud-controller',
        }),
      ]);

      const read = await fetch(
        `${baseUrl}/api/t/alpha/apps/${pluginId}/eligibility`,
      );
      expect(read.status).toBe(200);
      const safe = await read.json();
      expect(safe).toEqual(projection);
      expect(JSON.stringify(safe)).not.toContain('signedProjection');
      expect(JSON.stringify(safe)).not.toContain('tenant-alpha');
    });
  });

  it('returns safe state, enforces optimistic mutation, and exposes operation status', async () => {
    const test = fixture();
    const diagnosticMetrics = new PluginDiagnosticMetricsRegistryV1(
      () => new Date('2026-07-24T01:00:00.000Z'),
    );
    const eventMetrics = new PluginEventMetricsRegistryV1(
      () => new Date('2026-07-24T01:00:00.000Z'),
    );
    diagnosticMetrics.recordStatus({
      pluginId,
      state: 'degraded',
      reasonCode: 'collector_source_invalid',
      sourceClass: 'single',
    });
    eventMetrics.recordEnqueue({
      pluginId,
      subscriptionType: 'io.enterpriseglue.host.incident.v1',
      outcome: 'queued',
      reasonCode: 'queued',
    });
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, test.control, {
      deploymentAdminMiddleware: [allowAdmin],
      tenantAdminMiddleware: [allowAdmin],
      diagnosticMetrics,
      eventMetrics,
      capabilityCatalog: capabilityCatalog(),
    });
    await withServer(app, async (baseUrl) => {
      const capabilities = await fetch(
        `${baseUrl}/api/plugin-platform/v1/capabilities`,
      );
      expect(capabilities.status).toBe(200);
      expect(capabilities.headers.get('cache-control')).toBe('no-store');
      const capabilityBody = await capabilities.json();
      expect(capabilityBody).toMatchObject({
        apiVersion: 'platform-capabilities.plugin.enterpriseglue.io/v1',
        metadata: { catalogRevision: '2026-08-24.1' },
        compatibility: {
          hostVersion: '0.4.6',
          sdkVersion: '0.1.0',
        },
      });
      expect(JSON.stringify(capabilityBody)).not.toContain('publicKey');
      expect(JSON.stringify(capabilityBody)).not.toContain('tenantRef');

      const listed = await fetch(
        `${baseUrl}/api/plugin-platform/v1/plugins`,
      );
      expect(listed.status).toBe(200);
      expect(listed.headers.get('cache-control')).toBe('no-store');
      expect(await listed.json()).toMatchObject({
        revision: 1,
        plugins: [{ pluginId, enabled: true, revision: 0 }],
      });
      const execution = await fetch(
        `${baseUrl}/api/plugin-platform/v1/deployment-execution`,
      );
      expect(execution.status).toBe(200);
      expect(execution.headers.get('cache-control')).toBe('no-store');
      const executionBody = await execution.json();
      expect(executionBody).toMatchObject({
        observationState: 'current',
        workloadReconciliation: 'not_checked',
        execution: {
          pluginId,
          operation: 'install',
          status: 'queued',
        },
      });
      expect(JSON.stringify(executionBody)).not.toContain('leaseOwner');
      expect(JSON.stringify(executionBody)).not.toContain('history');
      expect(JSON.stringify(executionBody)).not.toContain('command');
      const metrics = await fetch(
        `${baseUrl}/api/plugin-platform/v1/metrics/diagnostics`,
      );
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get('cache-control')).toBe('no-store');
      expect(await metrics.json()).toEqual({
        apiVersion: 'diagnostic-metrics.plugin.enterpriseglue.io/v1',
        generatedAt: '2026-07-24T01:00:00.000Z',
        collections: [],
        statusChecks: [
          {
            pluginId,
            state: 'degraded',
            reasonCode: 'collector_source_invalid',
            sourceClass: 'single',
            count: 1,
          },
        ],
      });
      const eventMetricResponse = await fetch(
        `${baseUrl}/api/plugin-platform/v1/metrics/events`,
      );
      expect(eventMetricResponse.status).toBe(200);
      expect(eventMetricResponse.headers.get('cache-control')).toBe(
        'no-store',
      );
      expect(await eventMetricResponse.json()).toEqual({
        apiVersion: 'event-metrics.plugin.enterpriseglue.io/v1',
        generatedAt: '2026-07-24T01:00:00.000Z',
        enqueues: [
          {
            pluginId,
            subscriptionType: 'io.enterpriseglue.host.incident.v1',
            outcome: 'queued',
            reasonCode: 'queued',
            count: 1,
          },
        ],
        deliveries: [],
        circuits: [],
      });

      const disabled = await fetch(
        `${baseUrl}/api/plugin-platform/v1/plugins/${pluginId}/disable`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'route-test-1',
          },
          body: JSON.stringify({
            idempotencyKey: 'disable-route-request-0001',
            expectedRevision: 0,
            reason: 'administrator_request',
          }),
        },
      );
      expect(disabled.status).toBe(200);
      const operation = (await disabled.json()) as {
        operationId: string;
      };

      const stale = await fetch(
        `${baseUrl}/api/plugin-platform/v1/plugins/${pluginId}/disable`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey: 'disable-route-request-0002',
            expectedRevision: 0,
            reason: 'administrator_request',
          }),
        },
      );
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ code: 'revision_conflict' });

      const status = await fetch(
        `${baseUrl}/api/plugin-platform/v1/operations/${operation.operationId}`,
      );
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({
        operationId: operation.operationId,
        pluginId,
        type: 'disable',
        status: 'succeeded',
      });
    });
  });

  it('lists payload-free event dead letters and revision-protects admin replay', async () => {
    const test = fixture();
    const requeues: Array<{
      pluginId: string;
      deliveryId: string;
      expectedAttempt: number;
      actorRef: string;
      correlationId: string;
    }> = [];
    const eventOperations: PluginEventOperationsStoreV1 = {
      async listDeadLetters(input) {
        expect(input).toEqual({ limit: 1 });
        return {
          items: [
            {
              deliveryId: 'event-dead-letter-1',
              pluginId,
              subscriptionType:
                'io.enterpriseglue.host.incident.v1',
              attempt: 3,
              maxAttempts: 3,
              reasonCode: 'delivery_unavailable',
              createdAt: Date.parse('2026-07-24T01:00:00.000Z'),
              updatedAt: Date.parse('2026-07-24T01:03:00.000Z'),
            },
          ],
          nextCursor: null,
        };
      },
      async requeueDeadLetter(input) {
        requeues.push(input);
        return {
          deliveryId: input.deliveryId,
          pluginId: input.pluginId,
          tenantRef: 'never-projected-tenant',
          subscriptionType:
            'io.enterpriseglue.host.incident.v1',
          status: 'pending',
          attempt: 0,
          maxAttempts: 3,
          reasonCode: 'administrator_requeued',
          nextAttemptAt: Date.parse('2026-07-24T01:04:00.000Z'),
          updatedAt: Date.parse('2026-07-24T01:04:00.000Z'),
        };
      },
    };
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, test.control, {
      deploymentAdminMiddleware: [allowAdmin],
      tenantAdminMiddleware: [allowAdmin],
      eventOperations,
    });
    await withServer(app, async (baseUrl) => {
      const listed = await fetch(
        `${baseUrl}/api/plugin-platform/v1/events/dead-letters?limit=1`,
      );
      expect(listed.status).toBe(200);
      expect(listed.headers.get('cache-control')).toBe('no-store');
      const body = await listed.json();
      expect(body).toMatchObject({
        items: [
          {
            deliveryId: 'event-dead-letter-1',
            pluginId,
            tenantScoped: true,
            attempt: 3,
            reasonCode: 'delivery_unavailable',
          },
        ],
      });
      expect(JSON.stringify(body)).not.toContain('tenantRef');
      expect(JSON.stringify(body)).not.toContain('eventPayload');

      const invalid = await fetch(
        `${baseUrl}/api/plugin-platform/v1/plugins/${pluginId}/events/dead-letters/event-dead-letter-1/requeue`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedAttempt: 3,
            destination: 'https://attacker.invalid',
          }),
        },
      );
      expect(invalid.status).toBe(400);
      expect(requeues).toHaveLength(0);

      const replayed = await fetch(
        `${baseUrl}/api/plugin-platform/v1/plugins/${pluginId}/events/dead-letters/event-dead-letter-1/requeue`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'event-requeue-route-1',
          },
          body: JSON.stringify({ expectedAttempt: 3 }),
        },
      );
      expect(replayed.status).toBe(200);
      expect(replayed.headers.get('cache-control')).toBe('no-store');
      expect(await replayed.json()).toMatchObject({
        deliveryId: 'event-dead-letter-1',
        pluginId,
        status: 'pending',
        attempt: 0,
      });
      expect(requeues).toEqual([
        {
          pluginId,
          deliveryId: 'event-dead-letter-1',
          expectedAttempt: 3,
          actorRef: 'admin-1',
          correlationId: 'event-requeue-route-1',
        },
      ]);
    });
  });

  it('derives the OSS tenant and rejects extra tenant input', async () => {
    const test = fixture();
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, test.control, {
      deploymentAdminMiddleware: [allowAdmin],
      tenantAdminMiddleware: [allowAdmin],
    });
    await withServer(app, async (baseUrl) => {
      const invalid = await fetch(
        `${baseUrl}/t/default/api/plugin-platform/v1/plugins/${pluginId}/enablement`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            enabled: false,
            expectedRevision: 0,
            idempotencyKey: 'tenant-route-request-0001',
            tenantRef: 'attacker-selected-tenant',
          }),
        },
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ code: 'request_invalid' });

      const changed = await fetch(
        `${baseUrl}/t/default/api/plugin-platform/v1/plugins/${pluginId}/enablement`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            enabled: false,
            expectedRevision: 0,
            idempotencyKey: 'tenant-route-request-0002',
          }),
        },
      );
      expect(changed.status).toBe(200);
      const current = await fetch(
        `${baseUrl}/t/default/api/plugin-platform/v1/plugins/${pluginId}/enablement`,
      );
      expect(await current.json()).toMatchObject({
        pluginId,
        enabled: false,
        revision: 1,
      });
    });
  });

  it('supports a tenant-safe approval marketplace without accepting tenant selectors', async () => {
    const test = fixture('approval_required');
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, test.control, {
      deploymentAdminMiddleware: [allowAdmin],
      tenantReadMiddleware: [allowAlpha],
      tenantRequestMiddleware: [allowAlpha],
      tenantManageMiddleware: [allowAlpha],
    });
    await withServer(app, async (baseUrl) => {
      const catalogue = await fetch(`${baseUrl}/api/t/alpha/apps`);
      expect(catalogue.status).toBe(200);
      expect(catalogue.headers.get('cache-control')).toBe('no-store');
      expect(await catalogue.json()).toMatchObject({
        activationPolicy: 'approval_required',
        applications: [{ pluginId, status: 'available', active: false }],
      });

      const invalid = await fetch(
        `${baseUrl}/api/t/alpha/apps/${pluginId}/activation-request`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedRevision: 0,
            idempotencyKey: 'alpha-activation-request-0001',
            tenantRef: 'tenant-bravo',
          }),
        },
      );
      expect(invalid.status).toBe(400);

      const requested = await fetch(
        `${baseUrl}/api/t/alpha/apps/${pluginId}/activation-request`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedRevision: 0,
            idempotencyKey: 'alpha-activation-request-0002',
          }),
        },
      );
      expect(requested.status).toBe(200);
      expect(await requested.json()).toMatchObject({
        status: 'requested',
        active: false,
        revision: 1,
      });

      const approved = await fetch(
        `${baseUrl}/api/t/alpha/apps/${pluginId}/activation-request/decision`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            decision: 'approve',
            expectedRevision: 1,
            idempotencyKey: 'alpha-activation-approve-0001',
          }),
        },
      );
      expect(approved.status).toBe(200);
      expect(await approved.json()).toMatchObject({
        status: 'active',
        active: true,
        revision: 2,
      });
      const audit = await fetch(
        `${baseUrl}/api/t/alpha/apps/${pluginId}/audit`,
      );
      expect(await audit.json()).toMatchObject({
        events: [
          { eventType: 'tenant_activation_approved' },
          { eventType: 'tenant_activation_requested' },
        ],
      });
    });
  });

  it('exposes an admin-only, revision-protected platform emergency control', async () => {
    const test = fixture();
    const app = express();
    app.use(express.json());
    registerPluginControlRoutesV1(app, test.control, {
      deploymentAdminMiddleware: [allowAdmin],
      tenantAdminMiddleware: [allowAdmin],
    });
    await withServer(app, async (baseUrl) => {
      const initial = await fetch(
        `${baseUrl}/api/plugin-platform/v1/emergency-control`,
      );
      expect(initial.status).toBe(200);
      expect(initial.headers.get('cache-control')).toBe('no-store');
      expect(await initial.json()).toMatchObject({
        disabled: false,
        revision: 0,
      });

      const disabled = await fetch(
        `${baseUrl}/api/plugin-platform/v1/emergency-control`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'emergency-route-1',
          },
          body: JSON.stringify({
            disabled: true,
            expectedRevision: 0,
            idempotencyKey: 'emergency-route-request-0001',
          }),
        },
      );
      expect(disabled.status).toBe(200);
      expect(await disabled.json()).toMatchObject({
        disabled: true,
        revision: 1,
        reasonCode: 'emergency_disabled',
      });
      await expect(
        test.control.isExecutionAllowed(
          pluginId,
          'default-tenant-id',
        ),
      ).resolves.toBe(false);
      const audit = await fetch(
        `${baseUrl}/api/plugin-platform/v1/audit`,
      );
      expect(audit.status).toBe(200);
      expect(audit.headers.get('cache-control')).toBe('no-store');
      expect(await audit.json()).toMatchObject({
        events: [
          {
            eventType: 'platform_emergency_disabled',
            pluginId: null,
            tenantScoped: false,
          },
        ],
      });

      const stale = await fetch(
        `${baseUrl}/api/plugin-platform/v1/emergency-control`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            disabled: false,
            expectedRevision: 0,
            idempotencyKey: 'emergency-route-request-0002',
          }),
        },
      );
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ code: 'revision_conflict' });
    });
  });
});

async function withServer(
  app: express.Express,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
