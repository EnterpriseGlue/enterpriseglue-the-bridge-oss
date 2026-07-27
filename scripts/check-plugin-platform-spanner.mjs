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

// Apply the same metadata normalization used by the OSS Spanner runtime.
new SpannerAdapter();

const migrationModules = await Promise.all([
  import(
    new URL(
      'dist/db/migrations/1700000000016-add-plugin-platform.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000017-add-plugin-broker-replay.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000018-add-plugin-storage.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000019-add-plugin-events.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000020-add-plugin-notifications-and-schedules.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000021-add-plugin-emergency-control.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000022-add-plugin-gateway-admission.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000023-add-plugin-event-circuit.js',
      sharedRoot,
    )
  ),
  import(
    new URL(
      'dist/db/migrations/1700000000024-add-plugin-contribution-availability.js',
      sharedRoot,
    )
  ),
]);
const migrations = [
  migrationModules[0].AddPluginPlatform1700000000016,
  migrationModules[1].AddPluginBrokerReplay1700000000017,
  migrationModules[2].AddPluginStorage1700000000018,
  migrationModules[3].AddPluginEvents1700000000019,
  migrationModules[4].AddPluginNotificationsAndSchedules1700000000020,
  migrationModules[5].AddPluginEmergencyControl1700000000021,
  migrationModules[6].AddPluginGatewayAdmission1700000000022,
  migrationModules[7].AddPluginEventCircuit1700000000023,
  migrationModules[8].AddPluginContributionAvailability1700000000024,
];
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
const { DatabasePluginEventDeliveryStoreV1 } = await import(
  new URL('dist/plugins/pluginEventDeliveryStore.js', backendRoot)
);
const { PluginEventMetricsRegistryV1 } = await import(
  new URL('dist/plugins/pluginEventMetrics.js', backendRoot)
);
const { DatabasePluginGatewayAdmissionV1 } = await import(
  new URL('dist/plugins/pluginGatewayAdmissionStore.js', backendRoot)
);
const { DatabasePluginScheduleStoreV1 } = await import(
  new URL('dist/plugins/pluginScheduleStore.js', backendRoot)
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
const projectId = requiredEnvironment('SPANNER_PROJECT_ID');
const instanceId = requiredEnvironment('SPANNER_INSTANCE_ID');
const databaseId = requiredEnvironment('SPANNER_DATABASE_ID');
const additionalDatabaseIds = [
  'SPANNER_RECOVERY_DATABASE_ID',
  'SPANNER_LOAD_DATABASE_ID',
  'SPANNER_ACCEPTANCE_DATABASE_ID',
]
  .map((name) => [name, process.env[name]?.trim()])
  .filter((entry) => entry[1]);
for (const [name, value] of [
  ...Object.entries({
  SPANNER_PROJECT_ID: projectId,
  SPANNER_INSTANCE_ID: instanceId,
  SPANNER_DATABASE_ID: databaseId,
  }),
  ...additionalDatabaseIds,
]) {
  if (!/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(value)) {
    throw new Error(`${name} is not a safe Spanner resource identifier`);
  }
}
const allDatabaseIds = [
  databaseId,
  ...additionalDatabaseIds.map(([, value]) => value),
];
if (new Set(allDatabaseIds).size !== allDatabaseIds.length) {
  throw new Error('Spanner fixture database identifiers must be distinct');
}

if (environmentBoolean('SPANNER_CREATE_DATABASE')) {
  const admin = new Spanner({ projectId });
  try {
    const [instance, instanceOperation] = await admin.createInstance(
      instanceId,
      {
        config: 'emulator-config',
        nodes: 1,
      },
    );
    await instanceOperation.promise();
    for (const fixtureDatabaseId of allDatabaseIds) {
      const [, databaseOperation] =
        await instance.createDatabase(fixtureDatabaseId);
      await databaseOperation.promise();
    }
  } finally {
    await admin.close();
  }
}

const source = new DataSource({
  type: 'spanner',
  projectId,
  instanceId,
  databaseId,
  entities: pluginPlatformEntities,
  migrations,
  synchronize: false,
  logging: false,
});

await source.initialize();
try {
  const preexisting = await pluginTableNames(source);
  if (preexisting.length !== 0) {
    throw new Error(
      `Spanner plugin gate requires a clean database; found ${preexisting.join(',')}`,
    );
  }
  await ensureSpannerTypeOrmMigrationLedgerV1(source);
  const applied = await source.runMigrations({ transaction: 'none' });
  const repeatedMigrations = await source.runMigrations({
    transaction: 'none',
  });
  if (
    applied.length !== migrations.length ||
    repeatedMigrations.length !== 0
  ) {
    throw new Error(
      `Expected ${migrations.length} one-time Spanner plugin migrations, received ${applied.length}/${repeatedMigrations.length}`,
    );
  }
  const tables = await pluginTableNames(source);
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) {
    throw new Error(
      `Unexpected Spanner plugin tables: ${JSON.stringify(tables)}`,
    );
  }

  const indexedTextColumns = await source.query(`
    SELECT DISTINCT
      column_object.TABLE_NAME,
      column_object.COLUMN_NAME,
      column_object.SPANNER_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS column_object
    JOIN INFORMATION_SCHEMA.INDEX_COLUMNS index_column
      ON index_column.TABLE_NAME = column_object.TABLE_NAME
     AND index_column.COLUMN_NAME = column_object.COLUMN_NAME
    WHERE STARTS_WITH(column_object.TABLE_NAME, 'plugin_')
      AND STARTS_WITH(column_object.SPANNER_TYPE, 'STRING')
    ORDER BY column_object.TABLE_NAME, column_object.COLUMN_NAME
  `);
  if (
    indexedTextColumns.length === 0 ||
    indexedTextColumns.some((column) =>
      String(column.SPANNER_TYPE).includes('(MAX)'),
    )
  ) {
    throw new Error(
      'Spanner plugin indexes contain an unbounded STRING column',
    );
  }
  const contentColumns = await source.query(`
    SELECT TABLE_NAME, COLUMN_NAME, SPANNER_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE STARTS_WITH(TABLE_NAME, 'plugin_')
      AND COLUMN_NAME IN (
        'event_json',
        'projection_json',
        'response_json',
        'value_json'
      )
    ORDER BY TABLE_NAME, COLUMN_NAME
  `);
  if (
    contentColumns.length !== 4 ||
    contentColumns.some(
      (column) => column.SPANNER_TYPE !== 'STRING(MAX)',
    )
  ) {
    throw new Error(
      'Spanner plugin content columns are not STRING(MAX)',
    );
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
      now: () => new Date('2026-07-27T03:00:00.000Z'),
    },
  );
  const initial = await control.list();
  const tenant = await control.getTenantEnablement(
    sourceRecord.pluginId,
    'default-tenant-id',
  );
  if (
    initial.plugins.length !== 1 ||
    !initial.plugins[0]?.enabled ||
    initial.plugins[0]?.revision !== 0 ||
    !tenant.enabled ||
    tenant.revision !== 0
  ) {
    throw new Error('Spanner control reconciliation did not seed state');
  }
  const stopped = await control.setEmergencyDisabled({
    disabled: true,
    expectedRevision: 0,
    idempotencyKey: 'spanner-emergency-request-0001',
    actorRef: 'admin-1',
    correlationId: 'spanner-emergency-1',
  });
  const restartedControl = new PluginControlPlaneV1(
    installerSource,
    new DatabasePluginControlStoreV1(async () => source),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-27T03:01:00.000Z'),
    },
  );
  const seenAfterRestart = await restartedControl.getEmergencyState();
  const resumed = await restartedControl.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 1,
    idempotencyKey: 'spanner-emergency-request-0002',
    actorRef: 'admin-1',
    correlationId: 'spanner-emergency-2',
  });
  if (
    !stopped.disabled ||
    stopped.revision !== 1 ||
    !seenAfterRestart.disabled ||
    resumed.disabled ||
    resumed.revision !== 2
  ) {
    throw new Error('Spanner emergency control was not durable');
  }

  const storage = new DatabasePluginStorageStoreV1(async () => source);
  const storageBase = {
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    operationId: 'io.enterpriseglue.reference.store',
    scope: 'tenant',
    pluginId: sourceRecord.pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
  };
  await storage.execute({
    ...storageBase,
    callId: 'spanner-storage-call-1',
    action: 'put',
    key: 'case/Key',
    value: { cursor: 1, note: '問題なし' },
  });
  await storage.execute({
    ...storageBase,
    callId: 'spanner-storage-call-2',
    action: 'put',
    key: 'case/key',
    value: { cursor: 2 },
  });
  const firstRead = await storage.execute({
    ...storageBase,
    callId: 'spanner-storage-call-3',
    action: 'get',
    key: 'case/Key',
  });
  const secondRead = await storage.execute({
    ...storageBase,
    callId: 'spanner-storage-call-4',
    action: 'get',
    key: 'case/key',
  });
  if (
    !firstRead.found ||
    firstRead.value.note !== '問題なし' ||
    !secondRead.found ||
    secondRead.value.cursor !== 2
  ) {
    throw new Error(
      'Spanner case-sensitive storage or Unicode round-trip failed',
    );
  }
  const maximumPluginId = `a.${'b'.repeat(198)}`;
  await storage.execute({
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    callId: 'spanner-storage-maximum-put',
    operationId: 'io.enterpriseglue.reference.store',
    scope: 'tenant',
    pluginId: maximumPluginId,
    deploymentRef: 'd'.repeat(256),
    tenantRef: 't'.repeat(256),
    action: 'put',
    key: 'k'.repeat(256),
    value: { note: '最大長' },
  });
  const maximumRead = await storage.execute({
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    callId: 'spanner-storage-maximum-read',
    operationId: 'io.enterpriseglue.reference.store',
    scope: 'tenant',
    pluginId: maximumPluginId,
    deploymentRef: 'd'.repeat(256),
    tenantRef: 't'.repeat(256),
    action: 'get',
    key: 'k'.repeat(256),
  });
  if (!maximumRead.found || maximumRead.value.note !== '最大長') {
    throw new Error(
      'Spanner contract-maximum key fixture did not round-trip',
    );
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
    throw new Error('Spanner gateway concurrency was not deployment-wide');
  }
  await lease.release();
  const recoveredLease = await secondAdmission.acquire(admissionInput);
  await recoveredLease.release();

  const firstScheduleStore = new DatabasePluginScheduleStoreV1(
    async () => source,
    () => 1_000,
  );
  const secondScheduleStore = new DatabasePluginScheduleStoreV1(
    async () => source,
    () => 1_000,
  );
  for (const suffix of ['a', 'b']) {
    await firstScheduleStore.execute({
      pluginId: sourceRecord.pluginId,
      deploymentRef: 'deployment-1',
      tenantRef: 'tenant-1',
      subjectRef: 'user-1',
      deliveryOperationId:
        'io.enterpriseglue.reference.deliver-refresh',
      allowedIntervalsSeconds: [3_600],
      maxAttempts: 3,
      request: {
        apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
        callId: `spanner-schedule-call-${suffix}`,
        operationId:
          'io.enterpriseglue.reference.configure-refresh',
        action: 'upsert',
        jobType: `io.enterpriseglue.reference.refresh-index-${suffix}`,
        intervalSeconds: 3_600,
        idempotencyKey: `spanner-schedule-idempotency-${suffix}`,
      },
    });
  }
  const scheduleClaims = (
    await Promise.all([
      firstScheduleStore.claimDue({
        workerRef: 'spanner-schedule-worker-1',
        limit: 1,
        leaseSeconds: 30,
        now: 3_601_000,
      }),
      secondScheduleStore.claimDue({
        workerRef: 'spanner-schedule-worker-2',
        limit: 1,
        leaseSeconds: 30,
        now: 3_601_000,
      }),
    ])
  ).flat();
  if (
    scheduleClaims.length !== 2 ||
    new Set(scheduleClaims.map((job) => job.jobRef)).size !== 2
  ) {
    throw new Error('Spanner concurrent schedule claims overlapped');
  }
  const scheduleRetry = await firstScheduleStore.complete({
    jobRef: scheduleClaims[0].jobRef,
    leaseOwner: scheduleClaims[0].leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: scheduleClaims[0].request.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 3_601_100,
  });
  const secondScheduleAccepted = await secondScheduleStore.complete({
    jobRef: scheduleClaims[1].jobRef,
    leaseOwner: scheduleClaims[1].leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: scheduleClaims[1].request.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: 3_601_100,
  });
  const [retriedSchedule] = await secondScheduleStore.claimDue({
    workerRef: 'spanner-schedule-worker-3',
    limit: 1,
    leaseSeconds: 30,
    now: scheduleRetry.nextRunAt,
  });
  if (!retriedSchedule || retriedSchedule.attempt !== 2) {
    throw new Error('Spanner schedule retry was not reclaimed');
  }
  const retriedScheduleAccepted = await secondScheduleStore.complete({
    jobRef: retriedSchedule.jobRef,
    leaseOwner: retriedSchedule.leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: retriedSchedule.request.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: scheduleRetry.nextRunAt + 1,
  });
  await Promise.all([
    firstScheduleStore.setPaused({
      jobRef: secondScheduleAccepted.jobRef,
      paused: true,
      expectedRevision: secondScheduleAccepted.revision,
      reasonCode: 'acceptance_fixture_complete',
      now: scheduleRetry.nextRunAt + 2,
    }),
    secondScheduleStore.setPaused({
      jobRef: retriedScheduleAccepted.jobRef,
      paused: true,
      expectedRevision: retriedScheduleAccepted.revision,
      reasonCode: 'acceptance_fixture_complete',
      now: scheduleRetry.nextRunAt + 2,
    }),
  ]);

  const firstEventStore = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
  );
  const secondEventStore = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
  );
  for (const suffix of ['a', 'b']) {
    await firstEventStore.enqueue({
      pluginId: sourceRecord.pluginId,
      deploymentRef: 'deployment-1',
      tenantRef: 'tenant-1',
      subscriptionType: 'io.enterpriseglue.host.incident.v1',
      operationId: 'io.enterpriseglue.reference.consume-incident',
      maxAttempts: 3,
      now: 5_000,
      event: {
        specversion: '1.0',
        id: `spanner-incident-${suffix}`,
        source: 'enterpriseglue-oss',
        type: 'io.enterpriseglue.host.incident.v1',
        subject: `spanner-incident-${suffix}`,
        time: '2026-07-27T03:00:00.000Z',
        dataschema:
          'https://schemas.enterpriseglue.io/events/incident-v1.json',
        tenantRef: 'tenant-1',
        data: {
          engineRef: 'engine-1',
          incidentRef: `spanner-incident-${suffix}`,
          incidentType: 'failedJob',
        },
      },
    });
  }
  const eventClaims = (
    await Promise.all([
      firstEventStore.claimDue({
        workerRef: 'spanner-event-worker-1',
        limit: 1,
        leaseSeconds: 30,
        now: 5_000,
      }),
      secondEventStore.claimDue({
        workerRef: 'spanner-event-worker-2',
        limit: 1,
        leaseSeconds: 30,
        now: 5_000,
      }),
    ])
  ).flat();
  if (
    eventClaims.length !== 2 ||
    new Set(eventClaims.map((event) => event.deliveryId)).size !== 2
  ) {
    throw new Error('Spanner concurrent event claims overlapped');
  }
  const eventRetry = await firstEventStore.complete({
    deliveryId: eventClaims[0].deliveryId,
    leaseOwner: eventClaims[0].leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: eventClaims[0].deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 5_100,
  });
  await secondEventStore.complete({
    deliveryId: eventClaims[1].deliveryId,
    leaseOwner: eventClaims[1].leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: eventClaims[1].deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: 5_100,
  });
  const [retriedEvent] = await secondEventStore.claimDue({
    workerRef: 'spanner-event-worker-3',
    limit: 1,
    leaseSeconds: 30,
    now: eventRetry.nextAttemptAt,
  });
  if (!retriedEvent || retriedEvent.attempt !== 2) {
    throw new Error('Spanner event retry was not reclaimed');
  }
  const eventAccepted = await secondEventStore.complete({
    deliveryId: retriedEvent.deliveryId,
    leaseOwner: retriedEvent.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: retriedEvent.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: eventRetry.nextAttemptAt + 1,
  });
  if (eventAccepted.status !== 'delivered') {
    throw new Error('Spanner event retry did not recover');
  }

  await verifySpannerScheduleLifecycle(source);
  await verifySpannerEventLifecycle(
    source,
    PluginEventMetricsRegistryV1,
  );

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
    throw new Error(
      'Spanner safe audit history was absent or exposed content',
    );
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'spanner',
      migrations: applied.length,
      migrationReplaySafe: true,
      pluginTables: tables.length,
      boundedIndexedTextColumns: indexedTextColumns.length,
      unboundedContentColumns: contentColumns.length,
      utf8PayloadRoundTrip: true,
      caseSensitiveStorageKeys: true,
      contractMaximumKeyRoundTrip: true,
      emergencyRestart: true,
      gatewayConcurrency: true,
      concurrentEventClaims: true,
      concurrentScheduleClaims: true,
      eventRetryDelivery: true,
      scheduleRetryDelivery: true,
      scheduleLeaseExpiryRecovery: true,
      schedulePauseResumeCancel: true,
      eventLeaseExpiryRecovery: true,
      eventDeadLetterReplay: true,
      eventDeadLetterInspectionPayloadFree: true,
      eventDeadLetterReplayAudited: true,
      eventPauseResume: true,
      eventCircuitDurable: true,
      eventCircuitSingleProbe: true,
      eventCircuitRecovery: true,
      eventBacklogQuotaDeploymentWide: true,
      eventBacklogQuotaConcurrent: true,
      eventBacklogQuotaReclaimsCapacity: true,
      eventMetricsBoundedPayloadFree: true,
    }),
  );
} finally {
  await source.destroy();
}

