#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="eg-plugin-persistence-${$}"
POSTGRES_IMAGE="${ENTERPRISEGLUE_PLUGIN_TEST_POSTGRES_IMAGE:-postgres@sha256:979c4379dd698aba0b890599a6104e082035f98ef31d9b9291ec22f2b13059ca}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || {
  echo "docker is required for the plugin persistence drill" >&2
  exit 1
}

docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=plugin_test \
  -p 127.0.0.1::5432 \
  "$POSTGRES_IMAGE" >/dev/null

ready=false
for _attempt in {1..30}; do
  if docker exec "$CONTAINER_NAME" \
    pg_isready -U postgres -d plugin_test >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "disposable PostgreSQL did not become ready" >&2
  exit 1
fi

PGPORT="$(
  docker port "$CONTAINER_NAME" 5432/tcp |
    awk -F: 'NR == 1 { print $NF }'
)"
if [[ ! "$PGPORT" =~ ^[0-9]+$ ]]; then
  echo "could not determine disposable PostgreSQL port" >&2
  exit 1
fi

cd "$ROOT_DIR/packages/shared"
PGPORT="$PGPORT" node --input-type=module <<'NODE'
import { DataSource } from 'typeorm';

import { AddPluginBrokerReplay1700000000017 } from './dist/db/migrations/1700000000017-add-plugin-broker-replay.js';
import { AddPluginPlatform1700000000016 } from './dist/db/migrations/1700000000016-add-plugin-platform.js';
import { AddPluginStorage1700000000018 } from './dist/db/migrations/1700000000018-add-plugin-storage.js';
import { AddPluginEvents1700000000019 } from './dist/db/migrations/1700000000019-add-plugin-events.js';
import { AddPluginNotificationsAndSchedules1700000000020 } from './dist/db/migrations/1700000000020-add-plugin-notifications-and-schedules.js';
import { AddPluginEmergencyControl1700000000021 } from './dist/db/migrations/1700000000021-add-plugin-emergency-control.js';
import { AddPluginGatewayAdmission1700000000022 } from './dist/db/migrations/1700000000022-add-plugin-gateway-admission.js';
import { AddPluginEventCircuit1700000000023 } from './dist/db/migrations/1700000000023-add-plugin-event-circuit.js';
import { AddPluginContributionAvailability1700000000024 } from './dist/db/migrations/1700000000024-add-plugin-contribution-availability.js';
import { pluginPlatformEntities } from './dist/infrastructure/persistence/entities/PluginPlatform.js';
import { Notification } from './dist/infrastructure/persistence/entities/Notification.js';
import { User } from './dist/infrastructure/persistence/entities/User.js';
import { PluginControlPlaneV1 } from '../backend-host/dist/plugins/pluginControlPlane.js';
import { DatabasePluginControlStoreV1 } from '../backend-host/dist/plugins/pluginControlStore.js';
import { DatabasePluginStorageStoreV1 } from '../backend-host/dist/plugins/pluginStorageStore.js';
import { DatabasePluginEventDeliveryStoreV1 } from '../backend-host/dist/plugins/pluginEventDeliveryStore.js';
import { PluginEventMetricsRegistryV1 } from '../backend-host/dist/plugins/pluginEventMetrics.js';
import { DatabasePluginNotificationPublisherV1 } from '../backend-host/dist/plugins/pluginNotificationPublisher.js';
import { DatabasePluginScheduleStoreV1 } from '../backend-host/dist/plugins/pluginScheduleStore.js';
import { DatabasePluginGatewayAdmissionV1 } from '../backend-host/dist/plugins/pluginGatewayAdmissionStore.js';
import { DatabasePluginContributionAvailabilityStoreV1 } from '../backend-host/dist/plugins/pluginContributionAvailabilityStore.js';

const source = new DataSource({
  type: 'postgres',
  host: '127.0.0.1',
  port: Number(process.env.PGPORT),
  username: 'postgres',
  password: 'postgres',
  database: 'plugin_test',
  schema: 'main',
  entities: [...pluginPlatformEntities, Notification, User],
  migrations: [
    AddPluginPlatform1700000000016,
    AddPluginBrokerReplay1700000000017,
    AddPluginStorage1700000000018,
    AddPluginEvents1700000000019,
    AddPluginNotificationsAndSchedules1700000000020,
    AddPluginEmergencyControl1700000000021,
    AddPluginGatewayAdmission1700000000022,
    AddPluginEventCircuit1700000000023,
    AddPluginContributionAvailability1700000000024,
  ],
  synchronize: false,
});

