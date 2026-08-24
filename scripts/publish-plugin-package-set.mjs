import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const DEFAULT_REGISTRY = 'https://npm.pkg.github.com';
const MODES = new Set(['plan', 'dry-run', 'publish', 'verify']);
const PACKAGE_ORDER = [
  '@enterpriseglue/plugin-sdk',
  '@enterpriseglue/plugin-runtime',
  '@enterpriseglue/plugin-installer',
  '@enterpriseglue/plugin-manager',
];

export function sha512Integrity(payload) {
  return `sha512-${createHash('sha512').update(payload).digest('base64')}`;
}

async function canonicalTreeEntries(root, relative = '') {
  const directory = join(root, relative);
  const names = await readdir(directory);
  const entries = [];
  for (const name of names.sort()) {
    const child = join(relative, name);
    const metadata = await lstat(join(root, child));
    if (metadata.isDirectory()) {
      entries.push(...(await canonicalTreeEntries(root, child)));
    } else if (metadata.isFile()) {
      entries.push({
        path: child,
        kind: 'file',
        executable: (metadata.mode & 0o111) !== 0,
        payload: await readFile(join(root, child)),
      });
    } else if (metadata.isSymbolicLink()) {
      entries.push({
        path: child,
        kind: 'symlink',
        executable: false,
        payload: Buffer.from(await readlink(join(root, child))),
      });
    } else {
      throw new Error(`unsupported package entry: ${child}`);
    }
  }
  return entries;
}

