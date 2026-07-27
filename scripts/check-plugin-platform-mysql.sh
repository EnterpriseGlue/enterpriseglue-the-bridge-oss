#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="eg-plugin-mysql-${$}"
MYSQL_IMAGE="${ENTERPRISEGLUE_PLUGIN_TEST_MYSQL_IMAGE:-mysql@sha256:8dbcf531a03aade657e181b9cf2f1d1803ce621a1d55610cb44cb531ab7d7db6}"
BACKUP_FILE="/tmp/enterpriseglue-plugin-platform-mysql-${$}.sql"

cleanup() {
  status=$?
  if [[ "$status" -ne 0 ]]; then
    docker logs --tail 120 "$CONTAINER_NAME" >&2 || true
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$BACKUP_FILE"
  return "$status"
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || {
  echo "docker is required for the plugin MySQL drill" >&2
  exit 1
}

docker run --rm -d \
  --name "$CONTAINER_NAME" \
  -e MYSQL_ROOT_PASSWORD=mysql \
  -e MYSQL_DATABASE=main \
  -p 127.0.0.1::3306 \
  "$MYSQL_IMAGE" >/dev/null

ready=false
for _attempt in {1..60}; do
  if docker exec -e MYSQL_PWD=mysql "$CONTAINER_NAME" \
    mysql --protocol=TCP -h127.0.0.1 -uroot \
      --silent --skip-column-names -e 'SELECT 1' main >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "disposable MySQL did not become ready" >&2
  exit 1
fi
sleep 1

MYSQL_PORT="$(
  docker port "$CONTAINER_NAME" 3306/tcp |
    awk -F: 'NR == 1 { print $NF }'
)"
if [[ ! "$MYSQL_PORT" =~ ^[0-9]+$ ]]; then
  echo "could not determine disposable MySQL port" >&2
  exit 1
fi

cd "$ROOT_DIR/packages/shared"
MYSQL_PORT="$MYSQL_PORT" node --input-type=module <<'NODE'
import { createRequire } from 'node:module';
import { DataSource } from 'typeorm';

globalThis.require = createRequire(import.meta.url);

import { AddPluginPlatform1700000000016 } from './dist/db/migrations/1700000000016-add-plugin-platform.js';
import { AddPluginBrokerReplay1700000000017 } from './dist/db/migrations/1700000000017-add-plugin-broker-replay.js';
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
import { DatabasePluginGatewayAdmissionV1 } from '../backend-host/dist/plugins/pluginGatewayAdmissionStore.js';
import { DatabasePluginStorageStoreV1 } from '../backend-host/dist/plugins/pluginStorageStore.js';

