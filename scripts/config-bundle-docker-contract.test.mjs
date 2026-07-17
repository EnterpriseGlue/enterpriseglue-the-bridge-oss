import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
  assert.match(overlay, /EG_CONFIG_SECRET_FILE_ROOT: \$\{EG_CONFIG_SECRET_FILE_ROOT:-\/var\/run\/secrets\/enterpriseglue\}/);
  assert.match(overlay, /EG_CONFIG_BUNDLE_HOST_PATH[^\n]*:\/etc\/enterpriseglue\/config\/bundle\.json:ro/);
  assert.match(overlay, /EG_CONFIG_SECRETS_HOST_PATH[^\n]*:\/var\/run\/secrets\/enterpriseglue:ro/);
  assert.doesNotMatch(overlay, /EG_CONFIG_BUNDLE_HOST_PATH[^\n]*var\/run\/secrets/);
});

test('the local bootstrap rehearsal uses an isolated project for validate and apply startup', () => {
  const rehearsal = read('scripts/run-local-config-bootstrap-rehearsal.sh');
  const overlay = read('infra/docker/compose/docker-compose.config-bundle-rehearsal.yml');

  assert.match(rehearsal, /--project-name "\$project_name"/);
  assert.match(rehearsal, /mktemp -d/);
  assert.match(rehearsal, /down --volumes --remove-orphans/);
  assert.match(rehearsal, /run_compose\(\)/);
  assert.match(rehearsal, /run_compose down --volumes --remove-orphans/);
  assert.match(rehearsal, /up --force-recreate -d backend/);
  assert.match(rehearsal, /LOCAL_CONFIG_BOOTSTRAP_MODE/);
  assert.match(rehearsal, /bootstrapMode === 'apply' \? 'additive' : 'preview_only'/);
  assert.match(overlay, /EG_CONFIG_BOOTSTRAP_MODE: \$\{LOCAL_CONFIG_BOOTSTRAP_MODE:-validate\}/);
  assert.match(overlay, /EG_CONFIG_FAIL_CLOSED: "true"/);
  assert.match(overlay, /EG_CONFIG_EXPECTED_TENANT_SCOPE: \$\{LOCAL_CONFIG_BOOTSTRAP_EXPECTED_TENANT_SCOPE:-platform\}/);
});

test('the Compose harness preserves bundle paths with spaces and rejects a missing bundle before startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'enterpriseglue-compose-bundle-'));
  const envFile = join(directory, 'production.env');
  const bundlePath = join(directory, 'reviewed bundle.json');
  const missingBundlePath = join(directory, 'missing bundle.json');
  const fakeDocker = join(directory, 'docker');
  const invocationLog = join(directory, 'docker-invocation.txt');
  writeFileSync(envFile, 'DUMMY=true\n', 'utf8');
  writeFileSync(bundlePath, '{"bundle":"test"}\n', 'utf8');
  writeFileSync(fakeDocker, `#!/bin/sh
printf 'bundle=%s\\n' "$EG_CONFIG_BUNDLE_HOST_PATH" > "$DOCKER_INVOCATION_LOG"
printf 'args=%s\\n' "$*" >> "$DOCKER_INVOCATION_LOG"
`, 'utf8');
  chmodSync(fakeDocker, 0o755);
  const script = new URL('./deploy-compose.sh', import.meta.url).pathname;
  const baseEnv = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    EG_DEPLOY_ENV_FILE: envFile,
    DOCKER_INVOCATION_LOG: invocationLog,
  };

  try {
    const config = spawnSync('bash', [script, 'source', 'config'], {
      encoding: 'utf8',
      env: { ...baseEnv, EG_CONFIG_BUNDLE_HOST_PATH: bundlePath },
    });
    assert.equal(config.status, 0, `${config.stdout}\n${config.stderr}`);
    const invocation = readFileSync(invocationLog, 'utf8');
    assert.match(invocation, new RegExp(`bundle=${bundlePath.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
    assert.match(invocation, /docker-compose\.config-bundle\.yml/);
    assert.match(invocation, / config/);

    const missing = spawnSync('bash', [script, 'source', 'up'], {
      encoding: 'utf8',
      env: { ...baseEnv, EG_CONFIG_BUNDLE_HOST_PATH: missingBundlePath },
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /EG_CONFIG_BUNDLE_HOST_PATH must reference an existing JSON or ZIP bundle/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
