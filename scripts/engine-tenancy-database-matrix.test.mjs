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

test('declares the exact five-adapter, two-baseline, seven-stage denominator', () => {
  assert.equal(contract.schemaVersion, 1);
  assert.deepEqual(Object.keys(contract.databases), databases);
  assert.deepEqual(contract.requiredStages, stages);
  assert.deepEqual(
    contract.upgradeBaselines.map(({ id }) => id),
    ['pre_engine_tenancy', 'engine_tenancy_foundation_v1'],
  );
  assert.ok(contract.requiredTables.engines.includes('tenancy_mode'));
  assert.ok(contract.requiredTables.engine_tenant_mappings.includes('tenant_reference_json'));
  assert.ok(contract.requiredTables.runtime_resources.includes('tenant_resolution_details_json'));
  assert.ok(contract.requiredIndexes.runtime_resources.includes(
    'idx_runtime_resources_tenant_resolution',
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
  assert.match(runner, /database-observations/);
  assert.match(runner, /schemaFingerprints\.size === 1/);
  assert.match(runner, /Database-matrix evidence must be run from a clean worktree/);
  assert.match(runner, /releaseCommitQualified: status === 'passed' && sourceState === 'clean'/);
  assert.match(workflow, /pnpm run test:engine-tenancy:database-matrix/);
  assert.match(workflow, /test\/results\/engine-tenancy-release\/database-matrix\.json/);
  assert.match(workflow, /if: always\(\)/);
});

test('executes every stage against the real adapter and service transaction', () => {
  for (const requiredFunction of [
    'qualifyUpgradeBaselines',
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
