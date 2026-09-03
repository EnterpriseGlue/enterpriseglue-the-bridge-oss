import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sharedWorkflow = await readFile(
  new URL('../.github/workflows/publish-shared.yml', import.meta.url),
  'utf8',
);

test('shared publication uses a pnpm-packed external manifest', () => {
  assert.match(sharedWorkflow, /TARBALL="\$\(pnpm pack --pack-destination/);
  assert.match(sharedWorkflow, /tar -xOf "\$TARBALL" package\/package\.json/);
  assert.match(sharedWorkflow, /startsWith\('workspace:'\)/);
  assert.match(
    sharedWorkflow,
    /npm publish "\$\{\{ steps\.pack\.outputs\.tarball \}\}" --ignore-scripts --registry=https:\/\/npm\.pkg\.github\.com/,
  );
  assert.doesNotMatch(sharedWorkflow, /^\s*run:\s+npm publish\s*$/m);
});