export async function canonicalPackageDigest(tarball) {
  const extraction = await mkdtemp(join(tmpdir(), 'eg-plugin-package-content-'));
  try {
    const listing = spawnSync('tar', ['-tzf', tarball], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (listing.error) throw listing.error;
    if (listing.status !== 0) {
      throw npmFailure(listing, `inspect ${basename(tarball)}`);
    }
    for (const entry of listing.stdout.split('\n').filter(Boolean)) {
      assert.ok(!entry.startsWith('/'), `absolute package path is forbidden: ${entry}`);
      assert.ok(
        !entry.split('/').includes('..'),
        `parent package path is forbidden: ${entry}`,
      );
    }
    const extractionResult = spawnSync(
      'tar',
      ['-xzf', tarball, '--no-same-owner', '--no-same-permissions', '-C', extraction],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (extractionResult.error) throw extractionResult.error;
    if (extractionResult.status !== 0) {
      throw npmFailure(extractionResult, `extract ${basename(tarball)}`);
    }
    const hash = createHash('sha256');
    for (const entry of await canonicalTreeEntries(extraction)) {
      hash.update(entry.kind);
      hash.update('\0');
      hash.update(entry.path);
      hash.update('\0');
      hash.update(entry.executable ? 'executable' : 'regular');
      hash.update('\0');
      hash.update(entry.payload);
      hash.update('\0');
    }
    return `sha256:${hash.digest('hex')}`;
  } finally {
    await rm(extraction, { recursive: true, force: true });
  }
}

function npmFailure(result, operation) {
  const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return new Error(`${operation} failed${detail ? `: ${detail}` : ''}`);
}

export function createNpmRegistryClient({
  registry = process.env.NPM_REGISTRY || DEFAULT_REGISTRY,
  npmCli = process.env.NPM_CLI || 'npm',
} = {}) {
  const run = (args, operation) => {
    const result = spawnSync(npmCli, args, {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw npmFailure(result, operation);
    return result.stdout.trim();
  };

  return {
    async describe(subject) {
      const result = spawnSync(
        npmCli,
        ['view', subject, 'dist.integrity', '--json', `--registry=${registry}`],
        {
          encoding: 'utf8',
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
        if (/\bE404\b|\b404 Not Found\b/i.test(detail)) return null;
        throw npmFailure(result, `read ${subject}`);
      }
      const value = JSON.parse(result.stdout);
      assert.equal(typeof value, 'string', `${subject} must expose dist.integrity`);
      assert.match(value, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
      const downloadDirectory = await mkdtemp(
        join(tmpdir(), 'eg-plugin-registry-package-'),
      );
      try {
        const output = run(
          [
            'pack',
            subject,
            '--ignore-scripts',
            '--json',
            `--pack-destination=${downloadDirectory}`,
            `--registry=${registry}`,
          ],
          `download ${subject}`,
        );
        const records = JSON.parse(output);
        assert.ok(Array.isArray(records) && records.length === 1);
        assert.equal(typeof records[0].filename, 'string');
        const tarball = join(downloadDirectory, basename(records[0].filename));
        return {
          integrity: value,
          contentDigest: await canonicalPackageDigest(tarball),
        };
      } finally {
        await rm(downloadDirectory, { recursive: true, force: true });
      }
    },
    async publish(tarball, { dryRun }) {
      const args = [
        'publish',
        tarball,
        '--ignore-scripts',
        `--registry=${registry}`,
      ];
      if (dryRun) args.push('--dry-run');
      run(args, `${dryRun ? 'dry-run' : 'publish'} ${basename(tarball)}`);
    },
  };
}

export async function processPackageSet({
  mode,
  directory,
  registryClient,
  digestPackage = canonicalPackageDigest,
}) {
  assert.ok(MODES.has(mode), `unsupported mode: ${mode}`);
  const receiptPath = join(directory, 'release-receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.ok(Array.isArray(receipt.packages) && receipt.packages.length > 0);

  const results = [];
  const orderedPackages = [...receipt.packages].sort(
    (left, right) =>
      PACKAGE_ORDER.indexOf(left.name) - PACKAGE_ORDER.indexOf(right.name),
  );
  assert.deepEqual(
    orderedPackages.map(({ name }) => name),
    PACKAGE_ORDER,
    'the protected publication set must contain each public package exactly once',
  );
  for (const entry of orderedPackages) {
    assert.equal(typeof entry.name, 'string');
    assert.match(entry.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    assert.equal(basename(entry.filename), entry.filename);
    const tarball = join(directory, entry.filename);
    const localIntegrity = sha512Integrity(await readFile(tarball));
    const localContentDigest = await digestPackage(tarball);
    const subject = `${entry.name}@${entry.version}`;
    const published = await registryClient.describe(subject);

    if (published !== null) {
      assert.equal(
        published.contentDigest,
        localContentDigest,
        `${subject} exists with a different immutable payload`,
      );
      results.push({
        subject,
        status: mode === 'verify' ? 'verified' : 'reused',
        integrity: published.integrity,
        contentDigest: localContentDigest,
      });
      continue;
    }

    assert.notEqual(mode, 'verify', `${subject} is not visible in the registry`);
    if (mode === 'plan') {
      results.push({
        subject,
        status: 'new',
        integrity: localIntegrity,
        contentDigest: localContentDigest,
      });
      continue;
    }

    const dryRun = mode === 'dry-run';
    await registryClient.publish(tarball, { dryRun });
    if (!dryRun) {
      const verified = await registryClient.describe(subject);
      assert.ok(verified, `${subject} is not visible after publication`);
      assert.equal(
        verified.contentDigest,
        localContentDigest,
        `${subject} registry payload differs after publication`,
      );
    }
    results.push({
      subject,
      status: dryRun ? 'dry-run' : 'published',
      integrity: localIntegrity,
      contentDigest: localContentDigest,
    });
  }

  return {
    schemaVersion: 'enterpriseglue-plugin-package-publication/v1',
    mode,
    registry: process.env.NPM_REGISTRY || DEFAULT_REGISTRY,
    packages: results,
  };
}

async function main() {
  const [mode, directoryArgument] = process.argv.slice(2);
  assert.ok(MODES.has(mode), 'usage: publish-plugin-package-set.mjs <plan|dry-run|publish|verify> <directory>');
  assert.ok(directoryArgument, 'package directory is required');
  const publication = await processPackageSet({
    mode,
    directory: resolve(directoryArgument),
    registryClient: createNpmRegistryClient(),
  });
  process.stdout.write(`${JSON.stringify(publication, null, 2)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
