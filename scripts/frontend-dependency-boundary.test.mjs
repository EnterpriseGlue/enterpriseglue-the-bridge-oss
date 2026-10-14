import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const shared = read('packages/shared/package.json');
const server = read('packages/backend-host/package.json');
const frontend = read('frontend/package.json');
const browser = new Set(['zod', '@asteasolutions/zod-to-openapi', '@enterpriseglue/plugin-sdk']);

test('shared browser installation has no server dependencies and server peers remain owned and buildable', () => {
  assert.deepEqual(new Set(Object.keys(shared.dependencies)), browser);
  assert.ok(Object.keys(shared.peerDependencies).length >= 20);
  for (const [name, version] of Object.entries(shared.peerDependencies)) {
    assert.equal(shared.peerDependenciesMeta[name]?.optional, true, `${name} must not auto-install for browser consumers`);
    const buildVersion = shared.devDependencies[name];
    // An optional public peer can preserve an older supported line while the
    // host builds and deploys one qualified alternative from that union.
    assert.ok(version.split('||').map(range => range.trim()).includes(buildVersion), `${name} build range must be an explicit supported peer alternative`);
    assert.equal(server.dependencies[name], buildVersion, `${name} production and shared compiler ranges must match`);
  }
});

test('Spanner keeps additive peer compatibility while build and production use the repaired SDK line', () => {
  assert.equal(shared.peerDependencies['@google-cloud/spanner'], '^8.10.0 || ^9.1.0');
  assert.equal(shared.devDependencies['@google-cloud/spanner'], '^9.1.0');
  assert.equal(server.dependencies['@google-cloud/spanner'], '^9.1.0');
  assert.equal(shared.peerDependenciesMeta['@google-cloud/spanner']?.optional, true);
});

test('the frontend runtime host belongs to its production graph', () => {
  assert.equal(frontend.dependencies['@enterpriseglue/frontend-host'], 'workspace:*');
  assert.equal(frontend.devDependencies['@enterpriseglue/frontend-host'], undefined);
  assert.match(readFileSync(new URL('../frontend/src/main.tsx', import.meta.url), 'utf8'), /from ['"]@enterpriseglue\/frontend-host\/main['"]/);
});

test('the production browser workspace closure has no mail, database, or server libraries', () => {
  const manifestPaths = {
    '@enterpriseglue/frontend-host': 'packages/frontend-host/package.json',
    '@enterpriseglue/shared': 'packages/shared/package.json',
    '@enterpriseglue/plugin-sdk': 'packages/plugin-sdk/package.json',
    '@enterpriseglue/plugin-runtime': 'packages/plugin-runtime/package.json',
    '@enterpriseglue/enterprise-plugin-api': 'packages/enterprise-plugin-api/package.json',
  };
  const visited = new Set();
  function visit(manifest) {
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (visited.has(name)) continue;
      visited.add(name);
      if (manifestPaths[name]) visit(read(manifestPaths[name]));
    }
  }
  visit(frontend);
  for (const name of Object.keys(shared.peerDependencies)) assert.equal(visited.has(name), false, `${name} leaked into the browser graph`);
  assert.ok(visited.has('zod'));
  assert.ok(visited.has('@enterpriseglue/frontend-host'));
});

test('DOMPurify stays above the advisory floor and overrides have one authority', () => {
  const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  assert.equal(read('package.json').overrides, undefined);
  assert.match(workspace, /^  dompurify: \^3\.4\.16$/m);
  const versions = [...lock.matchAll(/^  dompurify@(\d+)\.(\d+)\.(\d+):$/gm)];
  assert.ok(versions.length);
  for (const [, major, minor, patch] of versions) {
    assert.ok(Number(major) > 3 || Number(major) === 3 && (Number(minor) > 4 || Number(minor) === 4 && Number(patch) >= 16));
  }
});

test('workspace production assemblies provide shared server peer links from the backend host', () => {
  for (const file of ['backend/Dockerfile.prod', 'infra/docker/managed-shard-bootstrap/Dockerfile']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /COPY --from=(?:deps|dependencies)(?: --chown=65532:65532)? \/repo\/packages\/backend-host\/node_modules (?:\.\/dist|\/app\/dist)\/packages\/shared\/node_modules/);
  }
});
