#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const enterpriseScope = '@enterpriseglue/';
const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const ignoredDirectories = new Set([
  '.artifacts',
  '.git',
  '.local',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const sourceRoots = ['backend/src', 'frontend/src', 'packages', 'scripts'];
const productionDockerfiles = ['backend/Dockerfile.prod', 'frontend/Dockerfile.prod'];
const boundaryPolicyImplementations = new Set([
  'scripts/check-paid-plugin-boundary.mjs',
  'scripts/check-paid-plugin-image-boundary.mjs',
]);
const privateProductMarkers = [
  /\bio\.enterpriseglue\.ion-support\b/i,
  /\bion support\b/i,
  /\b(?:enterpriseglue-)?ion-support-agent\b/i,
];

// These are legacy optional OSS/EE loader seams, not paid plugin imports. They stay constrained
// to their existing single-purpose loaders by check-oss-ee-boundary.sh.
const legacyLoaderImports = new Map([
  [
    '@enterpriseglue/enterprise-backend',
    new Set([
      'backend/src/enterprise/loadEnterpriseBackendPlugin.ts',
      'packages/backend-host/src/enterprise/loadEnterpriseBackendPlugin.ts',
    ]),
  ],
  [
    '@enterpriseglue/enterprise-frontend',
    new Set([
      'frontend/src/enterprise/loadEnterpriseFrontendPlugin.ts',
      'packages/frontend-host/src/enterprise/loadEnterpriseFrontendPlugin.ts',
    ]),
  ],
]);

async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function listFiles(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function packageBase(specifier) {
  if (!specifier.startsWith(enterpriseScope)) {
    return undefined;
  }
  const [scope, name] = specifier.split('/');
  return name ? `${scope}/${name}` : undefined;
}

function collectEnterpriseSpecifiers(source) {
  const specifiers = new Set();
  const quotedPackage = /['"](@enterpriseglue\/[A-Za-z0-9._-]+(?:\/[^'"]*)?)['"]/g;
  for (const match of source.matchAll(quotedPackage)) {
    specifiers.add(match[1]);
  }
  return specifiers;
}

function privateProductMarker(source) {
  return privateProductMarkers.find((marker) => marker.test(source));
}

function isTestOrFixture(relativePath) {
  return (
    /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(relativePath) ||
    relativePath.includes('/fixtures/') ||
    relativePath.includes('/test/')
  );
}

function importIsAllowed(specifier, relativePath, publicPackages) {
  const base = packageBase(specifier);
  if (!base) {
    return true;
  }
  if (publicPackages.has(base)) {
    return true;
  }
  return legacyLoaderImports.get(base)?.has(relativePath) ?? false;
}

async function discoverPublicWorkspacePackages() {
  const manifestPaths = ['package.json', 'backend/package.json', 'frontend/package.json'];
  for (const entry of await readdir(path.join(root, 'packages'), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      manifestPaths.push(path.posix.join('packages', entry.name, 'package.json'));
    }
  }

  const publicPackages = new Set();
  for (const relativePath of manifestPaths) {
    if (!(await exists(path.join(root, relativePath)))) {
      continue;
    }
    const manifest = await readJson(relativePath);
    if (typeof manifest.name === 'string' && manifest.name.startsWith(enterpriseScope)) {
      publicPackages.add(manifest.name);
    }
  }
  return { manifestPaths: [...new Set(manifestPaths)].sort(), publicPackages };
}

function checkSyntheticClassifier(publicPackages) {
  const samplePrivatePackage = '@enterpriseglue/example-paid-plugin';
  if (publicPackages.has(samplePrivatePackage)) {
    throw new Error('Synthetic private-package fixture unexpectedly belongs to the public workspace');
  }
  if (importIsAllowed(samplePrivatePackage, 'backend/src/example.ts', publicPackages)) {
    throw new Error('Paid-plugin import classifier failed its deny fixture');
  }
  if (
    !importIsAllowed(
      '@enterpriseglue/plugin-sdk/backend',
      'packages/example/src/backend.ts',
      publicPackages,
    )
  ) {
    throw new Error('Public SDK subpath classifier failed its allow fixture');
  }
  if (
    !importIsAllowed(
      '@enterpriseglue/enterprise-backend',
      'backend/src/enterprise/loadEnterpriseBackendPlugin.ts',
      publicPackages,
    )
  ) {
    throw new Error('Legacy loader classifier failed its constrained allow fixture');
  }
  if (!privateProductMarker('io.enterpriseglue.ion-support')) {
    throw new Error('Private product marker classifier failed its deny fixture');
  }
  if (privateProductMarker('io.enterpriseglue.reference-health')) {
    throw new Error('Private product marker classifier rejected the neutral reference fixture');
  }
}

const violations = [];
const { manifestPaths, publicPackages } = await discoverPublicWorkspacePackages();
checkSyntheticClassifier(publicPackages);

for (const relativePath of manifestPaths) {
  const manifest = await readJson(relativePath);
  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (!dependencies || typeof dependencies !== 'object') {
      continue;
    }
    for (const dependencyName of Object.keys(dependencies)) {
      if (
        dependencyName.startsWith(enterpriseScope) &&
        !publicPackages.has(dependencyName)
      ) {
        violations.push(
          `${relativePath}: ${section} contains non-public EnterpriseGlue package ${dependencyName}`,
        );
      }
    }
  }
}

const lockfilePath = path.join(root, 'pnpm-lock.yaml');
if (await exists(lockfilePath)) {
  const lockfile = await readFile(lockfilePath, 'utf8');
  for (const specifier of collectEnterpriseSpecifiers(lockfile)) {
    const base = packageBase(specifier);
    if (base && !publicPackages.has(base)) {
      violations.push(`pnpm-lock.yaml: resolves non-public EnterpriseGlue package ${base}`);
    }
  }
}

for (const sourceRoot of sourceRoots) {
  for (const relativePath of await listFiles(sourceRoot)) {
    if (!sourceExtensions.has(path.extname(relativePath))) {
      continue;
    }
    if (boundaryPolicyImplementations.has(relativePath)) {
      continue;
    }
    const source = await readFile(path.join(root, relativePath), 'utf8');
    const marker = isTestOrFixture(relativePath)
      ? undefined
      : privateProductMarker(source);
    if (marker) {
      violations.push(
        `${relativePath}: contains private product marker ${marker.source}`,
      );
    }
    for (const specifier of collectEnterpriseSpecifiers(source)) {
      if (!importIsAllowed(specifier, relativePath, publicPackages)) {
        violations.push(
          `${relativePath}: directly references non-public EnterpriseGlue package ${specifier}`,
        );
      }
    }
  }
}

for (const relativePath of productionDockerfiles) {
  const dockerfile = await readFile(path.join(root, relativePath), 'utf8');
  if (!dockerfile.includes('pnpm install --frozen-lockfile')) {
    violations.push(`${relativePath}: production dependency install is not lockfile-frozen`);
  }
  for (const line of dockerfile.split('\n')) {
    const trimmed = line.trim();
    if (/^(ADD|COPY)\s/i.test(trimmed) && /(^|\s)\.\.(\/|\s|$)/.test(trimmed)) {
      violations.push(`${relativePath}: build input escapes the public repository context: ${trimmed}`);
    }
  }
  for (const specifier of collectEnterpriseSpecifiers(dockerfile)) {
    const base = packageBase(specifier);
    if (base && !publicPackages.has(base)) {
      violations.push(`${relativePath}: references non-public EnterpriseGlue package ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(
    [
      '❌ [paid-plugin-boundary] Public OSS must not depend on or import private paid plugins.',
      ...violations.map((violation) => `- ${violation}`),
      '',
    ].join('\n'),
  );
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    event: 'paid_plugin_boundary',
    status: 'passed',
    publicWorkspacePackages: [...publicPackages].sort().length,
    privateDependencies: 0,
    privateSourceReferences: 0,
    privateProductMarkers: 0,
    productionDockerfiles: productionDockerfiles.length,
    dependencyClosure: 'public-workspace-only',
  })}\n`,
);
