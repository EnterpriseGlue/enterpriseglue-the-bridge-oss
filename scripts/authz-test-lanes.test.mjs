import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const scripts = packageJson.scripts;
const localOidcRehearsalRunner = readFileSync(new URL('./run-local-oidc-rehearsal-test.sh', import.meta.url), 'utf8');
const localSamlRehearsalRunner = readFileSync(new URL('./run-local-saml-rehearsal-test.sh', import.meta.url), 'utf8');
const localLdapRehearsalRunner = readFileSync(new URL('./run-local-ldap-rehearsal-test.sh', import.meta.url), 'utf8');
const ldapProtocolMockRunner = readFileSync(new URL('./run-ldap-protocol-mock.sh', import.meta.url), 'utf8');
const localEntraOidcRehearsalRunner = readFileSync(new URL('./run-local-entra-oidc-rehearsal-test.sh', import.meta.url), 'utf8');
const realEntraOidcRehearsalRunner = readFileSync(new URL('./run-entra-id-rehearsal.sh', import.meta.url), 'utf8');
const localOidcConfigureRunner = readFileSync(new URL('./configure-local-oidc-provider.sh', import.meta.url), 'utf8');
const localLdapConfigureRunner = readFileSync(new URL('./configure-local-ldap-provider.sh', import.meta.url), 'utf8');
const ciIdentityProtocolRehearsalRunner = readFileSync(new URL('./run-ci-identity-protocol-rehearsals.sh', import.meta.url), 'utf8');
const identityProtocolRehearsalCompose = readFileSync(new URL('../infra/docker/compose/docker-compose.identity-protocol-rehearsal.yml', import.meta.url), 'utf8');
const localAuthzSmokeRunner = readFileSync(new URL('./run-authz-local-login-test.sh', import.meta.url), 'utf8');
const localSeededAuthzSmokeRunner = readFileSync(new URL('./run-authz-local-seeded-smoke.sh', import.meta.url), 'utf8');
const localCrossBrowserAuthzRunner = readFileSync(new URL('./run-authz-local-seeded-cross-browser.sh', import.meta.url), 'utf8');
const localContainerWebkitRunner = readFileSync(new URL('./run-authz-local-seeded-webkit-container.sh', import.meta.url), 'utf8');
const accessibilityMatrixRunner = readFileSync(new URL('./run-authz-accessibility-matrix.sh', import.meta.url), 'utf8');
const browserEvidenceWriter = readFileSync(new URL('./write-authz-browser-evidence.mjs', import.meta.url), 'utf8');
const e2eGlobalSetup = readFileSync(new URL('../test/e2e/setup/global-setup.ts', import.meta.url), 'utf8');
const e2eGlobalTeardown = readFileSync(new URL('../test/e2e/setup/global-teardown.ts', import.meta.url), 'utf8');
const authzPrWorkflow = readFileSync(new URL('../.github/workflows/authz-pr.yml', import.meta.url), 'utf8');
const identityProtocolRehearsalWorkflow = readFileSync(new URL('../.github/workflows/identity-protocol-rehearsal.yml', import.meta.url), 'utf8');
const entraIdRehearsalWorkflow = readFileSync(new URL('../.github/workflows/entra-id-rehearsal.yml', import.meta.url), 'utf8');
const identityBrowserRunner = readFileSync(new URL('./run-identity-browser-test.sh', import.meta.url), 'utf8');
const authzRefactorRunner = readFileSync(new URL('./run-local-safe-authz-refactor.sh', import.meta.url), 'utf8');
const authzMutationRunner = readFileSync(new URL('./run-authz-mutation-tests.mjs', import.meta.url), 'utf8');
const customRoleMatrixRunner = readFileSync(new URL('./run-local-safe-custom-role-matrix.sh', import.meta.url), 'utf8');
const frontendAuthTypes = readFileSync(new URL('../packages/frontend-host/src/shared/types/auth.ts', import.meta.url), 'utf8');
const frontendAuthService = readFileSync(new URL('../packages/frontend-host/src/services/auth.ts', import.meta.url), 'utf8');
const frontendAuthzApi = readFileSync(new URL('../packages/frontend-host/src/features/platform-admin/hooks/useAuthzApi.ts', import.meta.url), 'utf8');
const frontendSharedApiTypes = readFileSync(new URL('../packages/frontend-host/src/shared/api/types.ts', import.meta.url), 'utf8');
const frontendInvitationFlow = readFileSync(new URL('../packages/frontend-host/src/shared/utils/invitationFlow.ts', import.meta.url), 'utf8');
const engineMembersModal = readFileSync(new URL('../packages/frontend-host/src/features/mission-control/engines/components/EngineMembersModal.tsx', import.meta.url), 'utf8');
const projectDetailPage = readFileSync(new URL('../packages/frontend-host/src/features/starbase/pages/ProjectDetail.tsx', import.meta.url), 'utf8');
const projectDeploymentTargetsModal = readFileSync(new URL('../packages/frontend-host/src/features/starbase/components/project-detail/ProjectDeploymentTargetsModal.tsx', import.meta.url), 'utf8');
const configurationBundleSettingsTab = readFileSync(new URL('../packages/frontend-host/src/features/platform-admin/components/ConfigurationBundleSettingsTab.tsx', import.meta.url), 'utf8');
const openApiSource = readFileSync(new URL('../packages/shared/src/schemas/openapi.ts', import.meta.url), 'utf8');
const sharedAuthContractSource = readFileSync(new URL('../packages/shared/src/contracts/auth.ts', import.meta.url), 'utf8');
const localLanes = ['test:authz:identity', 'test:authz:config', 'test:authz:runtime'];
const expectedLeafChecks = [
  'test:identity-contract',
  'test:identity-integration',
  'test:identity-persistence',
  'test:identity-provider-key-identity',
  'test:identity-mapping-config-key',
  'test:identity-mapping-matrix',
  'test:identity-protocol-mocks',
  'test:config-bundles',
  'test:docker-config-bundles',
  'test:openshift-config-bundles',
  'test:config-bundle-cicd',
  'test:documentation-contracts',
  'test:secret-boundaries',
  'test:target-ownership',
  'test:engine-import',
  'test:action-registry',
  'test:authz:exhaustive-contracts',
  'test:assignment-targets',
  'test:authz-group-key-identity',
  'test:managed-resource-key-identities',
  'test:runtime-resource-persistence',
  'test:deployment-lineage-persistence',
  'test:engine-connection-resolver',
  'test:deployment-eligibility-contract',
];

