#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const semverPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;
const sourceRevisionPattern = /^[a-f0-9]{40}$/;
const targetPrefixPattern =
  /^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+$/;
const chartLayerMediaType =
  'application/vnd.cncf.helm.chart.content.v1.tar+gzip';
const manifestName = 'toolchain-airgap.json';
const signatureName = 'toolchain-airgap.sigstore.json';
const releaseName = 'release.json';
const utilityName = 'toolchain-airgap.mjs';
const schemaVersion = 'enterpriseglue-plugin-toolchain-airgap/v1';
const roles = [
  'installer',
  'manager',
  'runtimeChart',
  'installerRbacChart',
  'managerChart',
];
const roleRepositories = {
  installer: 'plugin-installer',
  manager: 'plugin-manager',
  runtimeChart: 'charts/enterpriseglue-plugin-runtime',
  installerRbacChart: 'charts/enterpriseglue-plugin-installer-rbac',
  managerChart: 'charts/enterpriseglue-plugin-manager',
};
const imageRoles = new Set(['installer', 'manager']);

function fail(message) {
  throw new Error(message);
}

function usage() {
  return [
    'Usage:',
    '  plugin-toolchain-airgap.mjs export --release FILE --output DIR',
    '    [--source-registry-config FILE] [--source-ca FILE]',
    '    [--source-plain-http | --source-insecure]',
    '  plugin-toolchain-airgap.mjs import --bundle DIR --target-prefix REGISTRY/PATH',
    '    (--key FILE --insecure-ignore-tlog |',
    '     --certificate-identity URI --certificate-oidc-issuer URI --trusted-root FILE)',
    '    [--target-registry-config FILE] [--target-ca FILE]',
    '    [--target-plain-http | --target-insecure] [--receipt FILE]',
  ].join('\n');
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command !== 'export' && command !== 'import') {
    fail(usage());
  }
  const booleanFlags = new Set([
    'source-plain-http',
    'source-insecure',
    'target-plain-http',
    'target-insecure',
    'insecure-ignore-tlog',
  ]);
  const values = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--') || token.length < 3) {
      fail(`Unexpected argument ${token}\n${usage()}`);
    }
    const name = token.slice(2);
    if (values.has(name)) fail(`Duplicate argument --${name}`);
    if (booleanFlags.has(name)) {
      values.set(name, true);
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Argument --${name} requires a value`);
    }
    values.set(name, value);
    index += 1;
  }
  const allowed =
    command === 'export'
      ? new Set([
          'release',
          'output',
          'source-registry-config',
          'source-ca',
          'source-plain-http',
          'source-insecure',
        ])
      : new Set([
          'bundle',
          'target-prefix',
          'key',
          'insecure-ignore-tlog',
          'certificate-identity',
          'certificate-oidc-issuer',
          'trusted-root',
          'target-registry-config',
          'target-ca',
          'target-plain-http',
          'target-insecure',
          'receipt',
        ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) {
      fail(`Argument --${name} is not valid for ${command}`);
    }
  }
  return { command, values };
}

function required(values, name) {
  const value = values.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    fail(`--${name} is required`);
  }
  return value;
}

function assertExactKeys(value, requiredKeys, optionalKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const actual = Object.keys(value);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) fail(`${label} omits ${key}`);
  }
  for (const key of actual) {
    if (!allowed.has(key)) fail(`${label} contains unknown field ${key}`);
  }
}

function parseDigestReference(value, label) {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const separator = value.lastIndexOf('@');
  const repository = value.slice(0, separator);
  const digest = value.slice(separator + 1);
  if (
    separator < 1 ||
    repository.includes('://') ||
    repository.includes('@') ||
    !digestPattern.test(digest)
  ) {
    fail(`${label} must use one immutable SHA-256 OCI reference`);
  }
  return { reference: value, repository, digest };
}

function parseChart(value, label) {
  assertExactKeys(value, ['subject', 'archiveSha256'], [], label);
  const subject = parseDigestReference(value.subject, `${label}.subject`);
  if (
    typeof value.archiveSha256 !== 'string' ||
    !sha256Pattern.test(value.archiveSha256)
  ) {
    fail(`${label}.archiveSha256 must be a SHA-256`);
  }
  return { ...subject, payloadSha256: value.archiveSha256 };
}

function parseRelease(value) {
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'version',
      'sourceRevision',
      'installer',
      'managerVersion',
      'manager',
      'runtimeChart',
      'installerRbacChart',
      'managerChart',
      'customerCiRequired',
      'customerBuildRequired',
    ],
    ['workflowRun'],
    'Release receipt',
  );
  if (value.schemaVersion !== 'enterpriseglue-plugin-toolchain-release/v1') {
    fail('Release receipt schemaVersion is unsupported');
  }
  if (typeof value.version !== 'string' || !semverPattern.test(value.version)) {
    fail('Release receipt version must be SemVer');
  }
  if (
    typeof value.sourceRevision !== 'string' ||
    !sourceRevisionPattern.test(value.sourceRevision)
  ) {
    fail('Release receipt sourceRevision must be an exact Git commit');
  }
  if (
    value.customerCiRequired !== false ||
    value.customerBuildRequired !== false
  ) {
    fail('Release receipt must preserve the no-customer-CI contract');
  }
  if (
    typeof value.managerVersion !== 'string' ||
    !semverPattern.test(value.managerVersion)
  ) {
    fail('Release receipt managerVersion must be SemVer');
  }
  if (
    value.workflowRun !== undefined &&
    (typeof value.workflowRun !== 'string' ||
      !value.workflowRun.startsWith('https://github.com/EnterpriseGlue/'))
  ) {
    fail('Release receipt workflowRun is invalid');
  }
  return {
    version: value.version,
    sourceRevision: value.sourceRevision,
    installer: {
      ...parseDigestReference(value.installer, 'Release receipt installer'),
      payloadSha256: undefined,
    },
    manager: {
      ...parseDigestReference(value.manager, 'Release receipt manager'),
      payloadSha256: undefined,
    },
    runtimeChart: parseChart(value.runtimeChart, 'Release receipt runtimeChart'),
    installerRbacChart: parseChart(
      value.installerRbacChart,
      'Release receipt installerRbacChart',
    ),
    managerChart: parseChart(value.managerChart, 'Release receipt managerChart'),
  };
}

async function regularFile(pathInput, label) {
  const path = resolve(pathInput);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    fail(`${label} must be a regular non-symlink file`);
  }
  return realpath(path);
}

async function regularDirectory(pathInput, label) {
  const path = resolve(pathInput);
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    fail(`${label} must be a regular non-symlink directory`);
  }
  return realpath(path);
}

async function optionalRegularFile(values, name, label) {
  const value = values.get(name);
  return typeof value === 'string' ? regularFile(value, label) : undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      COPYFILE_DISABLE: '1',
      ...(options.env ?? {}),
    },
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 30 * 60_000,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim().slice(-2_000);
    fail(
      `${command} failed with ${result.status ?? result.signal ?? 'unknown'}${
        detail ? `: ${detail}` : ''
      }`,
    );
  }
  return result.stdout;
}

function parseDescriptor(output, label) {
  let descriptor;
  try {
    descriptor = JSON.parse(output);
  } catch {
    fail(`${label} descriptor was not JSON`);
  }
  if (
    !descriptor ||
    typeof descriptor !== 'object' ||
    Array.isArray(descriptor) ||
    typeof descriptor.digest !== 'string' ||
    !digestPattern.test(descriptor.digest)
  ) {
    fail(`${label} descriptor omitted a SHA-256 digest`);
  }
  return descriptor.digest;
}

async function digestFile(path) {
  const bytes = await readFile(path);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o444,
  });
}

function registryArguments(values, direction) {
  const plain = values.has(`${direction}-plain-http`);
  const insecure = values.has(`${direction}-insecure`);
  if (plain && insecure) {
    fail(`${direction} plain HTTP and insecure TLS are mutually exclusive`);
  }
  return { plain, insecure };
}

async function exportBundle(values) {
  const releasePath = await regularFile(
    required(values, 'release'),
    'Release receipt',
  );
  const releaseBytes = await readFile(releasePath);
  const release = parseRelease(JSON.parse(releaseBytes.toString('utf8')));
  const output = resolve(required(values, 'output'));
  const sourceMode = registryArguments(values, 'source');
  const registryConfig = await optionalRegularFile(
    values,
    'source-registry-config',
    'Source registry configuration',
  );
  const registryCa = await optionalRegularFile(
    values,
    'source-ca',
    'Source registry CA',
  );
  const sourceArgs = [
    ...(registryConfig ? ['--from-registry-config', registryConfig] : []),
    ...(registryCa ? ['--from-ca-file', registryCa] : []),
    ...(sourceMode.plain ? ['--from-plain-http'] : []),
    ...(sourceMode.insecure ? ['--from-insecure'] : []),
  ];

  await rm(output, { recursive: true, force: true });
  await mkdir(resolve(output, 'artifacts'), { recursive: true, mode: 0o700 });
  await copyFile(releasePath, resolve(output, releaseName));
  const releaseDigest = await digestFile(resolve(output, releaseName));
  const utilitySource = await regularFile(
    fileURLToPath(import.meta.url),
    'Toolchain air-gap utility',
  );
  await copyFile(utilitySource, resolve(output, utilityName));
  const utilityDigest = await digestFile(resolve(output, utilityName));
  const artifacts = [];

  for (const role of roles) {
    const subject = release[role];
    const layout = resolve(output, `.layout-${role}`);
    const archivePath = `artifacts/${role}.oci.tar`;
    const archive = resolve(output, archivePath);
    const importTag = `eg-toolchain-${subject.digest.replace(':', '-')}`;
    await mkdir(layout, { recursive: true, mode: 0o700 });
    run('oras', [
      'cp',
      '--recursive',
      '--to-oci-layout',
      '--no-tty',
      ...sourceArgs,
      subject.reference,
      `${layout}:${importTag}`,
    ]);
    const layoutDigest = parseDescriptor(
      run('oras', [
        'manifest',
        'fetch',
        '--oci-layout',
        '--descriptor',
        `${layout}@${subject.digest}`,
      ]),
      `${role} OCI layout`,
    );
    if (layoutDigest !== subject.digest) {
      fail(`${role} OCI layout changed the release digest`);
    }
    run('tar', ['-cf', archive, '-C', layout, '.']);
    await rm(layout, { recursive: true, force: true });
    const archiveDigest = parseDescriptor(
      run('oras', [
        'manifest',
        'fetch',
        '--oci-layout',
        '--descriptor',
        `${archive}@${subject.digest}`,
      ]),
      `${role} OCI archive`,
    );
    if (archiveDigest !== subject.digest) {
      fail(`${role} OCI archive changed the release digest`);
    }
    const fileDigest = await digestFile(archive);
    artifacts.push({
      role,
      source: subject.reference,
      subjectDigest: subject.digest,
      archivePath,
      archiveSha256: fileDigest.sha256,
      archiveSizeBytes: fileDigest.sizeBytes,
      ...(subject.payloadSha256
        ? { payloadSha256: subject.payloadSha256 }
        : {}),
    });
  }

  const generatedAtInput =
    process.env.EG_PLUGIN_TOOLCHAIN_AIRGAP_GENERATED_AT?.trim() ||
    new Date().toISOString();
  const generatedAt = new Date(generatedAtInput);
  if (!Number.isFinite(generatedAt.getTime())) {
    fail('EG_PLUGIN_TOOLCHAIN_AIRGAP_GENERATED_AT is invalid');
  }
  const manifest = {
    schemaVersion,
    version: release.version,
    sourceRevision: release.sourceRevision,
    generatedAt: generatedAt.toISOString(),
    release: {
      path: releaseName,
      sha256: releaseDigest.sha256,
      sizeBytes: releaseDigest.sizeBytes,
    },
    utility: {
      path: utilityName,
      sha256: utilityDigest.sha256,
      sizeBytes: utilityDigest.sizeBytes,
    },
    artifacts,
    customerCiRequired: false,
    customerBuildRequired: false,
  };
  await writeJson(resolve(output, manifestName), manifest);
  process.stdout.write(
    `${JSON.stringify({
      status: 'exported',
      schemaVersion,
      output,
      version: release.version,
      artifactCount: artifacts.length,
      manifest: resolve(output, manifestName),
      signature: resolve(output, signatureName),
    })}\n`,
  );
}

function parsePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive safe integer`);
  }
  return value;
}