const expectedTables = [
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

const source = new DataSource({
  type: 'mysql',
  host: '127.0.0.1',
  port: Number(process.env.MYSQL_PORT),
  username: 'root',
  password: 'mysql',
  database: 'main',
  charset: 'utf8mb4',
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
  const applied = await source.runMigrations({ transaction: 'each' });
  if (applied.length !== 9) {
    throw new Error(`Expected nine plugin migrations, received ${applied.length}`);
  }

  const tableRows = await source.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_name LIKE 'plugin_%' ORDER BY table_name",
  );
  const tables = tableRows.map((row) => row.TABLE_NAME ?? row.table_name);
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) {
    throw new Error(`Unexpected MySQL plugin tables: ${JSON.stringify(tables)}`);
  }

  const indexedTextColumns = await source.query(`
    SELECT DISTINCT
      c.table_name,
      c.column_name,
      c.data_type,
      c.character_set_name,
      c.collation_name
    FROM information_schema.statistics s
    JOIN information_schema.columns c
      ON c.table_schema = s.table_schema
     AND c.table_name = s.table_name
     AND c.column_name = s.column_name
    WHERE s.table_schema = 'main'
      AND s.table_name LIKE 'plugin_%'
      AND c.data_type IN ('char', 'varchar', 'tinytext', 'text', 'mediumtext', 'longtext')
    ORDER BY c.table_name, c.column_name
  `);
  if (indexedTextColumns.length === 0) {
    throw new Error('MySQL index-column inspection returned no plugin keys');
  }
  for (const column of indexedTextColumns) {
    if (
      column.DATA_TYPE !== 'varchar' ||
      column.CHARACTER_SET_NAME !== 'ascii' ||
      column.COLLATION_NAME !== 'ascii_bin'
    ) {
      throw new Error(
        `Unsafe MySQL plugin key ${column.TABLE_NAME}.${column.COLUMN_NAME}: ` +
          `${column.DATA_TYPE}/${column.CHARACTER_SET_NAME}/${column.COLLATION_NAME}`,
      );
    }
  }

  const [payloadColumn] = await source.query(`
    SELECT data_type, character_set_name
    FROM information_schema.columns
    WHERE table_schema = 'main'
      AND table_name = 'plugin_storage_entries'
      AND column_name = 'value_json'
  `);
  if (
    payloadColumn?.DATA_TYPE !== 'text' ||
    payloadColumn?.CHARACTER_SET_NAME !== 'utf8mb4'
  ) {
    throw new Error('MySQL plugin payload column lost UTF-8 unbounded-text storage');
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
  const installerSource = {
    snapshot: { revision: 1, records: [sourceRecord] },
    async controlSnapshot() {
      return structuredClone(this.snapshot);
    },
  };
  const control = new PluginControlPlaneV1(
    installerSource,
    new DatabasePluginControlStoreV1(async () => source),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-27T01:00:00.000Z'),
    },
  );
  const initial = await control.list();
  if (
    initial.plugins.length !== 1 ||
    !initial.plugins[0]?.enabled ||
    initial.plugins[0]?.revision !== 0
  ) {
    throw new Error('MySQL control reconciliation did not seed enabled state');
  }
  const tenant = await control.getTenantEnablement(
    sourceRecord.pluginId,
    'default-tenant-id',
  );
  if (!tenant.enabled || tenant.revision !== 0) {
    throw new Error('MySQL control reconciliation did not seed tenant state');
  }

  const stopped = await control.setEmergencyDisabled({
    disabled: true,
    expectedRevision: 0,
    idempotencyKey: 'mysql-emergency-request-0001',
    actorRef: 'admin-1',
    correlationId: 'mysql-emergency-1',
  });
  const restartedControl = new PluginControlPlaneV1(
    installerSource,
    new DatabasePluginControlStoreV1(async () => source),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-27T01:01:00.000Z'),
    },
  );
  if (
    !stopped.disabled ||
    stopped.revision !== 1 ||
    !(await restartedControl.getEmergencyState()).disabled ||
    (await restartedControl.isExecutionAllowed(
      sourceRecord.pluginId,
      'default-tenant-id',
    ))
  ) {
    throw new Error('MySQL emergency stop did not survive a fresh control instance');
  }
  const resumed = await restartedControl.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 1,
    idempotencyKey: 'mysql-emergency-request-0002',
    actorRef: 'admin-1',
    correlationId: 'mysql-emergency-2',
  });
  if (
    resumed.disabled ||
    resumed.revision !== 2 ||
    !(await control.isExecutionAllowed(
      sourceRecord.pluginId,
      'default-tenant-id',
    ))
  ) {
    throw new Error('MySQL emergency resume did not restore desired state');
  }

  const storage = new DatabasePluginStorageStoreV1(async () => source);
  const storageBase = {
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    callId: 'mysql-storage-call-1',
    operationId: 'io.enterpriseglue.reference.store',
    scope: 'tenant',
    pluginId: sourceRecord.pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
  };
  const firstKey = await storage.execute({
    ...storageBase,
    action: 'put',
    key: 'case/Key',
    value: { cursor: 1, note: '問題なし' },
  });
  const secondKey = await storage.execute({
    ...storageBase,
    callId: 'mysql-storage-call-2',
    action: 'put',
    key: 'case/key',
    value: { cursor: 2 },
  });
  if (firstKey.revision !== 'r1' || secondKey.revision !== 'r1') {
    throw new Error('MySQL case-sensitive storage keys were not independently created');
  }
  const firstRead = await storage.execute({
    ...storageBase,
    callId: 'mysql-storage-call-3',
    action: 'get',
    key: 'case/Key',
  });
  const secondRead = await storage.execute({
    ...storageBase,
    callId: 'mysql-storage-call-4',
    action: 'get',
    key: 'case/key',
  });
  if (
    !firstRead.found ||
    firstRead.value.note !== '問題なし' ||
    !secondRead.found ||
    secondRead.value.cursor !== 2
  ) {
    throw new Error('MySQL storage lost UTF-8 payload or key case separation');
  }

  const admissionPolicy = {
    windowMs: 60_000,
    maxRequestsPerSubjectOperation: 10,
    maxRequestsPerPlugin: 10,
    maxConcurrentPerOperation: 1,
    maxTrackedBuckets: 10,
  };
  const admissionInput = {
    pluginId: sourceRecord.pluginId,
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
  const lease = await firstAdmission.acquire(admissionInput);
  let concurrentRejected = false;
  try {
    await secondAdmission.acquire(admissionInput);
  } catch (error) {
    concurrentRejected = error?.code === 'concurrency_limited';
  }
  if (!concurrentRejected) {
    throw new Error('MySQL gateway concurrency was not deployment-wide');
  }
  await lease.release();
  const recoveredLease = await secondAdmission.acquire(admissionInput);
  await recoveredLease.release();

  const maximumPluginId = `a.${'b'.repeat(198)}`;
  await source.query(
    `INSERT INTO main.plugin_storage_entries
      (id, plugin_id, deployment_ref, scope, tenant_ref_key, storage_key,
       value_json, value_bytes, revision, created_at, updated_at)
     VALUES (?, ?, ?, 'tenant', ?, ?, ?, ?, 1, 1, 1)`,
    [
      'm'.repeat(128),
      maximumPluginId,
      'd'.repeat(256),
      't'.repeat(256),
      'k'.repeat(256),
      JSON.stringify({ note: '最大長' }),
      Buffer.byteLength(JSON.stringify({ note: '最大長' }), 'utf8'),
    ],
  );
  const [maximumRow] = await source.query(
    'SELECT CHAR_LENGTH(plugin_id) plugin_length, CHAR_LENGTH(storage_key) key_length, value_json FROM main.plugin_storage_entries WHERE id = ?',
    ['m'.repeat(128)],
  );
  if (
    Number(maximumRow?.plugin_length) !== 200 ||
    Number(maximumRow?.key_length) !== 256 ||
    JSON.parse(maximumRow?.value_json ?? '{}').note !== '最大長'
  ) {
    throw new Error('MySQL bounded contract-maximum key fixture did not round-trip');
  }

  const audit = await control.listAudit();
  if (
    audit.events.length < 2 ||
    audit.events.some(
      (event) =>
        'tenantRef' in event ||
        'requestBody' in event ||
        'manifest' in event,
    )
  ) {
    throw new Error('MySQL safe audit history was absent or exposed payload fields');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'mysql',
      migrations: applied.length,
      pluginTables: tables.length,
      boundedIndexedTextColumns: indexedTextColumns.length,
      utf8PayloadRoundTrip: true,
      caseSensitiveStorageKeys: true,
      contractMaximumKeyRoundTrip: true,
      emergencyRestart: true,
      gatewayConcurrency: true,
    }),
  );
} finally {
  await source.destroy();
}
NODE

