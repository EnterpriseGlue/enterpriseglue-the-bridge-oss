import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const contract = JSON.parse(readFileSync(
  new URL('../test/database/engine-tenancy-database-matrix-contract.json', import.meta.url),
  'utf8',
));
const runner = readFileSync(
  new URL('./run-engine-tenancy-database-matrix.mjs', import.meta.url),
  'utf8',
);
const worker = readFileSync(
  new URL('../backend/test/integration/engine-tenancy-database-qualification.mjs', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../.github/workflows/engine-tenancy-database.yml', import.meta.url),
  'utf8',
);

const databases = ['postgres', 'mysql', 'mssql', 'oracle', 'spanner'];
const stages = [
  'clean_install',
  'upgrade_baselines',
  'interrupted_retry',
  'schema_equivalence',
  'service_behavior',
  'rollback',
  'cleanup',
];

test('declares the exact five-adapter, six-baseline, seven-stage denominator', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.deepEqual(Object.keys(contract.databases), databases);
  assert.deepEqual(contract.requiredStages, stages);
  assert.deepEqual(
    contract.upgradeBaselines.map(({ id }) => id),
    [
      'pre_engine_tenancy',
      'engine_tenancy_foundation_v1',
      'pre_access_governance_ownership',
      'pre_login_experience',
      'pre_external_identity_and_project_tenancy',
      'v0_16_2_pre_native_saas_tenancy',
    ],
  );
  assert.ok(contract.requiredTables.engines.includes('tenancy_mode'));
  assert.ok(contract.requiredTables.engine_tenant_mappings.includes('tenant_reference_json'));
  assert.ok(contract.requiredTables.runtime_resources.includes('tenant_resolution_details_json'));
  assert.ok(contract.requiredTables.camunda_native_grant_import_runs.includes('rollback_config_bundle_run_id'));
  assert.ok(contract.requiredTables.camunda_native_grant_import_runs.includes('rolled_back_at'));
  assert.ok(contract.requiredTables.identity_entitlement_mappings.includes('ownership_mode'));
  assert.ok(contract.requiredTables.identity_providers.includes('display_name'));
  assert.ok(contract.requiredTables.identity_providers.includes('login_domains_json'));
  assert.ok(contract.requiredTables.platform_settings.includes('access_governance_ownership_mode'));
  assert.ok(contract.requiredTables.platform_settings.includes('local_password_login_mode'));
  assert.ok(contract.requiredTables.platform_settings.includes('sso_provider_selection_mode'));
  assert.ok(contract.requiredIndexes.runtime_resources.includes(
    'idx_runtime_resources_tenant_resolution',
  ));
  assert.ok(contract.requiredIndexes.camunda_native_grant_import_runs.includes(
    'idx_camunda_native_grant_import_status_updated',
  ));
  assert.ok(contract.requiredIndexes.identity_providers.includes(
    'uq_identity_providers_preferred_scope_identity',
  ));
  assert.ok(contract.requiredTables.external_engine_registrations.includes('source_identity'));
  assert.ok(contract.requiredTables.external_engine_registrations.includes('active_external_id_identity'));
  assert.ok(contract.requiredTables.projects.includes('tenant_id'));
  assert.ok(contract.requiredTables.project_engine_targets.includes('tenant_id'));
  assert.ok(contract.requiredTables.role_assignments.includes('assignment_key'));
  assert.ok(contract.requiredTables.permission_grants.includes('tenant_id'));
  assert.ok(contract.requiredIndexes.external_engine_registrations.includes(
    'uq_external_engine_registrations_active_external_identity',
  ));
});

