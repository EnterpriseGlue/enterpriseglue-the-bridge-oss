import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { buildPluginComposeDeploymentKit } from './build-plugin-compose-deployment-kit.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const input = (output) => ({
  output,
  hostVersion: '0.16.0',
  backendImage: `ghcr.io/enterpriseglue/backend@${digest('a')}`,
  frontendImage: `ghcr.io/enterpriseglue/frontend@${digest('b')}`,
  managerImage: `ghcr.io/enterpriseglue/plugin-manager@${digest('c')}`,
  deploymentRoot: '/opt/enterpriseglue/plugin-deployment',
  stateDirectory: '/opt/enterpriseglue/plugin-manager/state',
});

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'eg-plugin-kit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = resolve(root, 'kit-output');
  const manifest = await buildPluginComposeDeploymentKit(input(output));
  return { root, output, manifest };
}

function run(path, argumentsInput, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(path, argumentsInput, {
      encoding: 'utf8',
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
}

test('builds a source-free immutable Compose deployment kit', async (t) => {
  const { output, manifest } = await fixture(t);
  const compose = await readFile(
    resolve(output, 'kit/infra/docker/compose/docker-compose.plugin-manager.yml'),
    'utf8',
  );
  assert.doesNotMatch(compose, /^\s+build:/m);
  assert.match(compose, /EG_PLUGIN_MANAGER_IMAGE/);
  assert.match(compose, /EG_PLUGIN_MANAGER_STATE_SOURCE/);
  assert.match(compose, /plugins-planner/);
  assert.match(compose, /plugin-manager-planner/);

  const planner = JSON.parse(
    await readFile(
      resolve(output, 'config/manager-config.compose_planner.amd64.json.example'),
      'utf8',
    ),
  );
  assert.deepEqual(planner.capability.architectures, ['amd64', 'arm64']);
  assert.equal(planner.host.artifact, input(output).backendImage);
  assert.equal(planner.adapter.projectDirectory, input(output).stateDirectory);
  assert.deepEqual(planner.adapter.composeFiles, [
    '/opt/enterpriseglue/plugin-manager/state/deployment/infra/docker/compose/docker-compose.selfhost.yml',
    '/opt/enterpriseglue/plugin-manager/state/installer/docker-compose.plugins.generated.yaml',
  ]);
  assert.equal(planner.adapter.utilityImage, input(output).managerImage);

  const manifestEntry = manifest.components.find(
    (entry) => entry.path === 'kit/infra/docker/compose/docker-compose.plugin-manager.yml',
  );
  assert.ok(manifestEntry);
  assert.equal(
    manifestEntry.sha256,
    createHash('sha256').update(compose).digest('hex'),
  );
});

test('kit CLI rejects mutable image tags', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'eg-plugin-kit-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      resolve('scripts/build-plugin-compose-deployment-kit.mjs'),
      '--output', resolve(root, 'output'),
      '--host-version', '0.16.0',
      '--backend-image', 'ghcr.io/enterpriseglue/backend:latest',
      '--frontend-image', input(root).frontendImage,
      '--manager-image', input(root).managerImage,
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /immutable repository@sha256 reference/);
});

test('verifies every extracted kit component and rejects tampering', async (t) => {
  const { output } = await fixture(t);
  const verifier = resolve(output, 'scripts/verify-deployment-kit.mjs');
  const passing = spawnSync(process.execPath, [verifier, output], {
    encoding: 'utf8',
  });
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /deployment_kit_verified:/);

  const compose = resolve(
    output,
    'kit/infra/docker/compose/docker-compose.plugin-manager.yml',
  );
  const original = await readFile(compose, 'utf8');
  await writeFile(compose, `${original}\n# modified after release\n`);
  const failing = spawnSync(process.execPath, [verifier, output], {
    encoding: 'utf8',
  });
  assert.notEqual(failing.status, 0);
  assert.match(failing.stderr, /digest differs/);
});

test('deployment kit verification rejects symbolic-link components', async (t) => {
  const { output } = await fixture(t);
  const verifier = resolve(output, 'scripts/verify-deployment-kit.mjs');
  const compose = resolve(
    output,
    'kit/infra/docker/compose/docker-compose.plugin-manager.yml',
  );
  await rm(compose);
  await symlink(resolve(output, 'README.md'), compose);
  const result = spawnSync(process.execPath, [verifier, output], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not be a symbolic link/);
});

test('rendered Compose uses digest subjects and has no source build', async (t) => {
  if (spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('Docker Compose is unavailable');
    return;
  }
  const { output } = await fixture(t);
  const composeDirectory = resolve(output, 'kit/infra/docker/compose');
  const environmentFile = resolve(composeDirectory, '.env');
  await copyFile(resolve(composeDirectory, '.env.example'), environmentFile);
  await mkdir(resolve(output, 'state'), { recursive: true });
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-directory', output,
      '--env-file', environmentFile,
      '-f', resolve(composeDirectory, 'docker-compose.selfhost.yml'),
      '-f', resolve(composeDirectory, 'docker-compose.plugin-manager.yml'),
      '--profile', 'plugins-planner',
      'config', '--format', 'json',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        EG_BACKEND_ENV_FILE: environmentFile,
        EG_PLUGIN_DEPLOYMENT_DIRECTORY: resolve(output, 'kit'),
        EG_PLUGIN_MANAGER_CONFIG_DIRECTORY: resolve(output, 'config'),
        EG_PLUGIN_MANAGER_STATE_SOURCE: resolve(output, 'state'),
        EG_PLUGIN_MANAGER_STATE_DIRECTORY: resolve(output, 'state'),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const rendered = JSON.parse(result.stdout);
  assert.equal(rendered.services.backend.image, input(output).backendImage);
  assert.equal(rendered.services.frontend.image, input(output).frontendImage);
  assert.equal(rendered.services['plugin-manager'].image, input(output).managerImage);
  assert.equal(rendered.services['plugin-manager'].build, undefined);
});

test('route checker accepts backend JSON and rejects an SPA fallback', async (t) => {
  const { output } = await fixture(t);
  const checker = resolve(
    output,
    'kit/infra/cdn/plugin-routing/check-plugin-route.sh',
  );
  let spaFallback = false;
  const server = createServer((_request, response) => {
    if (spaFallback) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>EnterpriseGlue</title>');
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{"error":"Plugin asset not available"}');
  });
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;

  const passing = await run(checker, [origin]);
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /route_preflight_ok/);

  spaFallback = true;
  const failing = await run(checker, [origin]);
  assert.notEqual(failing.status, 0);
  assert.match(failing.stderr, /route_preflight_failed/);
});

test('CDN templates keep plugin assets ahead of the static fallback', async (t) => {
  const { output } = await fixture(t);
  const contract = JSON.parse(
    await readFile(
      resolve(output, 'kit/infra/cdn/plugin-routing/routing-contract.json'),
      'utf8',
    ),
  );
  assert.equal(contract.sameOriginRequired, true);
  assert.equal(contract.orderedRoutes[0].path, '/_enterpriseglue/plugins/*');
  assert.equal(contract.orderedRoutes.at(-1).fallback, '/index.html');
  const nginx = await readFile(
    resolve(output, 'kit/infra/cdn/plugin-routing/nginx-static-frontend.conf.template'),
    'utf8',
  );
  assert.ok(
    nginx.indexOf('location ^~ /_enterpriseglue/plugins/') <
      nginx.indexOf('location / {'),
  );
});
