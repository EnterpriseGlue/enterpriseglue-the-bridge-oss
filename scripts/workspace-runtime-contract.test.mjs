import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifests = [
  'package.json',
  'backend/package.json',
  'frontend/package.json',
  'packages/shared/package.json',
  'packages/backend-host/package.json',
  'packages/frontend-host/package.json',
  'packages/enterprise-plugin-api/package.json',
];

async function manifest(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

test('pins one supported Node runtime across every published and workspace package', async () => {
  for (const path of manifests) {
    assert.equal((await manifest(path)).engines?.node, '>=24 <25', `${path} must declare the canonical Node runtime`);
  }
});

test('pins the workspace package manager and exact internal runtime dependencies', async () => {
  const root = await manifest('package.json');
  const backendHost = await manifest('packages/backend-host/package.json');
  assert.equal(root.packageManager, 'pnpm@11.0.8');
  assert.equal(backendHost.dependencies?.['@enterpriseglue/shared'], 'workspace:*');
  assert.equal(backendHost.dependencies?.['@enterpriseglue/enterprise-plugin-api'], 'workspace:*');
});
