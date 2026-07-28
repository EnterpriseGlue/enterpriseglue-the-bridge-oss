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
const ignoredDirectories = new Set(['dev', 'proc', 'sys']);
const maxScannedFileBytes = 64 * 1024 * 1024;
const scannedTextExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.map',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
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
    containerPath: '/app',
  },
  {
    kind: 'frontend',
    image:
      readArgument('--frontend-image') ?? process.env.OSS_FRONTEND_IMAGE_UNDER_TEST,
    containerPath: '/usr/share/nginx/html',
  },
];

for (const image of images) {
  if (!image.image) {
    process.stderr.write(
      `Missing --${image.kind}-image or OSS_${image.kind.toUpperCase()}_IMAGE_UNDER_TEST\n`,
    );
    process.exit(2);
  }
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(filePath)));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
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
  for (const { kind, image, containerPath } of images) {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
    const containerId = execFileSync('docker', ['create', image], {
      encoding: 'utf8',
    }).trim();
    const destination = path.join(temporaryDirectory, kind);
    try {
      await mkdir(destination);
      execFileSync('docker', ['cp', `${containerId}:${containerPath}/.`, destination], {
        stdio: 'ignore',
      });
      const inspection = execFileSync('docker', ['image', 'inspect', image], {
        encoding: 'utf8',
      });
      for (const packageName of collectEnterprisePackages(inspection)) {
        if (!allowedPackages.has(packageName)) {
          violations.push(`${kind} image config references ${packageName}`);
        }
      }
      for (const filePath of await listFiles(destination)) {
        const relativePath = path.relative(destination, filePath);
        for (const packageName of collectEnterprisePackages(relativePath)) {
          if (!allowedPackages.has(packageName)) {
            violations.push(`${kind} image path ${relativePath} contains ${packageName}`);
          }
        }
        if (!scannedTextExtensions.has(path.extname(filePath).toLowerCase())) {
          continue;
        }
        const content = await readFile(filePath);
        if (content.byteLength > maxScannedFileBytes) {
          continue;
        }
        for (const packageName of collectEnterprisePackages(content.toString('utf8'))) {
          if (!allowedPackages.has(packageName)) {
            violations.push(`${kind} image file ${relativePath} references ${packageName}`);
          }
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
