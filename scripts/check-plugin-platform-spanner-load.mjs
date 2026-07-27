import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const EVENT_COUNT = 128;
const WORKER_COUNT = 4;
const CLAIM_BATCH_SIZE = 16;
const REGRESSION_CEILING_MS = 60_000;
const FIXTURE_NOW = 80_000_000;
const PLUGIN_ID = 'io.enterpriseglue.spanner-load';

const sharedRoot = new URL('../packages/shared/', import.meta.url);
const backendRoot = new URL('../packages/backend-host/', import.meta.url);
const sharedRequire = createRequire(new URL('package.json', sharedRoot));
globalThis.require = sharedRequire;
const { DataSource } = sharedRequire('typeorm');
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
const { DatabasePluginEventDeliveryStoreV1 } = await import(
  new URL('dist/plugins/pluginEventDeliveryStore.js', backendRoot)
);

const connectionOptions = {
  projectId: resourceIdentifier(
    'SPANNER_PROJECT_ID',
    requiredEnvironment('SPANNER_PROJECT_ID'),
  ),
  instanceId: resourceIdentifier(
    'SPANNER_INSTANCE_ID',
    requiredEnvironment('SPANNER_INSTANCE_ID'),
  ),
  databaseId: resourceIdentifier(
    'SPANNER_DATABASE_ID',
    requiredEnvironment('SPANNER_DATABASE_ID'),
  ),
};
const migrationSource = createDataSource(migrations);
const workerSources = Array.from(
  { length: WORKER_COUNT },
  () => createDataSource(),
);

await migrationSource.initialize();
try {
  await ensureSpannerTypeOrmMigrationLedgerV1(migrationSource);
  const applied = await migrationSource.runMigrations({
    transaction: 'none',
  });
  if (applied.length !== migrations.length) {
    throw new Error(
      `Expected ${migrations.length} load migrations, received ${applied.length}`,
    );
  }
  await Promise.all(workerSources.map((source) => source.initialize()));
  const stores = workerSources.map(
    (source) =>
      new DatabasePluginEventDeliveryStoreV1(
        async () => source,
        {
          maxOutstandingPerPlugin: EVENT_COUNT + 16,
          maxOutstandingPerSubscription: EVENT_COUNT + 16,
        },
      ),
  );

  const startedAt = performance.now();
  const enqueueStartedAt = performance.now();
  const enqueued = [];
  // The emulator permits one read-write transaction at a time and ignores
  // request cancellation. Round-robin the four independent pools here rather
  // than manufacturing a non-production RPC stall; concurrency semantics are
  // covered by the connected claim and multi-replica fixtures.
  for (let index = 0; index < EVENT_COUNT; index += 1) {
    enqueued.push(
      await stores[index % stores.length].enqueue({
        pluginId: PLUGIN_ID,
        deploymentRef: 'spanner-load-deployment',
        tenantRef: `spanner-load-tenant-${index % 16}`,
        subscriptionType: 'io.enterpriseglue.host.incident.v1',
        operationId: `${PLUGIN_ID}.consume-incident`,
        maxAttempts: 3,
        event: incidentEvent(index),
        now: FIXTURE_NOW,
      }),
    );
  }
  const enqueueElapsedMs = performance.now() - enqueueStartedAt;
  if (
    new Set(enqueued.map((item) => item.deliveryId)).size !==
    EVENT_COUNT
  ) {
    throw new Error(
      'Spanner load enqueue lost or duplicated a delivery identity',
    );
  }

  const duplicate = await stores[1].enqueue({
    pluginId: PLUGIN_ID,
    deploymentRef: 'spanner-load-deployment',
    tenantRef: 'spanner-load-tenant-0',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: `${PLUGIN_ID}.consume-incident`,
    maxAttempts: 3,
    event: incidentEvent(0),
    now: FIXTURE_NOW + 1,
  });
  if (duplicate.deliveryId !== enqueued[0].deliveryId) {
    throw new Error(
      'Spanner load replay did not preserve event idempotency',
    );
  }

  const drainStartedAt = performance.now();
  const deliveredByWorker = await drainStoresRoundRobin(stores);
  const drainElapsedMs = performance.now() - drainStartedAt;
  const totalElapsedMs = performance.now() - startedAt;
  const deliveredByWorkers = deliveredByWorker.reduce(
    (sum, count) => sum + count,
    0,
  );
  if (deliveredByWorkers !== EVENT_COUNT) {
    throw new Error(
      `Spanner load workers delivered ${deliveredByWorkers}/${EVENT_COUNT} events`,
    );
  }
  if (totalElapsedMs > REGRESSION_CEILING_MS) {
    throw new Error(
      `Spanner synthetic load exceeded ${REGRESSION_CEILING_MS}ms: ${Math.round(
        totalElapsedMs,
      )}ms`,
    );
  }

  const [deliveryState] = await migrationSource.query(`
    SELECT
      COUNT(*) AS total_count,
      COUNT(DISTINCT event_id) AS distinct_event_count,
      COUNTIF(status = 'delivered') AS delivered_count,
      COUNTIF(event_json != '{}') AS retained_payload_count,
      COUNTIF(lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL)
        AS active_lease_count
    FROM plugin_event_deliveries
    WHERE plugin_id = '${PLUGIN_ID}'
  `);
  if (
    Number(deliveryState?.total_count) !== EVENT_COUNT ||
    Number(deliveryState?.distinct_event_count) !== EVENT_COUNT ||
    Number(deliveryState?.delivered_count) !== EVENT_COUNT ||
    Number(deliveryState?.retained_payload_count) !== 0 ||
    Number(deliveryState?.active_lease_count) !== 0
  ) {
    throw new Error(
      `Spanner synthetic load invariants failed: ${JSON.stringify({
        deliveryState,
      })}`,
    );
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'spanner',
      emulatorSyntheticLoadRegression: true,
      productionPerformanceEvidence: false,
      events: EVENT_COUNT,
      workers: WORKER_COUNT,
      deliveredExactlyOnce: true,
      replayIdempotent: true,
      retainedPayloads: 0,
      activeLeases: 0,
      enqueueElapsedMs: Math.round(enqueueElapsedMs),
      drainElapsedMs: Math.round(drainElapsedMs),
      totalElapsedMs: Math.round(totalElapsedMs),
      regressionCeilingMs: REGRESSION_CEILING_MS,
    }),
  );
} finally {
  await Promise.allSettled(
    workerSources.map((source) =>
      source.isInitialized ? source.destroy() : Promise.resolve(),
    ),
  );
  await migrationSource.destroy();
}

