import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';

const sharedRoot = new URL('../packages/shared/', import.meta.url);
const backendRoot = new URL('../packages/backend-host/', import.meta.url);
const sharedRequire = createRequire(new URL('package.json', sharedRoot));
globalThis.require = sharedRequire;
const { DataSource } = sharedRequire('typeorm');
const { OracleAdapter } = await import(
  new URL(
    'dist/infrastructure/persistence/adapters/OracleAdapter.js',
    sharedRoot,
  )
);

// Apply the same entity metadata normalization used by the OSS Oracle runtime.
new OracleAdapter();

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
const { Notification } = await import(
  new URL(
    'dist/infrastructure/persistence/entities/Notification.js',
    sharedRoot,
  )
);
const { User } = await import(
  new URL('dist/infrastructure/persistence/entities/User.js', sharedRoot)
);
const { PluginControlPlaneV1 } = await import(
  new URL('dist/plugins/pluginControlPlane.js', backendRoot)
);
const { DatabasePluginControlStoreV1 } = await import(
  new URL('dist/plugins/pluginControlStore.js', backendRoot)
);
const { DatabasePluginGatewayAdmissionV1 } = await import(
  new URL('dist/plugins/pluginGatewayAdmissionStore.js', backendRoot)
);
const { DatabasePluginEventDeliveryStoreV1 } = await import(
  new URL('dist/plugins/pluginEventDeliveryStore.js', backendRoot)
);
const { PluginEventMetricsRegistryV1 } = await import(
  new URL('dist/plugins/pluginEventMetrics.js', backendRoot)
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

const source = new DataSource({
  type: 'oracle',
  username: requiredEnvironment('ORACLE_USER'),
  password: requiredEnvironment('ORACLE_PASSWORD'),
  connectString: `${requiredEnvironment('ORACLE_HOST')}:${requiredEnvironment(
    'ORACLE_PORT',
  )}/${requiredEnvironment('ORACLE_SERVICE_NAME')}`,
  schema: requiredEnvironment('ORACLE_SCHEMA'),
  entities: [...pluginPlatformEntities, Notification, User],
  migrations,
  synchronize: false,
  logging: false,
});

await source.initialize();
try {
  const preexisting = await pluginTableNames(source);
  if (preexisting.length !== 0) {
    throw new Error(
      `Oracle plugin gate requires a clean schema; found ${preexisting.join(',')}`,
    );
  }

  const applied = await source.runMigrations({ transaction: 'each' });
  if (applied.length !== migrations.length) {
    throw new Error(
      `Expected ${migrations.length} Oracle plugin migrations, received ${applied.length}`,
    );
  }
  const tables = await pluginTableNames(source);
  if (JSON.stringify(tables) !== JSON.stringify(expectedTables)) {
    throw new Error(`Unexpected Oracle plugin tables: ${JSON.stringify(tables)}`);
  }

  const indexedTextColumns = await source.query(`
    SELECT DISTINCT
      c.table_name,
      c.column_name,
      c.data_type
    FROM user_ind_columns i
    JOIN user_tab_columns c
      ON c.table_name = i.table_name
     AND c.column_name = i.column_name
    WHERE LOWER(c.table_name) LIKE 'plugin_%'
      AND c.data_type IN ('VARCHAR2', 'NVARCHAR2', 'CLOB', 'NCLOB')
    ORDER BY c.table_name, c.column_name
  `);
  if (
    indexedTextColumns.length === 0 ||
    indexedTextColumns.some((column) => column.DATA_TYPE !== 'VARCHAR2')
  ) {
    throw new Error('Oracle plugin indexes contain an unbounded text column');
  }

  const contentColumns = await source.query(`
    SELECT table_name, column_name, data_type
    FROM user_tab_columns
    WHERE LOWER(table_name) LIKE 'plugin_%'
      AND LOWER(column_name) IN (
        'event_json',
        'projection_json',
        'response_json',
        'value_json'
      )
    ORDER BY table_name, column_name
  `);
  if (
    contentColumns.length !== 4 ||
    contentColumns.some((column) => column.DATA_TYPE !== 'CLOB')
  ) {
    throw new Error('Oracle plugin content columns are not CLOB-backed');
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
      now: () => new Date('2026-07-27T02:00:00.000Z'),
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
    throw new Error('Oracle control reconciliation did not seed desired state');
  }

  const stopped = await control.setEmergencyDisabled({
    disabled: true,
    expectedRevision: 0,
    idempotencyKey: 'oracle-emergency-request-0001',
    actorRef: 'admin-1',
    correlationId: 'oracle-emergency-1',
  });
  const restartedControl = new PluginControlPlaneV1(
    installerSource,
    new DatabasePluginControlStoreV1(async () => source),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date('2026-07-27T02:01:00.000Z'),
    },
  );
  const seenAfterRestart = await restartedControl.getEmergencyState();
  const resumed = await restartedControl.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 1,
    idempotencyKey: 'oracle-emergency-request-0002',
    actorRef: 'admin-1',
    correlationId: 'oracle-emergency-2',
  });
  if (
    !stopped.disabled ||
    stopped.revision !== 1 ||
    !seenAfterRestart.disabled ||
    seenAfterRestart.revision !== 1 ||
    resumed.disabled ||
    resumed.revision !== 2 ||
    !(await control.isExecutionAllowed(
      sourceRecord.pluginId,
      'default-tenant-id',
    ))
  ) {
    throw new Error('Oracle emergency stop/restart/resume was not durable');
  }

  const storage = new DatabasePluginStorageStoreV1(async () => source);
  const storageBase = {
    apiVersion: 'storage-request.plugin.enterpriseglue.io/v1',
    callId: 'oracle-storage-call-1',
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
    callId: 'oracle-storage-call-2',
    action: 'put',
    key: 'case/key',
    value: { cursor: 2 },
  });
  const firstRead = await storage.execute({
    ...storageBase,
    callId: 'oracle-storage-call-3',
    action: 'get',
    key: 'case/Key',
  });
  const secondRead = await storage.execute({
    ...storageBase,
    callId: 'oracle-storage-call-4',
    action: 'get',
    key: 'case/key',
  });
  if (
    firstKey.revision !== 'r1' ||
    secondKey.revision !== 'r1' ||
    !firstRead.found ||
    firstRead.value.note !== '問題なし' ||
    !secondRead.found ||
    secondRead.value.cursor !== 2
  ) {
    throw new Error('Oracle case-sensitive storage or CLOB round-trip failed');
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
    throw new Error('Oracle gateway concurrency was not deployment-wide');
  }
  await lease.release();
  const recoveredLease = await secondAdmission.acquire(admissionInput);
  await recoveredLease.release();

  const scheduleStoreA = new DatabasePluginScheduleStoreV1(
    async () => source,
    () => 1_000,
  );
  const scheduleStoreB = new DatabasePluginScheduleStoreV1(
    async () => source,
    () => 1_000,
  );
  const scheduleBase = {
    pluginId: sourceRecord.pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subjectRef: 'user-1',
    deliveryOperationId:
      'io.enterpriseglue.reference.deliver-refresh',
    allowedIntervalsSeconds: [3_600],
    maxAttempts: 3,
  };
  const scheduledAlpha = await scheduleStoreA.execute({
    ...scheduleBase,
    request: {
      apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
      callId: 'oracle-schedule-call-alpha',
      operationId: 'io.enterpriseglue.reference.configure-refresh',
      action: 'upsert',
      jobType: 'io.enterpriseglue.reference.refresh-alpha',
      intervalSeconds: 3_600,
      idempotencyKey: 'oracle-schedule-alpha',
    },
  });
  const scheduledBeta = await scheduleStoreA.execute({
    ...scheduleBase,
    request: {
      apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
      callId: 'oracle-schedule-call-beta',
      operationId: 'io.enterpriseglue.reference.configure-refresh',
      action: 'upsert',
      jobType: 'io.enterpriseglue.reference.refresh-beta',
      intervalSeconds: 3_600,
      idempotencyKey: 'oracle-schedule-beta',
    },
  });
  const scheduleClaimTime = 3_601_000;
  const concurrentScheduleClaims = (
    await Promise.all([
      scheduleStoreA.claimDue({
        workerRef: 'oracle-schedule-worker-a',
        limit: 1,
        leaseSeconds: 30,
        now: scheduleClaimTime,
      }),
      scheduleStoreB.claimDue({
        workerRef: 'oracle-schedule-worker-b',
        limit: 1,
        leaseSeconds: 30,
        now: scheduleClaimTime,
      }),
    ])
  ).flat();
  if (
    concurrentScheduleClaims.length !== 2 ||
    new Set(concurrentScheduleClaims.map((claim) => claim.jobRef)).size !==
      2 ||
    !concurrentScheduleClaims.some(
      (claim) => claim.jobRef === scheduledAlpha.jobRef,
    ) ||
    !concurrentScheduleClaims.some(
      (claim) => claim.jobRef === scheduledBeta.jobRef,
    )
  ) {
    throw new Error(
      'Oracle concurrent schedule claims were not distinct and complete',
    );
  }
  const scheduleRetryClaim = concurrentScheduleClaims[0];
  const scheduleAcceptedClaim = concurrentScheduleClaims[1];
  const scheduleRetry = await scheduleStoreA.complete({
    jobRef: scheduleRetryClaim.jobRef,
    leaseOwner: scheduleRetryClaim.leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: scheduleRetryClaim.request.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: scheduleClaimTime + 100,
  });
  const scheduleAccepted = await scheduleStoreB.complete({
    jobRef: scheduleAcceptedClaim.jobRef,
    leaseOwner: scheduleAcceptedClaim.leaseOwner,
    receipt: {
      apiVersion: 'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: scheduleAcceptedClaim.request.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: scheduleClaimTime + 100,
  });
  const [retriedSchedule] = await scheduleStoreA.claimDue({
    workerRef: 'oracle-schedule-worker-retry',
    limit: 1,
    leaseSeconds: 30,
    now: scheduleRetry.nextRunAt,
  });
  if (
    scheduleRetry.status !== 'retry_wait' ||
    scheduleAccepted.status !== 'scheduled' ||
    !retriedSchedule ||
    retriedSchedule.jobRef !== scheduleRetryClaim.jobRef ||
    retriedSchedule.attempt !== 2
  ) {
    throw new Error('Oracle schedule retry/recurrence was not durable');
  }
  const scheduleRecovered = await scheduleStoreA.complete({
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
  if (
    scheduleRecovered.status !== 'scheduled' ||
    scheduleRecovered.attempt !== 0
  ) {
    throw new Error('Oracle schedule did not recover after retry');
  }
  await Promise.all([
    scheduleStoreA.setPaused({
      jobRef: scheduleAccepted.jobRef,
      paused: true,
      expectedRevision: scheduleAccepted.revision,
      reasonCode: 'acceptance_fixture_complete',
      now: scheduleRetry.nextRunAt + 2,
    }),
    scheduleStoreB.setPaused({
      jobRef: scheduleRecovered.jobRef,
      paused: true,
      expectedRevision: scheduleRecovered.revision,
      reasonCode: 'acceptance_fixture_complete',
      now: scheduleRetry.nextRunAt + 2,
    }),
  ]);

  const eventStoreA = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
  );
  const eventStoreB = new DatabasePluginEventDeliveryStoreV1(
    async () => source,
  );
  const oracleEvent = (id) => ({
    specversion: '1.0',
    id,
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: id,
    time: '2026-07-27T02:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef: 'tenant-1',
    data: {
      engineRef: 'engine-1',
      incidentRef: id,
      incidentType: 'failedJob',
    },
  });
  const queuedAlpha = await eventStoreA.enqueue({
    pluginId: sourceRecord.pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.reference.consume-incident',
    maxAttempts: 3,
    event: oracleEvent('oracle-incident-alpha'),
    now: 5_000,
  });
  const queuedBeta = await eventStoreA.enqueue({
    pluginId: sourceRecord.pluginId,
    deploymentRef: 'deployment-1',
    tenantRef: 'tenant-1',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.reference.consume-incident',
    maxAttempts: 3,
    event: oracleEvent('oracle-incident-beta'),
    now: 5_001,
  });
  const concurrentEventClaims = (
    await Promise.all([
      eventStoreA.claimDue({
        workerRef: 'oracle-event-worker-a',
        limit: 1,
        leaseSeconds: 30,
        now: 5_001,
      }),
      eventStoreB.claimDue({
        workerRef: 'oracle-event-worker-b',
        limit: 1,
        leaseSeconds: 30,
        now: 5_001,
      }),
    ])
  ).flat();
  if (
    concurrentEventClaims.length !== 2 ||
    new Set(
      concurrentEventClaims.map((claim) => claim.deliveryId),
    ).size !== 2 ||
    !concurrentEventClaims.some(
      (claim) => claim.deliveryId === queuedAlpha.deliveryId,
    ) ||
    !concurrentEventClaims.some(
      (claim) => claim.deliveryId === queuedBeta.deliveryId,
    )
  ) {
    throw new Error(
      'Oracle concurrent event claims were not distinct and complete',
    );
  }
  const eventRetryClaim = concurrentEventClaims[0];
  const eventAcceptedClaim = concurrentEventClaims[1];
  const eventRetry = await eventStoreA.complete({
    deliveryId: eventRetryClaim.deliveryId,
    leaseOwner: eventRetryClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: eventRetryClaim.deliveryId,
      status: 'retryable_rejected',
      reasonCode: 'sidecar_unavailable',
    },
    now: 5_100,
  });
  const eventAccepted = await eventStoreB.complete({
    deliveryId: eventAcceptedClaim.deliveryId,
    leaseOwner: eventAcceptedClaim.leaseOwner,
    receipt: {
      apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
      deliveryId: eventAcceptedClaim.deliveryId,
      status: 'accepted',
      reasonCode: 'accepted',
    },
    now: 5_100,
  });
  const [retriedEvent] = await eventStoreA.claimDue({
    workerRef: 'oracle-event-worker-retry',
    limit: 1,
    leaseSeconds: 30,
    now: eventRetry.nextAttemptAt,
  });
  if (
    eventRetry.status !== 'retry_wait' ||
    eventAccepted.status !== 'delivered' ||
    !retriedEvent ||
    retriedEvent.deliveryId !== eventRetryClaim.deliveryId ||
    retriedEvent.attempt !== 2
  ) {
    throw new Error('Oracle event retry/delivery was not durable');
  }
  const eventRecovered = await eventStoreA.complete({
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
  if (eventRecovered.status !== 'delivered') {
    throw new Error('Oracle event did not recover after retry');
  }

  await verifyOracleScheduleLifecycle(source);
  await verifyOracleEventLifecycle(
    source,
    PluginEventMetricsRegistryV1,
  );

  const maximumValue = JSON.stringify({ note: '最大長' });
  await source.query(
    `INSERT INTO "MAIN"."plugin_storage_entries"
      ("id", "plugin_id", "deployment_ref", "scope", "tenant_ref_key",
       "storage_key", "value_json", "value_bytes", "revision",
       "created_at", "updated_at")
     VALUES (:1, :2, :3, 'tenant', :4, :5, :6, :7, 1, 1, 1)`,
    [
      'm'.repeat(128),
      `a.${'b'.repeat(198)}`,
      'd'.repeat(256),
      't'.repeat(256),
      'k'.repeat(256),
      maximumValue,
      Buffer.byteLength(maximumValue, 'utf8'),
    ],
  );
  const [maximumRow] = await source.query(
    `SELECT
       LENGTH("plugin_id") AS "plugin_length",
       LENGTH("storage_key") AS "key_length",
       "value_json"
     FROM "MAIN"."plugin_storage_entries"
     WHERE "id" = :1`,
    ['m'.repeat(128)],
  );
  if (
    Number(maximumRow?.plugin_length) !== 200 ||
    Number(maximumRow?.key_length) !== 256 ||
    JSON.parse(maximumRow?.value_json ?? '{}').note !== '最大長'
  ) {
    throw new Error('Oracle contract-maximum key fixture did not round-trip');
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
    throw new Error('Oracle safe audit history was absent or exposed content');
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'oracle',
      migrations: applied.length,
      pluginTables: tables.length,
      boundedIndexedTextColumns: indexedTextColumns.length,
      clobContentColumns: contentColumns.length,
      utf8PayloadRoundTrip: true,
      caseSensitiveStorageKeys: true,
      contractMaximumKeyRoundTrip: true,
      emergencyRestart: true,
      gatewayConcurrency: true,
      oracleSafeWriteLocks: true,
      oracleSkipLockedBatchClaims: true,
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

async function verifyOracleScheduleLifecycle(dataSource) {
  const firstStore = new DatabasePluginScheduleStoreV1(
    async () => dataSource,
    () => 10_000_000,
  );
  const secondStore = new DatabasePluginScheduleStoreV1(
    async () => dataSource,
    () => 10_000_000,
  );
  const base = {
    pluginId: 'io.enterpriseglue.oracle-schedule',
    deploymentRef: 'deployment-schedule',
    tenantRef: 'tenant-schedule',
    subjectRef: 'user-schedule',
    deliveryOperationId:
      'io.enterpriseglue.oracle-schedule.deliver-refresh',
    allowedIntervalsSeconds: [3_600],
    maxAttempts: 3,
  };
  const request = {
    apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
    callId: 'oracle-full-schedule-call-1',
    operationId:
      'io.enterpriseglue.oracle-schedule.configure-refresh',
    action: 'upsert',
    jobType: 'io.enterpriseglue.oracle-schedule.refresh-index',
    intervalSeconds: 3_600,
    idempotencyKey: 'oracle-full-schedule-idempotency-1',
  };
  const scheduled = await firstStore.execute({ ...base, request });
  const duplicate = await secondStore.execute({ ...base, request });
  if (
    scheduled.status !== 'scheduled' ||
    duplicate.status !== 'duplicate' ||
    duplicate.jobRef !== scheduled.jobRef
  ) {
    throw new Error(
      'Oracle schedule command idempotency was not durable',
    );
  }

  const [claimed] = await firstStore.claimDue({
    workerRef: 'oracle-full-schedule-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 13_600_000,
  });
  if (!claimed || claimed.jobRef !== scheduled.jobRef) {
    throw new Error('Oracle schedule fixture was not claimed');
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
    workerRef: 'oracle-full-schedule-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: accepted.nextRunAt,
  });
  if (paused.status !== 'paused' || claimsWhilePaused.length !== 0) {
    throw new Error('Oracle paused schedule still delivered');
  }
  const resumed = await firstStore.setPaused({
    jobRef: accepted.jobRef,
    paused: false,
    expectedRevision: paused.revision,
    reasonCode: 'administrator_resumed',
    now: accepted.nextRunAt,
  });
  const [resumedClaim] = await secondStore.claimDue({
    workerRef: 'oracle-full-schedule-worker-3',
    limit: 1,
    leaseSeconds: 30,
    now: resumed.nextRunAt,
  });
  if (!resumedClaim || resumedClaim.jobRef !== accepted.jobRef) {
    throw new Error('Oracle resumed schedule did not deliver');
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
      callId: 'oracle-full-schedule-call-2',
      operationId:
        'io.enterpriseglue.oracle-schedule.configure-refresh',
      action: 'cancel',
      jobType: 'io.enterpriseglue.oracle-schedule.refresh-index',
      idempotencyKey: 'oracle-full-schedule-idempotency-2',
    },
  });
  if (
    resumedAccepted.status !== 'scheduled' ||
    cancelled.status !== 'cancelled'
  ) {
    throw new Error(
      'Oracle schedule resume/cancel state was not durable',
    );
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
      callId: 'oracle-lease-schedule-call-1',
      jobType: 'io.enterpriseglue.oracle-schedule.lease-expiry',
      idempotencyKey: 'oracle-lease-schedule-idempotency-1',
    },
  });
  const [leaseClaim] = await leaseStore.claimDue({
    workerRef: 'oracle-crashed-schedule-worker',
    limit: 1,
    leaseSeconds: 1,
    now: 23_600_000,
  });
  if (!leaseClaim || leaseClaim.jobRef !== leaseScheduled.jobRef) {
    throw new Error('Oracle schedule lease fixture was not claimed');
  }
  const immediatelyAfterExpiry = await secondStore.claimDue({
    workerRef: 'oracle-recovery-schedule-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 23_601_001,
  });
  if (immediatelyAfterExpiry.length !== 0) {
    throw new Error(
      'Oracle schedule lease recovery skipped its retry delay',
    );
  }
  const [recovered] = await secondStore.claimDue({
    workerRef: 'oracle-recovery-schedule-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 23_602_001,
  });
  if (
    !recovered ||
    recovered.jobRef !== leaseScheduled.jobRef ||
    recovered.attempt !== 2
  ) {
    throw new Error('Oracle expired schedule lease was not reclaimed');
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
    throw new Error('Oracle recovered schedule was not completed');
  }
}

