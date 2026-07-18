import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the CI workflow validates, previews, applies a reviewed immutable revision, and uploads receipts', () => {
  const workflow = read('.github/workflows/config-bundle.yml');

  assert.match(workflow, /git_ref:[\s\S]*?Immutable commit SHA/);
  assert.match(workflow, /git_ref to be a full immutable commit SHA/);
  assert.match(workflow, /confirm_apply=APPLY/);
  assert.match(workflow, /ENTERPRISEGLUE_CONFIG_SOURCE_REPOSITORY: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /ENTERPRISEGLUE_CONFIG_SOURCE_REVISION: \$\{\{ inputs\.git_ref \}\}/);
  assert.match(workflow, /ENTERPRISEGLUE_CONFIG_SOURCE_WORKFLOW_RUN_ID: \$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /pnpm authz:config validate "\$BUNDLE_PATH"/);
  assert.match(workflow, /pnpm authz:config preview "\$BUNDLE_PATH" \| tee config-bundle-preview\.json/);
  assert.match(workflow, /node scripts\/config-bundle\.mjs apply "\$BUNDLE_PATH" \| tee config-bundle-apply\.json/);
  assert.match(workflow, /node scripts\/config-bundle\.mjs wait "\$APPLY_RUN_ID" \| tee config-bundle-reconciliation\.json/);
  for (const receipt of ['config-bundle-preview.json', 'config-bundle-apply.json', 'config-bundle-reconciliation.json']) {
    assert.match(workflow, new RegExp(receipt.replace('.', '\\.')), `${receipt} must be retained as a workflow artifact`);
  }
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
  assert.match(cli, /toSanitizedJson/);
  assert.match(output, /\[REDACTED\]/);
});

test('rollback remains an explicit apply of a previous reviewed bundle and waits for readiness', () => {
  const guide = read('docs/how-to/deploy-authorization-config.md');

  assert.match(guide, /Rollback uses the previous known-good bundle through preview\/apply/);
  assert.match(guide, /Apply with a new idempotency key/);
  assert.match(guide, /Wait for reconciliation and readiness/);
});