await source.initialize();
try {
  await source.query('CREATE SCHEMA IF NOT EXISTS main');
  const applied = await source.runMigrations({ transaction: 'each' });
  const tableRows = await source.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_name LIKE 'plugin_%' ORDER BY table_name",
  );
  const tables = tableRows.map((row) => row.table_name);
  const expected = [
    'plugin_broker_replays',
    'plugin_contribution_availability',
    'plugin_emergency_control_operations',
    'plugin_event_deliveries',
    'plugin_event_queue_state',
    'plugin_event_subscription_state',
    'plugin_gateway_admission_state',
    'plugin_gateway_concurrency_leases',
    'plugin_gateway_subject_buckets',
    'plugin_installations',
    'plugin_lifecycle_operations',
    'plugin_notification_publications',
    'plugin_permission_grants',
    'plugin_platform_audit',
    'plugin_platform_state',
    'plugin_schedule_commands',
    'plugin_scheduled_jobs',
    'plugin_storage_entries',
    'plugin_tenant_enablements',
  ];
  if (JSON.stringify(tables) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected plugin tables: ${JSON.stringify(tables)}`);
  }

  const indexRows = await source.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'main' AND tablename = 'plugin_broker_replays' ORDER BY indexname",
  );
  const indexes = new Set(indexRows.map((row) => row.indexname));
  for (const required of [
    'idx_plugin_broker_replay_expiry',
    'idx_plugin_broker_replay_key',
    'idx_plugin_broker_replay_plugin',
  ]) {
    if (!indexes.has(required)) throw new Error(`Missing broker index ${required}`);
  }

  await source.query(
    "INSERT INTO main.plugin_broker_replays (id,key_hash,plugin_id,invocation_hash,call_id_hash,expires_at,created_at) VALUES ('id-1','key-1','io.enterpriseglue.reference','inv-1','call-1',9999999999,1)",
  );
  let duplicateRejected = false;
  try {
    await source.query(
      "INSERT INTO main.plugin_broker_replays (id,key_hash,plugin_id,invocation_hash,call_id_hash,expires_at,created_at) VALUES ('id-2','key-1','io.enterpriseglue.reference','inv-1','call-1',9999999999,1)",
    );
  } catch {
    duplicateRejected = true;
  }
  if (!duplicateRejected) throw new Error('Broker replay uniqueness was not enforced');

  const admissionPolicy = {
    windowMs: 60_000,
    maxRequestsPerSubjectOperation: 2,
    maxRequestsPerPlugin: 3,
    maxConcurrentPerOperation: 1,
    maxTrackedBuckets: 10,
  };
  const admissionInput = {
    pluginId: 'io.enterpriseglue.reference',
    operationId: 'io.enterpriseglue.reference.analyze',
    tenantRef: 'tenant-sensitive-reference',
    subjectRef: 'subject-sensitive-reference',
    nowMs: 60_000,
    leaseTtlMs: 1_000,
  };
  const firstAdmission = new DatabasePluginGatewayAdmissionV1(
    admissionPolicy,
    async () => source,
  );
  const secondAdmission = new DatabasePluginGatewayAdmissionV1(
    admissionPolicy,
    async () => source,
  );
  const firstLease = await firstAdmission.acquire(admissionInput);
  let concurrentRejected = false;
  try {
    await secondAdmission.acquire(admissionInput);
  } catch (error) {
    concurrentRejected = error?.code === 'concurrency_limited';
  }
  if (!concurrentRejected) {
    throw new Error('Deployment-wide gateway concurrency was not enforced');
  }
  await firstLease.release();
  const secondLease = await secondAdmission.acquire(admissionInput);
  await secondLease.release();
  const thirdLease = await firstAdmission.acquire({
    ...admissionInput,
    subjectRef: 'another-sensitive-subject',
  });
  await thirdLease.release();
  let pluginRateRejected = false;
  try {
    await secondAdmission.acquire({
      ...admissionInput,
      subjectRef: 'third-sensitive-subject',
    });
  } catch (error) {
    pluginRateRejected = error?.code === 'rate_limited';
  }
  if (!pluginRateRejected) {
    throw new Error('Deployment-wide gateway rate limit was not enforced');
  }

  const crashedLease = await firstAdmission.acquire({
    ...admissionInput,
    nowMs: 120_000,
  });
  let crashedLeaseRejected = false;
  try {
    await secondAdmission.acquire({
      ...admissionInput,
      nowMs: 120_999,
    });
  } catch (error) {
    crashedLeaseRejected = error?.code === 'concurrency_limited';
  }
  if (!crashedLeaseRejected) {
    throw new Error('Unexpired crashed-host lease did not hold bounded capacity');
  }
  const recoveredLease = await secondAdmission.acquire({
    ...admissionInput,
    nowMs: 121_001,
  });
  await recoveredLease.release();
  await crashedLease.release();
  const [subjectBucket] = await source.query(
    'SELECT bucket_hash,plugin_id,operation_id FROM main.plugin_gateway_subject_buckets LIMIT 1',
  );
  if (
    !/^[a-f0-9]{64}$/.test(subjectBucket?.bucket_hash ?? '') ||
    JSON.stringify(subjectBucket).includes('tenant-sensitive-reference') ||
    JSON.stringify(subjectBucket).includes('subject-sensitive-reference')
  ) {
    throw new Error('Gateway admission persisted a raw tenant or subject reference');
  }

  const availabilityTarget = {
    pluginId: 'io.enterpriseglue.reference',
    pluginVersion: '1.0.0',
    installerRevision: 7,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-availability-1',
    refreshIntervalSeconds: 300,
    maximumStalenessSeconds: 900,
  };
  const availabilityStoreA =
    new DatabasePluginContributionAvailabilityStoreV1(
      async () => source,
    );
  const availabilityStoreB =
    new DatabasePluginContributionAvailabilityStoreV1(
      async () => source,
    );
  await Promise.all([
    availabilityStoreA.reconcileTargets([availabilityTarget], 200_000),
    availabilityStoreB.reconcileTargets([availabilityTarget], 200_000),
  ]);
  const [availabilityClaim] = await availabilityStoreA.claimDue({
    workerRef: 'availability-worker-a',
    now: 200_000,
    leaseMs: 30_000,
    limit: 1,
  });
  if (
    !availabilityClaim ||
    (
      await availabilityStoreB.claimDue({
        workerRef: 'availability-worker-b',
        now: 200_000,
        leaseMs: 30_000,
        limit: 1,
      })
    ).length !== 0
  ) {
    throw new Error('Availability projection lease was not deployment-wide');
  }
  const availabilityProjection = {
    apiVersion:
      'contribution-availability.plugin.enterpriseglue.io/v1',
    evaluatedAt: '2026-07-26T00:00:00.000Z',
    validUntil: '2026-07-26T00:15:00.000Z',
    contributions: [
      {
        contributionId: 'io.enterpriseglue.reference.action',
        available: false,
        reasonCode: 'dependency_incompatible',
      },
    ],
  };
  if (
    !(await availabilityStoreA.completeSuccess(
      availabilityClaim,
      availabilityProjection,
      500_000,
      200_001,
    ))
  ) {
    throw new Error('Availability projection completion lost its CAS lease');
  }
  const availabilityAfterRestart =
    await new DatabasePluginContributionAvailabilityStoreV1(
      async () => source,
    ).readCurrent({
      ...availabilityTarget,
      now: Date.parse('2026-07-26T00:14:59.000Z'),
    });
  if (
    availabilityAfterRestart?.contributions[0]?.reasonCode !==
    'dependency_incompatible'
  ) {
    throw new Error('Availability projection did not survive restart');
  }
  const upgradedAvailabilityTarget = {
    ...availabilityTarget,
    installerRevision: 8,
  };
  await availabilityStoreB.reconcileTargets(
    [upgradedAvailabilityTarget],
    210_000,
  );
  if (
    await availabilityStoreB.readCurrent({
      ...upgradedAvailabilityTarget,
      now: 210_001,
    })
  ) {
    throw new Error('Availability projection survived a source revision');
  }
  const [crashedAvailabilityClaim] =
    await availabilityStoreA.claimDue({
      workerRef: 'availability-worker-crashed',
      now: 210_000,
      leaseMs: 30_000,
      limit: 1,
    });
  if (
    !crashedAvailabilityClaim ||
    (
      await availabilityStoreB.claimDue({
        workerRef: 'availability-worker-before-expiry',
        now: 239_999,
        leaseMs: 30_000,
        limit: 1,
      })
    ).length !== 0 ||
    (
      await availabilityStoreB.claimDue({
        workerRef: 'availability-worker-recovered',
        now: 240_001,
        leaseMs: 30_000,
        limit: 1,
      })
    ).length !== 1
  ) {
    throw new Error('Availability refresh lease did not recover after crash');
  }

  await source.query(
    'CREATE TABLE main.users (id text PRIMARY KEY, email text UNIQUE NOT NULL, is_active boolean NOT NULL DEFAULT true)',
  );
  await source.query(
    'CREATE TABLE main.notifications (id text PRIMARY KEY, user_id text NOT NULL, tenant_id text, state text NOT NULL, title text NOT NULL, subtitle text, read_at bigint, created_at bigint NOT NULL)',
  );
  await source.query(
    "INSERT INTO main.users (id,email,is_active) VALUES ('user-1','user-1@example.invalid',true)",
  );
  const notificationPublisher = new DatabasePluginNotificationPublisherV1(
    async () => source,
  );
  const notificationInput = {
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subjectRef: 'user-1',
    request: {
      apiVersion:
        'notification-publish-request.plugin.enterpriseglue.io/v1',
      callId: 'notification-call-1',
      operationId: 'io.enterpriseglue.reference.analyze',
      templateId: 'host.plugin.action-required.v1',
      reasonCode: 'review_required',
      occurrenceCount: 2,
      idempotencyKey: 'notification-idempotency-1',
    },
  };
  const publishedNotification =
    await notificationPublisher.publish(notificationInput);
  const duplicateNotification =
    await notificationPublisher.publish(notificationInput);
  if (
    publishedNotification.status !== 'published' ||
    duplicateNotification.status !== 'duplicate' ||
    duplicateNotification.notificationRef !==
      publishedNotification.notificationRef
  ) {
    throw new Error('Plugin notification publication was not idempotent');
  }
  const [notificationRow] = await source.query(
    'SELECT user_id,tenant_id,title,subtitle FROM main.notifications WHERE id = $1',
    [publishedNotification.notificationRef],
  );
  if (
    notificationRow?.user_id !== 'user-1' ||
    notificationRow?.tenant_id !== 'tenant-1' ||
    notificationRow?.title !== 'Plugin action required' ||
    !String(notificationRow?.subtitle).includes('review_required')
  ) {
    throw new Error('Plugin notification was not host-rendered and scoped');
  }

  const scheduleStore = new DatabasePluginScheduleStoreV1(
    async () => source,
    () => 1_000,
  );
  const scheduleBase = {
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subjectRef: 'user-1',
    deliveryOperationId:
      'io.enterpriseglue.reference.deliver-refresh',
    allowedIntervalsSeconds: [3600, 86400],
    maxAttempts: 3,
  };
  const scheduleRequest = {
    apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
    callId: 'schedule-call-1',
    operationId: 'io.enterpriseglue.reference.configure-refresh',
    action: 'upsert',
    jobType: 'io.enterpriseglue.reference.refresh-index',
    intervalSeconds: 3600,
    idempotencyKey: 'schedule-idempotency-1',
  };
  const scheduled = await scheduleStore.execute({
    ...scheduleBase,
    request: scheduleRequest,
  });
  const duplicateSchedule = await scheduleStore.execute({
    ...scheduleBase,
    request: scheduleRequest,
  });
  if (
    scheduled.status !== 'scheduled' ||
    duplicateSchedule.status !== 'duplicate' ||
    duplicateSchedule.jobRef !== scheduled.jobRef
  ) {
    throw new Error('Plugin schedule command was not idempotent');
  }
  const [firstScheduledDelivery] = await scheduleStore.claimDue({
    workerRef: 'schedule-worker-1',
    limit: 10,
    leaseSeconds: 30,
    now: 3_601_000,
  });
  if (
    !firstScheduledDelivery ||
    firstScheduledDelivery.attempt !== 1 ||
    firstScheduledDelivery.request.jobType !==
      'io.enterpriseglue.reference.refresh-index'
  ) {
    throw new Error('Plugin schedule was not durably claimed');
  }
  const scheduleRetry = await scheduleStore.complete({
    jobRef: scheduled.jobRef,
    leaseOwner: 'schedule-worker-1',
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: firstScheduledDelivery.request.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 3_601_100,
  });
  if (scheduleRetry.status !== 'retry_wait') {
    throw new Error('Plugin schedule retry was not persisted');
  }
  const [secondScheduledDelivery] = await scheduleStore.claimDue({
    workerRef: 'schedule-worker-2',
    limit: 10,
    leaseSeconds: 30,
    now: scheduleRetry.nextRunAt,
  });
  const scheduleAccepted = await scheduleStore.complete({
    jobRef: scheduled.jobRef,
    leaseOwner: 'schedule-worker-2',
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: secondScheduledDelivery.request.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: scheduleRetry.nextRunAt + 1,
  });
  if (
    scheduleAccepted.status !== 'scheduled' ||
    scheduleAccepted.attempt !== 0
  ) {
    throw new Error('Plugin recurring schedule was not advanced');
  }
  const pausedSchedule = await scheduleStore.setPaused({
    jobRef: scheduled.jobRef,
    paused: true,
    expectedRevision: scheduleAccepted.revision,
    reasonCode: 'administrator_paused',
    now: scheduleAccepted.nextRunAt - 1,
  });
  if (
    pausedSchedule.status !== 'paused' ||
    (
      await scheduleStore.claimDue({
        workerRef: 'schedule-worker-3',
        limit: 10,
        leaseSeconds: 30,
        now: scheduleAccepted.nextRunAt,
      })
    ).length !== 0
  ) {
    throw new Error('Paused plugin schedule still delivered');
  }
  const resumedSchedule = await scheduleStore.setPaused({
    jobRef: scheduled.jobRef,
    paused: false,
    expectedRevision: pausedSchedule.revision,
    reasonCode: 'administrator_resumed',
    now: scheduleAccepted.nextRunAt,
  });
  if (resumedSchedule.status !== 'scheduled') {
    throw new Error('Plugin schedule was not resumed');
  }
  const cancelledSchedule = await scheduleStore.execute({
    ...scheduleBase,
    request: {
      apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
      callId: 'schedule-call-2',
      operationId: 'io.enterpriseglue.reference.configure-refresh',
      action: 'cancel',
      jobType: 'io.enterpriseglue.reference.refresh-index',
      idempotencyKey: 'schedule-idempotency-2',
    },
  });
  if (cancelledSchedule.status !== 'cancelled') {
    throw new Error('Plugin schedule cancellation was not persisted');
  }

  const storage = new DatabasePluginStorageStoreV1(async () => source);
  const storageBase = {
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    callId: 'storage-call-1',
    operationId: 'io.enterpriseglue.reference.store',
    scope: 'tenant',
    key: 'automation/cursor',
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
  };
  const storageMissing = await storage.execute({
    ...storageBase,
    action: 'get',
  });
  if (storageMissing.found !== false) {
    throw new Error('Plugin storage missing key was not isolated');
  }
  const stored = await storage.execute({
    ...storageBase,
    action: 'put',
    value: { cursor: 1 },
  });
  if (stored.revision !== 'r1') {
    throw new Error('Plugin storage did not create revision r1');
  }
  let storageStaleRejected = false;
  try {
    await storage.execute({
      ...storageBase,
      action: 'put',
      value: { cursor: 2 },
    });
  } catch (error) {
    storageStaleRejected = error?.code === 'storage_revision_conflict';
  }
  if (!storageStaleRejected) {
    throw new Error('Plugin storage allowed an overwrite without a revision');
  }
  const updatedStorage = await storage.execute({
    ...storageBase,
    action: 'put',
    value: { cursor: 2 },
    expectedRevision: 'r1',
  });
  if (updatedStorage.revision !== 'r2') {
    throw new Error('Plugin storage optimistic update did not advance revision');
  }
  const otherTenant = await storage.execute({
    ...storageBase,
    action: 'get',
    tenantRef: 'tenant-2',
  });
  if (otherTenant.found !== false) {
    throw new Error('Plugin storage leaked a key across tenants');
  }
  const loadedStorage = await storage.execute({
    ...storageBase,
    action: 'get',
  });
  if (
    loadedStorage.found !== true ||
    loadedStorage.revision !== 'r2' ||
    loadedStorage.value?.cursor !== 2
  ) {
    throw new Error('Plugin storage round trip did not preserve the value');
  }
  await storage.execute({
    ...storageBase,
    action: 'delete',
    expectedRevision: 'r2',
  });

  const eventMetrics = new PluginEventMetricsRegistryV1(
    () => new Date('2026-07-26T00:00:00.000Z'),
  );
  const eventStore = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
    {},
    {},
    eventMetrics,
  );
  const event = {
    specversion: '1.0',
    id: 'incident-event-1',
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: 'incident-1',
    time: '2026-07-24T01:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef: 'tenant-1',
    data: {
      engineRef: 'engine-1',
      incidentRef: 'incident-1',
      incidentType: 'failedJob',
    },
  };
  const queuedEvent = await eventStore.enqueue({
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.reference.consume-incident',
    maxAttempts: 3,
    event,
    now: 1_000,
  });
  const duplicateEvent = await eventStore.enqueue({
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.reference.consume-incident',
    maxAttempts: 3,
    event,
    now: 1_001,
  });
  if (duplicateEvent.deliveryId !== queuedEvent.deliveryId) {
    throw new Error('Plugin event enqueue was not idempotent');
  }
  const [firstDelivery] = await eventStore.claimDue({
    workerRef: 'worker-1',
    limit: 10,
    leaseSeconds: 30,
    now: 1_000,
  });
  if (
    !firstDelivery ||
    firstDelivery.request.event.data.incidentRef !== 'incident-1' ||
    firstDelivery.attempt !== 1
  ) {
    throw new Error('Plugin event was not durably claimed');
  }
  const retry = await eventStore.complete({
    deliveryId: firstDelivery.deliveryId,
    leaseOwner: 'worker-1',
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: firstDelivery.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 1_100,
  });
  if (retry.status !== 'retry_wait') {
    throw new Error('Plugin event retry was not scheduled');
  }
  const [secondDelivery] = await eventStore.claimDue({
    workerRef: 'worker-2',
    limit: 10,
    leaseSeconds: 30,
    now: retry.nextAttemptAt,
  });
  if (!secondDelivery || secondDelivery.attempt !== 2) {
    throw new Error('Plugin event retry was not claimed');
  }
  const deadLetter = await eventStore.complete({
    deliveryId: secondDelivery.deliveryId,
    leaseOwner: 'worker-2',
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: secondDelivery.deliveryId,
      status: 'permanent_rejected',
      reasonCode: 'contract_rejected',
    },
    now: retry.nextAttemptAt + 1,
  });
  if (deadLetter.status !== 'dead_letter') {
    throw new Error('Plugin event was not dead-lettered');
  }
  const deadLetterPage = await eventStore.listDeadLetters({ limit: 1 });
  if (
    deadLetterPage.items.length !== 1 ||
    deadLetterPage.items[0]?.deliveryId !== deadLetter.deliveryId ||
    'tenantRef' in deadLetterPage.items[0] ||
    'eventJson' in deadLetterPage.items[0]
  ) {
    throw new Error('Plugin dead-letter inspection was not payload-free');
  }
  let wrongPluginReplayRejected = false;
  try {
    await eventStore.requeueDeadLetter({
      pluginId: 'io.enterpriseglue.other',
      deliveryId: deadLetter.deliveryId,
      expectedAttempt: 2,
      actorRef: 'persistence-test-admin',
      correlationId: 'persistence-test-requeue-wrong-plugin',
      now: retry.nextAttemptAt + 2,
    });
  } catch (error) {
    wrongPluginReplayRejected =
      error?.message === 'plugin_event_requeue_conflict';
  }
  if (!wrongPluginReplayRejected) {
    throw new Error('Plugin-scoped dead-letter replay was not enforced');
  }
  const requeued = await eventStore.requeueDeadLetter({
    pluginId: 'io.enterpriseglue.reference',
    deliveryId: deadLetter.deliveryId,
    expectedAttempt: 2,
    actorRef: 'persistence-test-admin',
    correlationId: 'persistence-test-requeue-1',
    now: retry.nextAttemptAt + 2,
  });
  if (requeued.status !== 'pending' || requeued.attempt !== 0) {
    throw new Error('Plugin dead letter was not explicitly replayed');
  }
  const [requeueAudit] = await source.query(
    "SELECT event_type, plugin_id, tenant_ref, actor_ref, correlation_id, from_state, to_state FROM main.plugin_platform_audit WHERE event_type = 'event_dead_letter_requeued'",
  );
  if (
    requeueAudit?.plugin_id !== 'io.enterpriseglue.reference' ||
    requeueAudit?.tenant_ref !== 'tenant-1' ||
    requeueAudit?.actor_ref !== 'persistence-test-admin' ||
    requeueAudit?.correlation_id !== 'persistence-test-requeue-1' ||
    requeueAudit?.from_state !== 'dead_letter' ||
    requeueAudit?.to_state !== 'pending'
  ) {
    throw new Error('Plugin dead-letter replay audit was not durable');
  }
  const paused = await eventStore.setPaused({
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    paused: true,
    expectedRevision: 0,
    reasonCode: 'administrator_paused',
    now: retry.nextAttemptAt + 3,
  });
  if (
    paused.revision !== 1 ||
    (
      await eventStore.claimDue({
        workerRef: 'worker-3',
        limit: 10,
        leaseSeconds: 30,
        now: retry.nextAttemptAt + 3,
      })
    ).length !== 0
  ) {
    throw new Error('Paused plugin subscription still delivered events');
  }
  await eventStore.setPaused({
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    paused: false,
    expectedRevision: 1,
    reasonCode: 'administrator_resumed',
    now: retry.nextAttemptAt + 4,
  });
  const [resumedDelivery] = await eventStore.claimDue({
    workerRef: 'worker-4',
    limit: 10,
    leaseSeconds: 30,
    now: retry.nextAttemptAt + 4,
  });
  if (!resumedDelivery) {
    throw new Error('Resumed plugin subscription did not deliver');
  }
  const deliveredEvent = await eventStore.complete({
    deliveryId: resumedDelivery.deliveryId,
    leaseOwner: 'worker-4',
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: resumedDelivery.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: retry.nextAttemptAt + 5,
  });
  if (deliveredEvent.status !== 'delivered') {
    throw new Error('Plugin event acceptance was not persisted');
  }

  const circuitStore = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
    {},
    {
      failureThreshold: 2,
      openMilliseconds: 1_000,
    },
    eventMetrics,
  );
  const circuitEvent = (id) => ({
    ...event,
    id,
    subject: `incident-${id}`,
    tenantRef: 'tenant-circuit',
    data: {
      ...event.data,
      incidentRef: `incident-${id}`,
    },
  });
  const circuitBase = {
    pluginId: 'io.enterpriseglue.circuit-test',
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-circuit',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.circuit-test.consume-incident',
    maxAttempts: 10,
  };
  await circuitStore.enqueue({
    ...circuitBase,
    event: circuitEvent('circuit-1'),
    now: 20_000,
  });
  const [circuitFirst] = await circuitStore.claimDue({
    workerRef: 'circuit-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 20_000,
  });
  if (!circuitFirst) throw new Error('Circuit fixture was not claimed');
  const circuitRetry = await circuitStore.complete({
    deliveryId: circuitFirst.deliveryId,
    leaseOwner: 'circuit-worker-1',
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: circuitFirst.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 20_001,
  });
  const [circuitSecond] = await circuitStore.claimDue({
    workerRef: 'circuit-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: circuitRetry.nextAttemptAt,
  });
  if (!circuitSecond) throw new Error('Circuit retry was not claimed');
  await circuitStore.complete({
    deliveryId: circuitSecond.deliveryId,
    leaseOwner: 'circuit-worker-2',
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: circuitSecond.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: circuitRetry.nextAttemptAt + 1,
  });
  const [openedCircuit] = await source.query(
    "SELECT circuit_state, consecutive_failures, circuit_open_until, probe_delivery_id FROM main.plugin_event_subscription_state WHERE plugin_id = 'io.enterpriseglue.circuit-test'",
  );
  if (
    openedCircuit?.circuit_state !== 'open' ||
    Number(openedCircuit?.consecutive_failures) !== 2 ||
    Number(openedCircuit?.circuit_open_until) !==
      circuitRetry.nextAttemptAt + 1 + 1_000 ||
    openedCircuit?.probe_delivery_id !== null
  ) {
    throw new Error('Plugin event circuit did not open durably');
  }
  let openCircuitRejected = false;
  try {
    await circuitStore.enqueue({
      ...circuitBase,
      event: circuitEvent('circuit-open-rejected'),
      now: circuitRetry.nextAttemptAt + 2,
    });
  } catch (error) {
    openCircuitRejected = error?.message === 'plugin_event_circuit_open';
  }
  if (!openCircuitRejected) {
    throw new Error('Open plugin event circuit accepted new automatic work');
  }
  const probeAt = circuitRetry.nextAttemptAt + 1 + 1_000;
  await circuitStore.enqueue({
    ...circuitBase,
    event: circuitEvent('circuit-probe-1'),
    now: probeAt,
  });
  await circuitStore.enqueue({
    ...circuitBase,
    event: circuitEvent('circuit-probe-2'),
    now: probeAt,
  });
  const probeClaims = await circuitStore.claimDue({
    workerRef: 'circuit-probe-worker',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt,
  });
  if (probeClaims.length !== 1) {
    throw new Error('Half-open event circuit admitted more than one probe');
  }
  const [halfOpenCircuit] = await source.query(
    "SELECT circuit_state, probe_delivery_id FROM main.plugin_event_subscription_state WHERE plugin_id = 'io.enterpriseglue.circuit-test'",
  );
  if (
    halfOpenCircuit?.circuit_state !== 'half_open' ||
    halfOpenCircuit?.probe_delivery_id !== probeClaims[0]?.deliveryId
  ) {
    throw new Error('Half-open event circuit probe was not durable');
  }
  await circuitStore.complete({
    deliveryId: probeClaims[0].deliveryId,
    leaseOwner: 'circuit-probe-worker',
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: probeClaims[0].deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: probeAt + 1,
  });
  const [closedCircuit] = await source.query(
    "SELECT circuit_state, consecutive_failures, circuit_open_until, probe_delivery_id FROM main.plugin_event_subscription_state WHERE plugin_id = 'io.enterpriseglue.circuit-test'",
  );
  if (
    closedCircuit?.circuit_state !== 'closed' ||
    Number(closedCircuit?.consecutive_failures) !== 0 ||
    closedCircuit?.circuit_open_until !== null ||
    closedCircuit?.probe_delivery_id !== null
  ) {
    throw new Error('Successful half-open probe did not close the event circuit');
  }

  const quotaEventStore = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
    {
      maxOutstandingPerPlugin: 2,
      maxOutstandingPerSubscription: 1,
    },
    {},
    eventMetrics,
  );
  const quotaEvent = (id, tenantRef) => ({
    ...event,
    id,
    subject: `incident-${id}`,
    tenantRef,
    data: {
      ...event.data,
      incidentRef: `incident-${id}`,
    },
  });
  const quotaBase = {
    pluginId: 'io.enterpriseglue.quota-test',
    deploymentRef: 'deployment-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.quota-test.consume-incident',
    maxAttempts: 3,
  };
  const firstQuotaEvent = await quotaEventStore.enqueue({
    ...quotaBase,
    tenantRef: 'tenant-quota-1',
    event: quotaEvent('quota-1', 'tenant-quota-1'),
    now: 10_000,
  });
  const duplicateQuotaEvent = await quotaEventStore.enqueue({
    ...quotaBase,
    tenantRef: 'tenant-quota-1',
    event: quotaEvent('quota-1', 'tenant-quota-1'),
    now: 10_001,
  });
  if (duplicateQuotaEvent.deliveryId !== firstQuotaEvent.deliveryId) {
    throw new Error('Backlog quota broke idempotent event enqueue');
  }
  let subscriptionBacklogRejected = false;
  try {
    await quotaEventStore.enqueue({
      ...quotaBase,
      tenantRef: 'tenant-quota-1',
      event: quotaEvent('quota-2', 'tenant-quota-1'),
      now: 10_002,
    });
  } catch (error) {
    subscriptionBacklogRejected =
      error?.message ===
      'plugin_event_backlog_subscription_quota_exceeded';
  }
  if (!subscriptionBacklogRejected) {
    throw new Error('Per-subscription event backlog quota was not enforced');
  }
  await quotaEventStore.enqueue({
    ...quotaBase,
    tenantRef: 'tenant-quota-2',
    event: quotaEvent('quota-3', 'tenant-quota-2'),
    now: 10_003,
  });
  let pluginBacklogRejected = false;
  try {
    await quotaEventStore.enqueue({
      ...quotaBase,
      tenantRef: 'tenant-quota-3',
      event: quotaEvent('quota-4', 'tenant-quota-3'),
      now: 10_004,
    });
  } catch (error) {
    pluginBacklogRejected =
      error?.message === 'plugin_event_backlog_plugin_quota_exceeded';
  }
  if (!pluginBacklogRejected) {
    throw new Error('Deployment-wide plugin event backlog quota was not enforced');
  }
  const [quotaDelivery] = await quotaEventStore.claimDue({
    workerRef: 'quota-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 10_005,
  });
  if (!quotaDelivery || quotaDelivery.deliveryId !== firstQuotaEvent.deliveryId) {
    throw new Error('Event backlog quota fixture was not durably claimable');
  }
  await quotaEventStore.complete({
    deliveryId: quotaDelivery.deliveryId,
    leaseOwner: 'quota-worker-1',
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: quotaDelivery.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: 10_006,
  });
  await quotaEventStore.enqueue({
    ...quotaBase,
    tenantRef: 'tenant-quota-1',
    event: quotaEvent('quota-2', 'tenant-quota-1'),
    now: 10_007,
  });
  const quotaRacePolicy = {
    maxOutstandingPerPlugin: 1,
    maxOutstandingPerSubscription: 1,
  };
  const quotaRaceStores = [
    new DatabasePluginEventDeliveryStoreV1(
      async () => source,
      quotaRacePolicy,
      {},
      eventMetrics,
    ),
    new DatabasePluginEventDeliveryStoreV1(
      async () => source,
      quotaRacePolicy,
      {},
      eventMetrics,
    ),
  ];
  const quotaRaceResults = await Promise.allSettled(
    quotaRaceStores.map((store, index) =>
      store.enqueue({
        ...quotaBase,
        pluginId: 'io.enterpriseglue.quota-race',
        operationId: 'io.enterpriseglue.quota-race.consume-incident',
        tenantRef: `tenant-race-${index + 1}`,
        event: quotaEvent(`quota-race-${index + 1}`, `tenant-race-${index + 1}`),
        now: 11_000,
      }),
    ),
  );
  if (
    quotaRaceResults.filter((result) => result.status === 'fulfilled').length !==
      1 ||
    quotaRaceResults.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason?.message ===
          'plugin_event_backlog_plugin_quota_exceeded',
    ).length !== 1
  ) {
    throw new Error('Concurrent replicas bypassed the plugin event backlog quota');
  }
  const eventMetricSnapshot = eventMetrics.snapshot();
  if (
    eventMetricSnapshot.generatedAt !== '2026-07-26T00:00:00.000Z' ||
    !eventMetricSnapshot.enqueues.some(
      (entry) =>
        entry.outcome === 'duplicate' &&
        entry.reasonCode === 'duplicate',
    ) ||
    !eventMetricSnapshot.enqueues.some(
      (entry) =>
        entry.outcome === 'rejected' &&
        entry.reasonCode === 'circuit_open',
    ) ||
    !eventMetricSnapshot.enqueues.some(
      (entry) =>
        entry.outcome === 'rejected' &&
        entry.reasonCode === 'plugin_backlog_full',
    ) ||
    !eventMetricSnapshot.deliveries.some(
      (entry) =>
        entry.outcome === 'retry_wait' &&
        entry.receiptStatus === 'retryable_rejected',
    ) ||
    !eventMetricSnapshot.deliveries.some(
      (entry) =>
        entry.outcome === 'dead_letter' &&
        entry.receiptStatus === 'permanent_rejected',
    ) ||
    !eventMetricSnapshot.deliveries.some(
      (entry) =>
        entry.outcome === 'requeued' &&
        entry.reasonCode === 'administrator_requeued',
    ) ||
    !eventMetricSnapshot.circuits.some(
      (entry) =>
        entry.state === 'open' &&
        entry.reasonCode === 'circuit_open',
    ) ||
    !eventMetricSnapshot.circuits.some(
      (entry) =>
        entry.state === 'half_open' &&
        entry.reasonCode === 'half_open_probe',
    ) ||
    !eventMetricSnapshot.circuits.some(
      (entry) =>
        entry.state === 'closed' &&
        entry.reasonCode === 'delivery_recovered',
    )
  ) {
    throw new Error('Bounded plugin event metrics missed a committed lifecycle outcome');
  }
  const eventMetricJson = JSON.stringify(eventMetricSnapshot);
  for (const forbidden of [
    'tenant-1',
    'deployment-1',
    'incident-event-1',
    'consume-incident',
    'deliveryId',
    'eventId',
    'operationId',
    'payload',
  ]) {
    if (eventMetricJson.includes(forbidden)) {
      throw new Error(`Plugin event metrics exposed ${forbidden}`);
    }
  }

  const sourceRecord = {
    pluginId: 'io.enterpriseglue.reference',
    version: '1.0.0',
    displayName: 'Reference',
    publisher: 'io.enterpriseglue',
    bundleDigest:
      'registry.example/reference@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    manifestSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceRecordHash:
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    installerEnabled: true,
    enablementScope: 'tenant',
    compatible: true,
    healthy: true,
    entitled: 'not_required',
    reasonCode: 'none',
    grantedPermissions: ['host.identity.read_safe'],
  };
  const controlSource = {
    snapshot: { revision: 1, records: [sourceRecord] },
    async controlSnapshot() {
      return structuredClone(this.snapshot);
    },
  };
  const control = new PluginControlPlaneV1(
    controlSource,
    new DatabasePluginControlStoreV1(async () => source),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-24T01:00:00.000Z'),
    },
  );
  const initialControl = await control.list();
  if (
    initialControl.plugins.length !== 1 ||
    initialControl.plugins[0]?.enabled !== true ||
    initialControl.plugins[0]?.revision !== 0
  ) {
    throw new Error('Database lifecycle reconciliation did not seed safe state');
  }
  const initialTenant = await control.getTenantEnablement(
    'io.enterpriseglue.reference',
    'default-tenant-id',
  );
  if (!initialTenant.enabled || initialTenant.revision !== 0) {
    throw new Error('Database lifecycle reconciliation did not seed the OSS tenant');
  }
  const initialEmergency = await control.getEmergencyState();
  if (initialEmergency.disabled || initialEmergency.revision !== 0) {
    throw new Error('Database emergency control did not initialize safely');
  }
  const emergencyRequest = {
    disabled: true,
    expectedRevision: 0,
    idempotencyKey: 'database-emergency-request-0001',
    actorRef: 'admin-1',
    correlationId: 'persistence-emergency-1',
  };
  const emergencyDisabled = await control.setEmergencyDisabled(emergencyRequest);
  const repeatedEmergency = await control.setEmergencyDisabled(emergencyRequest);
  if (
    !emergencyDisabled.disabled ||
    emergencyDisabled.revision !== 1 ||
    JSON.stringify(repeatedEmergency) !== JSON.stringify(emergencyDisabled)
  ) {
    throw new Error('Database emergency control was not durable and idempotent');
  }
  if (
    await control.isExecutionAllowed(
      'io.enterpriseglue.reference',
      'default-tenant-id',
    )
  ) {
    throw new Error('Database emergency control did not stop plugin execution');
  }
  const desiredDuringEmergency = await control.get(
    'io.enterpriseglue.reference',
  );
  if (!desiredDuringEmergency.enabled || desiredDuringEmergency.revision !== 0) {
    throw new Error('Emergency control mutated desired plugin state');
  }
  const restartedControl = new PluginControlPlaneV1(
    controlSource,
    new DatabasePluginControlStoreV1(async () => source),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-24T01:01:00.000Z'),
    },
  );
  const emergencyAfterRestart = await restartedControl.getEmergencyState();
  if (!emergencyAfterRestart.disabled || emergencyAfterRestart.revision !== 1) {
    throw new Error('Emergency control did not survive a host restart');
  }
  let staleEmergencyRejected = false;
  try {
    await control.setEmergencyDisabled({
      ...emergencyRequest,
      disabled: false,
      idempotencyKey: 'database-emergency-request-0002',
    });
  } catch (error) {
    staleEmergencyRejected = error?.code === 'revision_conflict';
  }
  if (!staleEmergencyRejected) {
    throw new Error('Emergency control stale revision was not rejected');
  }
  const emergencyCleared = await control.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 1,
    idempotencyKey: 'database-emergency-request-0003',
    actorRef: 'admin-1',
    correlationId: 'persistence-emergency-2',
  });
  if (emergencyCleared.disabled || emergencyCleared.revision !== 2) {
    throw new Error('Database emergency control could not be cleared');
  }
  if (
    !(await control.isExecutionAllowed(
      'io.enterpriseglue.reference',
      'default-tenant-id',
    ))
  ) {
    throw new Error('Clearing emergency control did not restore desired plugin state');
  }
  const [emergencyAudit] = await source.query(
    "SELECT plugin_id,event_type FROM main.plugin_platform_audit WHERE correlation_id = 'persistence-emergency-1'",
  );
  if (
    emergencyAudit?.plugin_id !== null ||
    emergencyAudit?.event_type !== 'platform_emergency_disabled'
  ) {
    throw new Error('Emergency control audit was not platform scoped');
  }
  const safeAudit = await control.listAudit();
  if (
    safeAudit.events.length < 2 ||
    safeAudit.events.some(
      (event) =>
        'tenantRef' in event ||
        'requestBody' in event ||
        'manifest' in event,
    )
  ) {
    throw new Error('Safe plugin audit history was absent or exposed payload fields');
  }
  const disableRequest = {
    pluginId: 'io.enterpriseglue.reference',
    enabled: false,
    expectedRevision: 0,
    idempotencyKey: 'database-disable-request-0001',
    actorRef: 'admin-1',
    correlationId: 'persistence-drill-1',
  };
  const disabledOperation = await control.setDeploymentEnabled(disableRequest);
  const repeatedOperation = await control.setDeploymentEnabled(disableRequest);
  if (repeatedOperation.operationId !== disabledOperation.operationId) {
    throw new Error('Database lifecycle idempotent retry returned another operation');
  }
  let staleControlRejected = false;
  try {
    await control.setDeploymentEnabled({
      ...disableRequest,
      idempotencyKey: 'database-disable-request-0002',
    });
  } catch (error) {
    staleControlRejected = error?.code === 'revision_conflict';
  }
  if (!staleControlRejected) {
    throw new Error('Database lifecycle stale revision was not rejected');
  }
  controlSource.snapshot = { revision: 2, records: [sourceRecord] };
  const afterUnrelatedRevision = await control.get(
    'io.enterpriseglue.reference',
  );
  if (
    afterUnrelatedRevision.enabled !== false ||
    afterUnrelatedRevision.revision !== 1
  ) {
    throw new Error('Unrelated installer revision overwrote the runtime gate');
  }
  controlSource.snapshot = { revision: 2, records: [] };
  let reusedRevisionRejected = false;
  try {
    await control.list();
  } catch (error) {
    reusedRevisionRejected =
      error?.message === 'plugin_installer_revision_reused';
  }
  if (!reusedRevisionRejected) {
    throw new Error('Changed installer snapshot reused an accepted revision');
  }
  controlSource.snapshot = { revision: 1, records: [sourceRecord] };
  let rollbackRevisionRejected = false;
  try {
    await control.list();
  } catch (error) {
    rollbackRevisionRejected =
      error?.message === 'plugin_installer_revision_rollback';
  }
  if (!rollbackRevisionRejected) {
    throw new Error('Lower installer snapshot revision was not rejected');
  }

  const installationColumns = new Set(
    (
      await source.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'main' AND table_name = 'plugin_installations'",
      )
    ).map((row) => row.column_name),
  );
  for (const required of [
    'installer_enabled',
    'installer_revision',
    'enablement_scope',
    'grant_set_hash',
    'source_record_hash',
  ]) {
    if (!installationColumns.has(required)) {
      throw new Error(`Missing lifecycle source column ${required}`);
    }
  }
  await source.query(
    "UPDATE main.plugin_installations SET desired_enabled = true WHERE plugin_id = 'io.enterpriseglue.reference' AND revision = 0",
  );
  const [lifecycleState] = await source.query(
    "SELECT desired_enabled, state, revision FROM main.plugin_installations WHERE plugin_id = 'io.enterpriseglue.reference'",
  );
  if (
    lifecycleState?.desired_enabled !== false ||
    lifecycleState?.state !== 'installed_disabled' ||
    Number(lifecycleState?.revision) !== 1
  ) {
    throw new Error('Lifecycle optimistic revision gate was not enforced');
  }

  await source.query(
    "INSERT INTO main.plugin_lifecycle_operations (id,plugin_id,type,status,idempotency_key_hash,request_hash,target_version,reason_code,revision,lease_owner,lease_expires_at,created_at,updated_at) VALUES ('operation-1','io.enterpriseglue.reference','disable','succeeded','idempotency-1','request-1',NULL,'administrator_disabled',0,NULL,NULL,1,1)",
  );
  let operationIdempotencyRejected = false;
  try {
    await source.query(
      "INSERT INTO main.plugin_lifecycle_operations (id,plugin_id,type,status,idempotency_key_hash,request_hash,target_version,reason_code,revision,lease_owner,lease_expires_at,created_at,updated_at) VALUES ('operation-2','io.enterpriseglue.reference','disable','succeeded','idempotency-1','request-1',NULL,'administrator_disabled',0,NULL,NULL,1,1)",
    );
  } catch {
    operationIdempotencyRejected = true;
  }
  if (!operationIdempotencyRejected) {
    throw new Error('Lifecycle operation idempotency uniqueness was not enforced');
  }

  const recoveryStorageBase = {
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    operationId: 'io.enterpriseglue.reference.store',
    scope: 'tenant',
    key: 'recovery/cursor',
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'recovery-deployment',
    tenantRef: 'recovery-tenant',
  };
  const recoveryStorage = new DatabasePluginStorageStoreV1(
    async () => source,
  );
  const recoveryCreated = await recoveryStorage.execute({
    ...recoveryStorageBase,
    callId: 'recovery-storage-create',
    action: 'put',
    value: { cursor: 1 },
  });
  const recoveryUpdated = await recoveryStorage.execute({
    ...recoveryStorageBase,
    callId: 'recovery-storage-update',
    action: 'put',
    value: { cursor: 2 },
    expectedRevision: recoveryCreated.revision,
  });
  if (recoveryUpdated.revision !== 'r2') {
    throw new Error('Backup/restore storage fixture did not reach revision r2');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      applied: applied.map((migration) => migration.name),
      tables,
      replayUnique: true,
      notificationHostRenderedIdempotent: true,
      scheduleIdempotent: true,
      scheduleLeaseRetryPauseCancel: true,
      storageTenantIsolation: true,
      storageOptimistic: true,
      eventIdempotent: true,
      eventRetryDeadLetterReplay: true,
      eventDeadLetterInspectionPayloadFree: true,
      eventDeadLetterReplayPluginScoped: true,
      eventDeadLetterReplayAudited: true,
      eventPauseResume: true,
      eventCircuitDurable: true,
      eventCircuitRejectsNewWork: true,
      eventCircuitSingleProbe: true,
      eventCircuitRecovery: true,
      eventBacklogQuotaDeploymentWide: true,
      eventBacklogQuotaConcurrent: true,
      eventBacklogQuotaReclaimsCapacity: true,
      eventMetricsBounded: true,
      eventMetricsPayloadFree: true,
      lifecycleOptimistic: true,
      operationIdempotencyUnique: true,
      lifecycleStoreRoundTrip: true,
      tenantDerived: true,
      installerRevisionProtected: true,
      emergencyControlDurable: true,
      emergencyControlIdempotent: true,
      emergencyControlAudited: true,
      emergencyControlPreservesDesiredState: true,
      safeAuditHistory: true,
      gatewayAdmissionDeploymentWide: true,
      gatewayAdmissionCrashRecovery: true,
      gatewayAdmissionPseudonymous: true,
      contributionAvailabilityCas: true,
      contributionAvailabilityRestart: true,
      contributionAvailabilitySourceInvalidation: true,
      contributionAvailabilityCrashRecovery: true,
    }),
  );
} finally {
  await source.destroy();
}
NODE

RESTORED_DB="plugin_test_restore_${$}"
BACKUP_FILE="/tmp/enterpriseglue-plugin-platform-${$}.dump"

docker exec "$CONTAINER_NAME" \
  pg_dump \
  --format=custom \
  --file="$BACKUP_FILE" \
  --username=postgres \
  --dbname=plugin_test

docker exec "$CONTAINER_NAME" \
  createdb \
  --template=template0 \
  --username=postgres \
  "$RESTORED_DB"

docker exec "$CONTAINER_NAME" \
  pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --username=postgres \
  --dbname="$RESTORED_DB" \
  "$BACKUP_FILE"

cd "$ROOT_DIR/packages/shared"
PGPORT="$PGPORT" RESTORED_DB="$RESTORED_DB" node --input-type=module <<'NODE'
import { DataSource } from 'typeorm';

import { pluginPlatformEntities } from './dist/infrastructure/persistence/entities/PluginPlatform.js';
import { Notification } from './dist/infrastructure/persistence/entities/Notification.js';
import { User } from './dist/infrastructure/persistence/entities/User.js';
import { PluginControlPlaneV1 } from '../backend-host/dist/plugins/pluginControlPlane.js';
import { DatabasePluginControlStoreV1 } from '../backend-host/dist/plugins/pluginControlStore.js';
import { DatabasePluginStorageStoreV1 } from '../backend-host/dist/plugins/pluginStorageStore.js';

const restored = new DataSource({
  type: 'postgres',
  host: '127.0.0.1',
  port: Number(process.env.PGPORT),
  username: 'postgres',
  password: 'postgres',
  database: process.env.RESTORED_DB,
  schema: 'main',
  entities: [...pluginPlatformEntities, Notification, User],
  migrations: [],
  synchronize: false,
});

const sourceRecord = {
  pluginId: 'io.enterpriseglue.reference',
  version: '1.0.0',
  displayName: 'Reference',
  publisher: 'io.enterpriseglue',
  bundleDigest:
    'registry.example/reference@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  manifestSha256:
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sourceRecordHash:
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  installerEnabled: true,
  enablementScope: 'tenant',
  compatible: true,
  healthy: true,
  entitled: 'not_required',
  reasonCode: 'none',
  grantedPermissions: ['host.identity.read_safe'],
};
const controlSource = {
  async controlSnapshot() {
    return {
      revision: 2,
      records: [sourceRecord],
    };
  },
};

await restored.initialize();
try {
  const [{ count: tableCount }] = await restored.query(
    "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'main' AND table_name LIKE 'plugin_%'",
  );
  if (Number(tableCount) !== 19) {
    throw new Error('Restored plugin platform did not contain all nineteen tables');
  }

  const control = new PluginControlPlaneV1(
    controlSource,
    new DatabasePluginControlStoreV1(async () => restored),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-24T02:00:00.000Z'),
    },
  );
  const [emergency, plugin, tenant, audit] = await Promise.all([
    control.getEmergencyState(),
    control.get('io.enterpriseglue.reference'),
    control.getTenantEnablement(
      'io.enterpriseglue.reference',
      'default-tenant-id',
    ),
    control.listAudit(),
  ]);
  if (emergency.disabled || emergency.revision !== 2) {
    throw new Error('Restored emergency revision/state was not exact');
  }
  if (!plugin || plugin.enabled || plugin.revision !== 1) {
    throw new Error('Restored plugin desired state/revision was not exact');
  }
  if (!tenant.enabled || tenant.revision !== 0) {
    throw new Error('Restored tenant desired state/revision was not exact');
  }
  const auditTypes = new Set(audit.events.map((event) => event.eventType));
  if (
    !auditTypes.has('platform_emergency_disabled') ||
    !auditTypes.has('platform_emergency_enabled') ||
    audit.events.some(
      (event) =>
        'tenantRef' in event ||
        'requestBody' in event ||
        'manifest' in event,
    )
  ) {
    throw new Error('Restored emergency audit was absent or unsafe');
  }

  const storage = new DatabasePluginStorageStoreV1(async () => restored);
  const restoredStorage = await storage.execute({
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    callId: 'restore-storage-read-1',
    operationId: 'io.enterpriseglue.reference.store',
    action: 'get',
    scope: 'tenant',
    key: 'recovery/cursor',
    pluginId: 'io.enterpriseglue.reference',
    deploymentRef: 'recovery-deployment',
    tenantRef: 'recovery-tenant',
  });
  if (
    !restoredStorage.found ||
    restoredStorage.revision !== 'r2' ||
    JSON.stringify(restoredStorage.value) !== JSON.stringify({ cursor: 2 })
  ) {
    throw new Error('Restored tenant storage value/revision was not exact');
  }

  const [{ count: unsafeDeliveredPayloads }] = await restored.query(
    "SELECT COUNT(*)::int AS count FROM main.plugin_event_deliveries WHERE status = 'delivered' AND event_json <> '{}'",
  );
  const [{ count: deliveredEvents }] = await restored.query(
    "SELECT COUNT(*)::int AS count FROM main.plugin_event_deliveries WHERE status = 'delivered'",
  );
  if (
    Number(deliveredEvents) < 1 ||
    Number(unsafeDeliveredPayloads) !== 0
  ) {
    throw new Error('Restored delivered events retained unsafe payload state');
  }
  const [{ count: activeLeases }] = await restored.query(
    'SELECT COUNT(*)::int AS count FROM main.plugin_gateway_concurrency_leases',
  );
  if (Number(activeLeases) !== 0) {
    throw new Error('Restored database retained an active gateway lease');
  }

  const disabled = await control.setEmergencyDisabled({
    disabled: true,
    expectedRevision: 2,
    idempotencyKey: 'restored-emergency-disable-0001',
    actorRef: 'restore-admin',
    correlationId: 'restore-emergency-1',
  });
  if (!disabled.disabled || disabled.revision !== 3) {
    throw new Error('Restored emergency control could not advance safely');
  }
  const restarted = new PluginControlPlaneV1(
    controlSource,
    new DatabasePluginControlStoreV1(async () => restored),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-24T02:01:00.000Z'),
    },
  );
  const afterRestart = await restarted.getEmergencyState();
  if (!afterRestart.disabled || afterRestart.revision !== 3) {
    throw new Error('Post-restore emergency state did not survive restart');
  }
  const resumed = await restarted.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 3,
    idempotencyKey: 'restored-emergency-resume-0001',
    actorRef: 'restore-admin',
    correlationId: 'restore-emergency-2',
  });
  if (resumed.disabled || resumed.revision !== 4) {
    throw new Error('Post-restore emergency control could not resume safely');
  }
  const pluginAfterResume = await restarted.get(
    'io.enterpriseglue.reference',
  );
  if (!pluginAfterResume || pluginAfterResume.enabled) {
    throw new Error('Post-restore emergency resume changed plugin desired state');
  }
  const enabled = await restarted.setDeploymentEnabled({
    pluginId: 'io.enterpriseglue.reference',
    enabled: true,
    expectedRevision: 1,
    idempotencyKey: 'restored-plugin-enable-0001',
    actorRef: 'restore-admin',
    correlationId: 'restore-plugin-enable-1',
  });
  if (enabled.status !== 'succeeded') {
    throw new Error('Restored plugin control could not accept a safe mutation');
  }
  if (
    !(await restarted.isExecutionAllowed(
      'io.enterpriseglue.reference',
      'default-tenant-id',
    ))
  ) {
    throw new Error('Restored control state could not resume plugin execution');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      logicalBackupRestore: true,
      restoredPluginTables: 19,
      restoredEmergencyRevision: 2,
      restoredDesiredState: true,
      restoredTenantState: true,
      restoredStorageRevision: 'r2',
      restoredDeliveredPayloadsErased: true,
      restoredActiveGatewayLeases: 0,
      postRestoreEmergencyRestart: true,
      postRestoreSafeMutation: true,
    }),
  );
} finally {
  await restored.destroy();
}
NODE
