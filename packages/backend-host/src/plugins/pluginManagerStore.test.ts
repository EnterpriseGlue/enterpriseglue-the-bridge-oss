import { afterEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import {
  PluginInstallationApproval,
  PluginInstallationIntent,
  PluginInstallationObservation,
  PluginInstallationReview,
  PluginManagerCapability,
  PluginManagerAdmission,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';

import { DatabasePluginManagerStoreV1 } from './pluginManagerStore.js';

const sources: DataSource[] = [];
const hash = (character: string) => character.repeat(64);
const release = `registry.example/plugin@sha256:${hash('1')}`;
const now = '2026-08-24T00:00:00.000Z';

async function fixture() {
  const source = new DataSource({
    type: 'sqljs',
    synchronize: true,
    entities: [
      PluginInstallationIntent,
      PluginInstallationReview,
      PluginInstallationApproval,
      PluginInstallationObservation,
      PluginManagerCapability,
      PluginManagerAdmission,
    ],
  });
  await source.initialize();
  sources.push(source);
  return new DatabasePluginManagerStoreV1(
    async () => source,
    () => new Date(now),
  );
}

afterEach(async () => {
  await Promise.all(sources.splice(0).map((source) => source.destroy()));
});

async function advertiseReadyManager(
  store: DatabasePluginManagerStoreV1,
  deploymentModes: Array<'compose_planner' | 'kubernetes'>,
) {
  await store.advertiseCapability({
    apiVersion: 'manager-capability.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginManagerCapability',
    managerId: 'manager-001',
    managerVersion: '0.1.0',
    protocolVersions: ['v1'],
    deploymentModes,
    architectures: ['amd64'],
    operations: ['plan', 'install'],
    state: 'ready',
    observedAt: now,
  });
}

describe('DatabasePluginManagerStoreV1', () => {
  it('persists revision-bound claim, review, approval, and safe observation', async () => {
    const store = await fixture();
    const intent = {
      apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1' as const,
      kind: 'EnterpriseGluePluginInstallationIntent' as const,
      installationId: 'install-001',
      pluginId: 'io.enterpriseglue.example',
      release,
      operation: 'install' as const,
      source: 'connected_registry' as const,
      deploymentMode: 'kubernetes' as const,
      requesterRef: 'user-001',
      expectedPlatformRevision: 0,
      idempotencyKey: 'installation-request-001',
      requestedAt: now,
    };
    await store.createIntent(intent);
    expect(await store.createIntent(intent)).toEqual(intent);
    await advertiseReadyManager(store, ['kubernetes']);

    const claim = await store.claim({
      managerId: 'manager-001',
      leaseDurationMs: 60_000,
      occurredAt: now,
    });
    expect(claim?.revision).toBe(0);
    const finding = {
      status: 'pass' as const,
      reasonCode: 'none' as const,
      summary: 'Verified.',
    };
    const review = {
      apiVersion: 'install-review.plugin.enterpriseglue.io/v1' as const,
      kind: 'EnterpriseGluePluginInstallReview' as const,
      installationId: intent.installationId,
      pluginId: intent.pluginId,
      version: '1.0.0',
      release,
      planSha256: hash('2'),
      reviewSha256: hash('3'),
      platformRevision: 0,
      generatedAt: '2026-08-24T00:00:01.000Z',
      expiresAt: '2026-08-24T00:15:00.000Z',
      identity: finding,
      compatibility: finding,
      permissionsAndData: finding,
      infrastructure: finding,
      migrationAndRollback: finding,
      entitlement: finding,
      entitlementState: 'not_required' as const,
      rollbackClass: 'stateless' as const,
      requestedPermissions: [],
      materialChanges: ['initial-install'],
      approvable: true,
    };
    expect(
      await store.publishReview({
        leaseToken: claim!.leaseToken,
        expectedRevision: 0,
        review,
      }),
    ).toEqual({ revision: 1, leaseRetained: false });

    const approval = {
      apiVersion: 'install-approval.plugin.enterpriseglue.io/v1' as const,
      kind: 'EnterpriseGluePluginInstallApproval' as const,
      installationId: intent.installationId,
      decision: 'approve' as const,
      reviewSha256: review.reviewSha256,
      planSha256: review.planSha256,
      approverRef: 'user-002',
      expectedRevision: 1,
      decidedAt: '2026-08-24T00:00:02.000Z',
      expiresAt: '2026-08-24T00:15:00.000Z',
    };
    expect((await store.approve(approval)).revision).toBe(2);
    expect(
      await store.readApproval({
        installationId: intent.installationId,
        reviewSha256: review.reviewSha256,
        planSha256: review.planSha256,
      }),
    ).toMatchObject({ approval, revision: 2 });

    const resumedClaim = await store.claim({
      managerId: 'manager-001',
      leaseDurationMs: 60_000,
      occurredAt: '2026-08-24T00:00:03.000Z',
    });
    expect(resumedClaim).toMatchObject({ revision: 2, review });

    const observation = {
      apiVersion: 'installation-observation.plugin.enterpriseglue.io/v1' as const,
      kind: 'EnterpriseGluePluginInstallationObservation' as const,
      installationId: intent.installationId,
      pluginId: intent.pluginId,
      version: '1.0.0',
      revision: 2,
      state: 'ready' as const,
      reasonCode: 'none' as const,
      planSha256: review.planSha256,
      occurredAt: '2026-08-24T00:00:03.000Z',
      retryable: false,
      recoveryActions: [],
    };
    expect(
      await store.publishObservation({
        leaseToken: resumedClaim!.leaseToken,
        expectedRevision: 2,
        observation,
      }),
    ).toEqual({ revision: 3 });

    const summary = await store.getInstallation(intent.installationId);
    expect(summary).toMatchObject({
      state: 'ready',
      revision: 3,
      review,
      approval,
      latestObservation: { ...observation, revision: 3 },
    });
  });

  it('does not return an intent with an active lease to another manager', async () => {
    const store = await fixture();
    await store.createIntent({
      apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginInstallationIntent',
      installationId: 'install-002',
      pluginId: 'io.enterpriseglue.example',
      release,
      source: 'static_catalog',
      deploymentMode: 'compose_planner',
      requesterRef: 'user-001',
      expectedPlatformRevision: 0,
      idempotencyKey: 'installation-request-002',
      requestedAt: now,
    });
    await advertiseReadyManager(store, ['compose_planner']);
    expect(
      await store.claim({
        managerId: 'manager-001',
        leaseDurationMs: 60_000,
        occurredAt: now,
      }),
    ).not.toBeNull();
    expect(
      await store.claim({
        managerId: 'manager-002',
        leaseDurationMs: 60_000,
        occurredAt: '2026-08-24T00:00:01.000Z',
      }),
    ).toBeNull();
  });

  it('cancels only at an exact safe revision and resets terminal failures for a fresh review', async () => {
    const store = await fixture();
    const intent = {
      apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1' as const,
      kind: 'EnterpriseGluePluginInstallationIntent' as const,
      installationId: 'install-recovery-001',
      pluginId: 'io.enterpriseglue.example',
      release,
      source: 'connected_registry' as const,
      deploymentMode: 'kubernetes' as const,
      requesterRef: 'user-001',
      expectedPlatformRevision: 0,
      idempotencyKey: 'installation-recovery-001',
      requestedAt: now,
    };
    await store.createIntent(intent);
    await expect(store.cancel({ installationId: intent.installationId, expectedRevision: 1, occurredAt: now })).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(store.cancel({ installationId: intent.installationId, expectedRevision: 0, occurredAt: now })).resolves.toEqual({ revision: 1 });
    expect(await store.getInstallation(intent.installationId)).toMatchObject({ state: 'cancelled', revision: 1 });

    const failed = { ...intent, installationId: 'install-recovery-002', idempotencyKey: 'installation-recovery-002' };
    await store.createIntent(failed);
    const source = sources.at(-1)!;
    await source.getRepository(PluginInstallationIntent).update(
      { installationId: failed.installationId },
      { state: 'failed', reasonCode: 'staging_failed', revision: 4 },
    );
    await expect(store.retry({ installationId: failed.installationId, expectedRevision: 4, occurredAt: now })).resolves.toEqual({ revision: 5 });
    expect(await store.getInstallation(failed.installationId)).toMatchObject({ state: 'requested', reasonCode: 'none', revision: 5 });
  });

  it('serializes deployment mutations and fails a stale platform revision before leasing it', async () => {
    const store = await fixture();
    const intent = {
      apiVersion: 'installation-intent.plugin.enterpriseglue.io/v1' as const,
      kind: 'EnterpriseGluePluginInstallationIntent' as const,
      installationId: 'install-serialized-001',
      pluginId: 'io.enterpriseglue.example',
      release,
      operation: 'install' as const,
      source: 'connected_registry' as const,
      deploymentMode: 'kubernetes' as const,
      requesterRef: 'user-001',
      expectedPlatformRevision: 0,
      idempotencyKey: 'install-serialized-001',
      requestedAt: now,
    };
    await store.createIntent(intent);
    await expect(
      store.createIntent({
        ...intent,
        installationId: 'install-serialized-002',
        idempotencyKey: 'install-serialized-002',
      }),
    ).rejects.toMatchObject({ code: 'operation_in_progress' });
    await advertiseReadyManager(store, ['kubernetes']);
    await expect(
      store.claim({
        managerId: 'manager-001',
        leaseDurationMs: 60_000,
        occurredAt: now,
        currentPlatformRevision: 1,
      }),
    ).resolves.toBeNull();
    await expect(store.getInstallation(intent.installationId)).resolves.toMatchObject({
      state: 'failed',
      reasonCode: 'revision_conflict',
      revision: 1,
    });
  });
});
