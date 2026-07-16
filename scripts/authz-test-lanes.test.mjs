import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const scripts = packageJson.scripts;
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
  assert.deepEqual(invokedScripts(scripts['test:authz-refactor']), [
    'test:authz:structure',
    ...localLanes,
  ]);
});

test('the local-safe lanes preserve every focused authorization check once', () => {
  const leafChecks = localLanes.flatMap((lane) => invokedScripts(scripts[lane]));
  assert.deepEqual(leafChecks, expectedLeafChecks);
  assert.equal(new Set(leafChecks).size, leafChecks.length, 'each focused check belongs to one lane');
});

test('browser, credentialed local authorization, and LDAP-container boundaries stay opt-in', () => {
  const localCommands = [...localLanes, 'test:authz-refactor']
    .map((name) => scripts[name])
    .join(' ');

  assert.doesNotMatch(localCommands, /test:(?:identity:(?:browser|ldap)|authz:local-(?:login|access-control))/);
});

test('credentialed local authorization smokes use the guarded runner', () => {
  assert.match(scripts['test:authz:local-login'], /run-authz-local-login-test\.sh/);
  assert.match(scripts['test:authz:local-access-control'], /run-authz-local-login-test\.sh/);
});