function parseAirgapManifest(value) {
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'version',
      'sourceRevision',
      'generatedAt',
      'release',
      'utility',
      'artifacts',
      'customerCiRequired',
      'customerBuildRequired',
    ],
    [],
    'Air-gap manifest',
  );
  if (value.schemaVersion !== schemaVersion) {
    fail('Air-gap manifest schemaVersion is unsupported');
  }
  if (typeof value.version !== 'string' || !semverPattern.test(value.version)) {
    fail('Air-gap manifest version must be SemVer');
  }
  if (
    typeof value.sourceRevision !== 'string' ||
    !sourceRevisionPattern.test(value.sourceRevision)
  ) {
    fail('Air-gap manifest sourceRevision must be an exact Git commit');
  }
  if (
    typeof value.generatedAt !== 'string' ||
    !Number.isFinite(new Date(value.generatedAt).getTime())
  ) {
    fail('Air-gap manifest generatedAt is invalid');
  }
  if (
    value.customerCiRequired !== false ||
    value.customerBuildRequired !== false
  ) {
    fail('Air-gap manifest must preserve the no-customer-CI contract');
  }
  assertExactKeys(
    value.release,
    ['path', 'sha256', 'sizeBytes'],
    [],
    'Air-gap manifest release',
  );
  if (
    value.release.path !== releaseName ||
    typeof value.release.sha256 !== 'string' ||
    !sha256Pattern.test(value.release.sha256)
  ) {
    fail('Air-gap manifest release reference is invalid');
  }
  parsePositiveInteger(
    value.release.sizeBytes,
    'Air-gap manifest release.sizeBytes',
  );
  assertExactKeys(
    value.utility,
    ['path', 'sha256', 'sizeBytes'],
    [],
    'Air-gap manifest utility',
  );
  if (
    value.utility.path !== utilityName ||
    typeof value.utility.sha256 !== 'string' ||
    !sha256Pattern.test(value.utility.sha256)
  ) {
    fail('Air-gap manifest utility reference is invalid');
  }
  parsePositiveInteger(
    value.utility.sizeBytes,
    'Air-gap manifest utility.sizeBytes',
  );
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== roles.length) {
    fail(`Air-gap manifest must contain exactly ${roles.length} artifacts`);
  }
  const foundRoles = new Set();
  const artifacts = value.artifacts.map((artifact, index) => {
    assertExactKeys(
      artifact,
      [
        'role',
        'source',
        'subjectDigest',
        'archivePath',
        'archiveSha256',
        'archiveSizeBytes',
      ],
      ['payloadSha256'],
      `Air-gap artifact ${index}`,
    );
    if (!roles.includes(artifact.role) || foundRoles.has(artifact.role)) {
      fail(`Air-gap artifact ${index} role is invalid or duplicated`);
    }
    foundRoles.add(artifact.role);
    const source = parseDigestReference(
      artifact.source,
      `Air-gap artifact ${index} source`,
    );
    if (
      artifact.subjectDigest !== source.digest ||
      artifact.archivePath !== `artifacts/${artifact.role}.oci.tar` ||
      typeof artifact.archiveSha256 !== 'string' ||
      !sha256Pattern.test(artifact.archiveSha256)
    ) {
      fail(`Air-gap artifact ${index} identity is invalid`);
    }
    parsePositiveInteger(
      artifact.archiveSizeBytes,
      `Air-gap artifact ${index} archiveSizeBytes`,
    );
    if (imageRoles.has(artifact.role)) {
      if (artifact.payloadSha256 !== undefined) {
        fail('Installer air-gap artifact must not declare a chart payload');
      }
    } else if (
      typeof artifact.payloadSha256 !== 'string' ||
      !sha256Pattern.test(artifact.payloadSha256)
    ) {
      fail(`Air-gap artifact ${index} chart payload hash is invalid`);
    }
    return { ...artifact, ...source };
  });
  return {
    version: value.version,
    sourceRevision: value.sourceRevision,
    release: value.release,
    utility: value.utility,
    artifacts,
  };
}

