#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const schemaVersion = 'enterpriseglue-distribution-lock/v1';
const digestReference = /^[a-z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9._/-]+@sha256:[a-f0-9]{64}$/;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const revision = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const readOnlyNoFollow = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

function fail(message) {
  throw new Error(message);
}

function argumentsFor(argv) {
  const [command, ...rest] = argv;
  if (!['create', 'verify'].includes(command)) {
    fail('Usage: enterpriseglue-distribution-lock.mjs create|verify [options]');
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
      fail(`Invalid argument ${flag ?? ''}`.trim());
    }
    const name = flag.slice(2);
    if (values.has(name)) fail(`Duplicate argument --${name}`);
    values.set(name, value);
  }
  return { command, values };
}

function required(values, name) {
  const value = values.get(name);
  if (!value) fail(`--${name} is required`);
  return value;
}

async function readRegularFile(input, label) {
  const path = resolve(input);
  let handle;
  try {
    handle = await open(path, readOnlyNoFollow);
  } catch (error) {
    if (error?.code === 'ELOOP') fail(`${label} must not be a symbolic link`);
    throw error;
  }
  try {
    const details = await handle.stat();
    if (!details.isFile()) fail(`${label} must be a regular non-symlink file`);
    const bytes = await handle.readFile();
    return { path, bytes, sizeBytes: bytes.byteLength };
  } finally {
    await handle.close();
  }
}

async function fileRecord(input, label) {
  const { path, bytes, sizeBytes } = await readRegularFile(input, label);
  return {
    path: basename(path),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes,
  };
}

function assertDigestReference(value, label) {
  if (!digestReference.test(value)) {
    fail(`${label} must be an immutable OCI SHA-256 reference`);
  }
  return value;
}

function assertToolchain(value, expectedRevision) {
  if (
    !value ||
    value.schemaVersion !== 'enterpriseglue-plugin-toolchain-release/v1' ||
    value.sourceRevision !== expectedRevision ||
    value.customerCiRequired !== false ||
    value.customerBuildRequired !== false
  ) {
    fail('Toolchain receipt is incompatible with this distribution');
  }
  for (const [label, subject] of [
    ['installer', value.installer],
    ['manager', value.manager],
    ['runtimeChart', value.runtimeChart?.subject],
    ['installerRbacChart', value.installerRbacChart?.subject],
    ['managerChart', value.managerChart?.subject],
  ]) {
    assertDigestReference(subject, `Toolchain ${label}`);
  }
  return value;
}

function assertFileRecord(value, label) {
  if (
    !value ||
    typeof value.path !== 'string' ||
    basename(value.path) !== value.path ||
    !sha256.test(value.sha256) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes <= 0
  ) {
    fail(`${label} is invalid`);
  }
}

function validateLock(value) {
  if (!value || value.schemaVersion !== schemaVersion) {
    fail('Distribution lock schemaVersion is unsupported');
  }
  if (!semver.test(value.version) || !revision.test(value.sourceRevision)) {
    fail('Distribution release identity is invalid');
  }
  if (!Number.isFinite(new Date(value.generatedAt).getTime())) {
    fail('Distribution generatedAt is invalid');
  }
  assertDigestReference(value.application?.backend?.subject, 'Backend image');
  assertDigestReference(value.application?.frontend?.subject, 'Frontend image');
  for (const component of [value.application.backend, value.application.frontend]) {
    if (
      JSON.stringify(component.platforms) !==
      JSON.stringify(['linux/amd64', 'linux/arm64'])
    ) {
      fail('Application images must support linux/amd64 and linux/arm64');
    }
  }
  assertToolchain(value.pluginToolchain, value.sourceRevision);
  assertFileRecord(value.frontendStatic, 'Frontend static archive');
  assertFileRecord(value.deploymentKit, 'Deployment kit archive');
  if (
    value.customerCiRequired !== false ||
    value.customerBuildRequired !== false ||
    JSON.stringify(value.supportedTopologies) !==
      JSON.stringify(['compose-backend-cdn-frontend'])
  ) {
    fail('Distribution customer-deployment contract is invalid');
  }
  return value;
}

async function create(values) {
  const version = required(values, 'version').replace(/^v/, '');
  const sourceRevision = required(values, 'source-revision');
  if (!semver.test(version) || !revision.test(sourceRevision)) {
    fail('Version or source revision is invalid');
  }
  const toolchainFile = await readRegularFile(
    required(values, 'toolchain-release'),
    'Toolchain receipt',
  );
  const pluginToolchain = assertToolchain(
    JSON.parse(toolchainFile.bytes.toString('utf8')),
    sourceRevision,
  );
  const generatedAt = new Date(
    process.env.EG_DISTRIBUTION_GENERATED_AT || new Date().toISOString(),
  );
  if (!Number.isFinite(generatedAt.getTime())) fail('Generated time is invalid');
  const lock = validateLock({
    schemaVersion,
    version,
    sourceRevision,
    generatedAt: generatedAt.toISOString(),
    application: {
      backend: {
        subject: assertDigestReference(required(values, 'backend'), 'Backend image'),
        platforms: ['linux/amd64', 'linux/arm64'],
      },
      frontend: {
        subject: assertDigestReference(required(values, 'frontend'), 'Frontend image'),
        platforms: ['linux/amd64', 'linux/arm64'],
      },
    },
    pluginToolchain,
    frontendStatic: await fileRecord(
      required(values, 'frontend-static'),
      'Frontend static archive',
    ),
    deploymentKit: await fileRecord(
      required(values, 'deployment-kit'),
      'Deployment kit archive',
    ),
    supportedTopologies: ['compose-backend-cdn-frontend'],
    previewTopologies: [
      'kubernetes-shared-plugin-assets',
      'openshift-shared-plugin-assets',
      'complete-air-gap-distribution',
    ],
    customerCiRequired: false,
    customerBuildRequired: false,
  });
  const output = resolve(required(values, 'output'));
  await writeFile(output, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o444 });
  process.stdout.write(`${JSON.stringify({ status: 'created', output, schemaVersion })}\n`);
}

async function verify(values) {
  const lockFile = await readRegularFile(required(values, 'lock'), 'Distribution lock');
  const root = resolve(required(values, 'root'));
  const lock = validateLock(JSON.parse(lockFile.bytes.toString('utf8')));
  for (const [label, record] of [
    ['Frontend static archive', lock.frontendStatic],
    ['Deployment kit archive', lock.deploymentKit],
  ]) {
    const file = await readRegularFile(resolve(root, record.path), label);
    const bytes = file.bytes;
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (file.sizeBytes !== record.sizeBytes || digest !== record.sha256) {
      fail(`${label} differs from the signed distribution lock`);
    }
  }
  process.stdout.write(`${JSON.stringify({ status: 'verified', schemaVersion })}\n`);
}

const { command, values } = argumentsFor(process.argv.slice(2));
await (command === 'create' ? create(values) : verify(values));