MYSQL_PORT="$MYSQL_PORT" \
  node "$ROOT_DIR/scripts/check-plugin-platform-mysql-lifecycle.mjs"

RESTORED_MYSQL_DATABASE="plugin_restore_${$}"
docker exec -e MYSQL_PWD=mysql "$CONTAINER_NAME" \
  mysqldump \
  --protocol=TCP \
  -h127.0.0.1 \
  -uroot \
  --single-transaction \
  --skip-lock-tables \
  --no-tablespaces \
  --set-gtid-purged=OFF \
  main >"$BACKUP_FILE"

docker exec -e MYSQL_PWD=mysql "$CONTAINER_NAME" \
  mysql \
  --protocol=TCP \
  -h127.0.0.1 \
  -uroot \
  --execute="CREATE DATABASE \`${RESTORED_MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"

docker exec -i -e MYSQL_PWD=mysql "$CONTAINER_NAME" \
  mysql \
  --protocol=TCP \
  -h127.0.0.1 \
  -uroot \
  "$RESTORED_MYSQL_DATABASE" <"$BACKUP_FILE"

MYSQL_PORT="$MYSQL_PORT" \
  RESTORED_MYSQL_DATABASE="$RESTORED_MYSQL_DATABASE" \
  node "$ROOT_DIR/scripts/check-plugin-platform-mysql-restore.mjs"

LOAD_MYSQL_DATABASE="plugin_load_${$}"
docker exec -e MYSQL_PWD=mysql "$CONTAINER_NAME" \
  mysql \
  --protocol=TCP \
  -h127.0.0.1 \
  -uroot \
  --execute="CREATE DATABASE \`${LOAD_MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"

MYSQL_PORT="$MYSQL_PORT" \
  MYSQL_DATABASE="$LOAD_MYSQL_DATABASE" \
  node "$ROOT_DIR/scripts/check-plugin-platform-mysql-load.mjs"

MULTI_REPLICA_MYSQL_DATABASE="plugin_acceptance_${$}"
docker exec -e MYSQL_PWD=mysql "$CONTAINER_NAME" \
  mysql \
  --protocol=TCP \
  -h127.0.0.1 \
  -uroot \
  --execute="CREATE DATABASE \`${MULTI_REPLICA_MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"

cd "$ROOT_DIR"
ENTERPRISEGLUE_PLUGIN_ACCEPTANCE_DATABASE_URL="mysql://root:mysql@127.0.0.1:${MYSQL_PORT}/${MULTI_REPLICA_MYSQL_DATABASE}" \
  pnpm --filter @enterpriseglue/backend-host exec vitest run \
  test/pluginPlatformMultiReplica.acceptance.test.ts
