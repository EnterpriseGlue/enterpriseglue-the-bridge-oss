#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const root = await realpath(resolve(process.argv[2] || '.'));
const manifestPath = resolve(root, 'deployment-kit.manifest.json');
const readOnlyNoFollow = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

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

async function readRegularFile(path, label) {
  const resolved = await realpath(path);
  const relation = relative(root, resolved);
  if (relation === '..' || relation.startsWith(`..${sep}`)) {
    fail(`${label} resolves outside the kit`);
  }
  let handle;
  try {
    handle = await open(path, readOnlyNoFollow);
  } catch (error) {
    if (error?.code === 'ELOOP') fail(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const details = await handle.stat();
    if (!details.isFile()) fail(`${label} is not a regular file`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

const manifest = JSON.parse(
  (await readRegularFile(manifestPath, 'manifest')).toString('utf8'),
);
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
  const digest = createHash('sha256')
    .update(await readRegularFile(path, component.path))
    .digest('hex');
  if (digest !== component.sha256) {
    fail(`${component.path} digest differs`);
  }
}

process.stdout.write(`deployment_kit_verified:${manifest.components.length}\n`);