function invokedScripts(command) {
  return [...command.matchAll(/pnpm run ([\w:-]+)/g)].map((match) => match[1]);
}

test('the authz refactor aggregate composes the three local-safe lanes', () => {
  assert.match(scripts['test:authz-refactor'], /run-local-safe-authz-refactor\.sh/);
  assert.deepEqual(invokedScripts(authzRefactorRunner), [
    'test:authz:structure',
    ...localLanes,
  ]);
  assert.match(authzRefactorRunner, /EG_ENV_FILE/);
  assert.match(authzRefactorRunner, /POSTGRES_HOST/);
  assert.match(authzRefactorRunner, /POSTGRES_URL/);
});

test('the authorization structure gate requires exhaustive registry action coverage', () => {
  assert.match(scripts['test:authz:structure'], /guard:backend-authz/);
  assert.match(scripts['test:authz:structure'], /guard:authz-test-coverage/);
  assert.match(scripts['test:authz:structure'], /test:authz:machine-principal-coverage/);
  assert.match(scripts['test:authz:structure'], /test:authz:policy-coverage/);
  assert.match(scripts['test:authz:structure'], /test:authz:api-client-middleware-coverage/);
  assert.match(scripts['test:authz:structure'], /test:authz:require-action-coverage/);
  assert.match(scripts['test:authz:structure'], /authz-test-lanes\.test\.mjs/);
});

test('the pull-request authorization gate keeps decision coverage and focused failure modes explicit', () => {
  assert.match(scripts['test:authz:pr'], /authorization-model-randomized\.test\.ts/);
  assert.match(scripts['test:authz:pr'], /custom-role-scope-matrix\.test\.ts/);
  assert.match(scripts['test:authz:pr'], /machine-principal-authz\.test\.ts/);
  assert.match(scripts['test:authz:pr'], /bpmn-engine-client\.test\.ts/);
  assert.match(scripts['test:authz:pr'], /process-instances\/routes\.test\.ts/);
  assert.match(scripts['test:authz:pr'], /history-extended\.test\.ts/);
  assert.match(scripts['test:authz:pr'], /shared\/tasks\.test\.ts/);

  const coverage = scripts['test:authz:decision-coverage'];
  assert.match(coverage, /permissions\.test\.ts/);
  assert.match(coverage, /services\/platform-admin\/permissions\.ts/);
  assert.match(coverage, /coverage\.reportsDirectory coverage\/authz-decisions/);
  assert.match(coverage, /coverage\.thresholds\.branches 60/);
  assert.match(coverage, /coverage\.thresholds\.lines 70/);
});

