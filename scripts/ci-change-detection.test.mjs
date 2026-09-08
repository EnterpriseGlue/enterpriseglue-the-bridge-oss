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
  for (const assetSource of ['packages/backend-host/src/plugins/pluginRuntime.ts', 'packages/backend-host/src/plugins/pluginRuntime.test.ts', 'packages/frontend-host/proxy-routes.json', 'frontend/vite.config.ts', 'infra/cdn/plugin-routing/routing-contract.json']) {
    assert.equal(classifyChangedFiles([assetSource]).run_native_tenancy, true, assetSource);
  }
  for (const source of ['contexts/AuthContext.tsx', 'plugins/nativePluginRuntime.tsx', 'utils/invitationRoute.ts', 'utils/httpInterceptor.ts']) {
    assert.equal(classifyChangedFiles([`packages/frontend-host/src/${source}`]).run_native_tenancy, true);
  }
  assert.equal(classifyChangedFiles(['frontend/__tests__/src/utils/httpInterceptor.test.ts']).run_native_tenancy, true);
  const result = classifyChangedFiles(['test/e2e/pooled-tenancy-segregated-sso.spec.ts']);
  assert.equal(result.run_native_tenancy, true);
  for (const proxy of ['frontend/nginx.conf', 'infra/docker/keycloak/local-tls-frontend.nginx.conf', 'infra/docker/compose/docker-compose.keycloak-tls.yml']) {
    assert.equal(classifyChangedFiles([proxy]).run_native_tenancy, true, `${proxy} must qualify SSO redirects`);
  }
  assert.match(ciWorkflow, /^  native-tenancy-pooled-e2e:/m);
  const pooledJob = ciWorkflow.split('\n  native-tenancy-pooled-e2e:')[1].split('\n  saas-upgrade-restore-rollback:')[0];
  const steps = pooledJob.split(/^      - name: /m).slice(1);
  const databaseSteps = steps.filter((step) => step.includes('run: pnpm run test:native-tenancy:postgres-rls'));
  const browserSteps = steps.filter((step) => step.includes('run: pnpm run test:native-tenancy:pooled-e2e'));
  assert.equal(databaseSteps.length, 1);
  assert.equal(browserSteps.length, 1);
  assert.ok(steps.indexOf(databaseSteps[0]) < steps.indexOf(browserSteps[0]));
  for (const step of [...databaseSteps, ...browserSteps]) {
    assert.doesNotMatch(step, /^\s+(?:if|continue-on-error):/m, 'both qualifications must retain default success gating and propagate failure');
  }
  assert.match(ciWorkflow, /^  saas-upgrade-restore-rollback:/m);
  assert.match(ciWorkflow, /run: pnpm run test:saas:upgrade-restore-rollback/);
});

test('session security changes cannot miss pooled session-race qualification', () => {
  for (const file of [
    'packages/shared/src/services/AuthSessionService.ts',
    'packages/shared/src/services/invitations.ts',
    'packages/shared/src/services/platform-admin/IdentityProviderProvisioningService.ts',
    'packages/shared/src/services/platform-admin/ProjectMemberService.ts',
    'packages/shared/src/services/platform-admin/EngineService.ts',
    'packages/shared/src/services/platform-admin/project-member-role-assignments.ts',
    'packages/shared/src/services/platform-admin/legacy-project-role-assignments.ts',
    'packages/shared/src/services/platform-admin/permissions.ts',
    'packages/shared/src/middleware/auth.ts', 'packages/shared/src/utils/jwt.ts',
    'packages/shared/src/infrastructure/persistence/entities/RefreshToken.ts',
    'packages/shared/src/infrastructure/persistence/entities/User.ts',
    'packages/shared/src/infrastructure/persistence/entities/IdentityProvider.ts',
    'packages/shared/src/infrastructure/persistence/entities/Invitation.ts',
    'packages/backend-host/src/modules/auth/routes/refresh.ts',
    'packages/backend-host/src/modules/auth/routes/logout.ts',
    'packages/backend-host/src/modules/auth/routes/identity-oidc.ts',
    'packages/backend-host/src/modules/auth/routes/onboarding.ts',
    'packages/backend-host/src/modules/auth/routes/sso-state.ts',
    'packages/backend-host/src/modules/invitations/routes/invitations.ts',
    'packages/shared/src/schemas/platform-admin/invitation.ts',
    'packages/frontend-host/src/pages/AcceptInvite.tsx',
    'frontend/__tests__/src/pages/AcceptInvite.test.tsx',
    'packages/backend-host/src/modules/tenancy/routes/tenants.ts',
    'backend/test/qualification/sessionRevocationRace.test.ts',
    'backend/__tests__/shared/services/authSessionLineage.test.ts',
    'backend/__tests__/shared/services/pooledInvitationEnrollment.test.ts',
    'backend/__tests__/shared/services/platform-admin/pooledIdentityLinking.test.ts',
    'scripts/native-tenancy-postgres-runner.test.mjs',
  ]) assert.equal(classifyChangedFiles([file]).run_native_tenancy, true, file);
  const runner = readFileSync(new URL('./run-native-tenancy-postgres-rls.sh', import.meta.url), 'utf8');
  assert.match(runner, /SESSION_RACE_DISPOSABLE_POSTGRES=true/);
  assert.match(runner, /test\/qualification\/sessionRevocationRace\.test\.ts/);
});

test('image and plugin work is independently gated from application tests', () => {
  assert.match(ciWorkflow, /frontend-tests:[\s\S]*?if: needs\.detect\.outputs\.run_frontend_tests == 'true'/);
  const focusedFrontendJob = ciWorkflow
    .split('\n  frontend-tests:')[1]
    .split('\n  test:')[0];
  for (const command of [
    'pnpm --filter frontend-host run typecheck',
    'pnpm --filter webmodeler-frontend run typecheck',
    'pnpm --filter webmodeler-frontend run test:unit',
    'pnpm --dir packages/frontend-host exec vitest run --config vitest.config.ts',
    'pnpm exec eslint frontend packages/frontend-host --max-warnings=0',
  ]) assert.match(focusedFrontendJob, new RegExp(command.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(focusedFrontendJob, /postgres|oracle|webmodeler-backend|DATABASE_TYPE/i);
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

test('tenant activation and lifecycle service changes trigger the physical database workflow on PR and main', () => {
  for (const name of ['TenantService', 'TenantReleaseWorkAssignmentService']) {
    const path = `packages/shared/src/services/platform-admin/${name}.ts`;
    assert.equal(databaseWorkflow.split(`"${path}"`).length - 1, 2);
    assert.equal(classifyChangedFiles([path]).run_database_matrix, true);
  }
});
