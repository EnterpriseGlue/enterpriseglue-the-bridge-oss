import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function runFixture(t, scenario) {
  const root = mkdtempSync(join(tmpdir(), 'eg-rls-runner-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const executable = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env node\n${body}`);
    chmodSync(path, 0o755);
  };
  executable('docker', `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'create') {
  if (process.env.FIXTURE_SCENARIO === 'create-failure') process.exit(9);
  console.log('a'.repeat(64)); process.exit(0);
}
if (args[0] === 'start') process.exit(process.env.FIXTURE_SCENARIO === 'start-failure' ? 9 : 0);
if (args[0] === 'rm') process.exit(process.env.FIXTURE_SCENARIO === 'cleanup-failure' ? 1 : 0);
if (args[0] !== 'exec' || args[2] !== 'pg_isready') process.exit(99);
let count = 0;
try { count = Number(fs.readFileSync(process.env.FIXTURE_COUNT, 'utf8')); } catch {}
fs.writeFileSync(process.env.FIXTURE_COUNT, String(++count));
const tcp = args.includes('-h') && args[args.indexOf('-h') + 1] === '127.0.0.1';
// The image's initialization server accepts Unix sockets, then stops before
// the real TCP listener starts. Reproduce the old false-ready/second-check race.
if (!tcp) process.exit(count === 1 ? 0 : 1);
process.exit(process.env.FIXTURE_SCENARIO === 'timeout' || count < 3 ? 1 : 0);
`);
  executable('sleep', 'process.exit(0);');
  executable('corepack', `
if (!/^[a-f0-9]{64}$/.test(process.env.MIGRATION_TEST_POSTGRES_CONTAINER || '')) process.exit(98);
require('node:fs').appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify(['tests', ...process.argv.slice(2)]) + '\\n');
process.exit(process.env.FIXTURE_SCENARIO === 'test-failure' ? 17 : 0);
`);
  const calls = join(root, 'calls.jsonl');
  const result = spawnSync('bash', [fileURLToPath(new URL('./run-native-tenancy-postgres-rls.sh', import.meta.url))], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_SCENARIO: scenario,
      FIXTURE_COUNT: join(root, 'count'), FIXTURE_CALLS: calls },
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.error, undefined);
  return { result, calls: readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('ignores temporary socket readiness and waits for the real TCP server', (t) => {
  const { result, calls } = runFixture(t, 'success');
  assert.equal(result.status, 0, result.stderr);
  const probes = calls.filter(([command]) => command === 'exec');
  assert.equal(probes.length, 3);
  for (const probe of probes) assert.deepEqual(probe.slice(2), ['pg_isready', '-h', '127.0.0.1', '-p', '5432', '-U', 'postgres', '-d', 'postgres']);
  const tests = calls.find(([command]) => command === 'tests');
  assert.ok(tests.includes('test/integration/nativeTenantRls.test.ts'));
  assert.ok(tests.includes('test/integration/postgres-context-boundary.test.ts'));
  assert.ok(tests.includes('test/integration/postgres-global-identity.test.ts'));
  assert.ok(tests.includes('test/integration/postgres-shared-inventory-readiness.test.ts'));
  assert.ok(tests.includes('test/qualification/sessionRevocationRace.test.ts'));
  const startedName = calls.find(([command]) => command === 'create')[2];
  assert.match(startedName, /^enterpriseglue-native-tenancy-rls-\d+$/);
  assert.deepEqual(calls.at(-1), ['rm', '-f', '-v', 'a'.repeat(64)]);
});

for (const [scenario, code] of [['create-failure', 9], ['start-failure', 9], ['timeout', 1], ['test-failure', 17], ['cleanup-failure', 1]]) {
  test(`fails closed and cleans only the owned fixture: ${scenario}`, (t) => {
    const { result, calls } = runFixture(t, scenario);
    assert.equal(result.status, code, result.stderr);
    if (scenario === 'create-failure') {
      assert.deepEqual(calls.map(([command]) => command), ['create'], 'never delete a colliding or unowned container after create fails');
    } else {
      assert.deepEqual(calls.at(-1), ['rm', '-f', '-v', 'a'.repeat(64)]);
    }
    if (['timeout', 'create-failure', 'start-failure'].includes(scenario)) assert.ok(!calls.some(([command]) => command === 'tests'));
    if (scenario === 'timeout') {
      assert.equal(calls.filter(([command]) => command === 'exec').length, 60);
      assert.match(result.stderr, /TCP readiness timed out/);
    }
  });
}
