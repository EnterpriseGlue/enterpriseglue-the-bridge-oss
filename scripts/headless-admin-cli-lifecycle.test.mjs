import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const cli = fileURLToPath(new URL('scripts/config-bundle.mjs', root));
const examplePath = fileURLToPath(new URL('docs/reference/headless-platform-administration.example.json', root));
const example = JSON.parse(await readFile(examplePath, 'utf8'));

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: fileURLToPath(root),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the CLI applies, waits for, and exports the complete headless platform bundle over HTTP', async (t) => {
  const requests = [];
  const canonicalHash = 'a'.repeat(64);
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : null;
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url === '/api/authz/config-bundles/preview') {
      res.end(JSON.stringify({ valid: true, canonicalHash, counts: {}, errors: [] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/authz/config-bundles/apply') {
      res.end(JSON.stringify({
        canonicalHash, applyRunId: 'run-all-family', created: 11, updated: 0, archived: 0,
        reconciliation: { status: 'completed', identitySnapshot: { status: 'completed' } },
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/authz/config-bundles/runs/run-all-family/identity-replay-tasks') {
      res.end('[]');
      return;
    }
    if (req.method === 'GET' && req.url === '/api/authz/config-bundles/export?bundleKey=platform.headless-example') {
      res.end(JSON.stringify(example));
      return;
    }
    res.statusCode = 404;
    res.end('{"error":"not found"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const env = {
    ENTERPRISEGLUE_API_URL: `http://127.0.0.1:${address.port}`,
    ENTERPRISEGLUE_API_TOKEN: 'egac_cli_test_secret',
    ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE: 'platform',
    ENTERPRISEGLUE_CONFIG_IDEMPOTENCY_KEY: 'all-family-cli-lifecycle',
    ENTERPRISEGLUE_CONFIG_RECONCILIATION_POLL_MS: '1',
  };

  const apply = await runCli(['apply', examplePath], env);
  assert.equal(apply.code, 0, apply.stderr);
  assert.match(apply.stdout, /"created": 11/);
  const wait = await runCli(['wait', 'run-all-family'], env);
  assert.equal(wait.code, 0, wait.stderr);
  assert.match(wait.stdout, /"status": "completed"/);
  const exported = await runCli(['export', 'platform.headless-example'], env);
  assert.equal(exported.code, 0, exported.stderr);
  assert.match(exported.stdout, /"\.\/external-engine-systems\.json"/);

  assert.ok(requests.every((entry) => entry.authorization === 'Bearer egac_cli_test_secret'));
  const preview = requests.find((entry) => entry.url === '/api/authz/config-bundles/preview');
  assert.deepEqual(preview.body.bundle.imports, example.bundle.imports);
  const applied = requests.find((entry) => entry.url === '/api/authz/config-bundles/apply');
  assert.equal(applied.body.expectedPreviewHash, canonicalHash);
  assert.equal(applied.body.expectedTenantScope, 'platform');
  assert.equal(applied.body.idempotencyKey, 'all-family-cli-lifecycle');
  assert.equal(applied.body.files['./machine-principals.json'].machinePrincipals.length, 3);
  assert.deepEqual(
    applied.body.files['./machine-principals.json'].machinePrincipals.find((principal) => principal.key === 'api-client.identity-provisioning')?.scopes,
    ['identity:provisioning:manage'],
  );
});
