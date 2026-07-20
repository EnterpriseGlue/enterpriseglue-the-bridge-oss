import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const scripts = packageJson.scripts;
const localOidcRehearsalRunner = readFileSync(new URL('./run-local-oidc-rehearsal-test.sh', import.meta.url), 'utf8');
const localSamlRehearsalRunner = readFileSync(new URL('./run-local-saml-rehearsal-test.sh', import.meta.url), 'utf8');
const localLdapRehearsalRunner = readFileSync(new URL('./run-local-ldap-rehearsal-test.sh', import.meta.url), 'utf8');
const localAuthzSmokeRunner = readFileSync(new URL('./run-authz-local-login-test.sh', import.meta.url), 'utf8');
const localSeededAuthzSmokeRunner = readFileSync(new URL('./run-authz-local-seeded-smoke.sh', import.meta.url), 'utf8');
const e2eGlobalSetup = readFileSync(new URL('../test/e2e/setup/global-setup.ts', import.meta.url), 'utf8');
const identityBrowserRunner = readFileSync(new URL('./run-identity-browser-test.sh', import.meta.url), 'utf8');
const authzRefactorRunner = readFileSync(new URL('./run-local-safe-authz-refactor.sh', import.meta.url), 'utf8');
const authzMutationRunner = readFileSync(new URL('./run-authz-mutation-tests.mjs', import.meta.url), 'utf8');
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
  assert.match(scripts['test:authz:structure'], /authz-test-lanes\.test\.mjs/);
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
  assert.match(localSeededAuthzSmokeRunner, /PLAYWRIGHT_LOCAL_CA_FILE/);
  assert.match(localSeededAuthzSmokeRunner, /PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true/);
  assert.match(localSeededAuthzSmokeRunner, /localhost, loopback, or a \.local host/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/login\.spec\.ts/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/access-control-local\.spec\.ts/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/fine-grained-access-local\.spec\.ts/);
});

test('the authorization mutation guard proves denial tests kill bypassed user and API-client guards', () => {
  assert.match(scripts['test:authz:mutation'], /run-authz-mutation-tests\.mjs/);
  assert.match(authzMutationRunner, /requireAction\.test\.ts/);
  assert.match(authzMutationRunner, /apiClientAuth\.test\.ts/);
  assert.match(authzMutationRunner, /user action deny bypass/);
  assert.match(authzMutationRunner, /API client deny bypass/);
  assert.match(authzMutationRunner, /Authorization mutant survived/);
});

test('the disposable local administrator has canonical break-glass memberships', () => {
  assert.match(e2eGlobalSetup, /system\.group\.authenticated_users/);
  assert.match(e2eGlobalSetup, /system\.group\.platform_administrators/);
  assert.match(e2eGlobalSetup, /INSERT INTO \$\{schema\}\.authz_group_memberships/);
  assert.match(e2eGlobalSetup, /INSERT INTO \$\{schema\}\.tenant_memberships/);
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
});

test('the live local LDAP rehearsal is opt-in, fixture-backed, and guarded to local browser targets', () => {
  assert.match(scripts['test:ldap:local-rehearsal'], /run-local-ldap-rehearsal-test\.sh/);
  assert.match(localLdapRehearsalRunner, /LOCAL_LDAP_FIXTURE_ACTIVE=true/);
  assert.match(localLdapRehearsalRunner, /LOCAL_LDAP_REHEARSAL=true/);
  assert.match(localLdapRehearsalRunner, /run-ldap-protocol-mock\.sh/);
  assert.match(localLdapRehearsalRunner, /localhost, loopback, or a \.local host/);
  assert.match(localLdapRehearsalRunner, /-z "\$\{ADMIN_EMAIL:-\}"/);
  assert.match(localLdapRehearsalRunner, /LOCAL_LDAP_ADMIN_EMAIL/);
});