async function verifySpannerScheduleLifecycle(dataSource) {
  const firstStore = new DatabasePluginScheduleStoreV1(
    async () => dataSource,
    () => 10_000_000,
  );
  const secondStore = new DatabasePluginScheduleStoreV1(
    async () => dataSource,
    () => 10_000_000,
  );
  const base = {
    pluginId: 'io.enterpriseglue.spanner-schedule',
    deploymentRef: 'deployment-schedule',
    tenantRef: 'tenant-schedule',
    subjectRef: 'user-schedule',
    deliveryOperationId:
      'io.enterpriseglue.spanner-schedule.deliver-refresh',
    allowedIntervalsSeconds: [3_600],
    maxAttempts: 3,
  };
  const request = {
    apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
    callId: 'spanner-full-schedule-call-1',
    operationId:
      'io.enterpriseglue.spanner-schedule.configure-refresh',
    action: 'upsert',
    jobType: 'io.enterpriseglue.spanner-schedule.refresh-index',
    intervalSeconds: 3_600,
    idempotencyKey: 'spanner-full-schedule-idempotency-1',
  };
  const scheduled = await firstStore.execute({ ...base, request });
  const duplicate = await secondStore.execute({ ...base, request });
  if (
    scheduled.status !== 'scheduled' ||
    duplicate.status !== 'duplicate' ||
    duplicate.jobRef !== scheduled.jobRef
  ) {
    throw new Error(
      'Spanner schedule command idempotency was not durable',
    );
  }

  const [claimed] = await firstStore.claimDue({
    workerRef: 'spanner-full-schedule-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 13_600_000,
  });
  if (!claimed || claimed.attempt !== 1) {
    throw new Error('Spanner schedule lifecycle fixture was not claimed');
  }
  const accepted = await firstStore.complete({
    jobRef: claimed.jobRef,
    leaseOwner: claimed.leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: claimed.request.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: 13_600_001,
  });
  const paused = await secondStore.setPaused({
    jobRef: accepted.jobRef,
    paused: true,
    expectedRevision: accepted.revision,
    reasonCode: 'administrator_paused',
    now: accepted.nextRunAt - 1,
  });
  const claimsWhilePaused = await firstStore.claimDue({
    workerRef: 'spanner-full-schedule-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: accepted.nextRunAt,
  });
  if (paused.status !== 'paused' || claimsWhilePaused.length !== 0) {
    throw new Error('Spanner paused schedule still delivered');
  }
  const resumed = await firstStore.setPaused({
    jobRef: accepted.jobRef,
    paused: false,
    expectedRevision: paused.revision,
    reasonCode: 'administrator_resumed',
    now: accepted.nextRunAt,
  });
  const [resumedClaim] = await secondStore.claimDue({
    workerRef: 'spanner-full-schedule-worker-3',
    limit: 1,
    leaseSeconds: 30,
    now: resumed.nextRunAt,
  });
  if (!resumedClaim || resumedClaim.jobRef !== accepted.jobRef) {
    throw new Error('Spanner resumed schedule did not deliver');
  }
  const resumedAccepted = await secondStore.complete({
    jobRef: resumedClaim.jobRef,
    leaseOwner: resumedClaim.leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: resumedClaim.request.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: resumed.nextRunAt + 1,
  });
  const cancelled = await firstStore.execute({
    ...base,
    request: {
      apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
      callId: 'spanner-full-schedule-call-2',
      operationId:
        'io.enterpriseglue.spanner-schedule.configure-refresh',
      action: 'cancel',
      jobType: 'io.enterpriseglue.spanner-schedule.refresh-index',
      idempotencyKey: 'spanner-full-schedule-idempotency-2',
    },
  });
  if (
    resumedAccepted.status !== 'scheduled' ||
    cancelled.status !== 'cancelled'
  ) {
    throw new Error('Spanner schedule resume/cancel state was not durable');
  }

  const leaseStore = new DatabasePluginScheduleStoreV1(
    async () => dataSource,
    () => 20_000_000,
  );
  const leaseScheduled = await leaseStore.execute({
    ...base,
    tenantRef: 'tenant-schedule-lease',
    request: {
      ...request,
      callId: 'spanner-lease-schedule-call-1',
      jobType:
        'io.enterpriseglue.spanner-schedule.lease-expiry',
      idempotencyKey: 'spanner-lease-schedule-idempotency-1',
    },
  });
  const [leaseClaim] = await leaseStore.claimDue({
    workerRef: 'spanner-crashed-schedule-worker',
    limit: 1,
    leaseSeconds: 1,
    now: 23_600_000,
  });
  if (!leaseClaim || leaseClaim.jobRef !== leaseScheduled.jobRef) {
    throw new Error('Spanner schedule lease fixture was not claimed');
  }
  const immediatelyAfterExpiry = await secondStore.claimDue({
    workerRef: 'spanner-recovery-schedule-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 23_601_001,
  });
  if (immediatelyAfterExpiry.length !== 0) {
    throw new Error(
      'Spanner schedule lease recovery skipped its bounded retry delay',
    );
  }
  const [recovered] = await secondStore.claimDue({
    workerRef: 'spanner-recovery-schedule-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 23_602_001,
  });
  if (
    !recovered ||
    recovered.jobRef !== leaseScheduled.jobRef ||
    recovered.attempt !== 2
  ) {
    throw new Error('Spanner expired schedule lease was not reclaimed');
  }
  const recoveredAccepted = await secondStore.complete({
    jobRef: recovered.jobRef,
    leaseOwner: recovered.leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: recovered.request.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: 23_602_002,
  });
  if (recoveredAccepted.status !== 'scheduled') {
    throw new Error('Spanner recovered schedule was not completed');
  }
}

