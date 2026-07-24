import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  closeDataSource,
  getDataSource,
} from '@enterpriseglue/shared/db/data-source.js';
import {
  runMigrations,
} from '@enterpriseglue/shared/db/run-migrations.js';
import {
  AddEngineTenancyFoundation1700000000096,
} from '@enterpriseglue/shared/db/migrations/1700000000096-add-engine-tenancy-foundation.js';
import {
  AddEngineTenantMappingReference1700000000097,
} from '@enterpriseglue/shared/db/migrations/1700000000097-add-engine-tenant-mapping-reference.js';
import {
  AddCamundaNativeGrantImportRuns1700000000098,
} from '@enterpriseglue/shared/db/migrations/1700000000098-add-camunda-native-grant-import-runs.js';
import {
  AddCamundaNativeGrantRollbackReceipt1700000000099,
} from '@enterpriseglue/shared/db/migrations/1700000000099-add-camunda-native-grant-rollback-receipt.js';
import {
  WidenCamundaNativeGrantEvidence1700000000100,
} from '@enterpriseglue/shared/db/migrations/1700000000100-widen-camunda-native-grant-evidence.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { CamundaNativeGrantImportRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/CamundaNativeGrantImportRun.js';
import {
  engineTenantMappingService,
} from '@enterpriseglue/shared/services/platform-admin/EngineTenantMappingService.js';

const backendDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(backendDirectory, '..');
const contract = JSON.parse(readFileSync(
  path.join(root, 'test/database/engine-tenancy-database-matrix-contract.json'),
  'utf8',
));
const database = process.env.DATABASE_TYPE;
const outputPath = process.env.ENGINE_TENANCY_DATABASE_OBSERVATION;

assert.ok(contract.databases[database], `Unsupported qualification database: ${database}`);
assert.ok(outputPath, 'ENGINE_TENANCY_DATABASE_OBSERVATION is required');

const stage = () => ({ status: 'pending' });
const observation = {
  schemaVersion: 1,
  evidenceKind: 'engine-tenancy-database-observation',
  database,
  status: 'failed',
  databaseVersion: '',
  schemaFingerprint: '',
  logicalSchema: null,
  stages: Object.fromEntries(contract.requiredStages.map((name) => [name, stage()])),
  sanitization: {
    containsCredentials: false,
    containsTokens: false,
    containsPrivateEndpoints: false,
    containsRawIdentityClaims: false,
    containsCustomerIdentifiers: false,
  },
};

const runId = `dbq-${database}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  legacyEngine: `${runId}-legacy-engine`,
  legacyResource: `${runId}-legacy-resource`,
  serviceEngine: `${runId}-service-engine`,
  serviceResource: `${runId}-service-resource`,
  rollbackMapping: `${runId}-rollback-mapping`,
  rollbackImportRun: `${runId}-rollback-import-run`,
};

function normalizeName(value) {
  return String(value || '')
    .replaceAll('"', '')
    .replaceAll('`', '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .split('.')
    .at(-1)
    .toLowerCase();
}

function metadataPath(dataSource, entity) {
  return dataSource.getMetadata(entity).tablePath;
}

async function tableDetails(queryRunner, dataSource, entity, contractName) {
  const table = await queryRunner.getTable(metadataPath(dataSource, entity));
  assert.ok(table, `${database}: missing ${contractName}`);
  const columns = new Map(table.columns.map((column) => [
    normalizeName(column.name),
    {
      name: normalizeName(column.name),
      nullable: Boolean(column.isNullable),
      primary: Boolean(column.isPrimary),
    },
  ]));
  for (const requiredColumn of contract.requiredTables[contractName]) {
    assert.ok(columns.has(requiredColumn), `${database}: ${contractName}.${requiredColumn} is missing`);
  }

  const indexes = new Set([
    ...table.indices.map((index) => normalizeName(index.name)),
    ...table.uniques.map((unique) => normalizeName(unique.name)),
  ]);
  for (const requiredIndex of contract.requiredIndexes[contractName] || []) {
    assert.ok(indexes.has(requiredIndex), `${database}: ${contractName}.${requiredIndex} is missing`);
  }

  return {
    table: contractName,
    columns: contract.requiredTables[contractName].map((name) => columns.get(name)),
    indexes: [...(contract.requiredIndexes[contractName] || [])].sort(),
  };
}

