import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const requiredIdentityPolicyKeys = [
  'EG_IDENTITY_PROVIDER_ALLOWED_HOSTS',
  'EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY',
  'EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS',
  'EG_IDENTITY_FLOW_RATE_LIMIT_MAX',
  'SSO_DIAGNOSTICS_INTERVAL_MS',
  'EG_LDAP_RECONCILIATION_IDENTITY_LIMIT',
  'EG_LDAP_RECONCILIATION_CONCURRENCY',
  'EG_LDAP_RECONCILIATION_GROUP_QUERY_LIMIT',
  'EG_LDAP_RECONCILIATION_GROUP_RESULT_LIMIT',
  'EG_LDAP_GROUP_SEARCH_QUERY_LIMIT',
  'EG_LDAP_GROUP_SEARCH_RESULT_LIMIT',
];

const requiredEnginePolicyKeys = [
  'EG_ENGINE_ALLOWED_HOSTS',
  'EG_ENFORCE_ENGINE_ENDPOINT_POLICY',
  'EG_ENGINE_ALLOW_PRIVATE_HOSTS',
  'EG_ALLOW_INSECURE_ENGINE_HTTP',
];

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function assertEnvAssignment(contents, key) {
  assert.match(contents, new RegExp(`^${key}=`, 'm'), `${key} must be explicit in the production environment example`);
}

test('production Docker environment examples expose fail-closed engine and identity endpoint controls', () => {
  for (const path of ['../infra/docker/env/examples/production.env.example', '../infra/docker/env/examples/selfhost.env.example']) {
    const contents = source(path);
    assert.match(contents, /^NODE_ENV=production$/m);
    [...requiredEnginePolicyKeys, ...requiredIdentityPolicyKeys].forEach((key) => assertEnvAssignment(contents, key));
    assert.match(contents, /^EG_ENGINE_ALLOWED_HOSTS=$/m);
    assert.match(contents, /^EG_IDENTITY_PROVIDER_ALLOWED_HOSTS=$/m);
    assert.doesNotMatch(contents, /HTTP .*automatically allowed/i);
  }
});

test('OpenShift defaults and operator references retain every identity safety budget', () => {
  const configMap = source('../infra/kubernetes/openshift/kustomize/base/config/configmap.yaml');
  const openShiftExample = source('../infra/docker/env/examples/openshift.env.example');
  const configurationMatrix = source('../docs/reference/configuration-matrix.md');
  for (const key of [...requiredEnginePolicyKeys, ...requiredIdentityPolicyKeys]) {
    assert.match(configMap, new RegExp(`^  ${key}:`, 'm'), `${key} must be rendered in the OpenShift ConfigMap`);
    assert.match(openShiftExample, new RegExp(`^#? ?${key}=`, 'm'), `${key} must be discoverable in the OpenShift environment example`);
    assert.match(configurationMatrix, new RegExp(`\\| ${key} \\|`), `${key} must be documented in the configuration matrix`);
  }
});