async function verifySpannerEventLifecycle(
  dataSource,
  EventMetricsRegistry,
) {
  const metrics = new EventMetricsRegistry(
    () => new Date('2026-07-27T04:00:00.000Z'),
  );
  const firstStore = new DatabasePluginEventDeliveryStoreV1(
    async () => dataSource,
    {},
    {},
    metrics,
  );
  const secondStore = new DatabasePluginEventDeliveryStoreV1(
    async () => dataSource,
    {},
    {},
    metrics,
  );
  const base = {
    pluginId: 'io.enterpriseglue.spanner-event',
    deploymentRef: 'deployment-event',
    tenantRef: 'tenant-event',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.spanner-event.consume-incident',
    maxAttempts: 3,
  };

  const queued = await firstStore.enqueue({
    ...base,
    event: spannerIncidentEvent('dead-letter-1', base.tenantRef),
    now: 30_000_000,
  });
  const duplicate = await secondStore.enqueue({
    ...base,
    event: spannerIncidentEvent('dead-letter-1', base.tenantRef),
    now: 30_000_001,
  });
  if (duplicate.deliveryId !== queued.deliveryId) {
    throw new Error('Spanner event idempotency was not durable');
  }
  const [firstClaim] = await firstStore.claimDue({
    workerRef: 'spanner-full-event-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 30_000_000,
  });
  if (!firstClaim || firstClaim.deliveryId !== queued.deliveryId) {
    throw new Error('Spanner dead-letter fixture was not claimed');
  }
  const retry = await firstStore.complete({
    deliveryId: firstClaim.deliveryId,
    leaseOwner: firstClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: firstClaim.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 30_000_001,
  });
  const [secondClaim] = await secondStore.claimDue({
    workerRef: 'spanner-full-event-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt,
  });
  if (!secondClaim || secondClaim.attempt !== 2) {
    throw new Error('Spanner dead-letter retry was not claimed');
  }
  const deadLetter = await secondStore.complete({
    deliveryId: secondClaim.deliveryId,
    leaseOwner: secondClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: secondClaim.deliveryId,
      status: 'permanent_rejected',
      reasonCode: 'contract_rejected',
    },
    now: retry.nextAttemptAt + 1,
  });
  if (deadLetter.status !== 'dead_letter') {
    throw new Error('Spanner event was not dead-lettered');
  }
  const deadLetters = await firstStore.listDeadLetters({ limit: 10 });
  const deadLetterProjection = deadLetters.items.find(
    (item) => item.deliveryId === deadLetter.deliveryId,
  );
  if (
    !deadLetterProjection ||
    'tenantRef' in deadLetterProjection ||
    'eventJson' in deadLetterProjection ||
    'deploymentRef' in deadLetterProjection
  ) {
    throw new Error(
      'Spanner dead-letter inspection was absent or exposed payload context',
    );
  }
  let wrongPluginRejected = false;
  try {
    await firstStore.requeueDeadLetter({
      pluginId: 'io.enterpriseglue.spanner-wrong-plugin',
      deliveryId: deadLetter.deliveryId,
      expectedAttempt: 2,
      actorRef: 'spanner-acceptance-admin',
      correlationId: 'spanner-full-requeue-wrong-plugin',
      now: retry.nextAttemptAt + 2,
    });
  } catch (error) {
    wrongPluginRejected =
      error?.message === 'plugin_event_requeue_conflict';
  }
  if (!wrongPluginRejected) {
    throw new Error(
      'Spanner dead-letter replay was not plugin-scoped',
    );
  }
  const requeued = await secondStore.requeueDeadLetter({
    pluginId: base.pluginId,
    deliveryId: deadLetter.deliveryId,
    expectedAttempt: 2,
    actorRef: 'spanner-acceptance-admin',
    correlationId: 'spanner-full-requeue-1',
    now: retry.nextAttemptAt + 2,
  });
  if (requeued.status !== 'pending' || requeued.attempt !== 0) {
    throw new Error('Spanner dead letter was not explicitly replayed');
  }
  const [requeueAudit] = await dataSource.query(`
    SELECT
      event_type,
      plugin_id,
      tenant_ref,
      actor_ref,
      correlation_id,
      from_state,
      to_state
    FROM plugin_platform_audit
    WHERE correlation_id = 'spanner-full-requeue-1'
  `);
  if (
    rowValue(requeueAudit, 'event_type') !==
      'event_dead_letter_requeued' ||
    rowValue(requeueAudit, 'plugin_id') !== base.pluginId ||
    rowValue(requeueAudit, 'tenant_ref') !== base.tenantRef ||
    rowValue(requeueAudit, 'actor_ref') !==
      'spanner-acceptance-admin' ||
    rowValue(requeueAudit, 'from_state') !== 'dead_letter' ||
    rowValue(requeueAudit, 'to_state') !== 'pending'
  ) {
    throw new Error('Spanner dead-letter replay audit was not durable');
  }

  const paused = await firstStore.setPaused({
    pluginId: base.pluginId,
    deploymentRef: base.deploymentRef,
    tenantRef: base.tenantRef,
    subscriptionType: base.subscriptionType,
    paused: true,
    expectedRevision: 0,
    reasonCode: 'administrator_paused',
    now: retry.nextAttemptAt + 3,
  });
  const claimsWhilePaused = await secondStore.claimDue({
    workerRef: 'spanner-paused-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt + 3,
  });
  if (paused.revision !== 1 || claimsWhilePaused.length !== 0) {
    throw new Error('Spanner paused event subscription still delivered');
  }
  await secondStore.setPaused({
    pluginId: base.pluginId,
    deploymentRef: base.deploymentRef,
    tenantRef: base.tenantRef,
    subscriptionType: base.subscriptionType,
    paused: false,
    expectedRevision: 1,
    reasonCode: 'administrator_resumed',
    now: retry.nextAttemptAt + 4,
  });
  const [resumedClaim] = await firstStore.claimDue({
    workerRef: 'spanner-resumed-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt + 4,
  });
  if (!resumedClaim || resumedClaim.deliveryId !== queued.deliveryId) {
    throw new Error('Spanner resumed event subscription did not deliver');
  }
  const resumedAccepted = await firstStore.complete({
    deliveryId: resumedClaim.deliveryId,
    leaseOwner: resumedClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: resumedClaim.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: retry.nextAttemptAt + 5,
  });
  if (resumedAccepted.status !== 'delivered') {
    throw new Error('Spanner replayed event was not delivered');
  }

  const leaseBase = {
    ...base,
    pluginId: 'io.enterpriseglue.spanner-event-lease',
    tenantRef: 'tenant-event-lease',
    operationId:
      'io.enterpriseglue.spanner-event-lease.consume-incident',
  };
  const leaseQueued = await firstStore.enqueue({
    ...leaseBase,
    event: spannerIncidentEvent('lease-expiry-1', leaseBase.tenantRef),
    now: 31_000_000,
  });
  const [leaseClaim] = await firstStore.claimDue({
    workerRef: 'spanner-crashed-event-worker',
    limit: 1,
    leaseSeconds: 1,
    now: 31_000_000,
  });
  if (!leaseClaim || leaseClaim.deliveryId !== leaseQueued.deliveryId) {
    throw new Error('Spanner event lease fixture was not claimed');
  }
  let [recoveredLeaseClaim] = await secondStore.claimDue({
    workerRef: 'spanner-recovered-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 31_001_001,
  });
  if (!recoveredLeaseClaim) {
    [recoveredLeaseClaim] = await secondStore.claimDue({
      workerRef: 'spanner-recovered-event-worker',
      limit: 1,
      leaseSeconds: 30,
      now: 31_001_002,
    });
  }
  if (
    !recoveredLeaseClaim ||
    recoveredLeaseClaim.deliveryId !== leaseQueued.deliveryId ||
    recoveredLeaseClaim.attempt !== 2
  ) {
    throw new Error('Spanner expired event lease was not reclaimed');
  }
  const recoveredLeaseAccepted = await secondStore.complete({
    deliveryId: recoveredLeaseClaim.deliveryId,
    leaseOwner: recoveredLeaseClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: recoveredLeaseClaim.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: 31_001_003,
  });
  if (recoveredLeaseAccepted.status !== 'delivered') {
    throw new Error('Spanner recovered event lease was not completed');
  }

  await verifySpannerEventCircuit(dataSource, metrics);
  await verifySpannerEventBacklog(dataSource, metrics);
  verifySpannerEventMetrics(metrics.snapshot());
}

