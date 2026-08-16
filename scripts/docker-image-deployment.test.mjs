import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

test('published-image compose mode pulls both images and fails closed on registry errors', () => {
  const overlay = read('infra/docker/compose/docker-compose.images.yml');
  assert.equal((overlay.match(/pull_policy:\s*always/g) || []).length, 2);
  assert.equal((overlay.match(/build:\s*!reset null/g) || []).length, 2);
  assert.match(overlay, /backend:[\s\S]*image: \$\{BACKEND_IMAGE\}:\$\{IMAGE_TAG\}[\s\S]*pull_policy: always/);
  assert.match(overlay, /frontend:[\s\S]*image: \$\{FRONTEND_IMAGE\}:\$\{IMAGE_TAG\}[\s\S]*pull_policy: always/);
});

test('CI image smoke jobs use their downloaded image artifacts without registry pulls', () => {
  const workflow = read('.github/workflows/ci.yml');
  const databasePulls = workflow.match(/docker compose[^\n]+docker-compose\.images\.yml[^\n]+pull db/g) || [];
  const localImageStarts = workflow.match(/docker compose[^\n]+docker-compose\.images\.yml[^\n]+up -d --pull never/g) || [];

  assert.equal(databasePulls.length, 2);
  assert.equal(localImageStarts.length, 2);
  assert.match(workflow, /smoke-postgres-image-deploy:[\s\S]*\.env\.images\.ci[\s\S]*pull db[\s\S]*up -d --pull never/);
  assert.match(workflow, /smoke-postgres-image-deploy-exposed:[\s\S]*\.env\.images\.exposed\.ci[\s\S]*pull db[\s\S]*up -d --pull never/);
});

test('Docker Hub examples use the configured release namespace', () => {
  const publicFiles = [
    'README.md',
    'docs/how-to/getting-started-docker.md',
    'infra/docker/env/examples/images.postgres.env.example',
    'infra/docker/env/examples/images.oracle.env.example',
    'infra/docker/env/examples/selfhost.env.example',
  ];
  for (const relativePath of publicFiles) {
    const source = read(relativePath);
    assert.equal(source.includes('docker.io/enterpriseglue/enterpriseglue-the-bridge-oss-'), false);
    assert.equal(source.includes('docker.io/haryenterpriseglue/enterpriseglue-the-bridge-oss-'), true);
  }
});
