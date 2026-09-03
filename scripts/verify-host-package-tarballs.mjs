#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyPackageEntryPoints } from './package-tarball-contract.mjs';

const EXPECTED_PACKAGES = new Map(
  [
    ['@enterpriseglue/shared', '../packages/shared/package.json'],
    ['@enterpriseglue/backend-host', '../packages/backend-host/package.json'],
    ['@enterpriseglue/frontend-host', '../packages/frontend-host/package.json'],
  ].map(([name, manifestPath]) => {
    const manifest = JSON.parse(readFileSync(new URL(manifestPath, import.meta.url), 'utf8'));
    if (manifest.name !== name) throw new Error(`Expected source package ${name}, found ${manifest.name}.`);
    return [name, manifest.version];
  }),
);

const FORBIDDEN_REFERENCE = /^(?:workspace:|link:|file:|\/|\.\.?[\\/]|[A-Za-z]:\\)/;

export function verifyHostPackageTarballs(directory) {
  const absoluteDirectory = resolve(directory);
  const tarballs = readdirSync(absoluteDirectory).filter((file) => file.endsWith('.tgz')).sort();
  if (tarballs.length !== EXPECTED_PACKAGES.size) {
    throw new Error(`Expected ${EXPECTED_PACKAGES.size} host package tarballs, found ${tarballs.length}.`);
  }

  const receipt = [];
  const seen = new Set();
  for (const filename of tarballs) {
    const tarball = resolve(absoluteDirectory, filename);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
    const expectedVersion = EXPECTED_PACKAGES.get(manifest.name);
    if (!expectedVersion) throw new Error(`Unexpected host package in ${filename}: ${manifest.name}`);
    if (manifest.version !== expectedVersion) {
      throw new Error(`${manifest.name} must be ${expectedVersion}, found ${manifest.version}.`);
    }
    if (manifest.private === true) throw new Error(`${manifest.name} is marked private.`);
    verifyPackageEntryPoints({ manifest, tarball });
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
      for (const [dependency, reference] of Object.entries(manifest[field] ?? {})) {
        if (FORBIDDEN_REFERENCE.test(String(reference))) {
          throw new Error(`${manifest.name} has forbidden ${field}.${dependency}=${reference}.`);
        }
      }
    }
    seen.add(manifest.name);
    const bytes = readFileSync(tarball);
    receipt.push({
      name: manifest.name,
      version: manifest.version,
      filename: basename(tarball),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  for (const name of EXPECTED_PACKAGES.keys()) {
    if (!seen.has(name)) throw new Error(`Missing package tarball for ${name}.`);
  }
  return receipt.sort((left, right) => left.name.localeCompare(right.name));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const directory = process.argv[2];
    if (!directory) throw new Error('Usage: node scripts/verify-host-package-tarballs.mjs <directory>');
    console.log(JSON.stringify({ packages: verifyHostPackageTarballs(directory) }, null, 2));
  } catch (error) {
    console.error(`[host-package-tarballs] ${error.message}`);
    process.exitCode = 1;
  }
}