async function verifySpannerEventCircuit(dataSource, metrics) {
  const firstStore = new DatabasePluginEventDeliveryStoreV1(
    async () => dataSource,
    {},
    { failureThreshold: 2, openMilliseconds: 1_000 },
    metrics,
  );
  const secondStore = new DatabasePluginEventDeliveryStoreV1(
    async () => dataSource,
    {},
    { failureThreshold: 2, openMilliseconds: 1_000 },
    metrics,
  );
  const base = {
    pluginId: 'io.enterpriseglue.spanner-circuit',
    deploymentRef: 'deployment-circuit',
    tenantRef: 'tenant-circuit',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.spanner-circuit.consume-incident',
    maxAttempts: 10,
  };
  await firstStore.enqueue({
    ...base,
    event: spannerIncidentEvent('circuit-1', base.tenantRef),
    now: 40_000_000,
  });
  const [firstClaim] = await firstStore.claimDue({
    workerRef: 'spanner-circuit-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 40_000_000,
  });
  const firstRetry = await firstStore.complete({
    deliveryId: firstClaim.deliveryId,
    leaseOwner: firstClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: firstClaim.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 40_000_001,
  });
  const [secondClaim] = await secondStore.claimDue({
    workerRef: 'spanner-circuit-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: firstRetry.nextAttemptAt,
  });
  await secondStore.complete({
    deliveryId: secondClaim.deliveryId,
    leaseOwner: secondClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: secondClaim.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: firstRetry.nextAttemptAt + 1,
  });
  let openCircuitRejected = false;
  try {
    await firstStore.enqueue({
      ...base,
      event: spannerIncidentEvent(
        'circuit-open-rejected',
        base.tenantRef,
      ),
      now: firstRetry.nextAttemptAt + 2,
    });
  } catch (error) {
    openCircuitRejected =
      error?.message === 'plugin_event_circuit_open';
  }
  if (!openCircuitRejected) {
    throw new Error('Spanner open event circuit accepted new work');
  }

  const probeAt = firstRetry.nextAttemptAt + 1 + 1_000;
  for (const suffix of ['a', 'b']) {
    await secondStore.enqueue({
      ...base,
      event: spannerIncidentEvent(
        `circuit-probe-${suffix}`,
        base.tenantRef,
      ),
      now: probeAt,
    });
  }
  const probeClaims = await Promise.all([
    firstStore.claimDue({
      workerRef: 'spanner-circuit-probe-worker-1',
      limit: 10,
      leaseSeconds: 30,
      now: probeAt,
    }),
    secondStore.claimDue({
      workerRef: 'spanner-circuit-probe-worker-2',
      limit: 10,
      leaseSeconds: 30,
      now: probeAt,
    }),
  ]);
  const claimedProbes = probeClaims.flat();
  if (claimedProbes.length !== 1) {
    throw new Error(
      'Spanner half-open circuit admitted more than one probe',
    );
  }
  const [probe] = claimedProbes;
  await firstStore.complete({
    deliveryId: probe.deliveryId,
    leaseOwner: probe.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: probe.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: probeAt + 1,
  });
  await firstStore.enqueue({
    ...base,
    event: spannerIncidentEvent(
      'circuit-after-recovery',
      base.tenantRef,
    ),
    now: probeAt + 2,
  });
  const recoveredClaims = await secondStore.claimDue({
    workerRef: 'spanner-circuit-recovered-worker',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt + 2,
  });
  if (recoveredClaims.length !== 2) {
    throw new Error('Spanner event circuit did not close after its probe');
  }
  for (const claim of recoveredClaims) {
    await secondStore.complete({
      deliveryId: claim.deliveryId,
      leaseOwner: claim.leaseOwner,
      receipt: {
        apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
        deliveryId: claim.deliveryId,
        status: 'accepted',
        reasonCode: 'accepted',
      },
      now: probeAt + 3,
    });
  }
}

