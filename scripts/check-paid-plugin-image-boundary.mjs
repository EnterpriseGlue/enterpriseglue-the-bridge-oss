#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const enterpriseScope = '@enterpriseglue/';
const allowedLegacyLoaderPackages = new Set([
  '@enterpriseglue/enterprise-backend',
  '@enterpriseglue/enterprise-frontend',
]);
function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const images = [
  {
    kind: 'backend',
    image:
      readArgument('--backend-image') ?? process.env.OSS_BACKEND_IMAGE_UNDER_TEST,
    contentDirectories: [
      '/app/dist/backend/src',
      '/app/dist/packages/backend-host/src',
      '/app/dist/packages/plugin-runtime/dist',
      '/app/dist/packages/plugin-sdk/dist',
    ],
  },
  {
    kind: 'frontend',
    image:
      readArgument('--frontend-image') ?? process.env.OSS_FRONTEND_IMAGE_UNDER_TEST,
    contentDirectories: ['/usr/share/nginx/html'],
  },
  {
    kind: 'manager',
    image:
      readArgument('--manager-image') ?? process.env.OSS_MANAGER_IMAGE_UNDER_TEST,
    contentDirectories: [
      '/opt/enterpriseglue/plugin-manager/node_modules/@enterpriseglue',
    ],
  },
].filter(({ kind, image }) => kind !== 'manager' || Boolean(image));

for (const image of images) {
  if (!image.image) {
    process.stderr.write(
      `Missing --${image.kind}-image or OSS_${image.kind.toUpperCase()}_IMAGE_UNDER_TEST\n`,
    );
    process.exit(2);
  }
}

async function discoverPublicPackages() {
  const publicPackages = new Set();
  const packageManifests = [];
  for (const entry of await readdir(path.join(root, 'packages'), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      packageManifests.push(path.join(root, 'packages', entry.name, 'package.json'));
    }
  }
  for (const manifestPath of [
    path.join(root, 'backend/package.json'),
    path.join(root, 'frontend/package.json'),
    ...packageManifests,
  ]) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (typeof manifest.name === 'string' && manifest.name.startsWith(enterpriseScope)) {
      publicPackages.add(manifest.name);
    }
  }
  return publicPackages;
}

async function collectImagePackageMarkers(directory) {
  const packages = new Set();

  async function walk(currentDirectory) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      // Package names are ASCII, so latin1 gives a lossless one-byte mapping
      // for both text and binary image content without external scan tools.
      const content = (await readFile(entryPath)).toString('latin1');
      for (const packageName of collectEnterprisePackages(content)) {
        packages.add(packageName);
      }
    }
  }

  await walk(directory);
  return packages;
}

function collectImagePathPackageMarkers(kind, image) {
  if (kind !== 'frontend') {
    const nodePathWalker = String.raw`
      import { readdir } from 'node:fs/promises';
      const matches = new Set();
      const pattern = /@enterpriseglue(?:\/|\+)([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/g;
      async function walk(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const entryPath = directory + '/' + entry.name;
          for (const match of entryPath.matchAll(pattern)) matches.add('@enterpriseglue/' + match[1]);
          if (entry.isDirectory()) await walk(entryPath);
        }
      }
      await walk(process.argv[1]);
      process.stdout.write([...matches].sort().join('\n'));
    `;
    const listing = execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--entrypoint',
        'node',
        image,
        '--input-type=module',
        '-e',
        nodePathWalker,
        kind === 'backend' ? '/app' : '/opt/enterpriseglue/plugin-manager',
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    return new Set(listing.split('\n').filter(Boolean));
  }

  const listing = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      '/busybox/sh',
      image,
      '-c',
      'find "$1" -print',
      'sh',
      '/usr/share/nginx/html',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return collectEnterprisePackages(listing);
}

function collectEnterprisePackages(value) {
  const packages = new Set();
  const pattern =
    /@enterpriseglue(?:\/|\+)([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/g;
  for (const match of value.matchAll(pattern)) {
    packages.add(`${enterpriseScope}${match[1]}`);
  }
  return packages;
}

const publicPackages = await discoverPublicPackages();
const allowedPackages = new Set([...publicPackages, ...allowedLegacyLoaderPackages]);
const violations = [];
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'enterpriseglue-paid-plugin-image-boundary-'),
);

try {
  for (const { kind, image, contentDirectories } of images) {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    const containerId = execFileSync('docker', ['create', image], {
      encoding: 'utf8',
    }).trim();
    const destination = path.join(temporaryDirectory, kind);
    try {
      await mkdir(destination);
      for (const sourceDirectory of contentDirectories) {
        const contentDestination = path.join(
          destination,
          sourceDirectory.replace(/^\//, '').replaceAll('/', '_'),
        );
        await mkdir(contentDestination);
        execFileSync(
          'docker',
          ['cp', `${containerId}:${sourceDirectory}/.`, contentDestination],
        );
      }
      const inspection = execFileSync('docker', ['image', 'inspect', image], {
        encoding: 'utf8',
      });
      for (const packageName of collectEnterprisePackages(inspection)) {
        if (!allowedPackages.has(packageName)) {
          violations.push(`${kind} image config references ${packageName}`);
        }
      }
      for (const packageName of collectImagePathPackageMarkers(kind, image)) {
        if (!allowedPackages.has(packageName)) {
          violations.push(`${kind} image path references ${packageName}`);
        }
      }
      for (const packageName of await collectImagePackageMarkers(destination)) {
        if (!allowedPackages.has(packageName)) {
          violations.push(`${kind} image content references ${packageName}`);
        }
      }
    } finally {
      execFileSync('docker', ['rm', containerId], { stdio: 'ignore' });
    }
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}

if (violations.length > 0) {
  process.stderr.write(
    [
      '❌ [paid-plugin-image-boundary] Public OSS images contain a non-public package marker.',
      ...[...new Set(violations)].sort().map((violation) => `- ${violation}`),
      '',
    ].join('\n'),
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    event: 'paid_plugin_image_boundary',
    status: 'passed',
    images: images.map(({ kind, image }) => ({ kind, image })),
    publicWorkspacePackages: publicPackages.size,
    privatePackageMarkers: 0,
  })}\n`,
);
