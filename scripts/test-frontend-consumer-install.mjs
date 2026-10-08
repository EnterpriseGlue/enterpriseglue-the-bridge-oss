import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Prove the supported pnpm runtime's actual production peer resolution outside
// the workspace, rather than inferring it from a manifest. No scripts run.
const root = process.cwd();
const temporary = mkdtempSync(path.join(os.tmpdir(), 'eg-browser-consumer-'));
const packages = ['plugin-sdk', 'plugin-runtime', 'enterprise-plugin-api', 'shared', 'frontend-host'];
try {
  const dependencies = {};
  for (const directory of packages) {
    const manifest = JSON.parse(readFileSync(path.join(root, 'packages', directory, 'package.json')));
    const previous = new Set(readdirSync(temporary));
    execFileSync('corepack', ['pnpm', '--dir', path.join(root, 'packages', directory), 'pack', '--pack-destination', temporary], {
      stdio: 'pipe', timeout: 120000,
    });
    const tarball = readdirSync(temporary).find(name => name.endsWith('.tgz') && !previous.has(name));
    assert.ok(tarball, `missing packed ${manifest.name}`);
    dependencies[manifest.name] = `file:${path.join(temporary, tarball)}`;
  }
  writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ name: 'browser-consumer-probe', version: '1.0.0', private: true, packageManager: 'pnpm@11.0.8', dependencies }));
  writeFileSync(path.join(temporary, 'pnpm-workspace.yaml'), JSON.stringify({ packages: ['.'], overrides: dependencies }));
  execFileSync('corepack', ['pnpm', 'install', '--prod', '--ignore-scripts', '--no-frozen-lockfile', '--prefer-offline', '--registry=https://registry.npmjs.org'], {
    cwd: temporary, stdio: 'pipe', timeout: 180000,
    env: { ...process.env, NPM_CONFIG_USERCONFIG: '/dev/null' },
  });
  const graph = execFileSync('corepack', ['pnpm', 'list', '--prod', '--depth', 'Infinity', '--json'], { cwd: temporary, encoding: 'utf8', timeout: 30000 });
  const installed = new Set();
  function collect(value) {
    if (Array.isArray(value)) { for (const item of value) collect(item); return; }
    if (!value || typeof value !== 'object') return;
    for (const [name, dependency] of Object.entries(value.dependencies ?? {})) { installed.add(name); collect(dependency); }
  }
  collect(JSON.parse(graph));
  const peers = JSON.parse(readFileSync(path.join(root, 'packages/shared/package.json'))).peerDependencies;
  // escape-html and uuid are browser-safe dependencies independently required
  // by diagram libraries; their presence is not a shared server dependency.
  for (const name of Object.keys(peers).filter(name => !['escape-html', 'uuid'].includes(name))) {
    assert.equal(installed.has(name), false, `${name} is installed in the standalone browser graph`);
  }
  assert.ok(installed.has('@enterpriseglue/frontend-host'));
  assert.ok(installed.has('zod'));
  const consumerRequire = createRequire(path.join(temporary, 'package.json'));
  const schemas = await import(pathToFileURL(consumerRequire.resolve('@enterpriseglue/shared/schemas/mission-control/history.js')));
  assert.equal(typeof schemas.HistoricDecisionInstanceDetailSchema.safeParse, 'function');
  assert.equal(schemas.HistoricDecisionInstanceDetailSchema.safeParse({}).success, false);
  const actions = await import(pathToFileURL(consumerRequire.resolve('@enterpriseglue/shared/authz/permission-actions.js')));
  assert.ok(Object.keys(actions).length);
  console.log('PASS packed browser schema and permission catalog imports without server peers');
  console.log(`PASS standalone pnpm production consumer: ${installed.size} package names, no database, mail, HTTP-server, or identity-provider peers installed`);
} catch (error) {
  throw new Error(`Standalone consumer qualification failed: ${error.stderr?.toString() || error.message}
${error.stdout?.toString().split('\n').slice(-10).join('\n') || ''}`, { cause: error.code });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
