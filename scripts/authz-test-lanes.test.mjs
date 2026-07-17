import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const localLanes = ['test:authz:identity', 'test:authz:config', 'test:authz:runtime'];
const expectedLeafChecks = [
  'test:identity-contract',
  'test:identity-integration',
  'test:legacy-auth-integration',
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

test('the local-safe lanes preserve every focused authorization check once', () => {
  const leafChecks = localLanes.flatMap((lane) => invokedScripts(scripts[lane]));
  assert.deepEqual(leafChecks, expectedLeafChecks);
  assert.equal(new Set(leafChecks).size, leafChecks.length, 'each focused check belongs to one lane');
});

test('legacy protocol fixtures run in isolated Vitest processes', () => {
  const command = scripts['test:legacy-auth-integration'];
  const commands = [...command.matchAll(/vitest run ([^&]+)/g)].map((match) => match[1]);

  assert.deepEqual(commands, [
    '__tests__/modules/auth/routes/microsoft-flow.e2e.test.ts --config vitest.config.ts --reporter=dot ',
    '__tests__/modules/auth/routes/google-flow.e2e.test.ts --config vitest.config.ts --reporter=dot ',
    '__tests__/modules/auth/routes/saml-flow.e2e.test.ts --config vitest.config.ts --reporter=dot',
  ]);
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
  assert.match(localSeededAuthzSmokeRunner, /E2E_SEED_FILE=/);
  assert.match(localSeededAuthzSmokeRunner, /POSTGRES_HOST=127\.0\.0\.1/);
  assert.match(localSeededAuthzSmokeRunner, /docker compose.*port db 5432/);
  assert.match(localSeededAuthzSmokeRunner, /localhost, loopback, or a \.local host/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/login\.spec\.ts/);
  assert.match(localSeededAuthzSmokeRunner, /test\/e2e\/smoke\/access-control-local\.spec\.ts/);
});

test('the disposable local administrator has canonical break-glass memberships', () => {
  assert.match(e2eGlobalSetup, /system\.group\.authenticated_users/);
  assert.match(e2eGlobalSetup, /system\.group\.platform_administrators/);
  assert.match(e2eGlobalSetup, /INSERT INTO \$\{schema\}\.authz_group_memberships/);
  assert.match(e2eGlobalSetup, /e2e-smoke-fixture/);
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
