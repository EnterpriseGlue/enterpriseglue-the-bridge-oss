import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const cli = path.resolve('scripts/provisioning-credential.mjs');

test('offline generation writes a reveal-once token to a protected file without logging it', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eg-provisioning-cli-'));
  const output = path.join(directory, 'credential.secret');
  const result = await execFileAsync(process.execPath, [cli, 'generate', output]);
  const secret = (await readFile(output, 'utf8')).trim();
  assert.match(secret, /^egscim_[^.]+\.[A-Za-z0-9_-]{43}$/);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.doesNotMatch(result.stdout, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('headless creation sends scope authentication and idempotency while keeping the response secret off stdout', async () => {
  const token = 'egscim_00000000-0000-4000-8000-000000000001.secret-value-that-is-never-logged-000000000';
  let observed;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      observed = { url: request.url, headers: request.headers, body: JSON.parse(body) };
      response.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({
        token,
        clientId: '00000000-0000-4000-8000-000000000001',
        tokenEndpointPath: '/scim/v2/workforce/oauth/token',
        credential: { fingerprint: '1234567890abcdef' },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eg-provisioning-cli-'));
  const output = path.join(directory, 'credential.secret');
  try {
    const result = await execFileAsync(process.execPath, [cli, 'create', 'workforce', output], {
      env: {
        ...process.env,
        ENTERPRISEGLUE_API_URL: `http://127.0.0.1:${address.port}`,
        ENTERPRISEGLUE_API_TOKEN: 'egac_client_secret',
        ENTERPRISEGLUE_PROVISIONING_IDEMPOTENCY_KEY: 'deployment:2026-08-15:001',
      },
    });
    assert.equal((await readFile(output, 'utf8')).trim(), token);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(observed.url, '/api/identity/provisioning-directories/workforce/credentials');
    assert.equal(observed.headers.authorization, 'Bearer egac_client_secret');
    assert.equal(observed.headers['idempotency-key'], 'deployment:2026-08-15:001');
    assert.deepEqual(observed.body, { name: 'Headless provisioning automation' });
    assert.doesNotMatch(result.stdout, /secret-value-that-is-never-logged/);
    assert.doesNotMatch(result.stderr, /secret-value-that-is-never-logged/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the CLI refuses to overwrite an existing secret file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eg-provisioning-cli-'));
  const output = path.join(directory, 'credential.secret');
  await execFileAsync(process.execPath, [cli, 'generate', output]);
  await assert.rejects(execFileAsync(process.execPath, [cli, 'generate', output]));
});

test('API commands fail before network access when a stable idempotency key is absent', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eg-provisioning-cli-'));
  await assert.rejects(execFileAsync(process.execPath, [cli, 'create', 'workforce', path.join(directory, 'credential.secret')], {
    env: {
      ...process.env,
      ENTERPRISEGLUE_API_URL: 'http://127.0.0.1:1',
      ENTERPRISEGLUE_API_TOKEN: 'egac_client_secret',
      ENTERPRISEGLUE_PROVISIONING_IDEMPOTENCY_KEY: '',
    },
  }), /ENTERPRISEGLUE_PROVISIONING_IDEMPOTENCY_KEY is required/);
});