async function verifyOracleEventLifecycle(
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
    pluginId: 'io.enterpriseglue.oracle-event',
    deploymentRef: 'deployment-event',
    tenantRef: 'tenant-event',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.oracle-event.consume-incident',
    maxAttempts: 3,
  };

  const queued = await firstStore.enqueue({
    ...base,
    event: oracleIncidentEvent('dead-letter-1', base.tenantRef),
    now: 30_000_000,
  });
  const duplicate = await secondStore.enqueue({
    ...base,
    event: oracleIncidentEvent('dead-letter-1', base.tenantRef),
    now: 30_000_001,
  });
  if (duplicate.deliveryId !== queued.deliveryId) {
    throw new Error('Oracle event idempotency was not durable');
  }
  const [firstClaim] = await firstStore.claimDue({
    workerRef: 'oracle-full-event-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 30_000_000,
  });
  if (!firstClaim || firstClaim.deliveryId !== queued.deliveryId) {
    throw new Error('Oracle dead-letter fixture was not claimed');
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
    workerRef: 'oracle-full-event-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt,
  });
  if (!secondClaim || secondClaim.attempt !== 2) {
    throw new Error('Oracle dead-letter retry was not claimed');
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
    throw new Error('Oracle event was not dead-lettered');
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
      'Oracle dead-letter inspection was absent or exposed payload context',
    );
  }
  let wrongPluginRejected = false;
  try {
    await firstStore.requeueDeadLetter({
      pluginId: 'io.enterpriseglue.oracle-wrong-plugin',
      deliveryId: deadLetter.deliveryId,
      expectedAttempt: 2,
      actorRef: 'oracle-acceptance-admin',
      correlationId: 'oracle-full-requeue-wrong-plugin',
      now: retry.nextAttemptAt + 2,
    });
  } catch (error) {
    wrongPluginRejected =
      error?.message === 'plugin_event_requeue_conflict';
  }
  if (!wrongPluginRejected) {
    throw new Error('Oracle dead-letter replay was not plugin-scoped');
  }
  const requeued = await secondStore.requeueDeadLetter({
    pluginId: base.pluginId,
    deliveryId: deadLetter.deliveryId,
    expectedAttempt: 2,
    actorRef: 'oracle-acceptance-admin',
    correlationId: 'oracle-full-requeue-1',
    now: retry.nextAttemptAt + 2,
  });
  if (requeued.status !== 'pending' || requeued.attempt !== 0) {
    throw new Error('Oracle dead letter was not replayed');
  }
  const [requeueAudit] = await dataSource.query(`
    SELECT
      "event_type" AS "event_type",
      "plugin_id" AS "plugin_id",
      "tenant_ref" AS "tenant_ref",
      "actor_ref" AS "actor_ref",
      "correlation_id" AS "correlation_id",
      "from_state" AS "from_state",
      "to_state" AS "to_state"
    FROM "MAIN"."plugin_platform_audit"
    WHERE "correlation_id" = 'oracle-full-requeue-1'
  `);
  if (
    requeueAudit?.event_type !== 'event_dead_letter_requeued' ||
    requeueAudit?.plugin_id !== base.pluginId ||
    requeueAudit?.tenant_ref !== base.tenantRef ||
    requeueAudit?.actor_ref !== 'oracle-acceptance-admin' ||
    requeueAudit?.from_state !== 'dead_letter' ||
    requeueAudit?.to_state !== 'pending'
  ) {
    throw new Error('Oracle dead-letter replay audit was not durable');
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
    workerRef: 'oracle-paused-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt + 3,
  });
  if (paused.revision !== 1 || claimsWhilePaused.length !== 0) {
    throw new Error('Oracle paused event subscription still delivered');
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
    workerRef: 'oracle-resumed-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt + 4,
  });
  if (!resumedClaim || resumedClaim.deliveryId !== queued.deliveryId) {
    throw new Error(
      'Oracle resumed event subscription did not deliver',
    );
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
    throw new Error('Oracle replayed event was not delivered');
  }

  const leaseBase = {
    ...base,
    pluginId: 'io.enterpriseglue.oracle-event-lease',
    tenantRef: 'tenant-event-lease',
    operationId:
      'io.enterpriseglue.oracle-event-lease.consume-incident',
  };
  const leaseQueued = await firstStore.enqueue({
    ...leaseBase,
    event: oracleIncidentEvent(
      'lease-expiry-1',
      leaseBase.tenantRef,
    ),
    now: 31_000_000,
  });
  const [leaseClaim] = await firstStore.claimDue({
    workerRef: 'oracle-crashed-event-worker',
    limit: 1,
    leaseSeconds: 1,
    now: 31_000_000,
  });
  if (!leaseClaim || leaseClaim.deliveryId !== leaseQueued.deliveryId) {
    throw new Error('Oracle event lease fixture was not claimed');
  }
  let [recoveredLeaseClaim] = await secondStore.claimDue({
    workerRef: 'oracle-recovered-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 31_001_001,
  });
  if (!recoveredLeaseClaim) {
    [recoveredLeaseClaim] = await secondStore.claimDue({
      workerRef: 'oracle-recovered-event-worker',
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
    throw new Error('Oracle expired event lease was not reclaimed');
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
    throw new Error('Oracle recovered event lease was not completed');
  }

  await verifyOracleEventCircuit(dataSource, metrics);
  await verifyOracleEventBacklog(dataSource, metrics);
  verifyOracleEventMetrics(metrics.snapshot());
}

async function verifyOracleEventCircuit(dataSource, metrics) {
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
    pluginId: 'io.enterpriseglue.oracle-circuit',
    deploymentRef: 'deployment-circuit',
    tenantRef: 'tenant-circuit',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.oracle-circuit.consume-incident',
    maxAttempts: 10,
  };
  await firstStore.enqueue({
    ...base,
    event: oracleIncidentEvent('circuit-1', base.tenantRef),
    now: 40_000_000,
  });
  const [firstClaim] = await firstStore.claimDue({
    workerRef: 'oracle-circuit-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 40_000_000,
  });
  if (!firstClaim) {
    throw new Error('Oracle circuit fixture was not claimed');
  }
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
    workerRef: 'oracle-circuit-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: firstRetry.nextAttemptAt,
  });
  if (!secondClaim) {
    throw new Error('Oracle circuit retry was not claimed');
  }
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
      event: oracleIncidentEvent(
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
    throw new Error('Oracle open event circuit accepted new work');
  }

  const probeAt = firstRetry.nextAttemptAt + 1 + 1_000;
  for (const suffix of ['a', 'b']) {
    await secondStore.enqueue({
      ...base,
      event: oracleIncidentEvent(
        `circuit-probe-${suffix}`,
        base.tenantRef,
      ),
      now: probeAt,
    });
  }
  const probeClaims = await firstStore.claimDue({
    workerRef: 'oracle-circuit-probe-worker-1',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt,
  });
  const secondProbeClaims = await secondStore.claimDue({
    workerRef: 'oracle-circuit-probe-worker-2',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt,
  });
  if (probeClaims.length !== 1 || secondProbeClaims.length !== 0) {
    throw new Error(
      'Oracle half-open circuit admitted more than one probe',
    );
  }
  const [probe] = probeClaims;
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
    event: oracleIncidentEvent(
      'circuit-after-recovery',
      base.tenantRef,
    ),
    now: probeAt + 2,
  });
  const recoveredClaims = await secondStore.claimDue({
    workerRef: 'oracle-circuit-recovered-worker',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt + 2,
  });
  if (recoveredClaims.length !== 2) {
    throw new Error(
      'Oracle event circuit did not close after its probe',
    );
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

async function verifyOracleEventBacklog(dataSource, metrics) {
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
    pluginId: 'io.enterpriseglue.oracle-quota',
    deploymentRef: 'deployment-quota',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.oracle-quota.consume-incident',
    maxAttempts: 3,
  };
  const first = await firstStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-1',
    event: oracleIncidentEvent('quota-1', 'tenant-quota-1'),
    now: 50_000_000,
  });
  const duplicate = await secondStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-1',
    event: oracleIncidentEvent('quota-1', 'tenant-quota-1'),
    now: 50_000_001,
  });
  if (duplicate.deliveryId !== first.deliveryId) {
    throw new Error('Oracle backlog quota broke idempotency');
  }
  let subscriptionRejected = false;
  try {
    await secondStore.enqueue({
      ...base,
      tenantRef: 'tenant-quota-1',
      event: oracleIncidentEvent('quota-2', 'tenant-quota-1'),
      now: 50_000_002,
    });
  } catch (error) {
    subscriptionRejected =
      error?.message ===
      'plugin_event_backlog_subscription_quota_exceeded';
  }
  if (!subscriptionRejected) {
    throw new Error(
      'Oracle per-subscription backlog quota was not enforced',
    );
  }
  await firstStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-2',
    event: oracleIncidentEvent('quota-3', 'tenant-quota-2'),
    now: 50_000_003,
  });
  let pluginRejected = false;
  try {
    await secondStore.enqueue({
      ...base,
      tenantRef: 'tenant-quota-3',
      event: oracleIncidentEvent('quota-4', 'tenant-quota-3'),
      now: 50_000_004,
    });
  } catch (error) {
    pluginRejected =
      error?.message ===
      'plugin_event_backlog_plugin_quota_exceeded';
  }
  if (!pluginRejected) {
    throw new Error(
      'Oracle deployment-wide backlog quota was not enforced',
    );
  }
  const quotaClaims = await firstStore.claimDue({
    workerRef: 'oracle-quota-worker',
    limit: 100,
    leaseSeconds: 30,
    now: 50_000_005,
  });
  const firstClaim = quotaClaims.find(
    (claim) => claim.deliveryId === first.deliveryId,
  );
  if (!firstClaim) {
    throw new Error('Oracle backlog fixture was not claimable');
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
    event: oracleIncidentEvent('quota-2', 'tenant-quota-1'),
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
        pluginId: 'io.enterpriseglue.oracle-quota-race',
        operationId:
          'io.enterpriseglue.oracle-quota-race.consume-incident',
        tenantRef: `tenant-quota-race-${index + 1}`,
        event: oracleIncidentEvent(
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
      'Concurrent Oracle workers bypassed the event backlog quota',
    );
  }
}

function verifyOracleEventMetrics(snapshot) {
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
    throw new Error('Oracle event metrics missed a lifecycle outcome');
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
      throw new Error(`Oracle event metrics exposed ${forbidden}`);
    }
  }
}

function oracleIncidentEvent(id, tenantRef) {
  return {
    specversion: '1.0',
    id: `oracle-${id}`,
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: `oracle-${id}`,
    time: '2026-07-27T04:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef,
    data: {
      engineRef: 'engine-oracle',
      incidentRef: `oracle-${id}`,
      incidentType: 'failedJob',
    },
  };
}

async function pluginTableNames(dataSource) {
  const rows = await dataSource.query(
    "SELECT table_name FROM user_tables WHERE LOWER(table_name) LIKE 'plugin_%' ORDER BY table_name",
  );
  return rows.map((row) => row.TABLE_NAME);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