async function drainStoresRoundRobin(stores) {
  const delivered = stores.map(() => 0);
  while (true) {
    let claimedThisPass = 0;
    for (const [index, store] of stores.entries()) {
      const workerRef = `spanner-load-worker-${index + 1}`;
      const claims = await store.claimDue({
        workerRef,
        limit: CLAIM_BATCH_SIZE,
        leaseSeconds: 30,
        now: FIXTURE_NOW + 2,
      });
      claimedThisPass += claims.length;
      for (const claim of claims) {
        const completion = await store.complete({
          deliveryId: claim.deliveryId,
          leaseOwner: claim.leaseOwner,
          receipt: {
            apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
            deliveryId: claim.deliveryId,
            status: 'accepted',
            reasonCode: 'accepted',
          },
          now: FIXTURE_NOW + 3,
        });
        if (completion.status !== 'delivered') {
          throw new Error(
            `Spanner load worker ${workerRef} did not persist delivery`,
          );
        }
        delivered[index] += 1;
      }
    }
    if (claimedThisPass === 0) return delivered;
  }
}

function createDataSource(dataSourceMigrations = []) {
  return new DataSource({
    type: 'spanner',
    ...connectionOptions,
    entities: pluginPlatformEntities,
    migrations: dataSourceMigrations,
    synchronize: false,
    logging: false,
  });
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

function incidentEvent(index) {
  return {
    specversion: '1.0',
    id: `spanner-load-event-${index}`,
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: `spanner-load-incident-${index}`,
    time: '2026-07-27T11:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef: `spanner-load-tenant-${index % 16}`,
    data: {
      engineRef: 'engine-spanner-load',
      incidentRef: `spanner-load-incident-${index}`,
      incidentType: 'failedJob',
    },
  };
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
