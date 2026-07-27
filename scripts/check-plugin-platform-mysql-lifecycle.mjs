import { createRequire } from 'node:module';

const sharedRoot = new URL('../packages/shared/', import.meta.url);
const backendRoot = new URL('../packages/backend-host/', import.meta.url);
const sharedRequire = createRequire(new URL('package.json', sharedRoot));
globalThis.require = sharedRequire;
const { DataSource } = sharedRequire('typeorm');
const { MySQLAdapter } = await import(
  new URL(
    'dist/infrastructure/persistence/adapters/MySQLAdapter.js',
    sharedRoot,
  )
);

// Apply the same entity metadata normalization used by the OSS MySQL runtime.
new MySQLAdapter();

const { pluginPlatformEntities } = await import(
  new URL(
    'dist/infrastructure/persistence/entities/PluginPlatform.js',
    sharedRoot,
  )
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

const source = new DataSource({
  type: 'mysql',
  host: '127.0.0.1',
  port: Number(requiredEnvironment('MYSQL_PORT')),
  username: 'root',
  password: 'mysql',
  database: 'main',
  charset: 'utf8mb4',
  entities: pluginPlatformEntities,
  synchronize: false,
  logging: false,
});

await source.initialize();
try {
  await verifyMySqlScheduleLifecycle(source);
  await verifyMySqlEventLifecycle(
    source,
    PluginEventMetricsRegistryV1,
  );
  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'mysql',
      durableLifecycle: true,
      scheduleIdempotency: true,
      scheduleLeaseExpiryRecovery: true,
      schedulePauseResumeCancel: true,
      eventIdempotency: true,
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

async function verifyMySqlScheduleLifecycle(dataSource) {
  const firstStore = new DatabasePluginScheduleStoreV1(
    async () => dataSource,
    () => 10_000_000,
  );
  const secondStore = new DatabasePluginScheduleStoreV1(
    async () => dataSource,
    () => 10_000_000,
  );
  const base = {
    pluginId: 'io.enterpriseglue.mysql-schedule',
    deploymentRef: 'deployment-schedule',
    tenantRef: 'tenant-schedule',
    subjectRef: 'user-schedule',
    deliveryOperationId:
      'io.enterpriseglue.mysql-schedule.deliver-refresh',
    allowedIntervalsSeconds: [3_600],
    maxAttempts: 3,
  };
  const request = {
    apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1',
    callId: 'mysql-full-schedule-call-1',
    operationId:
      'io.enterpriseglue.mysql-schedule.configure-refresh',
    action: 'upsert',
    jobType: 'io.enterpriseglue.mysql-schedule.refresh-index',
    intervalSeconds: 3_600,
    idempotencyKey: 'mysql-full-schedule-idempotency-1',
  };
  const scheduled = await firstStore.execute({ ...base, request });
  const duplicate = await secondStore.execute({ ...base, request });
  if (
    scheduled.status !== 'scheduled' ||
    duplicate.status !== 'duplicate' ||
    duplicate.jobRef !== scheduled.jobRef
  ) {
    throw new Error(
      'MySQL schedule command idempotency was not durable',
    );
  }

  const [claimed] = await firstStore.claimDue({
    workerRef: 'mysql-full-schedule-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 13_600_000,
  });
  if (!claimed || claimed.jobRef !== scheduled.jobRef) {
    throw new Error('MySQL schedule fixture was not claimed');
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
    workerRef: 'mysql-full-schedule-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: accepted.nextRunAt,
  });
  if (paused.status !== 'paused' || claimsWhilePaused.length !== 0) {
    throw new Error('MySQL paused schedule still delivered');
  }
  const resumed = await firstStore.setPaused({
    jobRef: accepted.jobRef,
    paused: false,
    expectedRevision: paused.revision,
    reasonCode: 'administrator_resumed',
    now: accepted.nextRunAt,
  });
  const [resumedClaim] = await secondStore.claimDue({
    workerRef: 'mysql-full-schedule-worker-3',
    limit: 1,
    leaseSeconds: 30,
    now: resumed.nextRunAt,
  });
  if (!resumedClaim || resumedClaim.jobRef !== accepted.jobRef) {
    throw new Error('MySQL resumed schedule did not deliver');
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
      callId: 'mysql-full-schedule-call-2',
      operationId:
        'io.enterpriseglue.mysql-schedule.configure-refresh',
      action: 'cancel',
      jobType: 'io.enterpriseglue.mysql-schedule.refresh-index',
      idempotencyKey: 'mysql-full-schedule-idempotency-2',
    },
  });
  if (
    resumedAccepted.status !== 'scheduled' ||
    cancelled.status !== 'cancelled'
  ) {
    throw new Error(
      'MySQL schedule resume/cancel state was not durable',
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
      callId: 'mysql-lease-schedule-call-1',
      jobType: 'io.enterpriseglue.mysql-schedule.lease-expiry',
      idempotencyKey: 'mysql-lease-schedule-idempotency-1',
    },
  });
  const [leaseClaim] = await leaseStore.claimDue({
    workerRef: 'mysql-crashed-schedule-worker',
    limit: 1,
    leaseSeconds: 1,
    now: 23_600_000,
  });
  if (!leaseClaim || leaseClaim.jobRef !== leaseScheduled.jobRef) {
    throw new Error('MySQL schedule lease fixture was not claimed');
  }
  const immediatelyAfterExpiry = await secondStore.claimDue({
    workerRef: 'mysql-recovery-schedule-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 23_601_001,
  });
  if (immediatelyAfterExpiry.length !== 0) {
    throw new Error(
      'MySQL schedule lease recovery skipped its retry delay',
    );
  }
  const [recovered] = await secondStore.claimDue({
    workerRef: 'mysql-recovery-schedule-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 23_602_001,
  });
  if (
    !recovered ||
    recovered.jobRef !== leaseScheduled.jobRef ||
    recovered.attempt !== 2
  ) {
    throw new Error('MySQL expired schedule lease was not reclaimed');
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
    throw new Error('MySQL recovered schedule was not completed');
  }
}

