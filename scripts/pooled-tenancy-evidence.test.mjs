import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { writeReceipt } from './pooled-tenancy-evidence.mjs';
import { classifyChangedFiles } from './ci-change-classifier.mjs';

const secret = 'DO_NOT_EXPORT_AUTH_COOKIE_PASSWORD_SQL_OR_STATE';
const goodIsolation = { superuser: false, bypass_rls: false, forced_tenant_policy_tables: 19 };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'eg-pooled-evidence-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, content) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  };
  return { root, put };
}

test('export is an allowlisted projection, never raw logs, screenshots or traces', (t) => {
  const { root, put } = fixture(t);
  for (const file of ['trace.zip', 'backend.log', 'cookies.json', 'error-context.md', 'page.png', 'video.webm', 'report/index.html']) {
    put(`raw/${file}`, `Cookie: ${secret}; Set-Cookie: ${secret}; Authorization: Bearer ${secret}; SQL PARAMETERS: ["${secret}"]`);
  }
  const input = put('raw/database-isolation.json', JSON.stringify({ ...goodIsolation, role: secret, password: secret, client_secret: secret, nested: { token: secret } }));
  const output = join(root, 'public/receipt.json');
  const receipt = writeReceipt({ output, status: 'passed', stage: 'complete', exitCode: 0, isolationFile: input });
  assert.deepEqual(receipt, {
    schemaVersion: 1, evidenceKind: 'pooled-tenancy-browser-emulators', status: 'passed', stage: 'complete', exitCode: 0,
    databaseIsolation: { superuser: false, bypassRls: false, forcedTenantPolicyTables: 19 },
    publicEdgeQualified: false, rawDiagnosticsExported: false,
  });
  assert.deepEqual(readdirSync(join(root, 'public')), ['receipt.json']);
  assert.ok(!readFileSync(output, 'utf8').includes(secret));
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('malformed, unsafe or absent database evidence cannot qualify a passing run', (t) => {
  const { root, put } = fixture(t);
  const inputs = [null, '{', JSON.stringify({ ...goodIsolation, superuser: true }),
    JSON.stringify({ ...goodIsolation, bypass_rls: 'false' }),
    ...[secret, 0, -1, 1.5, 10001].map((n) => JSON.stringify({ ...goodIsolation, forced_tenant_policy_tables: n })),
    JSON.stringify({ ...goodIsolation, padding: secret.repeat(300) })];
  for (const [index, input] of inputs.entries()) {
    const isolationFile = input === null ? join(root, 'missing') : put(`input-${index}`, input);
    assert.equal(writeReceipt({ output: join(root, 'receipt.json'), status: 'passed', stage: 'complete', exitCode: 0, isolationFile }).status, 'failed');
  }
  const target = put('target.json', JSON.stringify(goodIsolation));
  const link = join(root, 'linked-input.json');
  symlinkSync(target, link);
  assert.equal(writeReceipt({ output: join(root, 'receipt.json'), status: 'passed', stage: 'complete', exitCode: 0, isolationFile: link }).status, 'failed');
});

test('a path swapped after validation cannot redirect the isolation read', (t) => {
  const { root, put } = fixture(t);
  const input = put('isolation.json', JSON.stringify(goodIsolation));
  const replacement = put('replacement.json', JSON.stringify({ ...goodIsolation, superuser: true }));
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    fs.renameSync(input, `${input}.opened`);
    symlinkSync(replacement, input);
  };
  // Exercise the replacement window for both descriptor-based reads and the
  // former lstat(path)/readFile(path) implementation; the latter must fail.
  for (const method of ['openSync', 'lstatSync']) {
    const original = fs[method];
    t.mock.method(fs, method, (...args) => {
      const result = original(...args);
      if (args[0] === input) swap();
      return result;
    });
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const receipt = writeReceipt({ output: join(root, 'receipt.json'), status: 'passed', stage: 'complete', exitCode: 0, isolationFile: input });
  assert.equal(swapped, true);
  assert.equal(receipt.status, 'passed', 'must read the originally opened regular file');
});

test('growth after stat cannot evade the bounded isolation input limit', (t) => {
  const { root, put } = fixture(t);
  const input = put('isolation.json', JSON.stringify(goodIsolation));
  for (const method of ['fstatSync', 'lstatSync']) {
    const original = fs[method];
    t.mock.method(fs, method, (...args) => {
      const stat = original(...args);
      writeFileSync(input, `${JSON.stringify(goodIsolation)}${' '.repeat(5000)}`);
      return stat;
    });
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.equal(writeReceipt({ output: join(root, 'receipt.json'), status: 'passed', stage: 'complete', exitCode: 0, isolationFile: input }).status, 'failed');
});

test('new runs replace stale receipts and output symlinks without following them', (t) => {
  const { root, put } = fixture(t);
  const victim = put('private.txt', secret);
  const output = join(root, 'receipt.json');
  symlinkSync(victim, output);
  writeReceipt({ output, status: 'running', stage: 'preflight', exitCode: 0 });
  assert.equal(readFileSync(victim, 'utf8'), secret);
  assert.equal(JSON.parse(readFileSync(output)).status, 'running');
  writeReceipt({ output, status: 'failed', stage: 'browser', exitCode: 17 });
  assert.equal(JSON.parse(readFileSync(output)).status, 'failed');
});

test('control fields cannot inject credential strings or false pass receipts', (t) => {
  const { root, put } = fixture(t);
  const base = { output: join(root, 'receipt.json'), status: 'passed', stage: 'complete', exitCode: 0,
    isolationFile: put('isolation.json', JSON.stringify(goodIsolation)) };
  for (const override of [{ stage: secret }, { status: secret }, { exitCode: secret }, { exitCode: -1 }, { exitCode: 256 }]) {
    assert.throws(() => writeReceipt({ ...base, ...override }));
  }
  for (const override of [{ stage: 'browser' }, { exitCode: 17 }, { status: 'failed' }]) {
    assert.equal(writeReceipt({ ...base, ...override }).status, 'failed');
  }
});

function runnerFixture(t) {
  const { root, put } = fixture(t);
  for (const name of ['run-pooled-tenancy-e2e.sh', 'pooled-tenancy-evidence.mjs']) {
    const destination = put(`scripts/${name}`, '');
    copyFileSync(new URL(`./${name}`, import.meta.url), destination);
  }
  const executable = (path, body) => { const file = put(path, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755); };
  put('infra/docker/keycloak/enterpriseglue-local-realm.json', '{"clients":[]}');
  put('packages/plugin-reference/dist/plugin-bundle/plugin.yaml', JSON.stringify({ metadata: { version: '1.0.0' }, scope: {}, permissions: { required: [] } }));
  put('packages/plugin-reference/dist/plugin-bundle/deploy/resources.json', '{}');
  executable('infra/docker/keycloak/generate-local-tls.sh', 'mkdir -p "$KEYCLOAK_TLS_DIR"; touch "$KEYCLOAK_TLS_DIR/ca.crt" "$KEYCLOAK_TLS_DIR/server.crt" "$KEYCLOAK_TLS_DIR/server.key"');
  executable('scripts/prepare-local-keycloak-saml-certificate.sh', 'touch "$LOCAL_SAML_SIGNING_CERT_FILE"');
  executable('scripts/run-ldap-protocol-mock.sh', `echo '${secret}'\ncase "$SCENARIO" in browser-failure) exit 17;; signal) kill -TERM "$PPID";; esac`);
  executable('bin/pnpm', `echo '${secret}'\nif [ "$SCENARIO" = build-failure ]; then exit 23; fi`);
  executable('bin/curl', `echo '${secret}'`);
  executable('bin/rm', 'if [ "$SCENARIO" = scratch-cleanup-failure ]; then exit 1; fi\nexec /bin/rm "$@"');
  executable('bin/docker', `
case "$*" in
  info) [ "$SCENARIO" != preflight-failure ]; exit $?;;
  *"exec -T backend node -")
    if [ "$SCENARIO" = invalid-isolation ]; then echo '${secret}'; else echo '${JSON.stringify({ ...goodIsolation, role: secret })}'; fi;;
  *"down --volumes"*) touch "$HARNESS_CLEANUP"; [ "$SCENARIO" != cleanup-failure ]; exit $?;;
  *) echo '${secret}';;
esac`);
  const scratch = join(root, 'scratch');
  mkdirSync(scratch);
  const run = (scenario, overrides = {}) => spawnSync('bash', [join(root, 'scripts/run-pooled-tenancy-e2e.sh')], {
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CI: 'true', GITHUB_ACTIONS: '',
      POOLED_TENANCY_E2E_KEEP_RAW: 'false', TMPDIR: scratch, HARNESS_CLEANUP: join(root, 'cleaned'), SCENARIO: scenario,
      POOLED_TENANCY_E2E_ARTIFACT_DIR: join(root, 'artifacts'),
      POOLED_TENANCY_E2E_BACKEND_PORT: '18787', POOLED_TENANCY_E2E_FRONTEND_PORT: '18080',
      POOLED_TENANCY_E2E_KEYCLOAK_PORT: '18443', POOLED_TENANCY_E2E_TLS_FRONTEND_PORT: '18444',
      POOLED_TENANCY_E2E_POSTGRES_PORT: '15432', ...overrides },
    encoding: 'utf8', timeout: 30000,
  });
  return { root, put, scratch, run };
}

for (const [scenario, code, stage] of [
  ['success', 0, 'complete'], ['preflight-failure', 2, 'preflight'], ['build-failure', 23, 'build'],
  ['browser-failure', 17, 'browser'], ['signal', 143, 'browser'], ['invalid-isolation', 1, 'complete'],
  ['cleanup-failure', 1, 'cleanup'], ['scratch-cleanup-failure', 1, 'cleanup'],
]) test(`actual runner control flow: ${scenario}; credentials never reach console/export`, (t) => {
  const { root, put, scratch, run } = runnerFixture(t);
  put('artifacts/stale-trace.zip', secret);
  put('artifacts/public/receipt.json', JSON.stringify({ status: 'passed', stale: secret }));
  const result = run(scenario);
  assert.equal(result.status, code, result.stderr);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  const text = readFileSync(join(root, 'artifacts/public/receipt.json'), 'utf8');
  assert.ok(!text.includes(secret));
  assert.equal(JSON.parse(text).status, code === 0 ? 'passed' : 'failed');
  assert.equal(JSON.parse(text).stage, stage);
  if (scenario === 'scratch-cleanup-failure') {
    assert.equal(readdirSync(scratch).length, 1);
    assert.match(result.stderr, /Sensitive scratch cleanup failed/);
  } else {
    assert.deepEqual(readdirSync(scratch), [], 'owned scratch and raw authentication logs must be removed');
  }
  assert.equal(existsSync(join(root, 'cleaned')), !['preflight-failure', 'build-failure'].includes(scenario));
});

test('raw retention is explicit, private and prohibited on CI', (t) => {
  const { root, scratch, run } = runnerFixture(t);
  for (const overrides of [{ CI: 'true' }, { CI: 'false' }, { CI: '', GITHUB_ACTIONS: 'true' }]) {
    assert.equal(run('success', { ...overrides, POOLED_TENANCY_E2E_KEEP_RAW: 'true' }).status, 2);
    assert.deepEqual(readdirSync(scratch), []);
  }
  assert.equal(run('browser-failure', { CI: '', GITHUB_ACTIONS: '', POOLED_TENANCY_E2E_KEEP_RAW: 'true' }).status, 17);
  const dirs = readdirSync(scratch);
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /^enterpriseglue-pooled-private-debug\./);
  const debug = join(scratch, dirs[0]);
  assert.equal(statSync(debug).mode & 0o777, 0o700);
  assert.ok(readFileSync(join(debug, 'raw-diagnostics/pooled-tenancy-segregated-sso.log'), 'utf8').includes(secret));
  assert.deepEqual(readdirSync(join(root, 'artifacts/public')), ['receipt.json']);
});

test('protected CI uploads precisely the receipt and runs this regression gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  native-tenancy-pooled-e2e:')[1].split('\n  saas-upgrade-restore-rollback:')[0];
  assert.deepEqual([...job.matchAll(/^\s+path: (.+)$/gm)].map((match) => match[1]), ['.artifacts/pooled-tenancy-e2e/public/receipt.json']);
  assert.match(job, /node --test scripts\/pooled-tenancy-evidence\.test\.mjs/);
  assert.match(job, /scripts\/native-tenancy-postgres-runner\.test\.mjs/);
  assert.match(job, /id: pooled-database\s+run: pnpm run test:native-tenancy:postgres-rls/);
  assert.match(job, /if: failure\(\) && steps\.pooled-database\.outcome == 'failure'\s+run: node scripts\/pooled-tenancy-evidence\.mjs \.artifacts\/pooled-tenancy-e2e\/public\/receipt\.json failed database 1/);
  for (const file of ['scripts/pooled-tenancy-evidence.mjs', 'scripts/pooled-tenancy-evidence.test.mjs']) {
    assert.equal(classifyChangedFiles([file]).run_native_tenancy, true);
  }
});
