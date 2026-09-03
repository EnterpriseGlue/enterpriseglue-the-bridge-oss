import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChangedFiles, renderClassifierSummary } from './ci-change-classifier.mjs';

test('release-note and ordinary documentation changes use the policy-only fast path', () => {
  const result = classifyChangedFiles([
    '.release-notes/example-fix.json',
    'docs/how-to/example.md',
    'README.md',
  ]);

  assert.equal(result.metadata_only, true);
  assert.equal(result.run_tests, false);
  assert.equal(result.run_postgres, false);
  assert.equal(result.run_ci_images, false);
  assert.equal(result.run_documentation_guard, true);
  assert.equal(result.run_boundary_guards, false);
  assert.equal(result.run_plugin_checks, false);
  assert.equal(result.run_release_readiness, false);
  assert.deepEqual(result.selected_classes, ['metadata_only']);
});

test('release workflow changes run release readiness without unrelated application suites', () => {
  const result = classifyChangedFiles([
    '.github/workflows/release-candidate-stage.yml',
    '.release-notes/release-workflow-fix.json',
  ]);

  assert.equal(result.workflow_or_release, true);
  assert.equal(result.run_release_readiness, true);
  assert.equal(result.run_tests, false);
  assert.equal(result.run_postgres, false);
  assert.equal(result.run_ci_images, false);
  assert.equal(result.run_plugin_checks, false);
});

test('classifier contract tests stay on the workflow verification path', () => {
  const result = classifyChangedFiles(['scripts/ci-change-detection.test.mjs']);

  assert.equal(result.workflow_or_release, true);
  assert.equal(result.unknown_high_risk, false);
  assert.equal(result.run_release_readiness, true);
  assert.equal(result.run_ci_images, false);
  assert.equal(result.run_plugin_images, false);
});

test('release fragments without documentation stay on the policy-only path', () => {
  const result = classifyChangedFiles(['.release-notes/example-fix.json']);

  assert.equal(result.metadata_only, true);
  assert.equal(result.run_documentation_guard, false);
  assert.equal(result.run_boundary_guards, false);
});

test('root package scripts do not select unrelated database, identity, or deployment matrices', () => {
  const result = classifyChangedFiles(['package.json']);

  assert.equal(result.run_database_matrix, false);
  assert.equal(result.run_identity_rehearsal, false);
  assert.equal(result.run_deployment_evidence, false);
});

test('independent heavy workflows select only their owning change surfaces', () => {
  const database = classifyChangedFiles([
    'packages/shared/src/infrastructure/persistence/transformers/BigIntNumberTransformer.ts',
  ]);
  assert.equal(database.run_database_matrix, true);
  assert.equal(database.run_identity_rehearsal, false);

  const identity = classifyChangedFiles(['test/e2e/local-saml-rehearsal.spec.ts']);
  assert.equal(identity.run_identity_rehearsal, true);
  assert.equal(identity.run_database_matrix, false);

  const deployment = classifyChangedFiles(['scripts/run-deployment-evidence-matrix.mjs']);
  assert.equal(deployment.run_deployment_evidence, true);
  assert.equal(deployment.run_identity_rehearsal, false);
});

test('frontend source changes select application tests but not Oracle or image builds', () => {
  const result = classifyChangedFiles([
    'packages/frontend-host/src/features/mission-control/engines/EnginesPage.tsx',
  ]);

  assert.equal(result.frontend, true);
  assert.equal(result.engine_integration, true);
  assert.equal(result.run_tests, true);
  assert.equal(result.run_postgres, true);
  assert.equal(result.run_oracle, false);
  assert.equal(result.run_ci_images, false);
  assert.equal(result.run_engine_browser, true);
});

test('TypeORM persistence changes select both database adapters and engine regressions', () => {
  const result = classifyChangedFiles([
    'packages/shared/src/infrastructure/persistence/transformers/BigIntNumberTransformer.ts',
  ]);

  assert.equal(result.persistence, true);
  assert.equal(result.run_tests, true);
  assert.equal(result.run_postgres, true);
  assert.equal(result.run_oracle, true);
  assert.equal(result.run_engine_browser, true);
  assert.deepEqual(result.test_databases, ['postgres', 'oracle']);
});

