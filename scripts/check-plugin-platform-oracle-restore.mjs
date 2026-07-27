import { createRequire } from 'node:module';

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

const schema = safeOracleIdentifier(
  requiredEnvironment('ORACLE_SCHEMA'),
  'ORACLE_SCHEMA',
);
const restored = new DataSource({
  type: 'oracle',
  username: requiredEnvironment('ORACLE_USER'),
  password: requiredEnvironment('ORACLE_PASSWORD'),
  connectString:
    `${requiredEnvironment('ORACLE_HOST')}:` +
    `${requiredEnvironment('ORACLE_PORT')}/` +
    requiredEnvironment('ORACLE_SERVICE_NAME'),
  schema,
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
  const [tableState] = await restored.query(
    `SELECT COUNT(*) AS "table_count"
       FROM user_tables
      WHERE LOWER(table_name) LIKE 'plugin_%'`,
  );
  if (Number(tableState?.table_count) !== 19) {
    throw new Error(
      'Restored Oracle plugin platform did not contain all nineteen tables',
    );
  }

  const control = createControl(restored, '2026-07-27T08:00:00.000Z');
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
      'Restored Oracle emergency revision/state was not exact',
    );
  }
  if (!plugin?.enabled || plugin.revision !== 0) {
    throw new Error(
      'Restored Oracle plugin desired state/revision was not exact',
    );
  }
  if (!tenant.enabled || tenant.revision !== 0) {
    throw new Error(
      'Restored Oracle tenant desired state/revision was not exact',
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
      'Restored Oracle emergency audit was absent or unsafe',
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
      callId: 'oracle-restore-storage-read-1',
      key: 'case/Key',
    }),
    storage.execute({
      ...storageBase,
      callId: 'oracle-restore-storage-read-2',
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
      'Restored Oracle storage lost Unicode content, revision, or key case separation',
    );
  }

  const [eventState] = await restored.query(
    `SELECT
       SUM(CASE WHEN "status" = 'delivered' THEN 1 ELSE 0 END)
         AS "delivered_events",
       SUM(
         CASE
           WHEN "status" = 'delivered'
            AND DBMS_LOB.COMPARE("event_json", TO_CLOB('{}')) <> 0
           THEN 1
           ELSE 0
         END
       ) AS "unsafe_delivered_payloads",
       SUM(
         CASE
           WHEN "lease_owner" IS NOT NULL
             OR "lease_expires_at" IS NOT NULL
           THEN 1
           ELSE 0
         END
       ) AS "active_event_leases"
      FROM "${schema}"."plugin_event_deliveries"`,
  );
  const [gatewayState] = await restored.query(
    `SELECT COUNT(*) AS "active_gateway_leases"
       FROM "${schema}"."plugin_gateway_concurrency_leases"`,
  );
  const [scheduleState] = await restored.query(
    `SELECT
       SUM(
         CASE
           WHEN "lease_owner" IS NOT NULL
             OR "lease_expires_at" IS NOT NULL
           THEN 1
           ELSE 0
         END
       ) AS "active_schedule_leases"
       FROM "${schema}"."plugin_scheduled_jobs"`,
  );
  if (
    Number(eventState?.delivered_events) < 1 ||
    Number(eventState?.unsafe_delivered_payloads) !== 0 ||
    Number(eventState?.active_event_leases) !== 0 ||
    Number(gatewayState?.active_gateway_leases) !== 0 ||
    Number(scheduleState?.active_schedule_leases) !== 0
  ) {
    throw new Error(
      'Restored Oracle database lost payload-erasure or lease invariants',
    );
  }

  const disabled = await control.setEmergencyDisabled({
    disabled: true,
    expectedRevision: 2,
    idempotencyKey: 'oracle-restored-emergency-disable-0001',
    actorRef: 'restore-admin',
    correlationId: 'oracle-restore-emergency-1',
  });
  if (!disabled.disabled || disabled.revision !== 3) {
    throw new Error(
      'Restored Oracle emergency control could not advance safely',
    );
  }
  const restarted = createControl(
    restored,
    '2026-07-27T08:01:00.000Z',
  );
  const afterRestart = await restarted.getEmergencyState();
  if (!afterRestart.disabled || afterRestart.revision !== 3) {
    throw new Error(
      'Post-restore Oracle emergency state did not survive restart',
    );
  }
  const resumed = await restarted.setEmergencyDisabled({
    disabled: false,
    expectedRevision: 3,
    idempotencyKey: 'oracle-restored-emergency-resume-0001',
    actorRef: 'restore-admin',
    correlationId: 'oracle-restore-emergency-2',
  });
  if (resumed.disabled || resumed.revision !== 4) {
    throw new Error(
      'Post-restore Oracle emergency control could not resume safely',
    );
  }

  const deploymentDisabled = await restarted.setDeploymentEnabled({
    pluginId: sourceRecord.pluginId,
    enabled: false,
    expectedRevision: 0,
    idempotencyKey: 'oracle-restored-plugin-disable-0001',
    actorRef: 'restore-admin',
    correlationId: 'oracle-restore-plugin-disable-1',
  });
  const disabledPlugin = await restarted.get(sourceRecord.pluginId);
  if (
    deploymentDisabled.status !== 'succeeded' ||
    disabledPlugin?.enabled ||
    disabledPlugin?.revision !== 1
  ) {
    throw new Error(
      'Restored Oracle plugin control could not accept a safe disable mutation',
    );
  }
  const deploymentEnabled = await restarted.setDeploymentEnabled({
    pluginId: sourceRecord.pluginId,
    enabled: true,
    expectedRevision: 1,
    idempotencyKey: 'oracle-restored-plugin-enable-0001',
    actorRef: 'restore-admin',
    correlationId: 'oracle-restore-plugin-enable-1',
  });
  if (
    deploymentEnabled.status !== 'succeeded' ||
    !(await restarted.isExecutionAllowed(
      sourceRecord.pluginId,
      'default-tenant-id',
    ))
  ) {
    throw new Error(
      'Restored Oracle plugin control could not resume execution',
    );
  }

  console.log(
    JSON.stringify({
      status: 'passed',
      database: 'oracle',
      dataPumpBackupRestore: true,
      restoredPluginTables: 19,
      restoredEmergencyRevision: 2,
      restoredDesiredState: true,
      restoredTenantState: true,
      restoredCaseSensitiveUnicodeStorage: true,
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
