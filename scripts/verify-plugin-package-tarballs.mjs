#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyPackageEntryPoints } from './package-tarball-contract.mjs';

const expected = new Map(
  [
    ['@enterpriseglue/enterprise-plugin-api', '../packages/enterprise-plugin-api/package.json'],
    ['@enterpriseglue/plugin-sdk', '../packages/plugin-sdk/package.json'],
    ['@enterpriseglue/plugin-runtime', '../packages/plugin-runtime/package.json'],
    ['@enterpriseglue/plugin-installer', '../packages/plugin-installer/package.json'],
    ['@enterpriseglue/plugin-manager', '../packages/plugin-manager/package.json'],
  ].map(([name, manifestPath]) => {
    const manifest = JSON.parse(readFileSync(new URL(manifestPath, import.meta.url), 'utf8'));
    if (manifest.name !== name) {
      throw new Error(`Expected source package ${name}, found ${manifest.name}.`);
    }
    return [name, manifest.version];
  }),
);

const forbiddenReference = /^(?:workspace:|link:|file:|\/|\.\.?[\\/]|[A-Za-z]:\\)/;

function fail(message) {
  throw new Error(message);
}

export function verifyPluginPackageTarballs(directory) {
  const absoluteDirectory = resolve(directory);
  const tarballs = readdirSync(absoluteDirectory)
    .filter((file) => file.endsWith('.tgz'))
    .sort();
  if (tarballs.length !== expected.size) {
    fail(`Expected ${expected.size} plugin package tarballs, found ${tarballs.length}.`);
  }

  const receipt = [];
  const seen = new Set();
  for (const filename of tarballs) {
    const tarball = resolve(absoluteDirectory, filename);
    const manifest = JSON.parse(
      execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
        encoding: 'utf8',
      }),
    );
    const expectedVersion = expected.get(manifest.name);
    if (!expectedVersion) fail(`Unexpected package in ${filename}: ${manifest.name}`);
    if (manifest.version !== expectedVersion) {
      fail(`${manifest.name} must be ${expectedVersion}, found ${manifest.version}.`);
    }
    if (manifest.private === true) fail(`${manifest.name} is marked private.`);
    if (!manifest.exports && !manifest.bin) {
      fail(`${manifest.name} has neither exports nor a CLI binary.`);
    }
    verifyPackageEntryPoints({ manifest, tarball });
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      for (const [dependency, reference] of Object.entries(manifest[field] ?? {})) {
        if (forbiddenReference.test(String(reference))) {
          fail(`${manifest.name} has forbidden ${field}.${dependency}=${reference}.`);
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
  for (const name of expected.keys()) {
    if (!seen.has(name)) fail(`Missing package tarball for ${name}.`);
  }
  return receipt.sort((left, right) => left.name.localeCompare(right.name));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) try {
  const directory = process.argv[2];
  if (!directory) fail('Usage: node scripts/verify-plugin-package-tarballs.mjs <directory>');
  console.log(JSON.stringify({ packages: verifyPluginPackageTarballs(directory) }, null, 2));
} catch (error) {
  console.error(`[plugin-package-tarballs] ${error.message}`);
  process.exitCode = 1;
}
