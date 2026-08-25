#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || '.');
const manifestPath = resolve(root, 'deployment-kit.manifest.json');

function fail(message) {
  throw new Error(`deployment_kit_verification_failed: ${message}`);
}

function containedPath(input) {
  if (isAbsolute(input) || input.includes('\0')) fail('component path is unsafe');
  const normalized = resolve(root, input);
  const relation = relative(root, normalized);
  if (relation === '..' || relation.startsWith(`..${sep}`)) {
    fail('component path escapes the kit');
  }
  return normalized;
}

const manifestDetails = await lstat(manifestPath);
if (!manifestDetails.isFile() || manifestDetails.isSymbolicLink()) {
  fail('manifest is not a regular file');
}
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (
  manifest.apiVersion !== 'plugin-deployment-kit.enterpriseglue.io/v1' ||
  manifest.kind !== 'EnterpriseGluePluginComposeDeploymentKit' ||
  !Array.isArray(manifest.components) ||
  manifest.components.length === 0
) {
  fail('manifest contract is unsupported');
}

const seen = new Set();
for (const component of manifest.components) {
  if (
    !component ||
    typeof component.path !== 'string' ||
    !/^[a-f0-9]{64}$/.test(component.sha256) ||
    seen.has(component.path)
  ) {
    fail('component record is invalid or duplicated');
  }
  seen.add(component.path);
  const path = containedPath(component.path);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    fail(`${component.path} is not a regular file`);
  }
  const resolved = await realpath(path);
  const relation = relative(await realpath(root), resolved);
  if (relation === '..' || relation.startsWith(`..${sep}`)) {
    fail(`${component.path} resolves outside the kit`);
  }
  const digest = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  if (digest !== component.sha256) {
    fail(`${component.path} digest differs`);
  }
}

process.stdout.write(`deployment_kit_verified:${manifest.components.length}\n`);
