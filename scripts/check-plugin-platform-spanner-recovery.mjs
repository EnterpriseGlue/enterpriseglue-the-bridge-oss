import { createRequire } from 'node:module';

const sharedRoot = new URL('../packages/shared/', import.meta.url);
const backendRoot = new URL('../packages/backend-host/', import.meta.url);
const sharedRequire = createRequire(new URL('package.json', sharedRoot));
globalThis.require = sharedRequire;
const { DataSource } = sharedRequire('typeorm');
const { Spanner } = sharedRequire('@google-cloud/spanner');
const { SpannerAdapter } = await import(
  new URL(
    'dist/infrastructure/persistence/adapters/SpannerAdapter.js',
    sharedRoot,
  )
);
const { ensureSpannerTypeOrmMigrationLedgerV1 } = await import(
  new URL('dist/db/spanner-migration-ledger.js', sharedRoot)
);

new SpannerAdapter();

const migrations = await loadMigrations();
const { pluginPlatformEntities } = await import(
  new URL(
    'dist/infrastructure/persistence/entities/PluginPlatform.js',
    sharedRoot,
  )
);
const { PluginControlPlaneV1 } = await import(
  new URL('dist/plugins/pluginControlPlane.js', backendRoot)
);
const { DatabasePluginControlStoreV1 } = await import(
  new URL('dist/plugins/pluginControlStore.js', backendRoot)
);
const { DatabasePluginStorageStoreV1 } = await import(
  new URL('dist/plugins/pluginStorageStore.js', backendRoot)
);

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
const projectId = resourceIdentifier(
  'SPANNER_PROJECT_ID',
  requiredEnvironment('SPANNER_PROJECT_ID'),
);
const instanceId = resourceIdentifier(
  'SPANNER_INSTANCE_ID',
  requiredEnvironment('SPANNER_INSTANCE_ID'),
);
const sourceDatabaseId = resourceIdentifier(
  'SPANNER_SOURCE_DATABASE_ID',
  requiredEnvironment('SPANNER_SOURCE_DATABASE_ID'),
);
const restoredDatabaseId = resourceIdentifier(
  'SPANNER_DATABASE_ID',
  requiredEnvironment('SPANNER_DATABASE_ID'),
);
if (sourceDatabaseId === restoredDatabaseId) {
  throw new Error('Spanner source and recovery databases must be distinct');
}

