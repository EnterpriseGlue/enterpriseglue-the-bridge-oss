import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readinessProbe = /http:\/\/127\.0\.0\.1:'\+p\+'\/ready/;

test('development and production Docker stacks gate dependents on bootstrap readiness', () => {
  const development = read('infra/docker/compose/docker-compose.yml');
  const production = read('infra/docker/compose/docker-compose.prod.yml');
  const selfhost = read('infra/docker/compose/docker-compose.selfhost.yml');

  for (const [name, compose] of [['development', development], ['production', production], ['self-hosted published image', selfhost]]) {
    assert.match(compose, readinessProbe, `${name} backend healthcheck must call /ready`);
  }
  assert.match(development, /frontend:\s+[\s\S]*?depends_on:\s+backend:\s+condition: service_healthy/, 'development frontend must wait for readiness');
  assert.match(production, /frontend:\s+[\s\S]*?depends_on:\s+backend:\s+condition: service_healthy/, 'production frontend must wait for readiness');
  assert.match(selfhost, /frontend:\s+[\s\S]*?depends_on:\s+backend:\s+condition: service_healthy/, 'published-image frontend must wait for readiness');
});

test('Docker images expose a non-root config and separate secret mount target', () => {
  const development = read('backend/Dockerfile');
  const production = read('backend/Dockerfile.prod');

  assert.match(development, /mkdir -p \/etc\/enterpriseglue\/config \/var\/run\/secrets\/enterpriseglue/);
  assert.match(development, /chown -R node:node \/etc\/enterpriseglue \/var\/run\/secrets\/enterpriseglue/);
  assert.match(production, /mkdir -p \/etc\/enterpriseglue\/config \/var\/run\/secrets\/enterpriseglue/);
  assert.match(production, /chown -R 65532:65532 \/etc\/enterpriseglue \/var\/run\/secrets\/enterpriseglue/);
});

test('the optional bundle overlay is read-only and never combines config with secrets', () => {
  const overlay = read('infra/docker/compose/docker-compose.config-bundle.yml');

  assert.match(overlay, /EG_CONFIG_BUNDLE_PATH: \/etc\/enterpriseglue\/config\/bundle\.json/);
  assert.match(overlay, /EG_CONFIG_BUNDLE_HOST_PATH[^\n]*:\/etc\/enterpriseglue\/config\/bundle\.json:ro/);
  assert.match(overlay, /EG_CONFIG_SECRETS_HOST_PATH[^\n]*:\/var\/run\/secrets\/enterpriseglue:ro/);
  assert.doesNotMatch(overlay, /EG_CONFIG_BUNDLE_HOST_PATH[^\n]*var\/run\/secrets/);
});
