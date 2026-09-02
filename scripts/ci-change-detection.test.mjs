import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci-detect-reusable.yml', import.meta.url), 'utf8');
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const reusableCiWorkflow = readFileSync(new URL('../.github/workflows/ci-core-reusable.yml', import.meta.url), 'utf8');
const databaseWorkflow = readFileSync(new URL('../.github/workflows/engine-tenancy-database.yml', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('published package source directories select their owning CI lanes', () => {
  assert.match(workflow, /packages\/\(backend-host\|shared\|enterprise-plugin-api\|plugin-manager\)\//);
  assert.match(workflow, /packages\/\(frontend-host\|shared\|enterprise-plugin-api\|plugin-manager\)\//);
});

test('canonical TypeORM persistence and configuration paths select database qualification', () => {
  assert.match(workflow, /packages\/shared\/src\/\(db\|config\|infrastructure\/persistence\)\//);
});

test('Mission Control engine, database, and diagram regressions remain explicit CI gates', () => {
  const regressionCommand = packageManifest.scripts?.['test:mission-control-regressions'];
  assert.equal(typeof regressionCommand, 'string');
  for (const requiredTest of [
    'engineHealthBigintTransformer.test.ts',
    'postgres-adapter.test.ts',
    'mysql-adapter.test.ts',
    'sql-server-adapter.test.ts',
    'oracle-adapter.test.ts',
    'spanner-adapter.test.ts',
    'decisions/routes.test.ts',
    'engines/routes.test.ts',
    'processes/routes.test.ts',
    'editTargetOpenApi.test.ts',
    'processInstance.test.ts',
    'ProcessesOverviewPage.completed.test.tsx',
    'ProcessesOverviewPage.diagram-placeholder.test.tsx',
    'ProcessInstanceDiagramPane.test.tsx',
    'useInstanceData.test.ts',
    'CopyableLink.test.tsx',
    'viewerUtils.test.ts',
  ]) {
    assert.ok(regressionCommand.includes(requiredTest), `${requiredTest} must remain in the regression lane`);
  }

  assert.match(ciWorkflow, /run: pnpm run test:mission-control-regressions/);
  assert.match(reusableCiWorkflow, /run: pnpm run --if-present test:mission-control-regressions/);
  assert.equal(
    databaseWorkflow.match(/packages\/shared\/src\/infrastructure\/persistence\/transformers\/\*\*/g)?.length,
    2,
    'transformer changes must trigger both pull-request and main-branch database qualification',
  );
  assert.match(databaseWorkflow, /run: pnpm run test:engine-tenancy:database-matrix/);
});

test('native tenancy changes select the pooled RLS and segregated SSO lane', () => {
  assert.match(workflow, /run_native_tenancy:/);
  assert.match(workflow, /run_native_tenancy=true/);
  assert.match(workflow, /pooled-tenancy-e2e/);
  assert.match(workflow, /saas-upgrade-restore-rollback/);
  assert.match(workflow, /nativeTenantRls/);
  assert.match(workflow, /Login\\\.organization/);
  assert.match(workflow, /pages\/Login/);
  assert.match(workflow, /NativeTenantPicker/);
  assert.match(ciWorkflow, /^  native-tenancy-pooled-e2e:/m);
  assert.match(ciWorkflow, /run: pnpm run test:native-tenancy:pooled-e2e/);
  assert.match(ciWorkflow, /^  saas-upgrade-restore-rollback:/m);
  assert.match(ciWorkflow, /run: pnpm run test:saas:upgrade-restore-rollback/);
  assert.match(ciWorkflow, /      - native-tenancy-pooled-e2e\n      - saas-upgrade-restore-rollback/);
});

test('package changes continue to select plugin compatibility and package checks', () => {
  assert.match(workflow, /if \[ "\$backend_changed" = true \] \|\| \[ "\$frontend_changed" = true \]; then/);
  assert.match(workflow, /run_plugin_checks=true/);
  assert.match(workflow, /run_plugin_package=true/);
});

test('Trivy wrapper changes select image smoke and security qualification', () => {
  assert.match(workflow, /scripts\/\(smoke-images-local\|run-trivy-image-scan\)\\\.sh/);
  assert.match(workflow, /if \[ "\$run_smoke" = true \]; then/);
  assert.match(workflow, /run_security_scan=true/);
});

test('draft pull requests use the normal change-aware gates', () => {
  assert.doesNotMatch(workflow, /changed_files_count=draft/);
  assert.doesNotMatch(workflow, /PR_DRAFT/);
});
