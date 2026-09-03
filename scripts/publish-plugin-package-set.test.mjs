import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canonicalPackageDigest,
  processPackageSet,
  sha512Integrity,
} from './publish-plugin-package-set.mjs';

async function digestFixturePackage(tarball) {
  return sha512Integrity(await readFile(tarball));
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'eg-plugin-package-set-'));
  const packages = [
    { name: '@enterpriseglue/enterprise-plugin-api', version: '0.4.0', filename: 'api.tgz', payload: 'api' },
    { name: '@enterpriseglue/plugin-sdk', version: '0.3.0', filename: 'sdk.tgz', payload: 'sdk' },
    { name: '@enterpriseglue/plugin-runtime', version: '0.2.0', filename: 'runtime.tgz', payload: 'runtime' },
    { name: '@enterpriseglue/plugin-installer', version: '0.2.1', filename: 'installer.tgz', payload: 'installer' },
    { name: '@enterpriseglue/plugin-manager', version: '0.1.1', filename: 'manager.tgz', payload: 'manager' },
  ];
  for (const entry of packages) {
    await writeFile(join(directory, entry.filename), entry.payload);
  }
  await writeFile(
    join(directory, 'release-receipt.json'),
    JSON.stringify({ packages: packages.map(({ payload: _payload, ...entry }) => entry) }),
  );
  return { directory, packages };
}

async function packageTarball(name, manifest) {
  const directory = await mkdtemp(join(tmpdir(), 'eg-plugin-canonical-package-'));
  const packageDirectory = join(directory, 'package');
  await mkdir(packageDirectory);
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(manifest, null, 2));
  await writeFile(join(packageDirectory, 'index.js'), 'export const ready = true;\n');
  const tarball = join(directory, `${name}.tgz`);
  execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
  return tarball;
}

test('canonical package digests ignore JSON object member order in package.json', async () => {
  const first = await packageTarball('first', {
    name: '@fixture/example',
    version: '1.0.0',
    dependencies: { zod: '^4.3.6', runtime: '0.2.1', installer: '0.2.4' },
  });
  const reordered = await packageTarball('reordered', {
    dependencies: { installer: '0.2.4', runtime: '0.2.1', zod: '^4.3.6' },
    version: '1.0.0',
    name: '@fixture/example',
  });
  assert.equal(await canonicalPackageDigest(first), await canonicalPackageDigest(reordered));
});

test('canonical package digests still reject a package.json value change', async () => {
  const first = await packageTarball('first-value', {
    name: '@fixture/example',
    version: '1.0.0',
  });
  const changed = await packageTarball('changed-value', {
    name: '@fixture/example',
    version: '1.0.1',
  });
  assert.notEqual(await canonicalPackageDigest(first), await canonicalPackageDigest(changed));
});

test('plans only new payloads and safely reuses content-identical versions', async () => {
  const { directory, packages } = await fixture();
  const existing = sha512Integrity(Buffer.from(packages[1].payload));
  const result = await processPackageSet({
    mode: 'plan',
    directory,
    digestPackage: digestFixturePackage,
    registryClient: {
      describe: async (subject) =>
        subject.includes('plugin-sdk')
          ? { integrity: existing, contentDigest: existing }
          : null,
      publish: async () => assert.fail('plan must not publish'),
    },
  });
  assert.deepEqual(result.packages.map(({ status }) => status), [
    'new',
    'reused',
    'new',
    'new',
    'new',
  ]);
});

test('rejects a reused semantic version with a different payload', async () => {
  const { directory } = await fixture();
  await assert.rejects(
    processPackageSet({
      mode: 'plan',
      directory,
      digestPackage: digestFixturePackage,
      registryClient: {
        describe: async () => ({
          integrity: sha512Integrity(Buffer.from('different')),
          contentDigest: sha512Integrity(Buffer.from('different')),
        }),
        publish: async () => {},
      },
    }),
    /different immutable payload/,
  );
});

test('publishes only missing packages and verifies registry integrity afterward', async () => {
  const { directory, packages } = await fixture();
  const registry = new Map([
    [
      '@enterpriseglue/plugin-sdk@0.3.0',
      sha512Integrity(Buffer.from(packages[1].payload)),
    ],
  ]);
  const published = [];
  const result = await processPackageSet({
    mode: 'publish',
    directory,
    digestPackage: digestFixturePackage,
    registryClient: {
      describe: async (subject) => {
        const digest = registry.get(subject);
        return digest ? { integrity: digest, contentDigest: digest } : null;
      },
      publish: async (tarball, { dryRun }) => {
        assert.equal(dryRun, false);
        published.push(tarball);
        const entry = packages.find((candidate) => tarball.endsWith(candidate.filename));
        assert.ok(entry);
        registry.set(
          `${entry.name}@${entry.version}`,
          sha512Integrity(Buffer.from(entry.payload)),
        );
      },
    },
  });
  assert.equal(published.length, 4);
  assert.deepEqual(result.packages.map(({ status }) => status), [
    'published',
    'reused',
    'published',
    'published',
    'published',
  ]);
});

test('supports an exact alternate dependency-ordered publication set', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eg-host-package-set-'));
  const packages = [
    { name: '@enterpriseglue/frontend-host', version: '3.0.0', filename: 'frontend.tgz', payload: 'frontend' },
    { name: '@enterpriseglue/shared', version: '1.0.0', filename: 'shared.tgz', payload: 'shared' },
    { name: '@enterpriseglue/backend-host', version: '2.0.0', filename: 'backend.tgz', payload: 'backend' },
  ];
  for (const entry of packages) await writeFile(join(directory, entry.filename), entry.payload);
  await writeFile(
    join(directory, 'release-receipt.json'),
    JSON.stringify({ packages: packages.map(({ payload: _payload, ...entry }) => entry) }),
  );
  const result = await processPackageSet({
    mode: 'plan',
    directory,
    digestPackage: digestFixturePackage,
    packageOrder: [
      '@enterpriseglue/shared',
      '@enterpriseglue/backend-host',
      '@enterpriseglue/frontend-host',
    ],
    schemaVersion: 'enterpriseglue-host-package-publication/v1',
    registryClient: {
      describe: async () => null,
      publish: async () => assert.fail('plan must not publish'),
    },
  });
  assert.equal(result.schemaVersion, 'enterpriseglue-host-package-publication/v1');
  assert.deepEqual(result.packages.map(({ subject }) => subject), [
    '@enterpriseglue/shared@1.0.0',
    '@enterpriseglue/backend-host@2.0.0',
    '@enterpriseglue/frontend-host@3.0.0',
  ]);
});