async function verifySpannerEventBacklog(dataSource, metrics) {
  const policy = {
    maxOutstandingPerPlugin: 2,
    maxOutstandingPerSubscription: 1,
  };
  const firstStore = new DatabasePluginEventDeliveryStoreV1(
    async () => dataSource,
    policy,
    {},
    metrics,
  );
  const secondStore = new DatabasePluginEventDeliveryStoreV1(
    async () => dataSource,
    policy,
    {},
    metrics,
  );
  const base = {
    pluginId: 'io.enterpriseglue.spanner-quota',
    deploymentRef: 'deployment-quota',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.spanner-quota.consume-incident',
    maxAttempts: 3,
  };
  const first = await firstStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-1',
    event: spannerIncidentEvent('quota-1', 'tenant-quota-1'),
    now: 50_000_000,
  });
  const duplicate = await secondStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-1',
    event: spannerIncidentEvent('quota-1', 'tenant-quota-1'),
    now: 50_000_001,
  });
  if (duplicate.deliveryId !== first.deliveryId) {
    throw new Error('Spanner backlog quota broke idempotency');
  }
  let subscriptionRejected = false;
  try {
    await secondStore.enqueue({
      ...base,
      tenantRef: 'tenant-quota-1',
      event: spannerIncidentEvent('quota-2', 'tenant-quota-1'),
      now: 50_000_002,
    });
  } catch (error) {
    subscriptionRejected =
      error?.message ===
      'plugin_event_backlog_subscription_quota_exceeded';
  }
  if (!subscriptionRejected) {
    throw new Error(
      'Spanner per-subscription backlog quota was not enforced',
    );
  }
  await firstStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-2',
    event: spannerIncidentEvent('quota-3', 'tenant-quota-2'),
    now: 50_000_003,
  });
  let pluginRejected = false;
  try {
    await secondStore.enqueue({
      ...base,
      tenantRef: 'tenant-quota-3',
      event: spannerIncidentEvent('quota-4', 'tenant-quota-3'),
      now: 50_000_004,
    });
  } catch (error) {
    pluginRejected =
      error?.message ===
      'plugin_event_backlog_plugin_quota_exceeded';
  }
  if (!pluginRejected) {
    throw new Error(
      'Spanner deployment-wide backlog quota was not enforced',
    );
  }
  const quotaClaims = await firstStore.claimDue({
    workerRef: 'spanner-quota-worker',
    limit: 100,
    leaseSeconds: 30,
    now: 50_000_005,
  });
  const firstClaim = quotaClaims.find(
    (claim) => claim.deliveryId === first.deliveryId,
  );
  if (!firstClaim) {
    throw new Error('Spanner backlog fixture was not claimable');
  }
  for (const claim of quotaClaims) {
    await firstStore.complete({
      deliveryId: claim.deliveryId,
      leaseOwner: claim.leaseOwner,
      receipt: {
        apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
        deliveryId: claim.deliveryId,
        status: 'accepted',
        reasonCode: 'accepted',
      },
      now: 50_000_006,
    });
  }
  await secondStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-1',
    event: spannerIncidentEvent('quota-2', 'tenant-quota-1'),
    now: 50_000_007,
  });

  const racePolicy = {
    maxOutstandingPerPlugin: 1,
    maxOutstandingPerSubscription: 1,
  };
  const raceStores = [
    new DatabasePluginEventDeliveryStoreV1(
      async () => dataSource,
      racePolicy,
      {},
      metrics,
    ),
    new DatabasePluginEventDeliveryStoreV1(
      async () => dataSource,
      racePolicy,
      {},
      metrics,
    ),
  ];
  const raceResults = await Promise.allSettled(
    raceStores.map((store, index) =>
      store.enqueue({
        ...base,
        pluginId: 'io.enterpriseglue.spanner-quota-race',
        operationId:
          'io.enterpriseglue.spanner-quota-race.consume-incident',
        tenantRef: `tenant-quota-race-${index + 1}`,
        event: spannerIncidentEvent(
          `quota-race-${index + 1}`,
          `tenant-quota-race-${index + 1}`,
        ),
        now: 51_000_000,
      }),
    ),
  );
  if (
    raceResults.filter((result) => result.status === 'fulfilled')
      .length !== 1 ||
    raceResults.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason?.message ===
          'plugin_event_backlog_plugin_quota_exceeded',
    ).length !== 1
  ) {
    throw new Error(
      'Concurrent Spanner workers bypassed the event backlog quota',
    );
  }
}