const restored = createDataSource(restoredDatabaseId);
await restored.initialize();
try {
  await ensureSpannerTypeOrmMigrationLedgerV1(restored);
  const applied = await restored.runMigrations({
    transaction: 'none',
  });
  if (applied.length !== migrations.length) {
    throw new Error(
      `Expected ${migrations.length} recovery migrations, received ${applied.length}`,
    );
  }

  const spanner = new Spanner({ projectId });
  const instance = spanner.instance(instanceId);
  const sourceDatabase = instance.database(sourceDatabaseId);
  const targetDatabase = instance.database(restoredDatabaseId);
  let copiedRows = 0;
  let snapshot;
  try {
    [snapshot] = await sourceDatabase.getSnapshot({ strong: true });
    for (const tableName of expectedTables) {
      const [rows] = await snapshot.run({
        sql: `SELECT * FROM ${tableName}`,
      });
      copiedRows += rows.length;
      for (let offset = 0; offset < rows.length; offset += 100) {
        await targetDatabase
          .table(tableName)
          .insert(
            rows
              .slice(offset, offset + 100)
              .map((row) => row.toJSON()),
          );
      }
    }
  } finally {
    snapshot?.end();
    await sourceDatabase.close();
    await targetDatabase.close();
    await spanner.close();
  }

  const tables = await pluginTableNames(restored);
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) {
    throw new Error(
      `Unexpected recovered Spanner plugin tables: ${JSON.stringify(tables)}`,
    );
  }

  const sourceRecord = referenceSourceRecord();
  const control = createControl(
    restored,
    sourceRecord,
    '2026-07-27T10:00:00.000Z',
  );
  const [emergency, plugin, tenant, audit] = await Promise.all([
    control.getEmergencyState(),
    control.get(sourceRecord.pluginId),
    control.getTenantEnablement(
      sourceRecord.pluginId,
      'default-tenant-id',
    ),
    control.listAudit(),
  ]);
  if (emergency.disabled || emergency.revision !== 2) {
    throw new Error(
      'Recovered Spanner emergency revision/state was not exact',
    );
  }
  if (!plugin?.enabled || plugin.revision !== 0) {
    throw new Error(
      'Recovered Spanner plugin desired state/revision was not exact',
    );
  }
  if (!tenant.enabled || tenant.revision !== 0) {
    throw new Error(
      'Recovered Spanner tenant desired state/revision was not exact',
    );
  }
  if (
    audit.events.length < 2 ||
    audit.events.some(
      (event) =>
        'tenantRef' in event ||
        'requestBody' in event ||
        'manifest' in event,
    )
  ) {
    throw new Error(
      'Recovered Spanner audit history was absent or unsafe',
    );
  }

  const storage = new DatabasePluginStorageStoreV1(
    async () => restored,
  );
  const storageBase = {
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    operationId: 'io.enterpriseglue.reference.store',
    action: 'get',
    scope: 'tenant',
    pluginId: sourceRecord.pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
  };
  const [upperCaseStorage, lowerCaseStorage] = await Promise.all([
    storage.execute({
      ...storageBase,
      callId: 'spanner-recovery-storage-read-1',
      key: 'case/Key',
    }),
    storage.execute({
      ...storageBase,
      callId: 'spanner-recovery-storage-read-2',
      key: 'case/key',
    }),
  ]);
  if (
    !upperCaseStorage.found ||
    upperCaseStorage.revision !== 'r1' ||
    upperCaseStorage.value.note !== '問題なし' ||
    !lowerCaseStorage.found ||
    lowerCaseStorage.revision !== 'r1' ||
    lowerCaseStorage.value.cursor !== 2
  ) {
    throw new Error(
      'Recovered Spanner storage lost Unicode, revision, or key-case separation',
    );
  }

  const [eventState] = await restored.query(`
    SELECT
      COUNTIF(status = 'delivered') AS delivered_events,
      COUNTIF(status = 'delivered' AND event_json != '{}')
        AS unsafe_delivered_payloads,
      COUNTIF(lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL)
        AS active_event_leases
    FROM plugin_event_deliveries
  `);
  const [gatewayState] = await restored.query(`
    SELECT COUNT(*) AS active_gateway_leases
    FROM plugin_gateway_concurrency_leases
  `);
  const [scheduleState] = await restored.query(`
    SELECT
      COUNTIF(lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL)
        AS active_schedule_leases
    FROM plugin_scheduled_jobs
  `);
  if (
    Number(eventState?.delivered_events) < 1 ||
    Number(eventState?.unsafe_delivered_payloads) !== 0 ||
    Number(eventState?.active_event_leases) !== 0 ||
    Number(gatewayState?.active_gateway_leases) !== 0 ||
    Number(scheduleState?.active_schedule_leases) !== 0
  ) {
    throw new Error(
      'Recovered Spanner state lost payload-erasure or lease invariants',
    );
  }

  const disabled = await control.setEmergencyDisabled({
    disabled: true,
    expectedRevision: 2,
    idempotencyKey: 'spanner-recovery-emergency-disable-0001',
    actorRef: 'recovery-admin',
    correlationId: 'spanner-recovery-emergency-1',
  });
  const restarted = createControl(
    restored,
    sourceRecord,
    '2026-07-27T10:01:00.000Z',
  );
  const afterRestart = await restarted.getEmergencyState();
  const resumed = await restarted.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 3,
    idempotencyKey: 'spanner-recovery-emergency-resume-0001',
    actorRef: 'recovery-admin',
    correlationId: 'spanner-recovery-emergency-2',
  });
  if (
    !disabled.disabled ||
    disabled.revision !== 3 ||
    !afterRestart.disabled ||
    afterRestart.revision !== 3 ||
    resumed.disabled ||
    resumed.revision !== 4
  ) {
    throw new Error(
      'Recovered Spanner emergency control did not survive restart/resume',
    );
  }

  const deploymentDisabled = await restarted.setDeploymentEnabled({
    pluginId: sourceRecord.pluginId,
    enabled: false,
    expectedRevision: 0,
    idempotencyKey: 'spanner-recovery-plugin-disable-0001',
    actorRef: 'recovery-admin',
    correlationId: 'spanner-recovery-plugin-disable-1',
  });
  const deploymentEnabled = await restarted.setDeploymentEnabled({
    pluginId: sourceRecord.pluginId,
    enabled: true,
    expectedRevision: 1,
    idempotencyKey: 'spanner-recovery-plugin-enable-0001',
    actorRef: 'recovery-admin',
    correlationId: 'spanner-recovery-plugin-enable-1',
  });
  if (
    deploymentDisabled.status !== 'succeeded' ||
    deploymentEnabled.status !== 'succeeded' ||
    !(await restarted.isExecutionAllowed(
      sourceRecord.pluginId,
      'default-tenant-id',
    ))
  ) {
    throw new Error(
      'Recovered Spanner deployment control could not mutate safely',
    );
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'spanner',
      emulatorSnapshotCopyRecoveryValidation: true,
      nativeBackupRestore: false,
      copiedPluginRows: copiedRows,
      restoredPluginTables: tables.length,
      restoredEmergencyRevision: 2,
      restoredDesiredState: true,
      restoredTenantState: true,
      restoredCaseSensitiveUnicodeStorage: true,
      restoredDeliveredPayloadsErased: true,
      restoredActiveGatewayLeases: 0,
      restoredActiveEventLeases: 0,
      restoredActiveScheduleLeases: 0,
      postRecoveryEmergencyRestart: true,
      postRecoverySafeMutation: true,
    }),
  );
} finally {
  await restored.destroy();
}

