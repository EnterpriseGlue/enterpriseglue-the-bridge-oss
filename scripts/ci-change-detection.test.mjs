import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyChangedFiles } from './ci-change-classifier.mjs';

const workflow = readFileSync(new URL('../.github/workflows/ci-detect-reusable.yml', import.meta.url), 'utf8');
const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const reusableCiWorkflow = readFileSync(new URL('../.github/workflows/ci-core-reusable.yml', import.meta.url), 'utf8');
const databaseWorkflow = readFileSync(new URL('../.github/workflows/engine-tenancy-database.yml', import.meta.url), 'utf8');
const identityWorkflow = readFileSync(new URL('../.github/workflows/identity-protocol-rehearsal.yml', import.meta.url), 'utf8');
const deploymentWorkflow = readFileSync(new URL('../.github/workflows/access-governance-deployment-evidence.yml', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the reusable workflow delegates path policy to the tested deterministic classifier', () => {
  assert.match(workflow, /node scripts\/ci-change-classifier\.mjs/);
  assert.match(workflow, /MERGE_GROUP_BASE_SHA: \$\{\{ github\.event\.merge_group\.base_sha \}\}/);
  assert.match(workflow, /MERGE_GROUP_HEAD_SHA: \$\{\{ github\.event\.merge_group\.head_sha \}\}/);
  assert.match(workflow, /git diff --name-only "\$MERGE_GROUP_BASE_SHA" "\$MERGE_GROUP_HEAD_SHA"/);
  assert.doesNotMatch(workflow, /grep -E/);
});

test('published package source directories select their owning CI lanes', () => {
  const result = classifyChangedFiles([
    'packages/backend-host/src/app.ts',
    'packages/frontend-host/src/main.tsx',
    'packages/enterprise-plugin-api/src/frontend.d.ts',
    'packages/plugin-manager/src/main.ts',
  ]);
  assert.equal(result.backend, true);
  assert.equal(result.frontend, true);
  assert.equal(result.plugin_contract, true);
  assert.equal(result.run_plugin_checks, true);
});

test('canonical TypeORM persistence and configuration paths select database qualification', () => {
  const result = classifyChangedFiles([
    'packages/shared/src/db/data-source.ts',
    'packages/shared/src/config/index.ts',
    'packages/shared/src/infrastructure/persistence/adapters/OracleAdapter.ts',
  ]);
  assert.equal(result.persistence, true);
  assert.equal(result.run_postgres, true);
  assert.equal(result.run_oracle, true);
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
    'EngineSelector.test.tsx',
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
  const result = classifyChangedFiles(['test/e2e/pooled-tenancy-segregated-sso.spec.ts']);
  assert.equal(result.run_native_tenancy, true);
  assert.match(ciWorkflow, /^  native-tenancy-pooled-e2e:/m);
  assert.match(ciWorkflow, /run: pnpm run test:native-tenancy:pooled-e2e/);
  assert.match(ciWorkflow, /^  saas-upgrade-restore-rollback:/m);
  assert.match(ciWorkflow, /run: pnpm run test:saas:upgrade-restore-rollback/);
});

test('image and plugin work is independently gated from application tests', () => {
  assert.match(ciWorkflow, /plugin-platform:[\s\S]*?if: needs\.detect\.outputs\.run_plugin_checks == 'true'/);
  assert.match(ciWorkflow, /plugin-platform-images:[\s\S]*?if: needs\.detect\.outputs\.run_plugin_images == 'true'/);
  assert.match(ciWorkflow, /published-package-version-discipline:[\s\S]*?if: needs\.detect\.outputs\.run_package_discipline == 'true'/);
  assert.match(ciWorkflow, /compose-render:[\s\S]*?if: needs\.detect\.outputs\.run_compose_render == 'true'/);
  assert.match(ciWorkflow, /build-ci-images:[\s\S]*?if: needs\.detect\.outputs\.run_ci_images == 'true'/);
});

test('Trivy wrapper changes select image smoke and security qualification', () => {
  const result = classifyChangedFiles(['scripts/run-trivy-image-scan.sh']);
  assert.equal(result.run_ci_images, true);
  assert.equal(result.run_smoke, true);
  assert.equal(result.run_security_scan, true);
});

test('draft pull requests use the normal change-aware gates', () => {
  assert.doesNotMatch(workflow, /changed_files_count=draft/);
  assert.doesNotMatch(workflow, /PR_DRAFT/);
});

test('independent database, identity, and deployment workflows honor classifier relevance', () => {
  assert.match(databaseWorkflow, /uses: \.\/\.github\/workflows\/ci-detect-reusable\.yml/);
  assert.match(databaseWorkflow, /if: needs\.detect\.outputs\.run_database_matrix == 'true'/);
  assert.match(identityWorkflow, /uses: \.\/\.github\/workflows\/ci-detect-reusable\.yml/);
  assert.match(identityWorkflow, /if: needs\.detect\.outputs\.run_identity_rehearsal == 'true'/);
  assert.match(deploymentWorkflow, /uses: \.\/\.github\/workflows\/ci-detect-reusable\.yml/);
  assert.match(deploymentWorkflow, /if: needs\.detect\.outputs\.run_deployment_evidence == 'true'/);
});
