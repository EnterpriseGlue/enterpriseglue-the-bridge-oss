#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dependencyFields = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
];

export function findChangedWorkspaceDependencies({
  manifest,
  currentVersions,
  baseVersions,
}) {
  const dependencies = new Set();
  for (const field of dependencyFields) {
    for (const [name, reference] of Object.entries(manifest[field] ?? {})) {
      if (String(reference).startsWith('workspace:')) dependencies.add(name);
    }
  }

  return [...dependencies]
    .sort()
    .flatMap((name) => {
      const currentVersion = currentVersions.get(name);
      const baseVersion = baseVersions.get(name);
      if (!currentVersion || currentVersion === baseVersion) return [];
      return [{ name, baseVersion: baseVersion ?? null, currentVersion }];
    });
}

function currentPackageManifests() {
  return readdirSync('packages', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`)
    .filter((path) => {
      try {
        readFileSync(path);
        return true;
      } catch {
        return false;
      }
    });
}

function readGitJson(baseRef, path) {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `${baseRef}:${path}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    return null;
  }
}

function packageVersions(paths, readManifest) {
  return new Map(
    paths.flatMap((path) => {
      const manifest = readManifest(path);
      return manifest?.name && manifest?.version
        ? [[manifest.name, String(manifest.version)]]
        : [];
    }),
  );
}

function main() {
  const [baseRef, manifestPath] = process.argv.slice(2);
  if (!baseRef || !manifestPath) {
    throw new Error(
      'Usage: node scripts/check-workspace-dependency-version-drift.mjs <base-ref> <package-manifest>',
    );
  }

  const paths = currentPackageManifests();
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
  const currentVersions = packageVersions(paths, (path) =>
    JSON.parse(readFileSync(path, 'utf8')),
  );
  const baseVersions = packageVersions(paths, (path) => readGitJson(baseRef, path));
  const changes = findChangedWorkspaceDependencies({
    manifest,
    currentVersions,
    baseVersions,
  });

  for (const change of changes) {
    process.stdout.write(
      `${change.name}:${change.baseVersion ?? 'unpublished'}->${change.currentVersion}\n`,
    );
  }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