function verifySpannerEventMetrics(snapshot) {
  if (
    snapshot.generatedAt !== '2026-07-27T04:00:00.000Z' ||
    !snapshot.enqueues.some(
      (entry) =>
        entry.outcome === 'duplicate' &&
        entry.reasonCode === 'duplicate',
    ) ||
    !snapshot.enqueues.some(
      (entry) =>
        entry.outcome === 'rejected' &&
        entry.reasonCode === 'circuit_open',
    ) ||
    !snapshot.enqueues.some(
      (entry) =>
        entry.outcome === 'rejected' &&
        entry.reasonCode === 'plugin_backlog_full',
    ) ||
    !snapshot.deliveries.some(
      (entry) =>
        entry.outcome === 'retry_wait' &&
        entry.receiptStatus === 'retryable_rejected',
    ) ||
    !snapshot.deliveries.some(
      (entry) =>
        entry.outcome === 'dead_letter' &&
        entry.receiptStatus === 'permanent_rejected',
    ) ||
    !snapshot.deliveries.some(
      (entry) =>
        entry.outcome === 'requeued' &&
        entry.reasonCode === 'administrator_requeued',
    ) ||
    !snapshot.circuits.some(
      (entry) =>
        entry.state === 'open' &&
        entry.reasonCode === 'circuit_open',
    ) ||
    !snapshot.circuits.some(
      (entry) =>
        entry.state === 'half_open' &&
        entry.reasonCode === 'half_open_probe',
    ) ||
    !snapshot.circuits.some(
      (entry) =>
        entry.state === 'closed' &&
        entry.reasonCode === 'delivery_recovered',
    )
  ) {
    throw new Error(
      'Spanner event metrics missed a committed lifecycle outcome',
    );
  }
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'tenant-event',
    'deployment-event',
    'dead-letter-1',
    'consume-incident',
    'deliveryId',
    'eventId',
    'operationId',
    'payload',
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Spanner event metrics exposed ${forbidden}`);
    }
  }
}

function spannerIncidentEvent(id, tenantRef) {
  return {
    specversion: '1.0',
    id: `spanner-${id}`,
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: `spanner-${id}`,
    time: '2026-07-27T04:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef,
    data: {
      engineRef: 'engine-spanner',
      incidentRef: `spanner-${id}`,
      incidentType: 'failedJob',
    },
  };
}

function rowValue(row, name) {
  if (!row || typeof row !== 'object') return undefined;
  return (
    row[name] ??
    row[name.toUpperCase()] ??
    row[
      name.replace(
        /_([a-z])/g,
        (_match, letter) => letter.toUpperCase(),
      )
    ]
  );
}

async function pluginTableNames(dataSource) {
  const rows = await dataSource.query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND STARTS_WITH(TABLE_NAME, 'plugin_')
    ORDER BY TABLE_NAME
  `);
  return rows.map((row) => row.TABLE_NAME);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function environmentBoolean(name) {
  const value = requiredEnvironment(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}
