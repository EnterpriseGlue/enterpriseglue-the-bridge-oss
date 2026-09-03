import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyHostPackageTarballs } from './verify-host-package-tarballs.mjs';
import { packageEntryPointReferences } from './package-tarball-contract.mjs';

const packagePaths = [
  '../packages/shared/package.json',
  '../packages/backend-host/package.json',
  '../packages/frontend-host/package.json',
];

async function createTarball(directory, manifest, suffix = '') {
  const source = await mkdtemp(join(tmpdir(), 'eg-host-tarball-source-'));
  const packageDirectory = join(source, 'package');
  await mkdir(packageDirectory);
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const reference of packageEntryPointReferences(manifest)) {
    const relative = reference.slice(2).replaceAll('*', 'fixture');
    const target = join(packageDirectory, relative);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, 'export const ready = true;\n');
  }
  const filename = `${manifest.name.replace('@enterpriseglue/', 'enterpriseglue-')}-${manifest.version}${suffix}.tgz`;
  execFileSync('tar', ['-czf', join(directory, filename), '-C', source, 'package']);
}

async function sourceManifests() {
  return Promise.all(packagePaths.map(async (path) => {
    const manifest = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
      manifest[field] = Object.fromEntries(
        Object.entries(manifest[field] ?? {}).map(([name, reference]) => [
          name,
          String(reference).startsWith('workspace:') ? '0.0.0' : reference,
        ]),
      );
    }
    return manifest;
  }));
}

test('accepts exactly the three source-version host packages and emits checksums', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eg-host-tarballs-'));
  for (const manifest of await sourceManifests()) await createTarball(directory, manifest);
  const receipt = verifyHostPackageTarballs(directory);
  assert.deepEqual(receipt.map(({ name }) => name), [
    '@enterpriseglue/backend-host',
    '@enterpriseglue/frontend-host',
    '@enterpriseglue/shared',
  ]);
  for (const entry of receipt) {
    assert.match(entry.filename, /\.tgz$/);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.bytes > 0);
  }
});

test('rejects local dependency references in the retained payload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eg-host-tarballs-local-ref-'));
  const manifests = await sourceManifests();
  for (const manifest of manifests) {
    const candidate = manifest.name === '@enterpriseglue/frontend-host'
      ? { ...manifest, dependencies: { ...(manifest.dependencies ?? {}), fixture: 'workspace:*' } }
      : manifest;
    await createTarball(directory, candidate);
  }
  assert.throws(() => verifyHostPackageTarballs(directory), /forbidden dependencies\.fixture=workspace:\*/);
});

test('rejects duplicate or unexpected tarballs before publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eg-host-tarballs-extra-'));
  const manifests = await sourceManifests();
  for (const manifest of manifests) await createTarball(directory, manifest);
  await createTarball(directory, manifests[0], '-duplicate');
  assert.throws(() => verifyHostPackageTarballs(directory), /Expected 3 host package tarballs, found 4/);
});

test('rejects a package whose manifest points to an omitted build output', async () => {
  const manifests = await sourceManifests();
  const broken = manifests.find(({ name }) => name === '@enterpriseglue/backend-host');
  broken.exports = { '.': './missing/index.js' };
  const replacementDirectory = await mkdtemp(join(tmpdir(), 'eg-host-tarballs-broken-'));
  for (const manifest of manifests) {
    if (manifest === broken) {
      const source = await mkdtemp(join(tmpdir(), 'eg-host-broken-source-'));
      const packageDirectory = join(source, 'package');
      await mkdir(packageDirectory);
      await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(manifest));
      execFileSync('tar', ['-czf', join(replacementDirectory, 'backend.tgz'), '-C', source, 'package']);
    } else {
      await createTarball(replacementDirectory, manifest);
    }
  }
  assert.throws(
    () => verifyHostPackageTarballs(replacementDirectory),
    /missing packed entry point \.\/missing\/index\.js/,
  );
});