test('plugin contracts select compatibility, packaging, and plugin image lanes only', () => {
  const result = classifyChangedFiles([
    'packages/plugin-sdk/src/platform.ts',
    'packages/plugin-sdk/package.json',
  ]);

  assert.equal(result.plugin_contract, true);
  assert.equal(result.plugin_packaging, true);
  assert.equal(result.run_plugin_checks, true);
  assert.equal(result.run_plugin_package, true);
  assert.equal(result.run_plugin_images, true);
  assert.equal(result.run_package_discipline, true);
  assert.equal(result.run_ci_images, false);
});

test('application Dockerfiles select cached image, smoke, security, and release lanes', () => {
  const result = classifyChangedFiles(['backend/Dockerfile.prod']);

  assert.equal(result.application_container, true);
  assert.equal(result.backend, false);
  assert.equal(result.run_tests, false);
  assert.equal(result.run_ci_images, true);
  assert.equal(result.run_smoke, true);
  assert.equal(result.run_security_scan, true);
  assert.equal(result.run_release_readiness, true);
});

test('application image workflow contracts avoid unrelated broad verification', () => {
  const result = classifyChangedFiles([
    '.github/workflows/docker-images-reusable.yml',
    '.release-notes/release-image-build-cache.json',
    'scripts/release-candidate-workflow.test.mjs',
    'scripts/security-workflow-contract.test.mjs',
  ]);

  assert.equal(result.application_container, true);
  assert.equal(result.workflow_or_release, true);
  assert.equal(result.unknown_high_risk, false);
  assert.equal(result.run_ci_images, true);
  assert.equal(result.run_security_scan, true);
  assert.equal(result.run_release_readiness, true);
  assert.equal(result.run_tests, false);
  assert.equal(result.run_postgres, false);
  assert.equal(result.run_oracle, false);
  assert.equal(result.run_plugin_checks, false);
  assert.equal(result.run_native_tenancy, false);
  assert.equal(result.run_database_matrix, false);
  assert.equal(result.run_identity_rehearsal, false);
  assert.equal(result.run_deployment_evidence, false);
});

test('authorization and Operaton changes select their focused browser matrices', () => {
  const authorization = classifyChangedFiles([
    'packages/shared/src/authz/tenant-role-policy.ts',
  ]);
  assert.equal(authorization.authorization, true);
  assert.equal(authorization.run_adapter_backstop, false);

  const operaton = classifyChangedFiles([
    'test/e2e/operaton-container/native-authorization.test.mjs',
  ]);
  assert.equal(operaton.engine_integration, true);
  assert.equal(operaton.run_adapter_backstop, true);
  assert.equal(operaton.run_engine_browser, true);
});

test('unknown paths fail closed into the broad verification path', () => {
  const result = classifyChangedFiles(['new-product-area/unknown.bin']);

  assert.equal(result.unknown_high_risk, true);
  for (const lane of [
    'run_tests',
    'run_postgres',
    'run_oracle',
    'run_ci_images',
    'run_plugin_checks',
    'run_security_scan',
    'run_release_readiness',
  ]) {
    assert.equal(result[lane], true, `${lane} must fail closed`);
  }
});

test('manual full runs select every lane while respecting package publication input', () => {
  const result = classifyChangedFiles([], { forceFull: true, enablePluginPackage: false });

  assert.equal(result.metadata_only, false);
  assert.equal(result.run_tests, true);
  assert.equal(result.run_plugin_package, false);
  assert.deepEqual(result.test_databases, ['postgres', 'oracle']);
  assert.equal(result.changed_files_count, 'all');
});

test('summaries explain classification and selected work', () => {
  const summary = renderClassifierSummary(classifyChangedFiles(['backend/Dockerfile.prod']));
  assert.match(summary, /CI change classification/);
  assert.match(summary, /application_container/);
  assert.match(summary, /run_ci_images/);
});

test('changed paths must stay repository-relative', () => {
  assert.throws(() => classifyChangedFiles(['/tmp/file']), /invalid changed path/);
  assert.throws(() => classifyChangedFiles(['../file']), /invalid changed path/);
});
