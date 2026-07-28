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