async function verifyMySqlEventLifecycle(
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
    pluginId: 'io.enterpriseglue.mysql-event',
    deploymentRef: 'deployment-event',
    tenantRef: 'tenant-event',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.mysql-event.consume-incident',
    maxAttempts: 3,
  };

  const queued = await firstStore.enqueue({
    ...base,
    event: mySqlIncidentEvent('dead-letter-1', base.tenantRef),
    now: 30_000_000,
  });
  const duplicate = await secondStore.enqueue({
    ...base,
    event: mySqlIncidentEvent('dead-letter-1', base.tenantRef),
    now: 30_000_001,
  });
  if (duplicate.deliveryId !== queued.deliveryId) {
    throw new Error('MySQL event idempotency was not durable');
  }
  const [firstClaim] = await firstStore.claimDue({
    workerRef: 'mysql-full-event-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 30_000_000,
  });
  if (!firstClaim || firstClaim.deliveryId !== queued.deliveryId) {
    throw new Error('MySQL dead-letter fixture was not claimed');
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
    workerRef: 'mysql-full-event-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt,
  });
  if (!secondClaim || secondClaim.attempt !== 2) {
    throw new Error('MySQL dead-letter retry was not claimed');
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
    throw new Error('MySQL event was not dead-lettered');
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
      'MySQL dead-letter inspection was absent or exposed payload context',
    );
  }
  let wrongPluginRejected = false;
  try {
    await firstStore.requeueDeadLetter({
      pluginId: 'io.enterpriseglue.mysql-wrong-plugin',
      deliveryId: deadLetter.deliveryId,
      expectedAttempt: 2,
      actorRef: 'mysql-acceptance-admin',
      correlationId: 'mysql-full-requeue-wrong-plugin',
      now: retry.nextAttemptAt + 2,
    });
  } catch (error) {
    wrongPluginRejected =
      error?.message === 'plugin_event_requeue_conflict';
  }
  if (!wrongPluginRejected) {
    throw new Error('MySQL dead-letter replay was not plugin-scoped');
  }
  const requeued = await secondStore.requeueDeadLetter({
    pluginId: base.pluginId,
    deliveryId: deadLetter.deliveryId,
    expectedAttempt: 2,
    actorRef: 'mysql-acceptance-admin',
    correlationId: 'mysql-full-requeue-1',
    now: retry.nextAttemptAt + 2,
  });
  if (requeued.status !== 'pending' || requeued.attempt !== 0) {
    throw new Error('MySQL dead letter was not replayed');
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
    FROM main.plugin_platform_audit
    WHERE correlation_id = 'mysql-full-requeue-1'
  `);
  if (
    requeueAudit?.event_type !== 'event_dead_letter_requeued' ||
    requeueAudit?.plugin_id !== base.pluginId ||
    requeueAudit?.tenant_ref !== base.tenantRef ||
    requeueAudit?.actor_ref !== 'mysql-acceptance-admin' ||
    requeueAudit?.from_state !== 'dead_letter' ||
    requeueAudit?.to_state !== 'pending'
  ) {
    throw new Error('MySQL dead-letter replay audit was not durable');
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
    workerRef: 'mysql-paused-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt + 3,
  });
  if (paused.revision !== 1 || claimsWhilePaused.length !== 0) {
    throw new Error('MySQL paused event subscription still delivered');
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
    workerRef: 'mysql-resumed-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: retry.nextAttemptAt + 4,
  });
  if (!resumedClaim || resumedClaim.deliveryId !== queued.deliveryId) {
    throw new Error(
      'MySQL resumed event subscription did not deliver',
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
    throw new Error('MySQL replayed event was not delivered');
  }

  const leaseBase = {
    ...base,
    pluginId: 'io.enterpriseglue.mysql-event-lease',
    tenantRef: 'tenant-event-lease',
    operationId:
      'io.enterpriseglue.mysql-event-lease.consume-incident',
  };
  const leaseQueued = await firstStore.enqueue({
    ...leaseBase,
    event: mySqlIncidentEvent(
      'lease-expiry-1',
      leaseBase.tenantRef,
    ),
    now: 31_000_000,
  });
  const [leaseClaim] = await firstStore.claimDue({
    workerRef: 'mysql-crashed-event-worker',
    limit: 1,
    leaseSeconds: 1,
    now: 31_000_000,
  });
  if (!leaseClaim || leaseClaim.deliveryId !== leaseQueued.deliveryId) {
    throw new Error('MySQL event lease fixture was not claimed');
  }
  let [recoveredLeaseClaim] = await secondStore.claimDue({
    workerRef: 'mysql-recovered-event-worker',
    limit: 1,
    leaseSeconds: 30,
    now: 31_001_001,
  });
  if (!recoveredLeaseClaim) {
    [recoveredLeaseClaim] = await secondStore.claimDue({
      workerRef: 'mysql-recovered-event-worker',
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
    throw new Error('MySQL expired event lease was not reclaimed');
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
    throw new Error('MySQL recovered event lease was not completed');
  }

  await verifyMySqlEventCircuit(dataSource, metrics);
  await verifyMySqlEventBacklog(dataSource, metrics);
  verifyMySqlEventMetrics(metrics.snapshot());
}

async function verifyMySqlEventCircuit(dataSource, metrics) {
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
    pluginId: 'io.enterpriseglue.mysql-circuit',
    deploymentRef: 'deployment-circuit',
    tenantRef: 'tenant-circuit',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.mysql-circuit.consume-incident',
    maxAttempts: 10,
  };
  await firstStore.enqueue({
    ...base,
    event: mySqlIncidentEvent('circuit-1', base.tenantRef),
    now: 40_000_000,
  });
  const [firstClaim] = await firstStore.claimDue({
    workerRef: 'mysql-circuit-worker-1',
    limit: 1,
    leaseSeconds: 30,
    now: 40_000_000,
  });
  if (!firstClaim) {
    throw new Error('MySQL circuit fixture was not claimed');
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
    workerRef: 'mysql-circuit-worker-2',
    limit: 1,
    leaseSeconds: 30,
    now: firstRetry.nextAttemptAt,
  });
  if (!secondClaim) {
    throw new Error('MySQL circuit retry was not claimed');
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
      event: mySqlIncidentEvent(
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
    throw new Error('MySQL open event circuit accepted new work');
  }

  const probeAt = firstRetry.nextAttemptAt + 1 + 1_000;
  for (const suffix of ['a', 'b']) {
    await secondStore.enqueue({
      ...base,
      event: mySqlIncidentEvent(
        `circuit-probe-${suffix}`,
        base.tenantRef,
      ),
      now: probeAt,
    });
  }
  const probeClaims = await firstStore.claimDue({
    workerRef: 'mysql-circuit-probe-worker-1',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt,
  });
  const secondProbeClaims = await secondStore.claimDue({
    workerRef: 'mysql-circuit-probe-worker-2',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt,
  });
  if (probeClaims.length !== 1 || secondProbeClaims.length !== 0) {
    throw new Error(
      'MySQL half-open circuit admitted more than one probe',
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
    event: mySqlIncidentEvent(
      'circuit-after-recovery',
      base.tenantRef,
    ),
    now: probeAt + 2,
  });
  const recoveredClaims = await secondStore.claimDue({
    workerRef: 'mysql-circuit-recovered-worker',
    limit: 10,
    leaseSeconds: 30,
    now: probeAt + 2,
  });
  if (recoveredClaims.length !== 2) {
    throw new Error(
      'MySQL event circuit did not close after its probe',
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

async function verifyMySqlEventBacklog(dataSource, metrics) {
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
    pluginId: 'io.enterpriseglue.mysql-quota',
    deploymentRef: 'deployment-quota',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: 'io.enterpriseglue.mysql-quota.consume-incident',
    maxAttempts: 3,
  };
  const first = await firstStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-1',
    event: mySqlIncidentEvent('quota-1', 'tenant-quota-1'),
    now: 50_000_000,
  });
  const duplicate = await secondStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-1',
    event: mySqlIncidentEvent('quota-1', 'tenant-quota-1'),
    now: 50_000_001,
  });
  if (duplicate.deliveryId !== first.deliveryId) {
    throw new Error('MySQL backlog quota broke idempotency');
  }
  let subscriptionRejected = false;
  try {
    await secondStore.enqueue({
      ...base,
      tenantRef: 'tenant-quota-1',
      event: mySqlIncidentEvent('quota-2', 'tenant-quota-1'),
      now: 50_000_002,
    });
  } catch (error) {
    subscriptionRejected =
      error?.message ===
      'plugin_event_backlog_subscription_quota_exceeded';
  }
  if (!subscriptionRejected) {
    throw new Error(
      'MySQL per-subscription backlog quota was not enforced',
    );
  }
  await firstStore.enqueue({
    ...base,
    tenantRef: 'tenant-quota-2',
    event: mySqlIncidentEvent('quota-3', 'tenant-quota-2'),
    now: 50_000_003,
  });
  let pluginRejected = false;
  try {
    await secondStore.enqueue({
      ...base,
      tenantRef: 'tenant-quota-3',
      event: mySqlIncidentEvent('quota-4', 'tenant-quota-3'),
      now: 50_000_004,
    });
  } catch (error) {
    pluginRejected =
      error?.message ===
      'plugin_event_backlog_plugin_quota_exceeded';
  }
  if (!pluginRejected) {
    throw new Error(
      'MySQL deployment-wide backlog quota was not enforced',
    );
  }
  const quotaClaims = await firstStore.claimDue({
    workerRef: 'mysql-quota-worker',
    limit: 100,
    leaseSeconds: 30,
    now: 50_000_005,
  });
  const firstClaim = quotaClaims.find(
    (claim) => claim.deliveryId === first.deliveryId,
  );
  if (!firstClaim) {
    throw new Error('MySQL backlog fixture was not claimable');
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
    event: mySqlIncidentEvent('quota-2', 'tenant-quota-1'),
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
        pluginId: 'io.enterpriseglue.mysql-quota-race',
        operationId:
          'io.enterpriseglue.mysql-quota-race.consume-incident',
        tenantRef: `tenant-quota-race-${index + 1}`,
        event: mySqlIncidentEvent(
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
      `Concurrent MySQL workers bypassed the event backlog quota: ${JSON.stringify(
        raceResults.map((result) =>
          result.status === 'fulfilled'
            ? { status: result.status }
            : {
                status: result.status,
                message: result.reason?.message,
                code: result.reason?.code,
              },
        ),
      )}`,
    );
  }
}

function verifyMySqlEventMetrics(snapshot) {
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
    throw new Error('MySQL event metrics missed a lifecycle outcome');
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
      throw new Error(`MySQL event metrics exposed ${forbidden}`);
    }
  }
}

function mySqlIncidentEvent(id, tenantRef) {
  return {
    specversion: '1.0',
    id: `mysql-${id}`,
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: `mysql-${id}`,
    time: '2026-07-27T04:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef,
    data: {
      engineRef: 'engine-mysql',
      incidentRef: `mysql-${id}`,
      incidentType: 'failedJob',
    },
  };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