test('the pull-request workflow retains browser and database evidence when authorization fails', () => {
  assert.match(authzPrWorkflow, /name: Authorization Browser Gate/);
  assert.match(authzPrWorkflow, /pnpm run test:authz:pr/);
  assert.match(authzPrWorkflow, /pnpm run test:authz:mutation/);
  assert.match(authzPrWorkflow, /pnpm run test:authz:decision-coverage/);
  assert.match(authzPrWorkflow, /pnpm --filter frontend-host run build/);
  assert.match(authzPrWorkflow, /curl -sf http:\/\/localhost:5173\/src\/main\.tsx/);
  assert.match(authzPrWorkflow, /cron: "15 3 \* \* \*"/);
  assert.match(authzPrWorkflow, /\["chromium"\]/);
  assert.match(authzPrWorkflow, /\["firefox", "webkit"\]/);
  assert.match(authzPrWorkflow, /PLAYWRIGHT_BROWSERS=\$\{\{ matrix\.browser \}\}/);
  assert.match(authzPrWorkflow, /fine-grained-access-local\.spec\.ts/);
  assert.match(authzPrWorkflow, /variable-access-control-local\.spec\.ts/);
  assert.match(authzPrWorkflow, /adapter-backstop-changes:/);
  assert.match(authzPrWorkflow, /pull-requests: read/);
  assert.match(authzPrWorkflow, /github\.paginate\(github\.rest\.pulls\.listFiles/);
  assert.match(authzPrWorkflow, /core\.setOutput\('should_run', String\(relevant\)\)/);
  assert.match(authzPrWorkflow, /needs\.adapter-backstop-changes\.outputs\.should_run == 'true'/);
  assert.match(authzPrWorkflow, /adapter-backstop:/);
  assert.match(authzPrWorkflow, /adapter-backstop:[\s\S]*?services:[\s\S]*?image: postgres:17/);
  assert.match(authzPrWorkflow, /adapter-backstop:[\s\S]*?POSTGRES_HOST: localhost/);
  assert.match(authzPrWorkflow, /adapter-backstop:[\s\S]*?ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/);
  assert.match(authzPrWorkflow, /adapter-backstop:[\s\S]*?Create PostgreSQL schema/);
  assert.match(authzPrWorkflow, /adapter-backstop:[\s\S]*?Sync database schema/);
  assert.match(authzPrWorkflow, /Upload adapter\/backstop diagnostics[\s\S]*?if: failure\(\)/);
  assert.match(authzPrWorkflow, /test:authz:adapter-backstop/);
  assert.match(authzPrWorkflow, /Capture database diagnostics on failure/);
  assert.match(authzPrWorkflow, /test\/results/);
  assert.match(authzPrWorkflow, /backend\/coverage\/authz-decisions/);
});

test('machine-principal services retain literal 100 percent source coverage', () => {
  const command = scripts['test:authz:machine-principal-coverage'];
  assert.match(command, /apiClientService\.test\.ts/);
  assert.match(command, /serviceAccountService\.test\.ts/);
  assert.match(command, /coverage\.allowExternal true/);
  assert.match(command, /coverage\.thresholds\.100 true/);
  assert.match(command, /coverage\.thresholds\.perFile true/);
});

test('the authorization policy service retains literal 100 percent source coverage', () => {
  const command = scripts['test:authz:policy-coverage'];
  assert.match(command, /policyService\.test\.ts/);
  assert.match(command, /PolicyService\.ts/);
  assert.match(command, /coverage\.allowExternal true/);
  assert.match(command, /coverage\.thresholds\.100 true/);
  assert.match(command, /coverage\.thresholds\.perFile true/);
});

test('the API-client authorization middleware retains literal 100 percent source coverage', () => {
  const command = scripts['test:authz:api-client-middleware-coverage'];
  assert.match(command, /apiClientAuth\.test\.ts/);
  assert.match(command, /apiClientAuth\.ts/);
  assert.match(command, /coverage\.allowExternal true/);
  assert.match(command, /coverage\.thresholds\.100 true/);
  assert.match(command, /coverage\.thresholds\.perFile true/);
});

test('the shared authorization middleware retains literal 100 percent source coverage', () => {
  const command = scripts['test:authz:require-action-coverage'];
  assert.match(command, /requireAction\.test\.ts/);
  assert.match(command, /middleware\/requireAction\.ts/);
  assert.match(command, /coverage\.allowExternal true/);
  assert.match(command, /coverage\.thresholds\.100 true/);
  assert.match(command, /coverage\.thresholds\.perFile true/);
});

test('the local-safe lanes preserve every focused authorization check once', () => {
  const leafChecks = localLanes.flatMap((lane) => invokedScripts(scripts[lane]));
  assert.deepEqual(leafChecks, expectedLeafChecks);
  assert.equal(new Set(leafChecks).size, leafChecks.length, 'each focused check belongs to one lane');
});

test('browser, credentialed local authorization, and LDAP-container boundaries stay opt-in', () => {
  const localCommands = [...localLanes]
    .map((name) => scripts[name])
    .concat(authzRefactorRunner)
    .join(' ');

  assert.doesNotMatch(localCommands, /test:(?:identity:(?:browser|ldap)|authz:local-(?:login|access-control|smoke))/);
});

test('credentialed local authorization smokes use the guarded runner', () => {
  assert.match(scripts['test:authz:local-login'], /run-authz-local-login-test\.sh/);
  assert.match(scripts['test:authz:local-access-control'], /run-authz-local-login-test\.sh/);
  assert.match(scripts['test:authz:local-smoke'], /run-authz-local-login-test\.sh/);
  assert.match(scripts['test:authz:local-smoke'], /test\/e2e\/smoke\/login\.spec\.ts/);
  assert.match(scripts['test:authz:local-smoke'], /test\/e2e\/smoke\/access-control-local\.spec\.ts/);
  assert.match(localAuthzSmokeRunner, /PLAYWRIGHT_LOCAL_CA_FILE/);
  assert.match(localAuthzSmokeRunner, /PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true/);
  assert.match(localAuthzSmokeRunner, /localhost, loopback, or a \.local host/);
});

test('seeded local authorization smoke confines temporary fixtures to the local Compose database', () => {
  assert.match(scripts['test:authz:local-smoke:seeded'], /run-authz-local-seeded-smoke\.sh/);
  assert.match(localSeededAuthzSmokeRunner, /E2E_SEED_USER=true/);
  assert.match(localSeededAuthzSmokeRunner, /E2E_DIRECT_DB_CLEANUP=true/);
  assert.match(localSeededAuthzSmokeRunner, /E2E_SEED_FILE=/);
  assert.match(localSeededAuthzSmokeRunner, /POSTGRES_HOST=127\.0\.0\.1/);
  assert.match(localSeededAuthzSmokeRunner, /docker compose.*port db 5432/);
  assert.match(localSeededAuthzSmokeRunner, /docker-compose\.e2e-mission-control\.yml/);
  assert.match(localSeededAuthzSmokeRunner, /up -d --wait camunda-mock/);
  assert.match(localSeededAuthzSmokeRunner, /E2E_CAMUNDA_BASE_URL/);
  assert.match(localSeededAuthzSmokeRunner, /PLAYWRIGHT_LOCAL_CA_FILE/);
  assert.match(localSeededAuthzSmokeRunner, /PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true/);
  assert.match(localSeededAuthzSmokeRunner, /localhost, loopback, or a \.local host/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/login\.spec\.ts/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/access-control-local\.spec\.ts/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/fine-grained-access-local\.spec\.ts/);
  assert.match(e2eGlobalSetup, /process\.env\.E2E_SEED_FILE/);
  assert.match(e2eGlobalSetup, /const runtimeEngineBaseUrl = process\.env\.E2E_CAMUNDA_BASE_URL\s*\|\|\s*process\.env\.CAMUNDA_BASE_URL\s*\|\|\s*'http:\/\/camunda-mock:9080\/engine-rest'/);
  assert.match(e2eGlobalSetup, /assertLocalUrl\(API_BASE_URL\)/);
  assert.match(e2eGlobalSetup, /assertLocalDatabaseTarget\(\)/);
  assert.match(e2eGlobalTeardown, /assertLocalUrl\(API_BASE_URL\)/);
  assert.match(e2eGlobalTeardown, /assertLocalDatabaseTarget\(\)/);
});

test('cross-browser authorization writes sanitized evidence only after all targets pass', () => {
  assert.match(scripts['test:authz:local-smoke:cross-browser'], /bash \.\/scripts\/run-authz-local-seeded-cross-browser\.sh/);
  assert.match(localCrossBrowserAuthzRunner, /for browser in chromium/);
  assert.match(localCrossBrowserAuthzRunner, /PLAYWRIGHT_FIREFOX_EXECUTION/);
  assert.match(localCrossBrowserAuthzRunner, /PLAYWRIGHT_WEBKIT_EXECUTION/);
  assert.match(localCrossBrowserAuthzRunner, /run_firefox/);
  assert.match(localCrossBrowserAuthzRunner, /run-authz-local-seeded-webkit-container\.sh/);
  assert.match(localCrossBrowserAuthzRunner, /write-authz-browser-evidence\.mjs/);
  assert.ok(
    localCrossBrowserAuthzRunner.indexOf('write-authz-browser-evidence.mjs')
      > localCrossBrowserAuthzRunner.indexOf('done'),
  );
  assert.match(browserEvidenceWriter, /engine-tenancy-release/);
  assert.match(browserEvidenceWriter, /browser-matrix\.json/);
  assert.match(browserEvidenceWriter, /releaseCommitQualified/);
  assert.match(browserEvidenceWriter, /containsCredentials: false/);
  assert.match(browserEvidenceWriter, /containsTokens: false/);
  assert.match(browserEvidenceWriter, /'chromium', 'firefox', 'webkit'/);
  assert.match(browserEvidenceWriter, /direct_url_revalidation/);
  assert.match(browserEvidenceWriter, /multi_tab_revalidation/);
  assert.match(browserEvidenceWriter, /session_refresh_revalidation/);
  assert.match(browserEvidenceWriter, /back_forward_cache_revalidation/);
});

test('the macOS WebKit fallback remains an egress-isolated local Docker lane', () => {
  assert.match(localContainerWebkitRunner, /localhost, loopback, or a \.local host/);
  assert.match(localContainerWebkitRunner, /docker network create --internal/);
  assert.match(localContainerWebkitRunner, /--network "\$runner_network"/);
  assert.match(localContainerWebkitRunner, /attach_local_service "\$frontend_tls_container" frontend-tls/);
  assert.match(localContainerWebkitRunner, /attach_local_service "\$db_container" db/);
  assert.match(localContainerWebkitRunner, /E2E_LOCAL_COMPOSE_NETWORK=true/);
  assert.match(localContainerWebkitRunner, /POSTGRES_HOST=db/);
  assert.match(localContainerWebkitRunner, /--network none/);
  assert.match(localContainerWebkitRunner, /--network bridge/);
  assert.match(localContainerWebkitRunner, /COREPACK_HOME/);
  assert.match(localContainerWebkitRunner, /--offline/);
  assert.match(localContainerWebkitRunner, /E2E_CAMUNDA_BASE_URL=http:\/\/camunda-mock:9080\/engine-rest/);
  assert.match(localContainerWebkitRunner, /E2E_SEED_USER=true/);
  assert.match(localContainerWebkitRunner, /E2E_DIRECT_DB_CLEANUP=true/);
  assert.match(localContainerWebkitRunner, /PLAYWRIGHT_CONTAINER_BROWSER/);
  assert.match(localContainerWebkitRunner, /firefox or webkit/);
  assert.match(localContainerWebkitRunner, /seeded-smoke or accessibility/);
  assert.match(localContainerWebkitRunner, /mcr\.microsoft\.com\/playwright@sha256:8a0360d39d1973be506dd59002904a774f6d697d4946c94063b3fd006461c8ff/);
  assert.match(localContainerWebkitRunner, /test\/e2e\/smoke\/fine-grained-access-local\.spec\.ts/);
  assert.match(localContainerWebkitRunner, /test\/e2e\/smoke\/variable-access-control-local\.spec\.ts/);
});

test('the accessibility matrix uses the same local browser fallback without opening a database fixture', () => {
  assert.match(scripts['test:authz:accessibility:cross-browser'], /bash \.\/scripts\/run-authz-accessibility-matrix\.sh/);
  assert.match(accessibilityMatrixRunner, /PLAYWRIGHT_FIREFOX_EXECUTION/);
  assert.match(accessibilityMatrixRunner, /PLAYWRIGHT_WEBKIT_EXECUTION/);
  assert.match(accessibilityMatrixRunner, /PLAYWRIGHT_CONTAINER_SUITE=accessibility/);
  assert.match(accessibilityMatrixRunner, /E2E_SEED_USER=false/);
  assert.match(accessibilityMatrixRunner, /identity-administration-accessibility\.spec\.ts/);
  assert.match(accessibilityMatrixRunner, /write-authz-accessibility-evidence\.mjs/);
});

test('the authorization mutation guard kills every required tenancy fault class and retains evidence', () => {
  assert.match(scripts['test:authz:mutation'], /run-authz-mutation-tests\.mjs/);
  assert.match(authzMutationRunner, /requireAction\.test\.ts/);
  assert.match(authzMutationRunner, /apiClientAuth\.test\.ts/);
  assert.match(authzMutationRunner, /engineTenantMappingService\.test\.ts/);
  assert.match(authzMutationRunner, /for \(const testFile of focusedTests\)/);
  assert.match(authzMutationRunner, /user action deny bypass/);
  assert.match(authzMutationRunner, /API client deny bypass/);
  assert.match(authzMutationRunner, /removed-tenant-filter/);
  assert.match(authzMutationRunner, /inverted-ownership-check/);
  assert.match(authzMutationRunner, /accepted-null-tenant-context/);
  assert.match(authzMutationRunner, /skipped-mapping-version-check/);
  assert.match(authzMutationRunner, /upstream-call-after-denial/);
  assert.match(authzMutationRunner, /runtime batch partial-permission bypass/);
  assert.match(authzMutationRunner, /mutation-report\.json/);
  assert.match(authzMutationRunner, /Authorization mutant survived/);
});

test('the fine-grained authorization lane combines scope, machine-principal, policy, runtime, and mutation evidence', () => {
  const command = scripts['test:authz:fine-grained'];
  assert.match(command, /services\/platform-admin\/permissions\.test\.ts/);
  assert.match(command, /test:authz:variable-boundary/);
  assert.match(command, /test:authz:machine-principal-coverage/);
  assert.match(command, /test:authz:policy-coverage/);
  assert.match(command, /test:authz:require-action-coverage/);
  assert.match(command, /test:authz:mutation/);

  const localCommand = scripts['test:authz:fine-grained:local'];
  assert.match(localCommand, /test:authz:fine-grained/);
  assert.match(localCommand, /test:authz:custom-role-matrix:local/);
  assert.match(localCommand, /test:authz:local-smoke:seeded/);
  assert.match(scripts['test:authz:custom-role-matrix:local'], /run-local-safe-custom-role-matrix\.sh/);
  assert.match(customRoleMatrixRunner, /EG_ENV_FILE/);
  assert.match(customRoleMatrixRunner, /local-safe-test\.env/);
  assert.match(customRoleMatrixRunner, /machine-principal-authz\.test\.ts/);
});

test('the disposable local administrator has canonical break-glass memberships', () => {
  assert.match(e2eGlobalSetup, /system\.group\.authenticated_users/);
  assert.match(e2eGlobalSetup, /system\.group\.platform_administrators/);
  assert.match(e2eGlobalSetup, /INSERT INTO \$\{schema\}\.authz_group_memberships/);
  assert.match(e2eGlobalSetup, /INSERT INTO \$\{schema\}\.tenant_memberships/);
  assert.match(e2eGlobalSetup, /information_schema\.tables WHERE table_schema = \$1 AND table_name = 'tenant_memberships'/);
  assert.match(e2eGlobalSetup, /const addTenantMembership = async/);
  assert.match(e2eGlobalTeardown, /async function tenantMembershipsSupported/);
  assert.match(e2eGlobalSetup, /e2e-smoke-fixture:\$\{userId\}/);
  assert.match(e2eGlobalSetup, /e2e-group-scope-/);
  assert.match(e2eGlobalSetup, /principalType: 'group'/);
  assert.doesNotMatch(e2eGlobalSetup, /platform_role/);
});

test('the frontend effective-permissions snapshot imports the shared authorization contract', () => {
  assert.match(frontendAuthTypes, /@enterpriseglue\/shared\/schemas\/platform-admin\/authz\.js/);
  assert.match(frontendAuthTypes, /CurrentUserPermissions/);
  assert.doesNotMatch(frontendAuthTypes, /CurrentUserPermissions,\s*\n\s*EffectiveResourcePermissions,\s*\n[\s\S]*?@enterpriseglue\/shared\/contracts\/auth\.js/);
  assert.match(frontendAuthService, /CurrentUserPermissionsSchema\.parse\(await apiClient\.get<unknown>\('\/api\/authz\/me\/permissions'/);
  assert.match(frontendAuthzApi, /CurrentUserPermissionsSchema\.parse\(await apiClient\.get<unknown>\('\/api\/authz\/me\/permissions'/);
});

test('the frontend shared API type barrel re-exports canonical transport schemas', () => {
  assert.doesNotMatch(frontendSharedApiTypes, /\binterface\s+(?:Project|File|Version|Comment|Engine|ProcessDefinition|ProcessInstance)\b/);
  assert.match(frontendSharedApiTypes, /@enterpriseglue\/shared\/schemas\/starbase\/project\.js/);
  assert.match(frontendSharedApiTypes, /@enterpriseglue\/shared\/schemas\/starbase\/file\.js/);
  assert.match(frontendSharedApiTypes, /@enterpriseglue\/shared\/schemas\/mission-control\/process\.js/);
});

test('the auth contract has one generated declaration source', () => {
  assert.match(sharedAuthContractSource, /role\?: PlatformRole/);
  for (const contract of ['auth', 'index']) {
    for (const extension of ['d.ts', 'js']) {
      assert.equal(
        existsSync(new URL(`../packages/shared/src/contracts/${contract}.${extension}`, import.meta.url)),
        false,
        `a hand-maintained ${contract}.${extension} sibling can drift from the generated public contract`,
      );
    }
  }
});

test('the invitation delivery helper uses the shared capabilities contract', () => {
  assert.match(frontendInvitationFlow, /@enterpriseglue\/shared\/schemas\/platform-admin\/invitation\.js/);
  assert.match(frontendInvitationFlow, /InvitationCapabilitiesResponse/);
  assert.match(frontendInvitationFlow, /InvitationDeliveryMethod as SharedInvitationDeliveryMethod/);
  assert.doesNotMatch(frontendInvitationFlow, /export interface InvitationCapabilities/);
});

test('scoped engine and project assignment mutations use shared transport contracts', () => {
  for (const source of [engineMembersModal, projectDetailPage]) {
    assert.match(source, /RoleAssignmentCreate,/);
    assert.match(source, /RoleAssignmentCreateResponse,/);
    assert.doesNotMatch(source, /apiClient\.post<\{\s*id:\s*string\s*\}>\('\/api\/authz\/role-assignments'/);
  }
});

test('project deployment target mutations and project-scoped OpenAPI responses reuse shared contracts', () => {
  assert.match(projectDeploymentTargetsModal, /AuthzCreatedIdResponse,/);
  assert.match(projectDeploymentTargetsModal, /AuthzMutationSuccessResponse,/);
  assert.match(projectDeploymentTargetsModal, /ProjectEngineTarget(Create|Update|SyncLegacyResponse),/);
  assert.doesNotMatch(projectDeploymentTargetsModal, /apiClient\.(?:post|put)<\{\s*(?:id:\s*string|success:\s*boolean|createdOrUpdated:\s*number)\s*\}>/);
  assert.match(openApiSource, /path: '\/starbase-api\/projects\/\{projectId\}\/deployment-targets\/sync-legacy'.*ProjectEngineTargetSyncLegacyResponseSchema/);
  assert.match(openApiSource, /path: '\/starbase-api\/projects\/\{projectId\}\/deployment-targets'.*AuthzCreatedIdResponseSchema/);
  assert.match(openApiSource, /path: '\/starbase-api\/projects\/\{projectId\}\/deployment-targets\/\{targetId\}'.*AuthzMutationSuccessResponseSchema/);
});

test('configuration remote import reuses the canonical bundle envelope', () => {
  assert.match(configurationBundleSettingsTab, /ConfigBundleRequest/);
  assert.match(configurationBundleSettingsTab, /apiClient\.post<ConfigBundleRequest>\('\/api\/authz\/config-bundles\/import-url'/);
  assert.doesNotMatch(configurationBundleSettingsTab, /apiClient\.post<\{\s*bundle:\s*unknown;\s*files:\s*Record<string, unknown>\s*\}>\('\/api\/authz\/config-bundles\/import-url'/);
});

test('the live local OIDC rehearsal is opt-in and guarded to local browser targets', () => {
  assert.match(scripts['test:oidc:local-rehearsal'], /run-local-oidc-rehearsal-test\.sh/);
  assert.match(localOidcRehearsalRunner, /LOCAL_OIDC_REHEARSAL=true/);
  assert.match(localOidcRehearsalRunner, /PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true/);
  assert.match(localOidcRehearsalRunner, /localhost, loopback, or a \.local host/);
  assert.match(localOidcRehearsalRunner, /for _ in \{1\.\.30\}/);
  assert.match(localOidcRehearsalRunner, /sleep 1/);
  assert.match(localOidcRehearsalRunner, /source "\$admin_env_file"/);
  assert.match(localOidcRehearsalRunner, /PLAYWRIGHT_BASE_URL:-\$\{FRONTEND_URL:-https:\/\/localhost:\$\{KEYCLOAK_HTTPS_FRONTEND_PORT:-5443\}\}/);
  assert.match(localOidcRehearsalRunner, /LOCAL_OIDC_ISSUER_URL:-https:\/\/localhost:\$\{KEYCLOAK_HOST_PORT:-8180\}/);
  assert.match(localOidcRehearsalRunner, /LOCAL_OIDC_AUTHORIZATION_REHEARSAL=true[\s\\]+LOCAL_OIDC_ISSUER_URL="\$issuer_url"/);
  assert.match(localOidcRehearsalRunner, /LOCAL_OIDC_CONFIG_AUTHORIZATION_REHEARSAL=true/);
  assert.match(localOidcRehearsalRunner, /local-oidc-config-authorization\.spec\.ts/);
  assert.match(localOidcConfigureRunner, /groupClaim:"groups"/);
  assert.match(localOidcConfigureRunner, /expectedAudience:\$clientId/);
  assert.match(localOidcConfigureRunner, /triggers:\["login","manual"\]/);
  assert.match(localOidcConfigureRunner, /incompleteEntitlements:"fail_closed"/);
});

test('the Entra compatibility lanes distinguish local claim compatibility from opt-in real-tenant evidence', () => {
  assert.match(scripts['test:entra:compatibility'], /identityProviderMockContracts\.test\.ts/);
  assert.match(scripts['test:entra:compatibility'], /identityProviderProvisioningService\.test\.ts/);
  assert.match(scripts['test:entra:local-rehearsal'], /run-local-entra-oidc-rehearsal-test\.sh/);
  assert.match(scripts['test:entra:real-rehearsal'], /run-entra-id-rehearsal\.sh/);
  assert.match(localEntraOidcRehearsalRunner, /LOCAL_OIDC_CLIENT_ID.*enterpriseglue-local-entra/);
  assert.match(localEntraOidcRehearsalRunner, /LOCAL_OIDC_ENTITLEMENT_TYPE.*role/);
  assert.match(localEntraOidcRehearsalRunner, /LOCAL_OIDC_ENTITLEMENT_ID.*enterpriseglue\.engine_operator/);
  assert.match(realEntraOidcRehearsalRunner, /ENTRA_ID_REHEARSAL_ENABLED/);
  assert.match(realEntraOidcRehearsalRunner, /ENTRA_ID_REHEARSAL_TEST_TENANT/);
  assert.match(realEntraOidcRehearsalRunner, /ENTRA_ID_REHEARSAL_ALLOW_EXTERNAL/);
  assert.match(realEntraOidcRehearsalRunner, /OIDC_REHEARSAL_PROFILE=entra-id/);
  assert.match(realEntraOidcRehearsalRunner, /E2E_SEED_USER=false/);
  assert.match(realEntraOidcRehearsalRunner, /ENTRA_ID_REHEARSAL_CLIENT_SECRET_REF/);
  assert.match(entraIdRehearsalWorkflow, /environment: entra-id-test/);
  assert.match(entraIdRehearsalWorkflow, /ENTRA_ID_REHEARSAL_SCHEDULED/);
  assert.match(entraIdRehearsalWorkflow, /pnpm run test:entra:real-rehearsal/);
});

test('the identity browser lifecycle runner accepts the generated local TLS CA', () => {
  assert.match(scripts['test:e2e:identity-lifecycle'], /run-identity-browser-test\.sh/);
  assert.match(identityBrowserRunner, /PLAYWRIGHT_LOCAL_CA_FILE/);
  assert.match(identityBrowserRunner, /PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true/);
  assert.match(identityBrowserRunner, /localhost, loopback, or a \.local host/);
});

test('the live local SAML rehearsal is opt-in and guarded to local browser targets', () => {
  assert.match(scripts['test:saml:local-rehearsal'], /run-local-saml-rehearsal-test\.sh/);
  assert.match(localSamlRehearsalRunner, /LOCAL_SAML_REHEARSAL=true/);
  assert.match(localSamlRehearsalRunner, /PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true/);
  assert.match(localSamlRehearsalRunner, /localhost, loopback, or a \.local host/);
  assert.match(localSamlRehearsalRunner, /load_local_admin_credentials\nbase_url="\$\{PLAYWRIGHT_BASE_URL:-\$\{FRONTEND_URL:-https:\/\/localhost:\$\{KEYCLOAK_HTTPS_FRONTEND_PORT:-5443\}\}\}"/);
  assert.match(localSamlRehearsalRunner, /LOCAL_SAML_ISSUER_URL:-https:\/\/localhost:\$\{KEYCLOAK_HOST_PORT:-8180\}/);
  assert.match(localSamlRehearsalRunner, /LOCAL_SAML_ADMIN_ENV_FILE/);
  assert.match(localSamlRehearsalRunner, /LOCAL_SAML_SIGNING_CERT_FILE/);
});

test('the live local LDAP rehearsal is opt-in, fixture-backed, and guarded to local browser targets', () => {
  assert.match(scripts['test:ldap:local-rehearsal'], /run-local-ldap-rehearsal-test\.sh/);
  assert.match(localLdapRehearsalRunner, /LOCAL_LDAP_FIXTURE_ACTIVE=true/);
  assert.match(localLdapRehearsalRunner, /LOCAL_LDAP_REHEARSAL=true/);
  assert.match(localLdapRehearsalRunner, /run-ldap-protocol-mock\.sh/);
  assert.match(localLdapRehearsalRunner, /localhost, loopback, or a \.local host/);
  assert.match(localLdapRehearsalRunner, /-z "\$\{ADMIN_EMAIL:-\}"/);
  assert.match(localLdapRehearsalRunner, /LOCAL_LDAP_ADMIN_EMAIL/);
  assert.match(localLdapRehearsalRunner, /source "\$rehearsal_env_file"/);
  assert.match(localLdapRehearsalRunner, /PLAYWRIGHT_BASE_URL:-\$\{FRONTEND_URL:-https:\/\/localhost:\$\{KEYCLOAK_HTTPS_FRONTEND_PORT:-5443\}\}/);
  assert.match(localLdapRehearsalRunner, /LOCAL_LDAP_ADMIN_EMAIL:-\}|\$\{ADMIN_EMAIL:-\}/);
  assert.match(localLdapConfigureRunner, /LOCAL_LDAP_SECRET_DIRECTORY_MODE/);
  assert.match(localLdapConfigureRunner, /LOCAL_LDAP_SECRET_FILE_MODE/);
  assert.match(localLdapConfigureRunner, /LOCAL_LDAP_DIRECTORY_PORT/);
  assert.match(localLdapConfigureRunner, /\$1" == 'openldap'/);
  assert.match(ldapProtocolMockRunner, /container_cert_dir="\$tmp_dir\/server-certs"/);
  assert.match(ldapProtocolMockRunner, /client_ca_cert="\$tmp_dir\/ldap-client-ca\.crt"/);
  assert.match(ldapProtocolMockRunner, /cp "\$container_cert_dir\/ldap\.crt" "\$client_ca_cert"/);
  assert.match(ldapProtocolMockRunner, /exec -T --user root openldap/);
  assert.match(ldapProtocolMockRunner, /EG_LDAP_TEST_DOCKER_NETWORK/);
  assert.match(ldapProtocolMockRunner, /docker network connect --alias/);
  assert.match(localLdapConfigureRunner, /triggers:\["login","manual","scheduled"\]/);
  assert.match(localLdapConfigureRunner, /scheduled:true,intervalSeconds:60/);
  assert.match(localLdapConfigureRunner, /requiredForLogin:true/);
  assert.match(localLdapConfigureRunner, /incompleteEntitlements:"fail_closed"/);
});

test('the disposable identity-protocol CI lane keeps fresh-stack inputs and useful diagnostics isolated', () => {
  assert.match(scripts['test:identity:protocol-rehearsal'], /run-ci-identity-protocol-rehearsals\.sh/);
  assert.match(ciIdentityProtocolRehearsalRunner, /mktemp -d/);
  assert.match(ciIdentityProtocolRehearsalRunner, /randomBytes/);
  assert.match(ciIdentityProtocolRehearsalRunner, /generate-local-tls\.sh/);
  assert.match(ciIdentityProtocolRehearsalRunner, /test:oidc:local-rehearsal/);
  assert.match(ciIdentityProtocolRehearsalRunner, /test:entra:local-rehearsal/);
  assert.match(ciIdentityProtocolRehearsalRunner, /test:saml:local-rehearsal/);
  assert.match(ciIdentityProtocolRehearsalRunner, /test:ldap:local-rehearsal/);
  assert.match(ciIdentityProtocolRehearsalRunner, /down --volumes --remove-orphans/);
  assert.match(ciIdentityProtocolRehearsalRunner, /credentials=ephemeral-and-not-retained/);
  assert.match(ciIdentityProtocolRehearsalRunner, /LOCAL_SAML_ADMIN_ENV_FILE/);
  assert.match(ciIdentityProtocolRehearsalRunner, /KEYCLOAK_REALM_IMPORT_FILE/);
  assert.match(ciIdentityProtocolRehearsalRunner, /LOCAL_SAML_SKIP_SIGNING_CERTIFICATE_FETCH=true/);
  assert.match(ciIdentityProtocolRehearsalRunner, /LOCAL_LDAP_SECRET_FILE_MODE=644/);
  assert.match(ciIdentityProtocolRehearsalRunner, /EG_LDAP_TEST_DOCKER_NETWORK="\$\{project_name\}_enterpriseglue-network"/);
  assert.match(ciIdentityProtocolRehearsalRunner, /LOCAL_LDAP_DIRECTORY_HOST=openldap/);
  assert.match(ciIdentityProtocolRehearsalRunner, /LOCAL_LDAP_DIRECTORY_PORT=636/);
  assert.match(ciIdentityProtocolRehearsalRunner, /run_compose exec -T backend node -e/);
  assert.match(ciIdentityProtocolRehearsalRunner, /accessSync\('\/etc\/enterpriseglue\/local-identity-secrets\/keycloak-saml-signing\.crt'\)/);
  assert.match(ciIdentityProtocolRehearsalRunner, /chmod 711 "\$identity_secret_dir"/);
  assert.match(ciIdentityProtocolRehearsalRunner, /docker-compose\.identity-protocol-rehearsal\.yml/);
  assert.match(ciIdentityProtocolRehearsalRunner, /chmod 755 "\$tls_dir"/);
  assert.match(ciIdentityProtocolRehearsalRunner, /chmod 644 "\$tls_dir\/ca\.crt" "\$tls_dir\/server\.crt" "\$tls_dir\/server\.key"/);
  assert.match(identityProtocolRehearsalCompose, /dockerfile: backend\/Dockerfile\.prod/);
  assert.match(identityProtocolRehearsalCompose, /command: \["dist\/backend\/src\/server\.js"\]/);
  assert.match(identityProtocolRehearsalCompose, /host\.docker\.internal:host-gateway/);
  assert.match(identityProtocolRehearsalCompose, /volumes: !override/);

  assert.match(identityProtocolRehearsalWorkflow, /name: Identity Protocol Rehearsal \(Advisory\)/);
  assert.match(identityProtocolRehearsalWorkflow, /continue-on-error: true/);
  assert.match(identityProtocolRehearsalWorkflow, /pnpm run test:identity:protocol-rehearsal/);
  assert.match(identityProtocolRehearsalWorkflow, /playwright install --with-deps chromium/);
  assert.match(identityProtocolRehearsalWorkflow, /Upload identity protocol diagnostics/);
});

test('the extended authorization matrix includes variable boundaries and both engine adapter paths', () => {
  assert.match(scripts['test:authz:variable-boundary'], /process-instances\/routes\.test\.ts/);
  assert.match(scripts['test:authz:variable-boundary'], /history-extended\.test\.ts/);
  assert.match(scripts['test:authz:variable-boundary'], /shared\/tasks\.test\.ts/);
  assert.match(scripts['test:authz:adapter-backstop'], /test:sidecar-backstop/);
  assert.match(scripts['test:authz:adapter-backstop'], /test:operaton-native-auth-container/);
  assert.match(scripts['test:authz:extended-matrix'], /test:authz:pr/);
  assert.match(scripts['test:authz:extended-matrix'], /test:authz:variable-boundary/);
  assert.match(scripts['test:authz:extended-matrix'], /test:authz:adapter-backstop/);
});
