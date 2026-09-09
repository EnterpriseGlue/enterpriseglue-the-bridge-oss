import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { config } from '@enterpriseglue/shared/config/index.js';
import {
  PluginEventDelivery,
  PluginEventQueueState,
  PluginEventSubscriptionState,
  PluginPlatformAudit,
  PluginScheduleCommand,
  PluginScheduledJob,
  ReleaseEffectCohort,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { ReleaseEffectSettlementService } from '@enterpriseglue/shared/services/platform-admin/ReleaseEffectSettlementService.js';
import { DatabasePluginEventDeliveryStoreV1 } from '@enterpriseglue/backend-host/plugins/pluginEventDeliveryStore.js';
import { DatabasePluginScheduleStoreV1 } from '@enterpriseglue/backend-host/plugins/pluginScheduleStore.js';

const releaseId = 'release-preview';
const cohortEpoch = 7;
const tenantRef = 'tenant-1';
const originalReleaseId = config.tenantPlacementReleaseId;
const originalCohortEpoch = config.tenantReleaseEffectCohortEpoch;
let source: DataSource;

beforeEach(async () => {
  config.tenantPlacementReleaseId = releaseId;
  config.tenantReleaseEffectCohortEpoch = cohortEpoch;
  source = new DataSource({
    type: 'sqljs', synchronize: true,
    entities: [
      ReleaseEffectCohort, TenantReleaseWorkAssignment,
      PluginEventDelivery, PluginEventQueueState, PluginEventSubscriptionState, PluginPlatformAudit,
      PluginScheduledJob, PluginScheduleCommand,
    ],
  });
  await source.initialize();
  await source.getRepository(TenantReleaseWorkAssignment).insert({
    id: 'assignment-1', tenantRef, releaseId, assignmentEpoch: 9, updatedAt: 1,
  });
  await settlement().open({ releaseId, cohortEpoch, expectedRevision: 0 });
});

afterEach(async () => {
  config.tenantPlacementReleaseId = originalReleaseId;
  config.tenantReleaseEffectCohortEpoch = originalCohortEpoch;
  if (source?.isInitialized) await source.destroy();
});

function settlement() {
  return new ReleaseEffectSettlementService(async () => source, () => ({ releaseId, cohortEpoch }));
}

describe('covered release effect producers', () => {
  it('serializes plugin event admission with cohort closure and preserves exact duplicates', async () => {
    const store = new DatabasePluginEventDeliveryStoreV1(async () => source);
    const first = await store.enqueue(event('event-1'));
    expect(first.deliveryId).toMatch(/^event-/);
    await settlement().close({ releaseId, cohortEpoch, expectedRevision: 1 });

    await expect(store.enqueue(event('event-1'))).resolves.toEqual(first);
    await expect(store.enqueue(event('event-2'))).rejects.toThrow('release_effect_admission_closed');
    await source.getRepository(PluginEventDelivery).update(
      { deliveryId: first.deliveryId },
      { status: 'dead_letter', attempt: 1 },
    );
    await expect(store.requeueDeadLetter({
      pluginId: 'io.enterpriseglue.reference', deliveryId: first.deliveryId,
      expectedAttempt: 1, actorRef: 'operator', correlationId: 'requeue-after-close', now: 11_000,
    })).rejects.toThrow('release_effect_admission_closed');
    expect(await source.getRepository(PluginEventDelivery).count()).toBe(1);
  });

  it('blocks new fixed schedules after closure while allowing a cancellation to settle retained work', async () => {
    const store = new DatabasePluginScheduleStoreV1(async () => source, () => 10_000);
    await expect(store.execute(schedule('upsert', 'schedule-upsert-1'))).resolves.toMatchObject({ status: 'scheduled', revision: 1 });
    await settlement().close({ releaseId, cohortEpoch, expectedRevision: 1 });

    await expect(store.execute(schedule('upsert', 'schedule-upsert-2'))).rejects.toThrow('release_effect_admission_closed');
    await expect(store.execute(schedule('cancel', 'schedule-cancel-1'))).resolves.toMatchObject({ status: 'cancelled', revision: 2 });
    expect(await source.getRepository(PluginScheduledJob).findOneByOrFail({ tenantRef })).toMatchObject({ status: 'cancelled' });
  });

  it('blocks resuming a terminal paused schedule after closure', async () => {
    const store = new DatabasePluginScheduleStoreV1(async () => source, () => 10_000);
    await store.execute(schedule('upsert', 'schedule-upsert-1'));
    await store.setPaused({ jobRef: scheduleJobRef(), paused: true, expectedRevision: 1, reasonCode: 'operator_paused' });
    await settlement().close({ releaseId, cohortEpoch, expectedRevision: 1 });
    await expect(store.setPaused({
      jobRef: scheduleJobRef(), paused: false, expectedRevision: 2, reasonCode: 'operator_resumed',
    })).rejects.toThrow('release_effect_admission_closed');
  });

  it('revalidates the locked assignment before administrative event and schedule retries', async () => {
    const eventStore = new DatabasePluginEventDeliveryStoreV1(async () => source);
    const scheduleStore = new DatabasePluginScheduleStoreV1(async () => source, () => 10_000);
    const queued = await eventStore.enqueue(event('event-cross-release'));
    await source.getRepository(PluginEventDelivery).update(
      { deliveryId: queued.deliveryId }, { status: 'dead_letter', attempt: 1 },
    );
    await scheduleStore.execute(schedule('upsert', 'schedule-cross-release'));
    await scheduleStore.setPaused({ jobRef: scheduleJobRef(), paused: true, expectedRevision: 1, reasonCode: 'operator_paused' });

    const nextReleaseId = 'release-next';
    const nextBinding = { releaseId: nextReleaseId, cohortEpoch: 8, managedPooledCloud: true };
    await new ReleaseEffectSettlementService(async () => source, () => nextBinding)
      .open({ releaseId: nextReleaseId, cohortEpoch: 8, expectedRevision: 0 });
    await source.getRepository(TenantReleaseWorkAssignment).update(
      { tenantRef }, { releaseId: nextReleaseId, assignmentEpoch: 10 },
    );

    const nextEventStore = new DatabasePluginEventDeliveryStoreV1(
      async () => source, {}, {}, undefined, () => nextBinding,
    );
    const nextScheduleStore = new DatabasePluginScheduleStoreV1(
      async () => source, () => 10_000, () => nextBinding,
    );
    await expect(nextEventStore.requeueDeadLetter({
      pluginId: 'io.enterpriseglue.reference', deliveryId: queued.deliveryId,
      expectedAttempt: 1, actorRef: 'operator', correlationId: 'cross-release-event', now: 11_000,
    })).rejects.toThrow('plugin_event_release_assignment_changed');
    await expect(nextScheduleStore.setPaused({
      jobRef: scheduleJobRef(), paused: false, expectedRevision: 2, reasonCode: 'operator_resumed',
    })).rejects.toThrow('plugin_schedule_release_assignment_changed');
  });
});

function event(id: string): Parameters<DatabasePluginEventDeliveryStoreV1['enqueue']>[0] {
  return {
    pluginId: 'io.enterpriseglue.reference' as const,
    deploymentRef: 'deployment-1', tenantRef,
    subscriptionType: 'io.enterpriseglue.host.incident.v1' as const,
    operationId: 'io.enterpriseglue.reference.consume-incident', maxAttempts: 3,
    event: {
      specversion: '1.0' as const, id, source: 'enterpriseglue-oss',
      type: 'io.enterpriseglue.host.incident.v1' as const, subject: 'incident-1',
      time: '2026-09-10T00:00:00.000Z',
      dataschema: 'https://schemas.enterpriseglue.io/events/incident-v1.json', tenantRef,
      data: { engineRef: 'engine-1', incidentRef: 'incident-1', incidentType: 'failedJob' },
    },
    now: 10_000,
  };
}

function schedule(
  action: 'upsert' | 'cancel',
  idempotencyKey: string,
): Parameters<DatabasePluginScheduleStoreV1['execute']>[0] {
  return {
    pluginId: 'io.enterpriseglue.reference' as const,
    deploymentRef: 'deployment-1', tenantRef, subjectRef: 'subject-1',
    deliveryOperationId: 'io.enterpriseglue.reference.refresh-index',
    allowedIntervalsSeconds: [3600], maxAttempts: 3,
    request: action === 'upsert' ? {
      apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1' as const,
      callId: `call-${idempotencyKey}`, operationId: 'io.enterpriseglue.reference.schedule',
      action, jobType: 'io.enterpriseglue.reference.refresh-index',
      intervalSeconds: 3600,
      idempotencyKey,
    } : {
      apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1' as const,
      callId: `call-${idempotencyKey}`, operationId: 'io.enterpriseglue.reference.schedule',
      action, jobType: 'io.enterpriseglue.reference.refresh-index',
      idempotencyKey,
    },
  };
}

function scheduleJobRef(): string {
  const hash = createHash('sha256').update([
    'io.enterpriseglue.reference', 'deployment-1', tenantRef,
    'io.enterpriseglue.reference.refresh-index',
  ].join('\0')).digest('hex');
  return `job-${hash}`;
}