async function inventoryFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink()) fail('Air-gap bundle contains a symlink');
      if (details.isDirectory()) {
        if (relative(root, path) !== 'artifacts') {
          fail('Air-gap bundle contains an unexpected directory');
        }
        await visit(path);
      } else if (details.isFile()) {
        files.push(relative(root, path));
      } else {
        fail('Air-gap bundle contains an unsupported filesystem entry');
      }
    }
  }
  await visit(root);
  return files.sort();
}

function verificationArguments(values) {
  const key = values.get('key');
  const identity = values.get('certificate-identity');
  const issuer = values.get('certificate-oidc-issuer');
  const trustedRoot = values.get('trusted-root');
  const insecureIgnoreTlog = values.has('insecure-ignore-tlog');
  const keyMode = typeof key === 'string';
  const keylessMode =
    typeof identity === 'string' ||
    typeof issuer === 'string' ||
    typeof trustedRoot === 'string';
  if (keyMode === keylessMode) {
    fail('Choose exactly one key or keyless certificate verification mode');
  }
  if (keyMode) {
    if (!insecureIgnoreTlog) {
      fail('Local-key verification requires explicit --insecure-ignore-tlog');
    }
    return {
      mode: 'key',
      blob: ['--key', key, '--insecure-ignore-tlog'],
      subject: ['--key', key, '--insecure-ignore-tlog'],
      files: [{ path: key, label: 'Cosign public key' }],
    };
  }
  if (
    typeof identity !== 'string' ||
    typeof issuer !== 'string' ||
    typeof trustedRoot !== 'string' ||
    insecureIgnoreTlog
  ) {
    fail(
      'Keyless verification requires identity, issuer, and an independently approved trusted root',
    );
  }
  return {
    mode: 'keyless',
    blob: [
      '--certificate-identity',
      identity,
      '--certificate-oidc-issuer',
      issuer,
      '--trusted-root',
      trustedRoot,
    ],
    subject: [
      '--certificate-identity',
      identity,
      '--certificate-oidc-issuer',
      issuer,
      '--trusted-root',
      trustedRoot,
    ],
    files: [{ path: trustedRoot, label: 'Sigstore trusted root' }],
  };
}

