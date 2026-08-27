import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtimeUrlKey = 'EG_FRONTEND_RUNTIME_API_BASE_URL';
const runtimeRequiredKey = 'EG_FRONTEND_RUNTIME_CONFIG_REQUIRED';

test('the production frontend image has a stable container-start runtime document', () => {
  const dockerfile = read('frontend/Dockerfile.prod');
  const entrypoint = read('frontend/nginx-entrypoint.sh');
  const nginx = read('frontend/nginx.conf');

  assert.match(
    dockerfile,
    /ARG RUNTIME_CONFIG_URL=\/\.well-known\/enterpriseglue\/runtime-config\.json/,
  );
  assert.match(entrypoint, new RegExp(runtimeUrlKey));
  assert.match(entrypoint, new RegExp(runtimeRequiredKey));
  assert.match(entrypoint, /enterpriseglue-runtime-config\.json/);
  assert.match(entrypoint, /must be an absolute HTTP\(S\) URL/);
  assert.match(entrypoint, /RUNTIME_API_CONNECT_SRC/);
  assert.match(
    nginx,
    /location = \/\.well-known\/enterpriseglue\/runtime-config\.json/,
  );
  assert.match(nginx, /connect-src 'self'\$\{RUNTIME_API_CONNECT_SRC\}/);
});

test('every supported container deployment passes runtime frontend configuration', () => {
  for (const path of [
    'infra/docker/compose/docker-compose.yml',
    'infra/docker/compose/docker-compose.prod.yml',
    'infra/docker/compose/docker-compose.selfhost.yml',
  ]) {
    const compose = read(path);
    assert.match(compose, new RegExp(`${runtimeUrlKey}: \\$\\{${runtimeUrlKey}:-\\}`));
    assert.match(
      compose,
      new RegExp(`${runtimeRequiredKey}: \\$\\{${runtimeRequiredKey}:-false\\}`),
    );
  }

  const configMap = read('infra/kubernetes/openshift/kustomize/base/config/configmap.yaml');
  const deployment = read('infra/kubernetes/openshift/kustomize/base/app/frontend-deployment.yaml');
  for (const key of [runtimeUrlKey, runtimeRequiredKey]) {
    assert.match(configMap, new RegExp(`^  ${key}:`, 'm'));
    assert.match(deployment, new RegExp(`name: ${key}`));
    assert.match(deployment, new RegExp(`key: ${key}`));
  }
});

test('operator examples and the configuration matrix expose both runtime controls', () => {
  const examples = [
    'docker.default.env.example',
    'docker.mssql.env.example',
    'docker.mysql.env.example',
    'docker.oracle.env.example',
    'docker.postgres.env.example',
    'docker.spanner.env.example',
    'images.oracle.env.example',
    'images.postgres.env.example',
    'production.env.example',
    'selfhost.env.example',
  ];
  for (const file of examples) {
    const source = read(`infra/docker/env/examples/${file}`);
    assert.match(source, new RegExp(`^${runtimeUrlKey}=$`, 'm'));
    assert.match(source, new RegExp(`^${runtimeRequiredKey}=false$`, 'm'));
  }

  const matrix = read('docs/reference/configuration-matrix.md');
  assert.match(matrix, new RegExp(`\\| ${runtimeUrlKey} \\|`));
  assert.match(matrix, new RegExp(`\\| ${runtimeRequiredKey} \\|`));
});
