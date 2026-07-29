import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('config bundle CLI help documents explicit engine tenancy files and safety rules', () => {
  const result = spawnSync(process.execPath, ['scripts/config-bundle.mjs', '--help'], {
    cwd: root,
    encoding: 'utf8',
    env: {},
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.\/engines\.json/);
  assert.match(result.stdout, /\.\/engine-tenant-mappings\.json/);
  assert.match(result.stdout, /explicit dedicated\/shared tenancy/);
  assert.match(result.stdout, /shared engines require resource_aware access and deny unmapped resources/);
  assert.match(result.stdout, /enterpriseglue\.ai\/v1beta1/);
  assert.match(result.stdout, /v1alpha1 remains accepted with explicit normalization and deprecation warnings/);
  assert.match(result.stdout, /bundle\.governance/);
  assert.doesNotMatch(result.stdout, /api-client-token|Bearer\s+\S+/);
});