function createDataSource(databaseId) {
  return new DataSource({
    type: 'spanner',
    projectId,
    instanceId,
    databaseId,
    entities: pluginPlatformEntities,
    migrations,
    synchronize: false,
    logging: false,
  });
}

async function pluginTableNames(dataSource) {
  const rows = await dataSource.query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = ''
      AND STARTS_WITH(TABLE_NAME, 'plugin_')
    ORDER BY TABLE_NAME
  `);
  return rows.map((row) => String(row.TABLE_NAME));
}

function createControl(dataSource, sourceRecord, timestamp) {
  const controlSource = {
    async controlSnapshot() {
      return {
        revision: 1,
        records: [sourceRecord],
      };
    },
  };
  return new PluginControlPlaneV1(
    controlSource,
    new DatabasePluginControlStoreV1(async () => dataSource),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date(timestamp),
    },
  );
}

function referenceSourceRecord() {
  return {
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
}

async function loadMigrations() {
  const modules = await Promise.all(
    [
      '1700000000016-add-plugin-platform',
      '1700000000017-add-plugin-broker-replay',
      '1700000000018-add-plugin-storage',
      '1700000000019-add-plugin-events',
      '1700000000020-add-plugin-notifications-and-schedules',
      '1700000000021-add-plugin-emergency-control',
      '1700000000022-add-plugin-gateway-admission',
      '1700000000023-add-plugin-event-circuit',
      '1700000000024-add-plugin-contribution-availability',
    ].map((name) =>
      import(new URL(`dist/db/migrations/${name}.js`, sharedRoot)),
    ),
  );
  return modules.map((module) => Object.values(module)[0]);
}

function resourceIdentifier(name, value) {
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(value)) {
    throw new Error(`${name} is not a safe Spanner resource identifier`);
  }
  return value;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
