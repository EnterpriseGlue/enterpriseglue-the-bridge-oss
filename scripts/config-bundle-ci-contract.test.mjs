import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the CI workflow validates, previews, applies a reviewed immutable revision, and uploads receipts', () => {
  const workflow = read('.github/workflows/config-bundle.yml');

  assert.match(workflow, /git_ref:[\s\S]*?Immutable commit SHA/);
  assert.match(workflow, /git_ref to be a full immutable commit SHA/);
  assert.match(workflow, /confirm_apply=APPLY/);
  assert.match(workflow, /ENTERPRISEGLUE_CONFIG_SOURCE_REPOSITORY: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /ENTERPRISEGLUE_CONFIG_SOURCE_REVISION: \$\{\{ inputs\.git_ref \}\}/);
  assert.match(workflow, /ENTERPRISEGLUE_CONFIG_SOURCE_WORKFLOW_RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.ok(workflow.includes('git cat-file -t "HEAD:$BUNDLE_PATH"'));
  assert.match(workflow, /set -euo pipefail\s+node scripts\/config-bundle\.mjs "\$OPERATION" "\$BUNDLE_PATH" --summary \| tee "\$RUNNER_TEMP\/config-bundle-\$OPERATION\.json"/);
  assert.match(workflow, /steps\.bundles\.outcome == 'failure'/);
  assert.ok(workflow.includes('path: ${{ runner.temp }}/config-bundle-${{ inputs.operation }}.json'));
});

test('the CLI re-previews exact input, sends its canonical hash and idempotency key, and sanitizes CI output', () => {
  const cli = read('scripts/config-bundle.mjs');
  const output = read('scripts/lib/config-bundle-output.mjs');

  assert.match(cli, /\/api\/authz\/config-bundles\/preview/);
  assert.match(cli, /expectedPreviewHash: previewRequest\.result\.canonicalHash/);
  assert.match(cli, /idempotencyKey/);
  assert.match(cli, /ENTERPRISEGLUE_CONFIG_SOURCE_REPOSITORY/);
  assert.match(cli, /ciProvenance/);
  assert.match(cli, /reconciliationWaitState/);
  assert.match(cli, /await open\(filePath, 'r'\)/);
  assert.match(cli, /metadata\.isFile\(\)/);
  assert.match(cli, /contents\.byteLength > maxBundleBytes/);
  assert.match(cli, /toSanitizedJson/);
  assert.match(cli, /v1beta1/);
  assert.match(cli, /v1alpha1 remains accepted/);
  assert.match(output, /\[REDACTED\]/);
});

test('rollback remains an explicit apply of a previous reviewed bundle and waits for readiness', () => {
  const guide = read('docs/how-to/deploy-authorization-config.md');

  assert.match(guide, /Rollback uses the previous known-good bundle through preview\/apply/);
  assert.match(guide, /Apply with a new idempotency key/);
  assert.match(guide, /Wait for reconciliation and readiness/);
});

test('live apply waits for reconciliation, continues after failure, and emits one ordered JSON report', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'enterpriseglue-live-bundles-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtures = [
    ['20-engine-b.json', 'engine.b'],
    ['10-engine-a.json', 'engine.a'],
    ['01-platform.json', 'platform.base'],
  ];
  for (const [filename, key] of fixtures) {
    await writeFile(join(directory, filename), JSON.stringify({ bundle: { metadata: { key } }, files: {} }));
  }
  await mkdir(join(directory, 'nested'));
  await writeFile(join(directory, 'nested', '99-ignored.json'), '{}');
  await writeFile(join(directory, 'README.txt'), 'ignored');

  const events = [];
  const applies = [];
  let runtimePolls = 0;
  const server = createServer(async (req, res) => {
    function reply(status, body) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    }
    if (req.method === 'GET') {
      const queue = req.url.split('/').at(-1);
      events.push(queue);
      const status = queue === 'runtime-reconciliation-tasks' && ++runtimePolls === 1 ? 'queued' : 'completed';
      return reply(200, [{ status }]);
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const key = payload.bundle.metadata.key;
    if (req.url.endsWith('/preview')) {
      events.push('preview ' + key);
      return reply(200, { valid: true, canonicalHash: 'hash-' + key });
    }
    events.push('apply ' + key);
    applies.push(payload);
    if (key === 'engine.a') return reply(409, { message: 'private upstream details' });
    if (key === 'platform.base') {
      return reply(202, { applyRunId: 'platform-run', reconciliation: {
        identitySnapshot: { status: 'truncated' },
        runtimeReconciliation: { status: 'queued' },
      } });
    }
    return reply(200, { applyRunId: 'engine-b-run' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));

  const run = promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('./config-bundle.mjs', import.meta.url)), 'apply', directory,
  ], { env: {
    ...process.env,
    ENTERPRISEGLUE_API_URL: 'http://127.0.0.1:' + server.address().port,
    ENTERPRISEGLUE_API_TOKEN: 'fixture-token',
    ENTERPRISEGLUE_CONFIG_EXPECTED_TENANT_SCOPE: 'tenant-default',
    ENTERPRISEGLUE_CONFIG_IDEMPOTENCY_KEY: 'fixture-run',
    ENTERPRISEGLUE_CONFIG_RECONCILIATION_POLL_MS: '5',
  }, timeout: 10_000 });
  await assert.rejects(run, (error) => {
    assert.equal(error.code, 4);
    assert.equal(error.stderr, '');
    assert.deepEqual(JSON.parse(error.stdout), {
      status: 'failed',
      bundles: [
        { filename: '01-platform.json', bundleKey: 'platform.base', status: 'applied', issueCode: null, applyRunId: 'platform-run' },
        { filename: '10-engine-a.json', bundleKey: 'engine.a', status: 'failed', issueCode: 'apply_failed' },
        { filename: '20-engine-b.json', bundleKey: 'engine.b', status: 'applied', issueCode: null, applyRunId: 'engine-b-run' },
      ],
    });
    return true;
  });
  assert.deepEqual(events, [
    'preview platform.base', 'apply platform.base',
    'identity-replay-tasks', 'runtime-reconciliation-tasks', 'runtime-reconciliation-tasks',
    'preview engine.a', 'apply engine.a', 'preview engine.b', 'apply engine.b',
  ]);
  assert.equal(new Set(applies.map(input => input.idempotencyKey)).size, 3);
  assert.ok(applies.every(input => input.expectedPreviewHash === 'hash-' + input.bundle.metadata.key));
});
