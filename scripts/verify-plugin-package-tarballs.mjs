#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const expected = new Map([
  ['@enterpriseglue/plugin-sdk', '0.3.0'],
  ['@enterpriseglue/plugin-runtime', '0.1.1'],
  ['@enterpriseglue/plugin-installer', '0.2.0'],
  ['@enterpriseglue/plugin-manager', '0.1.0'],
]);

const forbiddenReference = /^(?:workspace:|link:|file:|\/|[A-Za-z]:\\)/;

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

try {
  const directory = process.argv[2];
  if (!directory) fail('Usage: node scripts/verify-plugin-package-tarballs.mjs <directory>');
  console.log(JSON.stringify({ packages: verifyPluginPackageTarballs(directory) }, null, 2));
} catch (error) {
  console.error(`[plugin-package-tarballs] ${error.message}`);
  process.exitCode = 1;
}