async function importBundle(values) {
  const bundle = await regularDirectory(
    required(values, 'bundle'),
    'Air-gap bundle',
  );
  const targetPrefix = required(values, 'target-prefix').replace(/\/+$/, '');
  if (
    !targetPrefixPattern.test(targetPrefix) ||
    targetPrefix.includes('//') ||
    targetPrefix.includes('..')
  ) {
    fail('--target-prefix must be a lowercase OCI registry/repository prefix');
  }
  const targetMode = registryArguments(values, 'target');
  const registryConfig = await optionalRegularFile(
    values,
    'target-registry-config',
    'Target registry configuration',
  );
  const registryCa = await optionalRegularFile(
    values,
    'target-ca',
    'Target registry CA',
  );
  const verification = verificationArguments(values);
  for (const file of verification.files) {
    const original = file.path;
    const resolved = await regularFile(original, file.label);
    verification.blob = verification.blob.map((argument) =>
      argument === original ? resolved : argument,
    );
    verification.subject = verification.subject.map((argument) =>
      argument === original ? resolved : argument,
    );
    file.path = resolved;
  }
  const manifestPath = await regularFile(
    resolve(bundle, manifestName),
    'Air-gap manifest',
  );
  const signaturePath = await regularFile(
    resolve(bundle, signatureName),
    'Air-gap manifest signature',
  );
  run('cosign', [
    'verify-blob',
    '--bundle',
    signaturePath,
    ...verification.blob,
    manifestPath,
  ]);

  const manifest = parseAirgapManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  );
  const expectedFiles = new Set([
    manifestName,
    signatureName,
    releaseName,
    utilityName,
    ...manifest.artifacts.map((artifact) => artifact.archivePath),
  ]);
  const actualFiles = await inventoryFiles(bundle);
  if (
    actualFiles.length !== expectedFiles.size ||
    actualFiles.some((path) => !expectedFiles.has(path))
  ) {
    fail('Air-gap bundle file inventory differs from the signed manifest');
  }

  const releasePath = await regularFile(
    resolve(bundle, manifest.release.path),
    'Bundled release receipt',
  );
  const releaseDigest = await digestFile(releasePath);
  if (
    releaseDigest.sha256 !== manifest.release.sha256 ||
    releaseDigest.sizeBytes !== manifest.release.sizeBytes
  ) {
    fail('Bundled release receipt differs from the signed air-gap manifest');
  }
  const release = parseRelease(
    JSON.parse(await readFile(releasePath, 'utf8')),
  );
  if (
    release.version !== manifest.version ||
    release.sourceRevision !== manifest.sourceRevision
  ) {
    fail('Air-gap manifest differs from its release receipt');
  }
  const utilityPath = await regularFile(
    resolve(bundle, manifest.utility.path),
    'Bundled air-gap utility',
  );
  const utilityDigest = await digestFile(utilityPath);
  if (
    utilityDigest.sha256 !== manifest.utility.sha256 ||
    utilityDigest.sizeBytes !== manifest.utility.sizeBytes
  ) {
    fail('Bundled air-gap utility differs from the signed manifest');
  }

  const copyArgs = [
    ...(registryConfig
      ? ['--to-registry-config', registryConfig]
      : []),
    ...(registryCa ? ['--to-ca-file', registryCa] : []),
    ...(targetMode.plain ? ['--to-plain-http'] : []),
    ...(targetMode.insecure ? ['--to-insecure'] : []),
  ];
  const fetchArgs = [
    ...(registryConfig ? ['--registry-config', registryConfig] : []),
    ...(registryCa ? ['--ca-file', registryCa] : []),
    ...(targetMode.plain ? ['--plain-http'] : []),
    ...(targetMode.insecure ? ['--insecure'] : []),
  ];
  const cosignRegistryArgs = [
    ...(targetMode.plain ? ['--allow-http-registry'] : []),
    ...(targetMode.insecure ? ['--allow-insecure-registry'] : []),
    ...(registryCa ? ['--registry-cacert', registryCa] : []),
  ];
  const temp = await mkdtemp(
    resolve(tmpdir(), 'enterpriseglue-toolchain-airgap-'),
  );
  let cosignEnvironment;
  if (registryConfig) {
    const dockerConfigDirectory = resolve(temp, 'docker-config');
    await mkdir(dockerConfigDirectory, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(dockerConfigDirectory, 'config.json'),
      await readFile(registryConfig),
      { mode: 0o600 },
    );
    cosignEnvironment = { DOCKER_CONFIG: dockerConfigDirectory };
  }
  const receipts = [];
  try {
    for (const artifact of manifest.artifacts) {
      const releaseSubject = release[artifact.role];
      if (
        artifact.source !== releaseSubject.reference ||
        artifact.subjectDigest !== releaseSubject.digest ||
        artifact.payloadSha256 !== releaseSubject.payloadSha256
      ) {
        fail(`${artifact.role} differs from the bundled release receipt`);
      }
      const archive = await regularFile(
        resolve(bundle, artifact.archivePath),
        `${artifact.role} OCI archive`,
      );
      if (!archive.startsWith(`${bundle}/`)) {
        fail(`${artifact.role} OCI archive escapes the air-gap bundle`);
      }
      const archiveDigest = await digestFile(archive);
      if (
        archiveDigest.sha256 !== artifact.archiveSha256 ||
        archiveDigest.sizeBytes !== artifact.archiveSizeBytes
      ) {
        fail(`${artifact.role} OCI archive hash or size is invalid`);
      }
      const localDigest = parseDescriptor(
        run('oras', [
          'manifest',
          'fetch',
          '--oci-layout',
          '--descriptor',
          `${archive}@${artifact.subjectDigest}`,
        ]),
        `${artifact.role} OCI archive`,
      );
      if (localDigest !== artifact.subjectDigest) {
        fail(`${artifact.role} OCI archive changed the signed digest`);
      }

      const targetRepository = `${targetPrefix}/${roleRepositories[artifact.role]}`;
      const targetTag = `${targetRepository}:eg-toolchain-${artifact.subjectDigest.replace(':', '-')}`;
      const targetReference = `${targetRepository}@${artifact.subjectDigest}`;
      run('oras', [
        'cp',
        '--recursive',
        '--from-oci-layout',
        '--no-tty',
        ...copyArgs,
        `${archive}@${artifact.subjectDigest}`,
        targetTag,
      ]);
      const importedDigest = parseDescriptor(
        run('oras', [
          'manifest',
          'fetch',
          '--descriptor',
          ...fetchArgs,
          targetTag,
        ]),
        `${artifact.role} imported subject`,
      );
      if (importedDigest !== artifact.subjectDigest) {
        fail(`${artifact.role} changed digest during registry import`);
      }
      run('cosign', [
        'verify',
        ...verification.subject,
        ...cosignRegistryArgs,
        targetReference,
      ], { env: cosignEnvironment });

      if (artifact.payloadSha256) {
        const manifestDocument = JSON.parse(
          run('oras', ['manifest', 'fetch', ...fetchArgs, targetReference]),
        );
        const chartLayers = Array.isArray(manifestDocument.layers)
          ? manifestDocument.layers.filter(
              (layer) =>
                layer &&
                typeof layer === 'object' &&
                layer.mediaType === chartLayerMediaType &&
                typeof layer.digest === 'string' &&
                digestPattern.test(layer.digest),
            )
          : [];
        if (chartLayers.length !== 1) {
          fail(`${artifact.role} must contain exactly one Helm chart layer`);
        }
        const payload = resolve(temp, `${artifact.role}.tgz`);
        run('oras', [
          'blob',
          'fetch',
          '--output',
          payload,
          ...fetchArgs,
          `${targetRepository}@${chartLayers[0].digest}`,
        ]);
        if ((await digestFile(payload)).sha256 !== artifact.payloadSha256) {
          fail(`${artifact.role} Helm payload differs from the release receipt`);
        }
      }
      receipts.push({
        role: artifact.role,
        source: artifact.source,
        target: targetReference,
        digest: artifact.subjectDigest,
        signatureVerified: true,
      });
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }

  const receipt = {
    schemaVersion: 'enterpriseglue-plugin-toolchain-airgap-import/v1',
    version: manifest.version,
    sourceRevision: manifest.sourceRevision,
    verificationMode: verification.mode,
    sourceRegistryAccessed: false,
    customerCiRequired: false,
    customerBuildRequired: false,
    artifacts: receipts,
  };
  const receiptPath = values.get('receipt');
  if (typeof receiptPath === 'string') {
    await writeJson(resolve(receiptPath), receipt);
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

try {
  const { command, values } = parseArguments(process.argv.slice(2));
  if (command === 'export') {
    await exportBundle(values);
  } else {
    await importBundle(values);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