async function logicalSchema(queryRunner, dataSource) {
  const value = {
    tables: [
      await tableDetails(queryRunner, dataSource, Engine, 'engines'),
      await tableDetails(queryRunner, dataSource, EngineTenantMapping, 'engine_tenant_mappings'),
      await tableDetails(queryRunner, dataSource, RuntimeResource, 'runtime_resources'),
      await tableDetails(queryRunner, dataSource, CamundaNativeGrantImportRun, 'camunda_native_grant_import_runs'),
    ],
  };
  value.tables.sort((left, right) => left.table.localeCompare(right.table));
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function databaseVersion(queryRunner) {
  if (database === 'postgres') {
    const [row] = await queryRunner.query('SELECT version() AS version');
    return String(row.version);
  }
  if (database === 'mysql') {
    const [row] = await queryRunner.query('SELECT VERSION() AS version');
    return String(row.version);
  }
  if (database === 'mssql') {
    const [row] = await queryRunner.query(
      "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version",
    );
    return String(row.version);
  }
  if (database === 'oracle') {
    const [row] = await queryRunner.query(
      "SELECT version AS \"version\" FROM product_component_version WHERE product LIKE 'Oracle Database%' FETCH FIRST 1 ROWS ONLY",
    );
    return String(row.version);
  }
  return process.env.ENGINE_TENANCY_DATABASE_VERSION_HINT || contract.databases.spanner.image;
}

function engineRow(id, overrides = {}) {
  const now = Date.now();
  return {
    id,
    name: id,
    baseUrl: 'http://engine.invalid',
    type: 'camunda7',
    authType: 'none',
    runtimeAccessScope: 'engine_wide',
    tenancyMode: 'dedicated',
    tenantMappingStrategy: null,
    tenantMappingVersion: 0,
    tenantResolutionStatus: 'ready',
    deploymentIntegration: 'enterpriseglue_proxy',
    metadataDiscoveryEnabled: false,
    deploymentDiscoveryEnabled: false,
    reconciliationIntervalSeconds: 300,
    pipelineReceiptEnabled: false,
    connectionMode: 'direct',
    environmentLocked: false,
    tenantId: 'tenant-default',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function resourceRow(id, engineId, overrides = {}) {
  const now = Date.now();
  return {
    id,
    tenantId: 'tenant-default',
    tenantResolutionStatus: 'resolved',
    tenantMappingId: null,
    tenantMappingVersion: 0,
    tenantResolutionDetailsJson: JSON.stringify({ code: 'dedicated_engine' }),
    engineId,
    resourceKind: 'process_definition',
    resourceKey: `${id}-key`,
    runtimeTenantId: '',
    labelsJson: '{}',
    lineageJson: '{}',
    source: 'database_qualification',
    observedAt: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function assertColumn(queryRunner, dataSource, entity, name, expected) {
  assert.equal(
    await queryRunner.hasColumn(metadataPath(dataSource, entity), name),
    expected,
    `${database}: expected ${dataSource.getMetadata(entity).tableName}.${name} present=${expected}`,
  );
}

async function seedLegacyRows(dataSource) {
  await dataSource.getRepository(Engine).insert(engineRow(ids.legacyEngine));
  await dataSource.getRepository(RuntimeResource).insert(resourceRow(
    ids.legacyResource,
    ids.legacyEngine,
  ));
}

async function qualifyUpgradeBaselines(queryRunner, dataSource, expectedFingerprint) {
  const foundation = new AddEngineTenancyFoundation1700000000096();
  const reference = new AddEngineTenantMappingReference1700000000097();
  const importRuns = new AddCamundaNativeGrantImportRuns1700000000098();
  const rollbackReceipt = new AddCamundaNativeGrantRollbackReceipt1700000000099();
  const widenEvidence = new WidenCamundaNativeGrantEvidence1700000000100();
  await seedLegacyRows(dataSource);

  // Simulate an upgrade from immediately before the native-grant importer,
  // including the idempotent receipt-column follow-up migration.
  await rollbackReceipt.down(queryRunner);
  await importRuns.down(queryRunner);
  await assertColumn(queryRunner, dataSource, CamundaNativeGrantImportRun, 'rollback_config_bundle_run_id', false);
  await importRuns.up(queryRunner);
  await rollbackReceipt.up(queryRunner);
  await widenEvidence.up(queryRunner);
  await assertColumn(queryRunner, dataSource, CamundaNativeGrantImportRun, 'rollback_config_bundle_run_id', true);
  await assertColumn(queryRunner, dataSource, CamundaNativeGrantImportRun, 'rolled_back_at', true);
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: native-grant receipt upgrade schema differs from clean install`,
  );

  await reference.down(queryRunner);
  await assertColumn(queryRunner, dataSource, EngineTenantMapping, 'tenant_reference_json', false);
  await reference.up(queryRunner);
  await assertColumn(queryRunner, dataSource, EngineTenantMapping, 'tenant_reference_json', true);
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: foundation-v1 upgrade schema differs from clean install`,
  );

  await reference.down(queryRunner);
  await foundation.down(queryRunner);
  await assertColumn(queryRunner, dataSource, Engine, 'tenancy_mode', false);
  await assertColumn(queryRunner, dataSource, RuntimeResource, 'tenant_resolution_status', false);

  await foundation.up(queryRunner);
  await reference.up(queryRunner);
  const upgradedEngine = await dataSource.getRepository(Engine).findOneByOrFail({ id: ids.legacyEngine });
  const upgradedResource = await dataSource.getRepository(RuntimeResource).findOneByOrFail({
    id: ids.legacyResource,
  });
  assert.equal(upgradedEngine.tenancyMode, 'dedicated');
  assert.equal(upgradedEngine.tenantResolutionStatus, 'ready');
  assert.equal(upgradedResource.tenantResolutionStatus, 'resolved');
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: pre-tenancy upgrade schema differs from clean install`,
  );

  observation.stages.upgrade_baselines = {
    status: 'passed',
    total: contract.upgradeBaselines.length,
    passed: contract.upgradeBaselines.length,
    baselines: contract.upgradeBaselines.map(({ id }) => ({ id, status: 'passed' })),
  };
}

async function qualifyInterruptedRetry(queryRunner, dataSource, expectedFingerprint) {
  const foundation = new AddEngineTenancyFoundation1700000000096();
  const reference = new AddEngineTenantMappingReference1700000000097();
  const importRuns = new AddCamundaNativeGrantImportRuns1700000000098();
  const rollbackReceipt = new AddCamundaNativeGrantRollbackReceipt1700000000099();
  const widenEvidence = new WidenCamundaNativeGrantEvidence1700000000100();
  const engines = await queryRunner.getTable(metadataPath(dataSource, Engine));
  const resources = await queryRunner.getTable(metadataPath(dataSource, RuntimeResource));
  const engineIndex = engines?.indices.find((candidate) =>
    normalizeName(candidate.name) === 'idx_engines_tenant_resolution_status');
  const resourceIndex = resources?.indices.find((candidate) =>
    normalizeName(candidate.name) === 'idx_runtime_resources_tenant_resolution');
  if (engineIndex) await queryRunner.dropIndex(metadataPath(dataSource, Engine), engineIndex);
  if (resourceIndex) await queryRunner.dropIndex(metadataPath(dataSource, RuntimeResource), resourceIndex);
  await rollbackReceipt.down(queryRunner);
  await importRuns.down(queryRunner);

  await foundation.up(queryRunner);
  await reference.up(queryRunner);
  await importRuns.up(queryRunner);
  await rollbackReceipt.up(queryRunner);
  await widenEvidence.up(queryRunner);
  await foundation.up(queryRunner);
  await reference.up(queryRunner);
  await importRuns.up(queryRunner);
  await rollbackReceipt.up(queryRunner);
  await widenEvidence.up(queryRunner);
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: interrupted/retried migration schema differs from clean install`,
  );
  observation.stages.interrupted_retry = {
    status: 'passed',
    simulatedInterruption: 'foundation indexes absent after column/table changes',
    retryExecutions: 2,
  };
}

async function qualifyServiceBehavior(dataSource) {
  await dataSource.getRepository(Engine).insert(engineRow(ids.serviceEngine, {
    runtimeAccessScope: 'resource_aware',
    tenancyMode: 'shared',
    tenantId: null,
    tenantMappingStrategy: 'engine_tenant_id',
    tenantResolutionStatus: 'incomplete',
  }));
  await dataSource.getRepository(RuntimeResource).insert(resourceRow(
    ids.serviceResource,
    ids.serviceEngine,
    {
      tenantId: null,
      tenantResolutionStatus: 'unmapped',
      tenantResolutionDetailsJson: JSON.stringify({ code: 'tenant_mapping_not_found' }),
      runtimeTenantId: 'runtime-a',
    },
  ));

  const first = await engineTenantMappingService.upsert({
    engineId: ids.serviceEngine,
    request: {
      expectedMappingVersion: 0,
      mappings: [{
        externalTenantId: 'runtime-a',
        tenantRef: { type: 'default' },
        strategy: 'engine_tenant_id',
        sourceRef: `${runId}:runtime-a`,
        active: true,
      }],
    },
    requestTenantId: 'tenant-default',
    principalType: 'system',
    principalId: runId,
    source: 'manual',
    ownershipMode: 'manual',
  });
  assert.equal(first.created, 1);
  assert.equal(first.mappingVersion, 1);
  assert.equal(first.diagnostics.resolutionStatus, 'ready');
  assert.equal(first.diagnostics.mappedResourceCount, 1);

  const retry = await engineTenantMappingService.upsert({
    engineId: ids.serviceEngine,
    request: {
      expectedMappingVersion: 1,
      mappings: [{
        externalTenantId: 'runtime-a',
        tenantRef: { type: 'default' },
        strategy: 'engine_tenant_id',
        sourceRef: `${runId}:runtime-a`,
        active: true,
      }],
    },
    requestTenantId: 'tenant-default',
    principalType: 'system',
    principalId: runId,
    source: 'manual',
    ownershipMode: 'manual',
  });
  assert.equal(retry.unchanged, 1);
  assert.equal(retry.mappingVersion, 1);
  assert.equal(await dataSource.getRepository(EngineTenantMapping).countBy({
    engineId: ids.serviceEngine,
  }), 1);
  const resource = await dataSource.getRepository(RuntimeResource).findOneByOrFail({
    id: ids.serviceResource,
  });
  assert.equal(resource.tenantId, 'tenant-default');
  assert.equal(resource.tenantResolutionStatus, 'resolved');

  observation.stages.service_behavior = {
    status: 'passed',
    assertions: [
      'shared mapping create is atomic',
      'runtime inventory resolves to the mapped tenant',
      'same-version retry is idempotent',
      'mapping version advances exactly once',
    ],
  };
}

async function qualifyRollback(dataSource) {
  const before = await dataSource.getRepository(RuntimeResource).findOneByOrFail({
    id: ids.serviceResource,
  });
  const marker = new Error('qualification rollback marker');
  await assert.rejects(
    dataSource.transaction(async (manager) => {
      const now = Date.now();
      await manager.getRepository(EngineTenantMapping).insert({
        id: ids.rollbackMapping,
        engineId: ids.serviceEngine,
        externalTenantId: 'rollback-only',
        enterpriseTenantId: 'tenant-default',
        tenantReferenceJson: JSON.stringify({ type: 'default' }),
        strategy: 'engine_tenant_id',
        source: 'manual',
        sourceRef: `${runId}:rollback`,
        ownershipMode: 'manual',
        sourceHash: null,
        lastAppliedAt: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await manager.getRepository(RuntimeResource).update(
        { id: ids.serviceResource },
        {
          tenantId: null,
          tenantResolutionStatus: 'conflict',
          tenantResolutionDetailsJson: JSON.stringify({ code: 'rollback_marker' }),
          updatedAt: now,
        },
      );
      await manager.getRepository(CamundaNativeGrantImportRun).insert({
        id: ids.rollbackImportRun,
        engineId: ids.serviceEngine,
        tenantId: 'tenant-default',
        sourceKind: 'live_api',
        status: 'previewed',
        inputHash: '0'.repeat(64),
        mappingCatalogVersion: 'database-qualification',
        inventoryTruncated: false,
        normalizedCountsJson: '{}',
        classificationsJson: '[]',
        encryptedDetailedSnapshot: null,
        detailedSnapshotExpiresAt: null,
        draftHash: null,
        createdById: null,
        approvedById: null,
        approvedAt: null,
        appliedConfigBundleRunId: null,
        rollbackConfigBundleRunId: null,
        rolledBackAt: null,
        createdAt: now,
        updatedAt: now,
      });
      throw marker;
    }),
    (error) => error === marker,
  );
  assert.equal(await dataSource.getRepository(EngineTenantMapping).countBy({
    id: ids.rollbackMapping,
  }), 0);
  assert.equal(await dataSource.getRepository(CamundaNativeGrantImportRun).countBy({
    id: ids.rollbackImportRun,
  }), 0);
  const after = await dataSource.getRepository(RuntimeResource).findOneByOrFail({
    id: ids.serviceResource,
  });
  assert.equal(after.tenantId, before.tenantId);
  assert.equal(after.tenantResolutionStatus, before.tenantResolutionStatus);
  assert.equal(after.tenantResolutionDetailsJson, before.tenantResolutionDetailsJson);
  observation.stages.rollback = {
    status: 'passed',
    retainedMetadata: true,
    assertions: [
      'failed mapping write leaves no row',
      'failed native-grant receipt write leaves no row',
      'tenant resolution and diagnostic metadata remain unchanged',
    ],
  };
}

async function qualifyCleanup(dataSource) {
  const mappingRepository = dataSource.getRepository(EngineTenantMapping);
  const resourceRepository = dataSource.getRepository(RuntimeResource);
  const engineRepository = dataSource.getRepository(Engine);
  await mappingRepository.delete({ engineId: ids.serviceEngine });
  await resourceRepository.delete({ id: ids.serviceResource });
  await engineRepository.delete({ id: ids.serviceEngine });
  await resourceRepository.delete({ id: ids.legacyResource });
  await engineRepository.delete({ id: ids.legacyEngine });
  assert.equal(await mappingRepository.countBy({ engineId: ids.serviceEngine }), 0);
  assert.equal(await resourceRepository.countBy({ id: ids.serviceResource }), 0);
  assert.equal(await engineRepository.countBy({ id: ids.serviceEngine }), 0);
  assert.equal(await resourceRepository.countBy({ id: ids.legacyResource }), 0);
  assert.equal(await engineRepository.countBy({ id: ids.legacyEngine }), 0);
  observation.stages.cleanup = {
    status: 'passed',
    ownedRowsRemaining: 0,
  };
}

function retainObservation() {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(observation, null, 2)}\n`);
}

try {
  await runMigrations();
  const dataSource = await getDataSource();
  const queryRunner = dataSource.createQueryRunner();
  try {
    observation.databaseVersion = await databaseVersion(queryRunner);
    const cleanSchema = await logicalSchema(queryRunner, dataSource);
    const cleanFingerprint = fingerprint(cleanSchema);
    observation.logicalSchema = cleanSchema;
    observation.schemaFingerprint = cleanFingerprint;
    observation.stages.clean_install = {
      status: 'passed',
      currentSchemaCreated: true,
      requiredTables: Object.keys(contract.requiredTables).length,
    };
    await qualifyUpgradeBaselines(queryRunner, dataSource, cleanFingerprint);
    await qualifyInterruptedRetry(queryRunner, dataSource, cleanFingerprint);
    observation.stages.schema_equivalence = {
      status: 'passed',
      logicalFingerprint: cleanFingerprint,
      cleanInstallEqualsAllUpgradePaths: true,
    };
    await qualifyServiceBehavior(dataSource);
    await qualifyRollback(dataSource);
    await qualifyCleanup(dataSource);
    observation.status = contract.requiredStages.every(
      (name) => observation.stages[name]?.status === 'passed',
    ) ? 'passed' : 'failed';
  } finally {
    await queryRunner.release();
  }
} catch (error) {
  observation.error = {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
} finally {
  try {
    await closeDataSource();
  } catch {
    // Preserve the qualification error; the container is disposable.
  }
  retainObservation();
}

if (observation.status !== 'passed') {
  process.exitCode = 1;
}
