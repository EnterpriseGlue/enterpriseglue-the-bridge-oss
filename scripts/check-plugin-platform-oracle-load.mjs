import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const EVENT_COUNT = 128;
const WORKER_COUNT = 4;
const CLAIM_BATCH_SIZE = 16;
const REGRESSION_CEILING_MS = 60_000;
const FIXTURE_NOW = 70_000_000;
const PLUGIN_ID = 'io.enterpriseglue.oracle-load';

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

// Apply the same schema and column normalization used by the OSS Oracle runtime.
new OracleAdapter();

const migrations = await Promise.all(
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
const migrationClasses = migrations.map(
  (module) => Object.values(module)[0],
);
const { pluginPlatformEntities } = await import(
  new URL(
    'dist/infrastructure/persistence/entities/PluginPlatform.js',
    sharedRoot,
  )
);
const { DatabasePluginEventDeliveryStoreV1 } = await import(
  new URL('dist/plugins/pluginEventDeliveryStore.js', backendRoot)
);

const schema = safeOracleIdentifier(
  requiredEnvironment('ORACLE_SCHEMA'),
  'ORACLE_SCHEMA',
);
const connectionOptions = {
  username: requiredEnvironment('ORACLE_USER'),
  password: requiredEnvironment('ORACLE_PASSWORD'),
  connectString:
    `${requiredEnvironment('ORACLE_HOST')}:` +
    `${requiredEnvironment('ORACLE_PORT')}/` +
    requiredEnvironment('ORACLE_SERVICE_NAME'),
};
const migrationSource = createDataSource(migrationClasses);
const workerSources = Array.from(
  { length: WORKER_COUNT },
  () => createDataSource(),
);

await migrationSource.initialize();
try {
  const preexisting = await migrationSource.query(
    "SELECT table_name FROM user_tables WHERE LOWER(table_name) LIKE 'plugin_%'",
  );
  if (preexisting.length !== 0) {
    throw new Error(
      'Oracle load schema must not contain plugin tables',
    );
  }
  const applied = await migrationSource.runMigrations({
    transaction: 'each',
  });
  if (applied.length !== 9) {
    throw new Error(
      `Expected nine load-schema migrations, received ${applied.length}`,
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
  const enqueued = await Promise.all(
    Array.from({ length: EVENT_COUNT }, (_, index) =>
      stores[index % stores.length].enqueue({
        pluginId: PLUGIN_ID,
        deploymentRef: 'oracle-load-deployment',
        tenantRef: `oracle-load-tenant-${index % 16}`,
        subscriptionType: 'io.enterpriseglue.host.incident.v1',
        operationId: `${PLUGIN_ID}.consume-incident`,
        maxAttempts: 3,
        event: incidentEvent(index),
        now: FIXTURE_NOW,
      }),
    ),
  );
  const enqueueElapsedMs = performance.now() - enqueueStartedAt;
  if (
    new Set(enqueued.map((item) => item.deliveryId)).size !==
    EVENT_COUNT
  ) {
    throw new Error(
      'Oracle load enqueue lost or duplicated a delivery identity',
    );
  }

  const duplicate = await stores[1].enqueue({
    pluginId: PLUGIN_ID,
    deploymentRef: 'oracle-load-deployment',
    tenantRef: 'oracle-load-tenant-0',
    subscriptionType: 'io.enterpriseglue.host.incident.v1',
    operationId: `${PLUGIN_ID}.consume-incident`,
    maxAttempts: 3,
    event: incidentEvent(0),
    now: FIXTURE_NOW + 1,
  });
  if (duplicate.deliveryId !== enqueued[0].deliveryId) {
    throw new Error(
      'Oracle load replay did not preserve event idempotency',
    );
  }

  const drainStartedAt = performance.now();
  const deliveredByWorker = await Promise.all(
    stores.map((store, index) =>
      drainStore(store, `oracle-load-worker-${index + 1}`),
    ),
  );
  const drainElapsedMs = performance.now() - drainStartedAt;
  const totalElapsedMs = performance.now() - startedAt;
  const deliveredByWorkers = deliveredByWorker.reduce(
    (sum, count) => sum + count,
    0,
  );
  if (deliveredByWorkers !== EVENT_COUNT) {
    throw new Error(
      `Oracle load workers delivered ${deliveredByWorkers}/${EVENT_COUNT} events`,
    );
  }
  if (totalElapsedMs > REGRESSION_CEILING_MS) {
    throw new Error(
      `Oracle synthetic load exceeded ${REGRESSION_CEILING_MS}ms: ${Math.round(
        totalElapsedMs,
      )}ms`,
    );
  }

  const [deliveryState] = await migrationSource.query(
    `SELECT
       COUNT(*) AS "total_count",
       COUNT(DISTINCT "event_id") AS "distinct_event_count",
       SUM(CASE WHEN "status" = 'delivered' THEN 1 ELSE 0 END)
         AS "delivered_count",
       SUM(
         CASE
           WHEN DBMS_LOB.COMPARE("event_json", TO_CLOB('{}')) <> 0
           THEN 1
           ELSE 0
         END
       ) AS "retained_payload_count",
       SUM(
         CASE
           WHEN "lease_owner" IS NOT NULL
             OR "lease_expires_at" IS NOT NULL
           THEN 1
           ELSE 0
         END
       ) AS "active_lease_count"
     FROM "${schema}"."plugin_event_deliveries"
     WHERE "plugin_id" = '${PLUGIN_ID}'`,
  );
  if (
    Number(deliveryState?.total_count) !== EVENT_COUNT ||
    Number(deliveryState?.distinct_event_count) !== EVENT_COUNT ||
    Number(deliveryState?.delivered_count) !== EVENT_COUNT ||
    Number(deliveryState?.retained_payload_count) !== 0 ||
    Number(deliveryState?.active_lease_count) !== 0
  ) {
    throw new Error(
      `Oracle synthetic load invariants failed: ${JSON.stringify({
        deliveryState,
      })}`,
    );
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'oracle',
      syntheticLoadRegression: true,
      events: EVENT_COUNT,
      workers: WORKER_COUNT,
      deliveredExactlyOnce: true,
      replayIdempotent: true,
      retainedPayloads: 0,
      activeLeases: 0,
      enqueueElapsedMs: Math.round(enqueueElapsedMs),
      drainElapsedMs: Math.round(drainElapsedMs),
      totalElapsedMs: Math.round(totalElapsedMs),
      observedEventsPerSecond: Number(
        ((EVENT_COUNT * 1_000) / totalElapsedMs).toFixed(2),
      ),
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

async function drainStore(store, workerRef) {
  let delivered = 0;
  while (true) {
    const claims = await store.claimDue({
      workerRef,
      limit: CLAIM_BATCH_SIZE,
      leaseSeconds: 30,
      now: FIXTURE_NOW + 2,
    });
    if (claims.length === 0) return delivered;
    const completions = await Promise.all(
      claims.map((claim) =>
        store.complete({
          deliveryId: claim.deliveryId,
          leaseOwner: claim.leaseOwner,
          receipt: {
            apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
            deliveryId: claim.deliveryId,
            status: 'accepted',
            reasonCode: 'accepted',
          },
          now: FIXTURE_NOW + 3,
        }),
      ),
    );
    if (
      completions.some(
        (completion) => completion.status !== 'delivered',
      )
    ) {
      throw new Error(
        `Oracle load worker ${workerRef} did not persist delivery`,
      );
    }
    delivered += completions.length;
  }
}

function createDataSource(dataSourceMigrations = []) {
  return new DataSource({
    type: 'oracle',
    ...connectionOptions,
    schema,
    entities: pluginPlatformEntities,
    migrations: dataSourceMigrations,
    migrationsTableName: 'plugin_load_migrations',
    synchronize: false,
    logging: false,
  });
}

function incidentEvent(index) {
  return {
    specversion: '1.0',
    id: `oracle-load-event-${index}`,
    source: 'enterpriseglue-oss',
    type: 'io.enterpriseglue.host.incident.v1',
    subject: `oracle-load-incident-${index}`,
    time: '2026-07-27T09:00:00.000Z',
    dataschema:
      'https://schemas.enterpriseglue.io/events/incident-v1.json',
    tenantRef: `oracle-load-tenant-${index % 16}`,
    data: {
      engineRef: 'engine-oracle-load',
      incidentRef: `oracle-load-incident-${index}`,
      incidentType: 'failedJob',
    },
  };
}

function safeOracleIdentifier(value, name) {
  if (!/^[A-Z][A-Z0-9_$#]{0,127}$/.test(value)) {
    throw new Error(`${name} is not a safe Oracle identifier`);
  }
  return value;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
