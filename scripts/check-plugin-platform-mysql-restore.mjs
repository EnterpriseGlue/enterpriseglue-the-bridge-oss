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
const { PluginControlPlaneV1 } = await import(
  new URL('dist/plugins/pluginControlPlane.js', backendRoot)
);
const { DatabasePluginControlStoreV1 } = await import(
  new URL('dist/plugins/pluginControlStore.js', backendRoot)
);
const { DatabasePluginStorageStoreV1 } = await import(
  new URL('dist/plugins/pluginStorageStore.js', backendRoot)
);

const restoredDatabase = requiredEnvironment('RESTORED_MYSQL_DATABASE');
const restored = new DataSource({
  type: 'mysql',
  host: '127.0.0.1',
  port: Number(requiredEnvironment('MYSQL_PORT')),
  username: 'root',
  password: 'mysql',
  database: restoredDatabase,
  charset: 'utf8mb4',
  entities: pluginPlatformEntities,
  migrations: [],
  synchronize: false,
  logging: false,
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
      revision: 1,
      records: [sourceRecord],
    };
  },
};

await restored.initialize();
try {
  const [{ tableCount }] = await restored.query(
    `SELECT COUNT(*) AS tableCount
       FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name LIKE 'plugin_%'`,
    [restoredDatabase],
  );
  if (Number(tableCount) !== 19) {
    throw new Error(
      'Restored MySQL plugin platform did not contain all nineteen tables',
    );
  }

  const control = createControl(restored, '2026-07-27T03:00:00.000Z');
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
      'Restored MySQL emergency revision/state was not exact',
    );
  }
  if (!plugin?.enabled || plugin.revision !== 0) {
    throw new Error(
      'Restored MySQL plugin desired state/revision was not exact',
    );
  }
  if (!tenant.enabled || tenant.revision !== 0) {
    throw new Error(
      'Restored MySQL tenant desired state/revision was not exact',
    );
  }
  const auditTypes = new Set(
    audit.events.map((event) => event.eventType),
  );
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
    throw new Error(
      'Restored MySQL emergency audit was absent or unsafe',
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
      callId: 'mysql-restore-storage-read-1',
      key: 'case/Key',
    }),
    storage.execute({
      ...storageBase,
      callId: 'mysql-restore-storage-read-2',
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
      'Restored MySQL storage lost UTF-8 content, revision, or key case separation',
    );
  }

  const [{ deliveredEvents }] = await restored.query(
    `SELECT COUNT(*) AS deliveredEvents
       FROM plugin_event_deliveries
      WHERE status = 'delivered'`,
  );
  const [{ unsafeDeliveredPayloads }] = await restored.query(
    `SELECT COUNT(*) AS unsafeDeliveredPayloads
       FROM plugin_event_deliveries
      WHERE status = 'delivered'
        AND event_json <> '{}'`,
  );
  if (
    Number(deliveredEvents) < 1 ||
    Number(unsafeDeliveredPayloads) !== 0
  ) {
    throw new Error(
      'Restored MySQL delivered events retained unsafe payload state',
    );
  }

  const [{ activeGatewayLeases }] = await restored.query(
    'SELECT COUNT(*) AS activeGatewayLeases FROM plugin_gateway_concurrency_leases',
  );
  const [{ activeEventLeases }] = await restored.query(
    `SELECT COUNT(*) AS activeEventLeases
      FROM plugin_event_deliveries
      WHERE lease_owner IS NOT NULL
         OR lease_expires_at IS NOT NULL`,
  );
  const [{ activeScheduleLeases }] = await restored.query(
    `SELECT COUNT(*) AS activeScheduleLeases
      FROM plugin_scheduled_jobs
      WHERE lease_owner IS NOT NULL
         OR lease_expires_at IS NOT NULL`,
  );
  if (
    Number(activeGatewayLeases) !== 0 ||
    Number(activeEventLeases) !== 0 ||
    Number(activeScheduleLeases) !== 0
  ) {
    throw new Error(
      'Restored MySQL database retained active runtime leases',
    );
  }

  const disabled = await control.setEmergencyDisabled({
    disabled: true,
    expectedRevision: 2,
    idempotencyKey: 'mysql-restored-emergency-disable-0001',
    actorRef: 'restore-admin',
    correlationId: 'mysql-restore-emergency-1',
  });
  if (!disabled.disabled || disabled.revision !== 3) {
    throw new Error(
      'Restored MySQL emergency control could not advance safely',
    );
  }
  const restarted = createControl(
    restored,
    '2026-07-27T03:01:00.000Z',
  );
  const afterRestart = await restarted.getEmergencyState();
  if (!afterRestart.disabled || afterRestart.revision !== 3) {
    throw new Error(
      'Post-restore MySQL emergency state did not survive restart',
    );
  }
  const resumed = await restarted.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 3,
    idempotencyKey: 'mysql-restored-emergency-resume-0001',
    actorRef: 'restore-admin',
    correlationId: 'mysql-restore-emergency-2',
  });
  if (resumed.disabled || resumed.revision !== 4) {
    throw new Error(
      'Post-restore MySQL emergency control could not resume safely',
    );
  }

  const deploymentDisabled = await restarted.setDeploymentEnabled({
    pluginId: sourceRecord.pluginId,
    enabled: false,
    expectedRevision: 0,
    idempotencyKey: 'mysql-restored-plugin-disable-0001',
    actorRef: 'restore-admin',
    correlationId: 'mysql-restore-plugin-disable-1',
  });
  const disabledPlugin = await restarted.get(sourceRecord.pluginId);
  if (
    deploymentDisabled.status !== 'succeeded' ||
    disabledPlugin?.enabled ||
    disabledPlugin?.revision !== 1
  ) {
    throw new Error(
      'Restored MySQL plugin control could not accept a safe disable mutation',
    );
  }
  const deploymentEnabled = await restarted.setDeploymentEnabled({
    pluginId: sourceRecord.pluginId,
    enabled: true,
    expectedRevision: 1,
    idempotencyKey: 'mysql-restored-plugin-enable-0001',
    actorRef: 'restore-admin',
    correlationId: 'mysql-restore-plugin-enable-1',
  });
  if (
    deploymentEnabled.status !== 'succeeded' ||
    !(await restarted.isExecutionAllowed(
      sourceRecord.pluginId,
      'default-tenant-id',
    ))
  ) {
    throw new Error(
      'Restored MySQL plugin control could not resume execution',
    );
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'mysql',
      logicalBackupRestore: true,
      restoredPluginTables: 19,
      restoredEmergencyRevision: 2,
      restoredDesiredState: true,
      restoredTenantState: true,
      restoredCaseSensitiveUtf8Storage: true,
      restoredDeliveredPayloadsErased: true,
      restoredActiveGatewayLeases: 0,
      restoredActiveEventLeases: 0,
      restoredActiveScheduleLeases: 0,
      postRestoreEmergencyRestart: true,
      postRestoreSafeMutation: true,
    }),
  );
} finally {
  await restored.destroy();
}

function createControl(dataSource, timestamp) {
  return new PluginControlPlaneV1(
    controlSource,
    new DatabasePluginControlStoreV1(async () => dataSource),
    {
      defaultTenantRef: 'default-tenant-id',
      now: () => new Date(timestamp),
    },
  );
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
