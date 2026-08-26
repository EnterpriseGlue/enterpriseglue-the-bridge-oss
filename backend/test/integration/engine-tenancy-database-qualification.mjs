import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
import {
  AddIdentityMappingOwnershipMode1700000000104,
} from '@enterpriseglue/shared/db/migrations/1700000000104-add-identity-mapping-ownership-mode.js';
import {
  AddPlatformGovernanceSettingsOwnership1700000000105,
} from '@enterpriseglue/shared/db/migrations/1700000000105-add-platform-governance-settings-ownership.js';
import {
  AddLoginExperienceMetadata1700000000106,
} from '@enterpriseglue/shared/db/migrations/1700000000106-add-login-experience-metadata.js';
import {
  ConsolidateLoginProviderPreference1700000000107,
} from '@enterpriseglue/shared/db/migrations/1700000000107-consolidate-login-provider-preference.js';
import {
  AddExternalEngineRegistrationIdentities1700000000108,
} from '@enterpriseglue/shared/db/migrations/1700000000108-add-external-engine-registration-identities.js';
import {
  RequireProjectTenantOwnership1700000000109,
} from '@enterpriseglue/shared/db/migrations/1700000000109-require-project-tenant-ownership.js';
import {
  AddNativeSaasTenancy1700000000124,
} from '@enterpriseglue/shared/db/migrations/1700000000124-add-native-saas-tenancy.js';
import {
  BackfillNativeTenantOwnership1700000000125,
} from '@enterpriseglue/shared/db/migrations/1700000000125-backfill-native-tenant-ownership.js';
import {
  AddPostgresTenantRls1700000000126,
} from '@enterpriseglue/shared/db/migrations/1700000000126-add-postgres-tenant-rls.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { CamundaNativeGrantImportRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/CamundaNativeGrantImportRun.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { PermissionGrant } from '@enterpriseglue/shared/infrastructure/persistence/entities/PermissionGrant.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { TenantDomain } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantDomain.js';
import { TenantDiscoveryDomain } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantDiscoveryDomain.js';
import { TenantDiscoveryChallenge } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantDiscoveryChallenge.js';
import { TenantLoginPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLoginPolicy.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
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

const runId = `dbq-${database}-${Date.now()}-${randomUUID().slice(0, 8)}`;
const ids = {
  legacyEngine: `${runId}-legacy-engine`,
  legacyResource: `${runId}-legacy-resource`,
  serviceEngine: `${runId}-service-engine`,
  serviceResource: `${runId}-service-resource`,
  rollbackMapping: `${runId}-rollback-mapping`,
  rollbackImportRun: `${runId}-rollback-import-run`,
  migrationProvider: `${runId}-migration-provider`,
  migrationGroup: `${runId}-migration-group`,
  migrationMapping: `${runId}-migration-mapping`,
  migrationExternalRegistration: `${runId}-external-registration`,
  migrationProject: `${runId}-project`,
  migrationProjectTarget: `${runId}-project-target`,
  migrationProjectAssignment: `${runId}-project-assignment`,
  migrationProjectGrant: `${runId}-project-grant`,
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
      await tableDetails(queryRunner, dataSource, IdentityEntitlementMapping, 'identity_entitlement_mappings'),
      await tableDetails(queryRunner, dataSource, IdentityProvider, 'identity_providers'),
      await tableDetails(queryRunner, dataSource, PlatformSettings, 'platform_settings'),
      await tableDetails(queryRunner, dataSource, ExternalEngineRegistration, 'external_engine_registrations'),
      await tableDetails(queryRunner, dataSource, Project, 'projects'),
      await tableDetails(queryRunner, dataSource, ProjectEngineTarget, 'project_engine_targets'),
      await tableDetails(queryRunner, dataSource, RbacRoleAssignment, 'role_assignments'),
      await tableDetails(queryRunner, dataSource, PermissionGrant, 'permission_grants'),
      await tableDetails(queryRunner, dataSource, Tenant, 'tenants'),
      await tableDetails(queryRunner, dataSource, TenantDomain, 'tenant_domains'),
      await tableDetails(queryRunner, dataSource, TenantDiscoveryDomain, 'tenant_discovery_domains'),
      await tableDetails(queryRunner, dataSource, TenantDiscoveryChallenge, 'tenant_discovery_challenges'),
      await tableDetails(queryRunner, dataSource, TenantLoginPolicy, 'tenant_login_policies'),
      await tableDetails(queryRunner, dataSource, RefreshToken, 'refresh_tokens'),
      await tableDetails(queryRunner, dataSource, Invitation, 'invitations'),
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

function entityRowWithDefaults(dataSource, entity, overrides) {
  const row = { ...overrides };
  for (const column of dataSource.getMetadata(entity).columns) {
    const property = column.propertyName;
    if (Object.prototype.hasOwnProperty.call(row, property)) continue;
    if (column.isNullable) {
      row[property] = null;
      continue;
    }
    if (column.default !== undefined) {
      row[property] = typeof column.default === 'function'
        ? column.default()
        : column.default;
      continue;
    }
    throw new Error(`${database}: qualification seed has no value for ${entity.name}.${property}`);
  }
  return row;
}

async function seedRecentMigrationRows(dataSource) {
  const now = Date.now();
  await dataSource.getRepository(AuthzGroup).insert({
    id: ids.migrationGroup,
    tenantId: null,
    key: ids.migrationGroup,
    groupKeyIdentity: `default:${ids.migrationGroup}`,
    name: 'Migration qualification group',
    description: null,
    source: 'database_qualification',
    sourceRef: runId,
    ownershipMode: 'manual',
    sourceHash: null,
    lastAppliedAt: null,
    driftStatus: null,
    isSystem: false,
    isArchived: false,
    createdById: null,
    createdAt: now,
    updatedAt: now,
  });
  await dataSource.getRepository(IdentityProvider).insert({
    id: ids.migrationProvider,
    tenantId: null,
    key: ids.migrationProvider,
    displayName: 'Discarded pre-migration display name',
    organization: 'Qualification',
    displayOrder: 99,
    isPreferred: true,
    preferredScopeIdentity: 'preferred:platform',
    loginDomainsJson: '["before.invalid"]',
    providerKeyIdentity: `default:${ids.migrationProvider}`,
    protocol: 'oidc',
    isEnabled: false,
    authenticationMode: 'claims_only',
    directoryTenantId: null,
    configurationJson: '{}',
    syncJson: '{}',
    ownershipMode: 'manual',
    sourceRef: runId,
    sourceHash: null,
    lastAppliedAt: null,
    driftStatus: null,
    createdAt: now,
    updatedAt: now,
  });
  await dataSource.getRepository(IdentityEntitlementMapping).insert({
    id: ids.migrationMapping,
    tenantId: null,
    providerId: ids.migrationProvider,
    configKey: ids.migrationMapping,
    configKeyIdentity: `default:${ids.migrationMapping}`,
    sourceRef: runId,
    ownershipMode: 'manual',
    sourceHash: null,
    lastAppliedAt: null,
    driftStatus: null,
    entitlementType: 'group',
    externalId: 'qualification-group',
    matchOperator: 'exact',
    targetGroupId: ids.migrationGroup,
    syncMode: 'authoritative',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await dataSource.getRepository(PlatformSettings).insert(entityRowWithDefaults(
    dataSource,
    PlatformSettings,
    { id: 'default', updatedAt: now, updatedById: null },
  ));
}

async function qualifyRecentMigrationBaselines(queryRunner, dataSource, expectedFingerprint) {
  const mappingOwnership = new AddIdentityMappingOwnershipMode1700000000104();
  const governanceOwnership = new AddPlatformGovernanceSettingsOwnership1700000000105();
  const loginExperience = new AddLoginExperienceMetadata1700000000106();
  const providerPreference = new ConsolidateLoginProviderPreference1700000000107();

  await seedRecentMigrationRows(dataSource);
  await providerPreference.down(queryRunner);
  await loginExperience.down(queryRunner);
  await governanceOwnership.down(queryRunner);
  await mappingOwnership.down(queryRunner);

  await assertColumn(queryRunner, dataSource, IdentityEntitlementMapping, 'ownership_mode', false);
  await assertColumn(queryRunner, dataSource, PlatformSettings, 'access_governance_ownership_mode', false);
  await assertColumn(queryRunner, dataSource, IdentityProvider, 'display_name', false);
  await assertColumn(queryRunner, dataSource, IdentityProvider, 'preferred_scope_identity', false);
  await assertColumn(queryRunner, dataSource, PlatformSettings, 'local_password_login_mode', false);

  await mappingOwnership.up(queryRunner);
  await governanceOwnership.up(queryRunner);
  await loginExperience.up(queryRunner);
  await providerPreference.up(queryRunner);

  const mapping = await dataSource.getRepository(IdentityEntitlementMapping).findOneByOrFail({
    id: ids.migrationMapping,
  });
  const provider = await dataSource.getRepository(IdentityProvider).findOneByOrFail({
    id: ids.migrationProvider,
  });
  const settings = await dataSource.getRepository(PlatformSettings).findOneByOrFail({ id: 'default' });
  assert.equal(mapping.ownershipMode, 'config_locked');
  assert.equal(provider.displayName, ids.migrationProvider);
  assert.equal(provider.organization, null);
  assert.equal(Number(provider.displayOrder), 0);
  assert.equal(provider.isPreferred, false);
  assert.equal(provider.preferredScopeIdentity, `provider:${ids.migrationProvider}`);
  assert.equal(provider.loginDomainsJson, '[]');
  assert.equal(settings.accessGovernanceOwnershipMode, 'manual');
  assert.equal(settings.localPasswordLoginMode, 'auto');
  assert.equal(settings.ssoProviderSelectionMode, 'auto_redirect_single');
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: recent authorization/login upgrade schema differs from clean install`,
  );
}

async function makeTenantColumnNullable(queryRunner, dataSource, entity) {
  const path = metadataPath(dataSource, entity);
  const table = await queryRunner.getTable(path);
  const current = table?.columns.find((column) => normalizeName(column.name) === 'tenant_id');
  assert.ok(current, `${database}: ${entity.name}.tenant_id is missing`);
  if (current.isNullable) return;
  const nullable = current.clone();
  nullable.isNullable = true;
  nullable.default = undefined;
  if (database === 'spanner') {
    const dependentIndexes = table.indices.filter((index) => index.columnNames.map(normalizeName).includes('tenant_id'));
    for (const index of dependentIndexes) await queryRunner.dropIndex(path, index);
    const tablePath = path.split('.').filter(Boolean).map((part) => queryRunner.connection.driver.escape(part)).join('.');
    const columnName = queryRunner.connection.driver.escape('tenant_id');
    const columnType = queryRunner.connection.driver.createFullType(nullable);
    await queryRunner.updateDDL(`ALTER TABLE ${tablePath} ALTER COLUMN ${columnName} ${columnType}`);
    for (const index of dependentIndexes) await queryRunner.createIndex(path, index);
    return;
  }
  const dependentIndexes = database === 'mssql'
    ? table.indices.filter((index) => index.columnNames.map(normalizeName).includes('tenant_id'))
    : [];
  for (const index of dependentIndexes) await queryRunner.dropIndex(path, index);
  await queryRunner.changeColumn(path, current, nullable);
  for (const index of dependentIndexes) await queryRunner.createIndex(path, index);
}

async function qualifyExternalIdentityAndProjectTenantBaseline(queryRunner, dataSource, expectedFingerprint) {
  const externalIdentity = new AddExternalEngineRegistrationIdentities1700000000108();
  const projectTenantOwnership = new RequireProjectTenantOwnership1700000000109();
  const now = Date.now();

  await dataSource.getRepository(ExternalEngineRegistration).insert(entityRowWithDefaults(
    dataSource,
    ExternalEngineRegistration,
    {
      id: ids.migrationExternalRegistration,
      engineId: ids.legacyEngine,
      externalId: `${runId}-external-id`,
      sourceIdentity: `${runId}-pre-0108-source`,
      activeExternalIdIdentity: `${runId}-pre-0108-active`,
      registrationSource: 'user',
      createdAt: now,
      updatedAt: now,
    },
  ));
  await dataSource.getRepository(Project).insert({
    id: ids.migrationProject,
    name: 'Tenant qualification project',
    ownerId: `${runId}-owner`,
    tenantId: 'tenant-default',
    createdAt: now,
    updatedAt: now,
  });
  await dataSource.getRepository(ProjectEngineTarget).insert(entityRowWithDefaults(
    dataSource,
    ProjectEngineTarget,
    {
      id: ids.migrationProjectTarget,
      tenantId: 'tenant-default',
      projectId: ids.migrationProject,
      engineId: ids.legacyEngine,
      createdAt: now,
      updatedAt: now,
    },
  ));
  await dataSource.getRepository(RbacRoleAssignment).insert(entityRowWithDefaults(
    dataSource,
    RbacRoleAssignment,
    {
      id: ids.migrationProjectAssignment,
      tenantId: 'tenant-default',
      principalType: 'user',
      principalId: `${runId}-principal`,
      assignmentKey: `${runId}-legacy-assignment-key`,
      roleId: `${runId}-role`,
      scopeType: 'project',
      scopeId: ids.migrationProject,
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    },
  ));
  await dataSource.getRepository(PermissionGrant).insert(entityRowWithDefaults(
    dataSource,
    PermissionGrant,
    {
      id: ids.migrationProjectGrant,
      tenantId: 'tenant-default',
      userId: `${runId}-principal`,
      permission: 'project:deploy',
      resourceType: 'project',
      resourceId: ids.migrationProject,
      createdAt: now,
    },
  ));

  await externalIdentity.down(queryRunner);
  await makeTenantColumnNullable(queryRunner, dataSource, Project);
  await makeTenantColumnNullable(queryRunner, dataSource, ProjectEngineTarget);
  await dataSource.getRepository(Project).update({ id: ids.migrationProject }, { tenantId: null });
  await dataSource.getRepository(ProjectEngineTarget).update({ id: ids.migrationProjectTarget }, { tenantId: null });
  await dataSource.getRepository(RbacRoleAssignment).update({ id: ids.migrationProjectAssignment }, { tenantId: null });
  await dataSource.getRepository(PermissionGrant).update({ id: ids.migrationProjectGrant }, { tenantId: null });

  await externalIdentity.up(queryRunner);
  await projectTenantOwnership.up(queryRunner);
  await externalIdentity.up(queryRunner);
  await projectTenantOwnership.up(queryRunner);

  const registration = await dataSource.getRepository(ExternalEngineRegistration).findOneByOrFail({
    id: ids.migrationExternalRegistration,
  });
  const project = await dataSource.getRepository(Project).findOneByOrFail({ id: ids.migrationProject });
  const target = await dataSource.getRepository(ProjectEngineTarget).findOneByOrFail({ id: ids.migrationProjectTarget });
  const assignment = await dataSource.getRepository(RbacRoleAssignment).findOneByOrFail({ id: ids.migrationProjectAssignment });
  const grant = await dataSource.getRepository(PermissionGrant).findOneByOrFail({ id: ids.migrationProjectGrant });
  assert.match(registration.sourceIdentity, /^[a-f0-9]{64}$/);
  assert.match(registration.activeExternalIdIdentity, /^[a-f0-9]{64}$/);
  assert.equal(project.tenantId, 'tenant-default');
  assert.equal(target.tenantId, 'tenant-default');
  assert.equal(assignment.tenantId, 'tenant-default');
  assert.notEqual(assignment.assignmentKey, `${runId}-legacy-assignment-key`);
  assert.equal(grant.tenantId, 'tenant-default');
  const projectTable = await queryRunner.getTable(metadataPath(dataSource, Project));
  const targetTable = await queryRunner.getTable(metadataPath(dataSource, ProjectEngineTarget));
  assert.equal(projectTable?.columns.find((column) => normalizeName(column.name) === 'tenant_id')?.isNullable, false);
  assert.equal(targetTable?.columns.find((column) => normalizeName(column.name) === 'tenant_id')?.isNullable, false);
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: external identity/project tenancy upgrade schema differs from clean install`,
  );
}

async function qualifyNativeSaasTenancyBaseline(queryRunner, dataSource, expectedFingerprint) {
  const nativeTenancy = new AddNativeSaasTenancy1700000000124();
  const ownershipBackfill = new BackfillNativeTenantOwnership1700000000125();
  const postgresRls = new AddPostgresTenantRls1700000000126();

  await postgresRls.down(queryRunner);
  await nativeTenancy.down(queryRunner);

  assert.equal(await queryRunner.hasTable(metadataPath(dataSource, Tenant)), false);
  assert.equal(await queryRunner.hasTable(metadataPath(dataSource, TenantDomain)), false);
  assert.equal(await queryRunner.hasTable(metadataPath(dataSource, TenantDiscoveryDomain)), false);
  assert.equal(await queryRunner.hasTable(metadataPath(dataSource, TenantDiscoveryChallenge)), false);
  assert.equal(await queryRunner.hasTable(metadataPath(dataSource, TenantLoginPolicy)), false);
  await assertColumn(queryRunner, dataSource, RefreshToken, 'tenant_id', false);
  await assertColumn(queryRunner, dataSource, Invitation, 'tenant_id', false);

  // Re-run every migration to prove a partially retried v0.16.2 upgrade is
  // idempotent on adapters where DDL may have committed before interruption.
  await nativeTenancy.up(queryRunner);
  await nativeTenancy.up(queryRunner);
  await ownershipBackfill.up(queryRunner);
  await ownershipBackfill.up(queryRunner);
  await postgresRls.up(queryRunner);
  await postgresRls.up(queryRunner);

  await assertColumn(queryRunner, dataSource, RefreshToken, 'tenant_id', true);
  await assertColumn(queryRunner, dataSource, Invitation, 'tenant_id', true);
  for (const entity of [Tenant, TenantDomain, TenantDiscoveryDomain, TenantDiscoveryChallenge, TenantLoginPolicy]) {
    assert.equal(
      await queryRunner.hasTable(metadataPath(dataSource, entity)),
      true,
      `${database}: ${dataSource.getMetadata(entity).tableName} was not created by native SaaS tenancy upgrade`,
    );
  }

  const provider = await dataSource.getRepository(IdentityProvider).findOneByOrFail({
    id: ids.migrationProvider,
  });
  const group = await dataSource.getRepository(AuthzGroup).findOneByOrFail({ id: ids.migrationGroup });
  const mapping = await dataSource.getRepository(IdentityEntitlementMapping).findOneByOrFail({
    id: ids.migrationMapping,
  });
  assert.equal(provider.tenantId, 'tenant-default');
  assert.equal(group.tenantId, 'tenant-default');
  assert.equal(mapping.tenantId, 'tenant-default');
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: v0.16.2 native SaaS tenancy upgrade schema differs from clean install`,
  );
}

async function qualifyUpgradeBaselines(queryRunner, dataSource, expectedFingerprint) {
  const foundation = new AddEngineTenancyFoundation1700000000096();
  const reference = new AddEngineTenantMappingReference1700000000097();
  const importRuns = new AddCamundaNativeGrantImportRuns1700000000098();
  const rollbackReceipt = new AddCamundaNativeGrantRollbackReceipt1700000000099();
  const widenEvidence = new WidenCamundaNativeGrantEvidence1700000000100();
  await seedLegacyRows(dataSource);
  await qualifyRecentMigrationBaselines(queryRunner, dataSource, expectedFingerprint);
  await qualifyExternalIdentityAndProjectTenantBaseline(queryRunner, dataSource, expectedFingerprint);
  await qualifyNativeSaasTenancyBaseline(queryRunner, dataSource, expectedFingerprint);

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
  const mappingOwnership = new AddIdentityMappingOwnershipMode1700000000104();
  const governanceOwnership = new AddPlatformGovernanceSettingsOwnership1700000000105();
  const loginExperience = new AddLoginExperienceMetadata1700000000106();
  const providerPreference = new ConsolidateLoginProviderPreference1700000000107();
  const externalIdentity = new AddExternalEngineRegistrationIdentities1700000000108();
  const projectTenantOwnership = new RequireProjectTenantOwnership1700000000109();
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

  // Simulate an interrupted recent upgrade after only a subset of columns was
  // committed. This is especially important for adapters whose DDL is not
  // transactionally rolled back (Oracle and Spanner).
  await providerPreference.down(queryRunner);
  await externalIdentity.down(queryRunner);
  await queryRunner.dropColumn(metadataPath(dataSource, IdentityEntitlementMapping), 'ownership_mode');
  await queryRunner.dropColumn(metadataPath(dataSource, PlatformSettings), 'access_governance_source_hash');
  await queryRunner.dropColumn(metadataPath(dataSource, IdentityProvider), 'organization');
  await queryRunner.dropColumn(metadataPath(dataSource, PlatformSettings), 'sso_provider_selection_mode');
  await mappingOwnership.up(queryRunner);
  await governanceOwnership.up(queryRunner);
  await loginExperience.up(queryRunner);
  await providerPreference.up(queryRunner);
  await externalIdentity.up(queryRunner);
  await projectTenantOwnership.up(queryRunner);
  await mappingOwnership.up(queryRunner);
  await governanceOwnership.up(queryRunner);
  await loginExperience.up(queryRunner);
  await providerPreference.up(queryRunner);
  await externalIdentity.up(queryRunner);
  await projectTenantOwnership.up(queryRunner);

  const recoveredMapping = await dataSource.getRepository(IdentityEntitlementMapping).findOneByOrFail({
    id: ids.migrationMapping,
  });
  assert.equal(recoveredMapping.ownershipMode, 'config_locked');
  assert.equal(
    fingerprint(await logicalSchema(queryRunner, dataSource)),
    expectedFingerprint,
    `${database}: interrupted/retried migration schema differs from clean install`,
  );
  observation.stages.interrupted_retry = {
    status: 'passed',
    simulatedInterruption: 'foundation indexes, ownership/login columns, and external-registration identity claims absent after partial DDL',
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
  const identityMappingRepository = dataSource.getRepository(IdentityEntitlementMapping);
  const identityProviderRepository = dataSource.getRepository(IdentityProvider);
  const groupRepository = dataSource.getRepository(AuthzGroup);
  const settingsRepository = dataSource.getRepository(PlatformSettings);
  const externalRegistrationRepository = dataSource.getRepository(ExternalEngineRegistration);
  const projectTargetRepository = dataSource.getRepository(ProjectEngineTarget);
  const projectAssignmentRepository = dataSource.getRepository(RbacRoleAssignment);
  const permissionGrantRepository = dataSource.getRepository(PermissionGrant);
  const projectRepository = dataSource.getRepository(Project);
  await mappingRepository.delete({ engineId: ids.serviceEngine });
  await resourceRepository.delete({ id: ids.serviceResource });
  await engineRepository.delete({ id: ids.serviceEngine });
  await resourceRepository.delete({ id: ids.legacyResource });
  await projectTargetRepository.delete({ id: ids.migrationProjectTarget });
  await projectAssignmentRepository.delete({ id: ids.migrationProjectAssignment });
  await permissionGrantRepository.delete({ id: ids.migrationProjectGrant });
  await projectRepository.delete({ id: ids.migrationProject });
  await externalRegistrationRepository.delete({ id: ids.migrationExternalRegistration });
  await engineRepository.delete({ id: ids.legacyEngine });
  await identityMappingRepository.delete({ id: ids.migrationMapping });
  await identityProviderRepository.delete({ id: ids.migrationProvider });
  await groupRepository.delete({ id: ids.migrationGroup });
  await settingsRepository.delete({ id: 'default' });
  assert.equal(await mappingRepository.countBy({ engineId: ids.serviceEngine }), 0);
  assert.equal(await resourceRepository.countBy({ id: ids.serviceResource }), 0);
  assert.equal(await engineRepository.countBy({ id: ids.serviceEngine }), 0);
  assert.equal(await resourceRepository.countBy({ id: ids.legacyResource }), 0);
  assert.equal(await engineRepository.countBy({ id: ids.legacyEngine }), 0);
  assert.equal(await identityMappingRepository.countBy({ id: ids.migrationMapping }), 0);
  assert.equal(await identityProviderRepository.countBy({ id: ids.migrationProvider }), 0);
  assert.equal(await groupRepository.countBy({ id: ids.migrationGroup }), 0);
  assert.equal(await projectRepository.countBy({ id: ids.migrationProject }), 0);
  assert.equal(await externalRegistrationRepository.countBy({ id: ids.migrationExternalRegistration }), 0);
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
