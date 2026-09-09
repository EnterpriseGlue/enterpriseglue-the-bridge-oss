import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import {
  RELEASE_EFFECT_SOURCES_V1,
  type ReleaseEffectSourceV1,
} from '@enterpriseglue/shared/contracts/release-effect-inventory.js';
import {
  PluginEventDelivery,
  PluginScheduledJob,
  ReleaseEffectCohort,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import {
  ReleaseEffectSettlementService,
  assertReleaseEffectAdmission,
} from '@enterpriseglue/shared/services/platform-admin/ReleaseEffectSettlementService.js';

const releaseId = 'release-preview';
const cohortEpoch = 7;
const binding = { releaseId, cohortEpoch };
let source: DataSource;

beforeEach(async () => {
  source = new DataSource({
    type: 'sqljs',
    synchronize: true,
    entities: [ReleaseEffectCohort, PluginEventDelivery, PluginScheduledJob, TenantReleaseWorkAssignment],
  });
  await source.initialize();
});

afterEach(async () => {
  if (source?.isInitialized) await source.destroy();
});

function service(sources: readonly ReleaseEffectSourceV1[] = RELEASE_EFFECT_SOURCES_V1) {
  let now = 1_000;
  return new ReleaseEffectSettlementService(
    async () => source,
    () => binding,
    sources,
    () => ++now,
  );
}

async function open(serviceUnderTest = service()) {
  return serviceUnderTest.open({ releaseId, cohortEpoch, expectedRevision: 0 });
}

describe('ReleaseEffectSettlementService', () => {
  it('rejects managed pooled Cloud producer admission when a release has no cohort epoch', async () => {
    await expect(source.transaction((manager) => assertReleaseEffectAdmission(manager, {
      sourceId: 'plugin_event_delivery', releaseId,
    }, { releaseId, managedPooledCloud: true })))
      .rejects.toThrow('release_effect_admission_not_configured');
    await expect(source.transaction((manager) => assertReleaseEffectAdmission(manager, {
      sourceId: 'plugin_event_delivery', releaseId,
    }, { releaseId }))).resolves.toBeUndefined();
  });

  it('opens once, closes with a revision fence, and rejects admission after close', async () => {
    const subject = service();
    await expect(open(subject)).resolves.toMatchObject({ state: 'open', revision: 1, inventoryComplete: false });
    await expect(open(subject)).resolves.toMatchObject({ state: 'open', revision: 1 });
    await expect(source.transaction((manager) => assertReleaseEffectAdmission(manager, {
      sourceId: 'plugin_event_delivery', releaseId,
    }, binding))).resolves.toBeUndefined();

    await expect(subject.close({ releaseId, cohortEpoch, expectedRevision: 1 })).resolves.toMatchObject({ state: 'closing', revision: 2 });
    await expect(subject.close({ releaseId, cohortEpoch, expectedRevision: 1 })).resolves.toMatchObject({ state: 'closing', revision: 2 });
    await expect(source.transaction((manager) => assertReleaseEffectAdmission(manager, {
      sourceId: 'plugin_event_delivery', releaseId,
    }, binding)))
      .rejects.toThrow('release_effect_admission_closed');
    await expect(source.transaction((manager) => assertReleaseEffectAdmission(manager, {
      sourceId: 'engine_api_mutation', releaseId,
    }, binding))).rejects.toThrow('release_effect_admission_source_uncovered');
    await expect(subject.close({ releaseId, cohortEpoch, expectedRevision: 9 })).rejects.toMatchObject({ statusCode: 409 });

    const changedEpoch = new ReleaseEffectSettlementService(
      async () => source,
      () => ({ releaseId, cohortEpoch: cohortEpoch + 1 }),
    );
    await expect(changedEpoch.open({ releaseId, cohortEpoch: cohortEpoch + 1, expectedRevision: 0 }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('counts durable retry and lease states instead of treating an expired worker as settled', async () => {
    const subject = service();
    await open(subject);
    await source.getRepository(PluginEventDelivery).insert(event({ status: 'delivering', leaseExpiresAt: 10 }));
    await source.getRepository(PluginScheduledJob).insert(schedule({ status: 'retry_wait', leaseExpiresAt: null }));
    await source.getRepository(TenantReleaseWorkAssignment).insert({
      id: 'assignment-1', tenantRef: 'tenant-a', releaseId, assignmentEpoch: 9, updatedAt: 1,
    });
    await subject.close({ releaseId, cohortEpoch, expectedRevision: 1 });

    const status = await subject.verify({ releaseId, cohortEpoch, expectedRevision: 2 });
    expect(status).toMatchObject({
      state: 'closing', inventoryComplete: false, coveredSourcesSettled: false,
      eligibleForShutdown: false, settled: false, releaseAssignmentsOutstanding: 1,
    });
    expect(status.sources.find((item) => item.sourceId === 'plugin_event_delivery')).toMatchObject({ outstanding: 1, reasonCode: 'outstanding' });
    expect(status.sources.find((item) => item.sourceId === 'plugin_schedule_delivery')).toMatchObject({ outstanding: 1, reasonCode: 'outstanding' });
  });

  it('remains fail-closed after covered work drains while any mutating source is uncovered', async () => {
    const subject = service();
    await open(subject);
    await subject.close({ releaseId, cohortEpoch, expectedRevision: 1 });
    const status = await subject.verify({ releaseId, cohortEpoch, expectedRevision: 2 });
    expect(status).toMatchObject({
      state: 'closing', inventoryComplete: false, coveredSourcesSettled: true,
      eligibleForShutdown: false, settled: false,
    });
    expect(status.sources.filter((item) => item.settlementRequired && item.coverage === 'uncovered').length).toBeGreaterThan(0);
  });

  it('settles exactly once when an injected complete inventory has no assignments or effects', async () => {
    const covered = RELEASE_EFFECT_SOURCES_V1.filter((item) => item.coverage === 'authoritative');
    const subject = service(covered);
    await open(subject);
    await subject.close({ releaseId, cohortEpoch, expectedRevision: 1 });
    await expect(subject.verify({ releaseId, cohortEpoch, expectedRevision: 2 })).resolves.toMatchObject({
      state: 'settled', revision: 3, inventoryComplete: true,
      coveredSourcesSettled: true, eligibleForShutdown: true, settled: true,
    });
    await expect(subject.verify({ releaseId, cohortEpoch, expectedRevision: 2 })).resolves.toMatchObject({ state: 'settled', revision: 3, settled: true });
    await expect(subject.verify({ releaseId, cohortEpoch, expectedRevision: 1 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a changed runtime binding and a changed inventory snapshot', async () => {
    const subject = service();
    await open(subject);
    const changedBinding = new ReleaseEffectSettlementService(async () => source, () => ({ releaseId, cohortEpoch: cohortEpoch + 1 }));
    await expect(changedBinding.status({ releaseId, cohortEpoch })).rejects.toMatchObject({ statusCode: 409 });

    const changedInventory = [...RELEASE_EFFECT_SOURCES_V1, {
      sourceId: 'future_mutation', owner: 'worker', settlementRequired: true, coverage: 'uncovered',
      durableTables: [], admissionBoundary: 'future', settlementBasis: 'future',
    } satisfies ReleaseEffectSourceV1];
    const changed = service(changedInventory);
    await subject.close({ releaseId, cohortEpoch, expectedRevision: 1 });
    const status = await changed.status({ releaseId, cohortEpoch });
    expect(status.configuredInventorySha256).not.toBe(status.inventorySha256);
    expect(status.eligibleForShutdown).toBe(false);

    await source.getRepository(ReleaseEffectCohort).update(
      { releaseId },
      { inventoryVersion: 'release-effect-inventory.enterpriseglue.io/obsolete' },
    );
    const versionDrift = await subject.verify({ releaseId, cohortEpoch, expectedRevision: 2 });
    expect(versionDrift.inventoryVersion).not.toBe(versionDrift.configuredInventoryVersion);
    expect(versionDrift).toMatchObject({ state: 'closing', settled: false, eligibleForShutdown: false });
  });
});

function event(overrides: Partial<PluginEventDelivery> = {}): PluginEventDelivery {
  return {
    id: 'event-row-1', deliveryId: 'delivery-1', pluginId: 'io.enterpriseglue.test', deploymentRef: 'deployment-1',
    tenantRef: 'tenant-a', releaseId, assignmentEpoch: 9, subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'deliver-event', eventId: 'event-1', eventSha256: 'a'.repeat(64), eventJson: '{}',
    status: 'pending', attempt: 0, maxAttempts: 3, nextAttemptAt: 1, leaseOwner: null, leaseExpiresAt: null,
    reasonCode: 'queued', deliveredAt: null, createdAt: 1, updatedAt: 1, ...overrides,
  } as PluginEventDelivery;
}

function schedule(overrides: Partial<PluginScheduledJob> = {}): PluginScheduledJob {
  return {
    id: 'schedule-row-1', jobRef: 'job-1', pluginId: 'io.enterpriseglue.test', deploymentRef: 'deployment-1',
    tenantRef: 'tenant-a', releaseId, assignmentEpoch: 9, jobType: 'refresh', operationId: 'scheduled-refresh',
    intervalSeconds: 60, maxAttempts: 3, status: 'scheduled', revision: 1, attempt: 0, nextRunAt: 1,
    leaseOwner: null, leaseExpiresAt: null, reasonCode: 'scheduled', scheduledByRef: 'tester', createdAt: 1, updatedAt: 1,
    ...overrides,
  } as PluginScheduledJob;
}
