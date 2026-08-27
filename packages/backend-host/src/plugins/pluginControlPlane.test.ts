import type { PluginId } from '@enterpriseglue/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  MemoryPluginControlStoreV1,
  PluginControlPlaneV1,
} from './pluginControlPlane.js';
import type {
  PluginControlSourceRecordV1,
  PluginControlSourceSnapshotV1,
} from './pluginRuntime.js';

const pluginId = 'io.enterpriseglue.reference' as PluginId;

function sourceRecord(
  overrides: Partial<PluginControlSourceRecordV1> = {},
): PluginControlSourceRecordV1 {
  return {
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
    ...overrides,
  };
}

class MutableSource {
  snapshot: PluginControlSourceSnapshotV1 = {
    revision: 1,
    records: [sourceRecord()],
  };

  async controlSnapshot() {
    return structuredClone(this.snapshot);
  }
}

function fixture(source = new MutableSource()) {
  const store = new MemoryPluginControlStoreV1();
  const control = new PluginControlPlaneV1(source, store, {
    defaultTenantRef: 'default-tenant-id',
    now: () => new Date('2026-07-24T01:00:00.000Z'),
  });
  return { control, source, store };
}

describe('PluginControlPlaneV1', () => {
  it('enforces distinct signed eligibility for two tenants and rechecks expiry', async () => {
    let clock = new Date('2026-08-28T12:00:00.000Z');
    const source = new MutableSource();
    source.snapshot.records = [sourceRecord({
      entitlementProvider: 'plugin',
      entitlementFeature: 'premium_reference',
      entitled: 'unavailable',
    })];
    const store = new MemoryPluginControlStoreV1();
    const verifier = {
      verify(input: { signedProjection: string; tenantRef: string }) {
        const state: 'active' | 'revoked' =
          input.signedProjection === 'alpha-active' ? 'active' : 'revoked';
        return {
          claims: {
            schemaVersion: 'tenant-eligibility.plugin.enterpriseglue.io/v1' as const,
            iss: 'https://control.enterpriseglue.example',
            aud: 'enterpriseglue-shard',
            jti: `projection-${input.tenantRef}`,
            tenantRef: input.tenantRef,
            pluginId,
            pluginVersion: '1.0.0',
            release: `registry.example/reference@sha256:${'a'.repeat(64)}`,
            state,
            effectiveFrom: null,
            effectiveUntil: '2026-08-28T13:00:00.000Z',
            limitsHash: 'd'.repeat(64),
            revision: 1,
            projectionRef: `subscription-${input.tenantRef}`,
            iat: Math.floor(Date.parse('2026-08-28T11:59:00.000Z') / 1_000),
            exp: Math.floor(Date.parse('2026-08-28T14:00:00.000Z') / 1_000),
          },
          signatureSha256: input.signedProjection === 'alpha-active'
            ? 'a'.repeat(64)
            : 'b'.repeat(64),
        };
      },
    };
    const control = new PluginControlPlaneV1(source, store, {
      defaultTenantRef: 'default-tenant-id',
      tenantEligibilityVerifier: verifier,
      now: () => clock,
    });

    await control.applyTenantEligibility({
      pluginId,
      tenantRef: 'tenant-alpha',
      signedProjection: 'alpha-active',
      actorRef: 'cloud-controller',
      correlationId: 'eligibility-alpha-1',
    });
    await expect(control.applyTenantEligibility({
      pluginId,
      tenantRef: 'tenant-alpha',
      signedProjection: 'bravo-revoked',
      actorRef: 'cloud-controller',
      correlationId: 'eligibility-alpha-conflict',
    })).rejects.toMatchObject({ code: 'revision_conflict' });
    await control.applyTenantEligibility({
      pluginId,
      tenantRef: 'tenant-bravo',
      signedProjection: 'bravo-revoked',
      actorRef: 'cloud-controller',
      correlationId: 'eligibility-bravo-1',
    });
    await control.setTenantEnabled({
      pluginId,
      tenantRef: 'tenant-alpha',
      enabled: true,
      expectedRevision: 0,
      idempotencyKey: 'alpha-activation-idempotency',
      actorRef: 'alpha-admin',
      correlationId: 'alpha-activation-1',
    });

    await expect(control.isExecutionAllowed(pluginId, 'tenant-alpha')).resolves.toBe(true);
    await expect(control.isExecutionAllowed(pluginId, 'tenant-bravo')).resolves.toBe(false);
    await expect(control.setTenantEnabled({
      pluginId,
      tenantRef: 'tenant-bravo',
      enabled: true,
      expectedRevision: 0,
      idempotencyKey: 'bravo-activation-idempotency',
      actorRef: 'bravo-admin',
      correlationId: 'bravo-activation-1',
    })).rejects.toMatchObject({ code: 'tenant_eligibility_inactive' });
    await expect(control.getTenantEligibility(pluginId, 'tenant-alpha')).resolves.toMatchObject({
      state: 'active',
      issuer: 'https://control.enterpriseglue.example',
      revision: 1,
    });

    clock = new Date('2026-08-28T13:00:01.000Z');
    await expect(control.isExecutionAllowed(pluginId, 'tenant-alpha')).resolves.toBe(false);
    await expect(control.getTenantApplication(
      pluginId,
      'tenant-alpha',
      'alpha',
    )).resolves.toMatchObject({ status: 'blocked', entitled: 'expired' });
  });

  it('reconciles only safe summaries and seeds the OSS default tenant', async () => {
    const { control } = fixture();
    await expect(control.list()).resolves.toEqual({
      apiVersion: 'control.plugin.enterpriseglue.io/v1',
      revision: 1,
      plugins: [
        {
          pluginId,
          version: '1.0.0',
          displayName: 'Reference plugin',
          state: 'enabled',
          enabled: true,
          healthy: true,
          compatible: true,
          entitled: 'not_required',
          reasonCode: 'none',
          revision: 0,
        },
      ],
    });
    await expect(
      control.getTenantEnablement(pluginId, 'default-tenant-id'),
    ).resolves.toMatchObject({ enabled: true, revision: 0 });
    await expect(
      control.isExecutionAllowed(pluginId, 'default-tenant-id'),
    ).resolves.toBe(true);
    await expect(
      control.isExecutionAllowed(pluginId, 'other-tenant'),
    ).resolves.toBe(false);
  });

  it('disables immediately, rejects stale concurrency, and replays one idempotent result', async () => {
    const { control } = fixture();
    await control.list();
    const request = {
      pluginId,
      enabled: false,
      expectedRevision: 0,
      idempotencyKey: 'disable-request-0001',
      actorRef: 'admin-1',
      correlationId: 'correlation-1',
    };
    const requests = [
      request,
      {
        ...request,
        idempotencyKey: 'disable-request-0002',
      },
    ];
    const [first, second] = await Promise.allSettled(
      requests.map((candidate) =>
        control.setDeploymentEnabled(candidate),
      ),
    );
    expect(
      [first, second].filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = [first, second].find(
      (result) => result.status === 'rejected',
    );
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: 'revision_conflict',
    });

    const winnerIndex = [first, second].findIndex(
      (result) => result.status === 'fulfilled',
    );
    const repeated = await control.setDeploymentEnabled(
      requests[winnerIndex]!,
    );
    const succeeded = [first, second][
      winnerIndex
    ] as PromiseFulfilledResult<Awaited<typeof repeated>>;
    expect(repeated.operationId).toBe(succeeded.value.operationId);
    await expect(
      control.isExecutionAllowed(pluginId, 'default-tenant-id'),
    ).resolves.toBe(false);
    await expect(control.get(pluginId)).resolves.toMatchObject({
      enabled: false,
      healthy: false,
      state: 'installed_disabled',
      reasonCode: 'administrator_disabled',
      revision: 1,
    });
  });

  it('uses tenant revision independently and rejects idempotency-key reuse for another request', async () => {
    const { control } = fixture();
    await control.list();
    const operation = await control.setTenantEnabled({
      pluginId,
      tenantRef: 'default-tenant-id',
      enabled: false,
      expectedRevision: 0,
      idempotencyKey: 'tenant-request-0001',
      actorRef: 'admin-1',
      correlationId: 'correlation-1',
    });
    await expect(
      control.getTenantEnablement(pluginId, 'default-tenant-id'),
    ).resolves.toMatchObject({ enabled: false, revision: 1 });
    await expect(control.getOperation(operation.operationId)).resolves.toEqual(
      operation,
    );
    await expect(
      control.setTenantEnabled({
        pluginId,
        tenantRef: 'default-tenant-id',
        enabled: true,
        expectedRevision: 1,
        idempotencyKey: 'tenant-request-0001',
        actorRef: 'admin-1',
        correlationId: 'correlation-1',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });

  it('projects a secret-free catalogue and activates one pooled tenant independently', async () => {
    const source = new MutableSource();
    source.snapshot.records = [sourceRecord({
      tenantConfiguration: {
        relativePath: 'settings/reference',
        schemaSha256: 'd'.repeat(64),
      },
    })];
    const { control } = fixture(source);
    const alpha = await control.listTenantApplications('tenant-alpha', 'alpha');
    expect(alpha).toMatchObject({
      activationPolicy: 'direct',
      applications: [{
        pluginId,
        publisher: 'io.enterpriseglue',
        status: 'available',
        active: false,
        revision: 0,
        configuration: {
          available: true,
          schemaSha256: 'd'.repeat(64),
          href: '/t/alpha/settings/reference',
          owner: 'plugin',
        },
      }],
    });
    expect(JSON.stringify(alpha)).not.toContain('bundleDigest');
    expect(JSON.stringify(alpha)).not.toContain('manifestSha256');

    await expect(control.setTenantApplicationActive({
      pluginId,
      tenantRef: 'tenant-alpha',
      tenantSlug: 'alpha',
      active: true,
      expectedRevision: 0,
      idempotencyKey: 'tenant-alpha-activate-0001',
      actorRef: 'alpha-admin',
      correlationId: 'alpha-correlation-1',
    })).resolves.toMatchObject({ status: 'active', active: true, revision: 1 });
    await expect(
      control.getTenantApplication(pluginId, 'tenant-bravo', 'bravo'),
    ).resolves.toMatchObject({ status: 'available', active: false, revision: 0 });
    await expect(
      control.listTenantApplicationAudit(pluginId, 'tenant-alpha'),
    ).resolves.toMatchObject({ events: [{ eventType: 'tenant_enabled' }] });
    await expect(
      control.listTenantApplicationAudit(pluginId, 'tenant-bravo'),
    ).resolves.toEqual({
      apiVersion: 'tenant-application-audit.plugin.enterpriseglue.io/v1',
      events: [],
    });
  });

  it('supports approval-required activation with revisioned idempotent requests', async () => {
    const source = new MutableSource();
    const control = new PluginControlPlaneV1(
      source,
      new MemoryPluginControlStoreV1(),
      {
        defaultTenantRef: 'default-tenant-id',
        tenantActivationPolicy: 'approval_required',
        now: () => new Date('2026-07-24T01:00:00.000Z'),
      },
    );
    const request = {
      pluginId,
      tenantRef: 'tenant-alpha',
      tenantSlug: 'alpha',
      expectedRevision: 0,
      idempotencyKey: 'tenant-alpha-request-0001',
      actorRef: 'alpha-member',
      correlationId: 'alpha-request-correlation',
    };
    const pending = await control.requestTenantApplicationActivation(request);
    expect(pending).toMatchObject({
      status: 'requested',
      active: false,
      revision: 1,
      activationRequest: { state: 'pending' },
    });
    await expect(
      control.requestTenantApplicationActivation(request),
    ).resolves.toEqual(pending);
    await expect(control.setTenantApplicationActive({
      ...request,
      active: true,
      expectedRevision: 1,
      idempotencyKey: 'tenant-alpha-direct-0001',
      actorRef: 'alpha-admin',
    })).rejects.toMatchObject({ code: 'activation_approval_required' });
    await expect(control.decideTenantApplicationActivation({
      ...request,
      decision: 'approve',
      expectedRevision: 1,
      idempotencyKey: 'tenant-alpha-approve-0001',
      actorRef: 'alpha-admin',
    })).resolves.toMatchObject({
      status: 'active',
      active: true,
      revision: 2,
      activationRequest: { state: 'approved' },
    });
  });

  it('cannot start a sidecar the installer left disabled', async () => {
    const source = new MutableSource();
    source.snapshot = {
      revision: 2,
      records: [sourceRecord({ installerEnabled: false })],
    };
    const { control } = fixture(source);
    await control.list();
    await expect(
      control.setDeploymentEnabled({
        pluginId,
        enabled: true,
        expectedRevision: 0,
        idempotencyKey: 'enable-request-0001',
        actorRef: 'admin-1',
        correlationId: 'correlation-1',
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('persists one global emergency gate without changing desired plugin state', async () => {
    const { control } = fixture();
    await expect(control.getEmergencyState()).resolves.toMatchObject({
      disabled: false,
      revision: 0,
      reasonCode: 'none',
    });
    const request = {
      disabled: true,
      expectedRevision: 0,
      idempotencyKey: 'emergency-request-0001',
      actorRef: 'admin-1',
      correlationId: 'correlation-emergency-1',
    };
    const disabled = await control.setEmergencyDisabled(request);
    expect(disabled).toMatchObject({
      disabled: true,
      revision: 1,
      reasonCode: 'emergency_disabled',
    });
    await expect(control.setEmergencyDisabled(request)).resolves.toEqual(
      disabled,
    );
    await expect(control.listAudit()).resolves.toMatchObject({
      apiVersion: 'audit.plugin.enterpriseglue.io/v1',
      events: [
        {
          eventType: 'platform_emergency_disabled',
          pluginId: null,
          tenantScoped: false,
          actorRef: 'admin-1',
          correlationId: 'correlation-emergency-1',
          reasonCode: 'emergency_disabled',
        },
      ],
    });
    await expect(
      control.isExecutionAllowed(pluginId, 'default-tenant-id'),
    ).resolves.toBe(false);
    await expect(
      control.enabledPluginIds('default-tenant-id'),
    ).resolves.toEqual(new Set());
    await expect(control.get(pluginId)).resolves.toMatchObject({
      enabled: true,
      state: 'enabled',
      revision: 0,
    });
    await expect(
      control.setEmergencyDisabled({
        ...request,
        idempotencyKey: 'emergency-request-0002',
      }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(
      control.setEmergencyDisabled({
        ...request,
        disabled: false,
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(
      control.setEmergencyDisabled({
        disabled: false,
        expectedRevision: 1,
        idempotencyKey: 'emergency-request-0003',
        actorRef: 'admin-1',
        correlationId: 'correlation-emergency-2',
      }),
    ).resolves.toMatchObject({
      disabled: false,
      revision: 2,
      reasonCode: 'none',
    });
    await expect(
      control.isExecutionAllowed(pluginId, 'default-tenant-id'),
    ).resolves.toBe(true);
  });

  it('preserves an admin gate across unrelated installer revisions and rejects installer rollback', async () => {
    const test = fixture();
    await test.control.list();
    await test.control.setDeploymentEnabled({
      pluginId,
      enabled: false,
      expectedRevision: 0,
      idempotencyKey: 'disable-request-0003',
      actorRef: 'admin-1',
      correlationId: 'correlation-1',
    });
    test.source.snapshot = {
      revision: 2,
      records: [sourceRecord()],
    };
    await expect(test.control.get(pluginId)).resolves.toMatchObject({
      enabled: false,
      revision: 1,
    });
    test.source.snapshot = {
      revision: 2,
      records: [],
    };
    await expect(test.control.list()).rejects.toThrow(
      'plugin_installer_revision_reused',
    );
    test.source.snapshot = {
      revision: 1,
      records: [sourceRecord()],
    };
    await expect(test.control.list()).rejects.toThrow(
      'plugin_installer_revision_rollback',
    );
  });
});