test('runs every database in an isolated disposable localhost container', () => {
  assert.match(
    packageJson.scripts['test:engine-tenancy:database-matrix'],
    /test:engine-tenancy:database-contract/,
  );
  assert.match(
    packageJson.scripts['test:engine-tenancy:database-matrix'],
    /run-engine-tenancy-database-matrix\.mjs/,
  );
  assert.match(
    packageJson.scripts['test:engine-tenancy:database-matrix'],
    /test:database-portability:unit/,
  );
  assert.match(packageJson.scripts['test:database-portability:unit'], /guard:no-raw-sql/);
  assert.match(packageJson.scripts['test:database-portability:unit'], /migrationPortability\.test\.ts/);
  assert.match(packageJson.scripts['test:database-portability:unit'], /lazyConnectionPool\.test\.ts/);
  for (const database of databases) {
    assert.match(runner, new RegExp(`database === '${database}'|prepare${{
      postgres: 'Postgres',
      mysql: 'MySql',
      mssql: 'MsSql',
      oracle: 'Oracle',
      spanner: 'Spanner',
    }[database]}`));
  }
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /removeContainer/);
  assert.match(runner, /docker\(\['pull', '--platform', target\.platform, target\.image\]\)/);
  assert.match(runner, /database-observations/);
  assert.match(runner, /schemaFingerprints\.size === 1/);
  assert.match(runner, /Database-matrix evidence must be run from a clean worktree/);
  assert.match(runner, /releaseCommitQualified: status === 'passed' && sourceState === 'clean'/);
  assert.match(runner, /new sql\.ConnectionPool\(serverConfig\)/);
  assert.doesNotMatch(runner, /sql\.connect\(serverConfig\)/);
  assert.match(workflow, /pnpm run test:engine-tenancy:database-matrix/);
  assert.match(workflow, /backend\/scripts\/check-no-raw-sql\.ts/);
  assert.match(workflow, /packages\/backend-host\/src\/server\.ts/);
  assert.match(workflow, /packages\/shared\/src\/infrastructure\/persistence\/migrations\/\*\*/);
  assert.match(workflow, /test\/results\/engine-tenancy-release\/database-matrix\.json/);
  assert.match(workflow, /if: always\(\)/);
});

test('executes every stage against the real adapter and service transaction', () => {
  for (const requiredFunction of [
    'qualifyUpgradeBaselines',
    'qualifyRecentMigrationBaselines',
    'qualifyInterruptedRetry',
    'logicalSchema',
    'qualifyServiceBehavior',
    'qualifyRollback',
    'qualifyCleanup',
  ]) {
    assert.match(worker, new RegExp(`\\b${requiredFunction}\\b`));
  }
  assert.match(worker, /runMigrations/);
  assert.match(worker, /engineTenantMappingService\.upsert/);
  assert.match(worker, /expectedMappingVersion: 0/);
  assert.match(worker, /expectedMappingVersion: 1/);
  assert.match(worker, /tenantResolutionDetailsJson/);
  assert.match(worker, /AddCamundaNativeGrantImportRuns1700000000098/);
  assert.match(worker, /AddCamundaNativeGrantRollbackReceipt1700000000099/);
  assert.match(worker, /AddIdentityMappingOwnershipMode1700000000104/);
  assert.match(worker, /AddPlatformGovernanceSettingsOwnership1700000000105/);
  assert.match(worker, /AddLoginExperienceMetadata1700000000106/);
  assert.match(worker, /ConsolidateLoginProviderPreference1700000000107/);
  assert.match(worker, /AddExternalEngineRegistrationIdentities1700000000108/);
  assert.match(worker, /RequireProjectTenantOwnership1700000000109/);
  assert.match(worker, /mapping\.ownershipMode, 'config_locked'/);
  assert.match(worker, /provider\.displayName, ids\.migrationProvider/);
  assert.match(worker, /settings\.ssoProviderSelectionMode, 'auto_redirect_single'/);
  assert.match(worker, /provider\.preferredScopeIdentity/);
  assert.match(worker, /assignment\.tenantId, 'tenant-default'/);
  assert.match(worker, /grant\.tenantId, 'tenant-default'/);
  assert.match(worker, /rollbackConfigBundleRunId/);
  assert.match(worker, /ownedRowsRemaining: 0/);
  assert.match(worker, /cleanInstallEqualsAllUpgradePaths: true/);
  assert.match(worker, /assert\.rejects/);
  assert.match(worker, /retainedMetadata: true/);
});

test('keeps retained matrix evidence sanitized', () => {
  for (const source of [runner, worker]) {
    for (const declaration of [
      'containsCredentials: false',
      'containsTokens: false',
      'containsPrivateEndpoints: false',
      'containsRawIdentityClaims: false',
      'containsCustomerIdentifiers: false',
    ]) {
      assert.match(source, new RegExp(declaration));
    }
  }
  assert.doesNotMatch(
    runner,
    /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/,
  );
  assert.doesNotMatch(
    worker,
    /process\.env\.(?:JWT_SECRET|ENCRYPTION_KEY|POSTGRES_PASSWORD|ADMIN_PASSWORD)/,
  );
});
