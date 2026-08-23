#!/usr/bin/env node

import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  assertPluginCatalogCompatibilityMatrixV1,
  assertPluginReleaseTestedHostV1,
  selectPluginCatalogReleaseV1,
  verifySignedPluginAirgapIndexV1,
  verifySignedPluginPackageIndexV1,
  verifySignedPluginCatalogV1,
  verifySignedPluginCompatibilityMatrixV1,
  type TrustedPluginSignerV1,
} from '@enterpriseglue/plugin-runtime/supply-chain';
import { assertSafePluginFrontendEntryV1 } from '@enterpriseglue/plugin-runtime/frontend-policy';
import {
  parseEnterpriseGluePluginManifestV1,
  ociDigestReferenceSchema,
  pluginAirgapRegistryMapV1Schema,
  pluginPermissionGrantSetV1Schema,
  signedArtifactEnvelopeV1Schema,
  type PluginId,
  type PluginAirgapRegistryMapV1,
  type PluginPackageIndexV1,
} from '@enterpriseglue/plugin-sdk';
import { parse } from 'yaml';

import {
  ComposePluginLifecyclePhaseAdapterV1,
  createPluginDeploymentExecutionObservationV1,
  FilePluginLifecycleExecutionStoreV1,
  KubernetesPluginLifecycleExecutionStoreV1,
  KubernetesPluginLifecyclePhaseAdapterV1,
  PluginLifecycleExecutionError,
  createPluginLifecyclePlanEnvelopeV1,
  importPluginAirgapArchivesV1,
  writePluginDeploymentExecutionObservationV1,
  emptyPluginInstallerStateV1,
  installPluginV1,
  parsePluginInstallerStateV1,
  renderComposePluginOverlayV1,
  renderHelmPluginValuesV1,
  rollbackPluginV1,
  runPluginLifecycleExecutionV1,
  setPluginEnabledV1,
  uninstallPluginV1,
  upgradePluginV1,
  withPluginImageMappingsV1,
  verifyPluginInstallInputV1,
  type PluginInstallerStateV1,
  type DockerCommandPortV1,
  type ClusterCommandPortV1,
} from './index.js';
import {
  acquirePluginOciPackageV1,
  assertPluginOciCatalogSubjectV1,
  type OciAcquisitionCommandPortV1,
} from './ociAcquisition.js';

type Arguments = Record<string, string>;

function parseArguments(argv: string[]): { command: string; values: Arguments } {
  const [command = 'help', ...rest] = argv;
  const values: Arguments = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected --name value argument, received ${name ?? '<end>'}`);
    }
    values[name.slice(2)] = value;
  }
  return { command, values };
}

function required(values: Arguments, name: string): string {
  const value = values[name]?.trim();
  if (!value) throw new Error(`Missing required --${name} argument`);
  return value;
}

function optionalRevision(
  values: Arguments,
  name: string,
): number | undefined {
  const input = values[name]?.trim();
  if (!input) return undefined;
  const revision = Number(input);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`--${name} must be a non-negative safe integer`);
  }
  return revision;
}

function optionalBoolean(
  values: Arguments,
  name: string,
): boolean {
  const input = values[name]?.trim();
  if (input === undefined || input === '') return false;
  if (input !== 'true' && input !== 'false') {
    throw new Error(`--${name} must be true or false`);
  }
  return input === 'true';
}

function optionalMaximumDownloadBytes(
  values: Arguments,
): number | undefined {
  const input = values['max-download-bytes']?.trim();
  if (!input) return undefined;
  const value = Number(input);
  if (!Number.isSafeInteger(value)) {
    throw new Error('--max-download-bytes must be a safe integer');
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadTrust(path: string): Promise<TrustedPluginSignerV1[]> {
  const input = await readJson(path);
  if (
    !input ||
    typeof input !== 'object' ||
    !Array.isArray((input as { signers?: unknown }).signers)
  ) {
    throw new Error('Trust file must contain a signers array');
  }
  return (input as { signers: unknown[] }).signers.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof (entry as Record<string, unknown>).publisher !== 'string' ||
      typeof (entry as Record<string, unknown>).keyId !== 'string' ||
      typeof (entry as Record<string, unknown>).publicKeyPem !== 'string' ||
      !['active', 'retiring', 'revoked', 'compromised'].includes(
        String((entry as Record<string, unknown>).status),
      )
    ) {
      throw new Error('Trust signer entry is invalid');
    }
    return {
      publisher: (entry as Record<string, string>).publisher,
      keyId: (entry as Record<string, string>).keyId,
      publicKey: (entry as Record<string, string>).publicKeyPem,
      status: (entry as Record<string, string>)
        .status as TrustedPluginSignerV1['status'],
    };
  });
}

async function loadVerifiedCatalog(values: Arguments) {
  const payload = await readFile(required(values, 'catalog'));
  const envelope = await readJson(required(values, 'catalog-signature'));
  const trust = await loadTrust(required(values, 'trust'));
  return verifySignedPluginCatalogV1({
    payload,
    envelope,
    trust,
  });
}

const packageControlFiles = new Set([
  'catalog.json',
  'catalog.signature.json',
  'package-index.json',
  'package-index.signature.json',
]);

async function regularPackageFile(
  packageRoot: string,
  packageRootRealPath: string,
  path: string,
): Promise<string> {
  const target = resolve(packageRoot, path);
  const relativePath = relative(packageRoot, target);
  if (
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\')
  ) {
    throw new Error(`Package file escapes its root: ${path}`);
  }
  const details = await lstat(target);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Package entry must be a regular non-symlink file: ${path}`);
  }
  const targetRealPath = await realpath(target);
  if (
    targetRealPath !== packageRootRealPath &&
    !targetRealPath.startsWith(`${packageRootRealPath}/`)
  ) {
    throw new Error(`Package entry resolves outside its root: ${path}`);
  }
  return target;
}

async function digestFile(path: string): Promise<{
  sizeBytes: number;
  sha256: string;
}> {
  const digest = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += bytes.byteLength;
    digest.update(bytes);
  }
  return { sizeBytes, sha256: digest.digest('hex') };
}

async function inventoryPackageFiles(
  packageRoot: string,
  directory = packageRoot,
): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    const path = relative(packageRoot, absolutePath).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) {
      throw new Error(`Plugin package must not contain symbolic links: ${path}`);
    }
    if (entry.isDirectory()) {
      paths.push(...(await inventoryPackageFiles(packageRoot, absolutePath)));
    } else if (entry.isFile()) {
      paths.push(path);
    } else {
      throw new Error(`Plugin package contains an unsupported file type: ${path}`);
    }
  }
  return paths.sort();
}

function manifestFileReferences(
  manifest: ReturnType<typeof parseEnterpriseGluePluginManifestV1>,
): Array<{ path: string; sha256: string }> {
  const references: Array<{ path: string; sha256: string }> = [];
  if (manifest.deployment.frontend) {
    references.push({
      path: manifest.deployment.frontend.entry,
      sha256: manifest.deployment.frontend.sha256,
    });
  }
  if (manifest.deployment.resources) {
    references.push({
      path: manifest.deployment.resources.descriptor,
      sha256: manifest.deployment.resources.sha256,
    });
  }
  for (const operation of manifest.deployment.backend?.operations ?? []) {
    references.push(operation.requestSchema, operation.responseSchema);
  }
  for (const subscription of manifest.events.subscriptions) {
    references.push(subscription.schema);
  }
  return references;
}

async function loadVerifiedPackage(values: Arguments): Promise<{
  packageRoot: string;
  index: PluginPackageIndexV1;
  record: ReturnType<typeof verifyPluginInstallInputV1>;
  publisher: PluginId;
}> {
  const packageRoot = resolve(required(values, 'package'));
  const rootDetails = await lstat(packageRoot);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error('Plugin package root must be a regular non-symlink directory');
  }
  const packageRootRealPath = await realpath(packageRoot);
  const actualPaths = await inventoryPackageFiles(packageRoot);
  for (const path of packageControlFiles) {
    if (!actualPaths.includes(path)) {
      throw new Error(`Plugin package is missing required control file: ${path}`);
    }
    await regularPackageFile(packageRoot, packageRootRealPath, path);
  }
  const trust = await loadTrust(required(values, 'trust'));
  const catalogPayload = await readFile(resolve(packageRoot, 'catalog.json'));
  const catalogEnvelopeInput = await readJson(
    resolve(packageRoot, 'catalog.signature.json'),
  );
  const catalogEnvelope =
    signedArtifactEnvelopeV1Schema.parse(catalogEnvelopeInput);
  const catalog = verifySignedPluginCatalogV1({
    payload: catalogPayload,
    envelope: catalogEnvelope,
    trust,
  });
  const indexPayload = await readFile(
    resolve(packageRoot, 'package-index.json'),
  );
  const indexEnvelope = await readJson(
    resolve(packageRoot, 'package-index.signature.json'),
  );
  const verifiedIndex = verifySignedPluginPackageIndexV1({
    payload: indexPayload,
    envelope: indexEnvelope,
    trust,
  });
  const { index } = verifiedIndex;
  if (index.catalogRevision !== catalog.metadata.revision) {
    throw new Error('Plugin package and catalog revisions do not match');
  }
  const release = selectPluginCatalogReleaseV1(
    catalog,
    index.pluginId,
    index.version,
  );
  assertPluginReleaseTestedHostV1(
    release,
    required(values, 'host-version'),
  );
  const catalogEntry = catalog.entries.find(
    (entry) => entry.pluginId === index.pluginId,
  );
  if (
    !catalogEntry ||
    catalogEntry.publisher !== verifiedIndex.envelope.publisher ||
    catalogEntry.publisher !== catalogEnvelope.publisher
  ) {
    throw new Error(
      'Catalog, package, and publisher signer identities do not match',
    );
  }

  const indexedPaths = new Set(index.files.map((file) => file.path));
  for (const path of actualPaths) {
    if (!packageControlFiles.has(path) && !indexedPaths.has(path)) {
      throw new Error(`Plugin package contains an unindexed file: ${path}`);
    }
  }
  for (const file of index.files) {
    const path = await regularPackageFile(
      packageRoot,
      packageRootRealPath,
      file.path,
    );
    const actual = await digestFile(path);
    if (
      actual.sizeBytes !== file.sizeBytes ||
      actual.sha256 !== file.sha256
    ) {
      throw new Error(`Plugin package file integrity check failed: ${file.path}`);
    }
  }

  const manifestBytes = await readFile(resolve(packageRoot, index.manifestPath));
  const manifest = parseEnterpriseGluePluginManifestV1(
    parse(manifestBytes.toString('utf8')),
  );
  if (
    manifest.metadata.id !== index.pluginId ||
    manifest.metadata.version !== index.version ||
    manifest.metadata.publisher !== catalogEntry.publisher
  ) {
    throw new Error('Plugin package identity differs from its signed manifest');
  }
  if (manifest.deployment.resources?.descriptor !== index.resourcesPath) {
    throw new Error(
      'Plugin package resource path differs from its signed manifest',
    );
  }
  if (manifest.deployment.frontend) {
    await assertSafePluginFrontendEntryV1(
      await readFile(
        resolve(packageRoot, manifest.deployment.frontend.entry),
      ),
    );
  }
  const filesByPath = new Map(index.files.map((file) => [file.path, file]));
  const referencedRuntimePaths = new Set([index.manifestPath]);
  for (const reference of manifestFileReferences(manifest)) {
    const file = filesByPath.get(reference.path);
    if (
      !file ||
      file.role !== 'runtime' ||
      file.sha256 !== reference.sha256
    ) {
      throw new Error(
        `Manifest reference is not a matching inventoried runtime file: ${reference.path}`,
      );
    }
    referencedRuntimePaths.add(reference.path);
  }
  for (const file of index.files) {
    if (file.role === 'runtime' && !referencedRuntimePaths.has(file.path)) {
      throw new Error(
        `Plugin package contains an unreferenced runtime file: ${file.path}`,
      );
    }
  }

  const resourceBytes = await readFile(resolve(packageRoot, index.resourcesPath));
  const permissionGrantPath = values['permission-grants']?.trim();
  const grantSet = pluginPermissionGrantSetV1Schema.parse(
    permissionGrantPath
      ? await readJson(permissionGrantPath)
      : {
          apiVersion: 'permission-grants.plugin.enterpriseglue.io/v1',
          pluginId: index.pluginId,
          permissions: manifest.permissions.required,
        },
  );
  if (grantSet.pluginId !== index.pluginId) {
    throw new Error('Permission grant file does not match the packaged plugin');
  }
  const record = verifyPluginInstallInputV1({
    release,
    manifestBytes,
    manifest,
    resourceBytes,
    resources: parse(resourceBytes.toString('utf8')),
    grantedPermissions: grantSet.permissions,
    stagedAssetPath: './pending-package-stage',
  });
  return {
    packageRoot,
    index,
    record,
    publisher: catalogEntry.publisher,
  };
}

const airgapControlFiles = new Set([
  'airgap-index.json',
  'airgap-index.signature.json',
]);

async function loadVerifiedAirgap(values: Arguments): Promise<{
  airgapRoot: string;
  package: Awaited<ReturnType<typeof loadVerifiedPackage>>;
  index: ReturnType<typeof verifySignedPluginAirgapIndexV1>['index'];
}> {
  const airgapRoot = resolve(required(values, 'airgap'));
  const rootDetails = await lstat(airgapRoot);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error('Air-gap root must be a regular non-symlink directory');
  }
  const airgapRootRealPath = await realpath(airgapRoot);
  const actualPaths = await inventoryPackageFiles(airgapRoot);
  for (const path of airgapControlFiles) {
    if (!actualPaths.includes(path)) {
      throw new Error(`Air-gap bundle is missing required control file: ${path}`);
    }
    await regularPackageFile(airgapRoot, airgapRootRealPath, path);
  }

  const packageRoot = resolve(airgapRoot, 'package');
  const loadedPackage = await loadVerifiedPackage({
    ...values,
    package: packageRoot,
  });
  const trust = await loadTrust(required(values, 'trust'));
  const indexPayload = await readFile(resolve(airgapRoot, 'airgap-index.json'));
  const indexEnvelope = await readJson(
    resolve(airgapRoot, 'airgap-index.signature.json'),
  );
  const verified = verifySignedPluginAirgapIndexV1({
    payload: indexPayload,
    envelope: indexEnvelope,
    trust,
  });
  if (verified.envelope.publisher !== loadedPackage.publisher) {
    throw new Error('Air-gap and plugin package publisher identities do not match');
  }
  if (
    verified.index.catalogRevision !==
    loadedPackage.index.catalogRevision
  ) {
    throw new Error('Air-gap and plugin package catalog revisions do not match');
  }

  const indexedPaths = new Set(
    verified.index.artifacts.map((artifact) => artifact.archivePath),
  );
  for (const artifact of verified.index.artifacts) {
    if (!artifact.archivePath.startsWith('artifacts/')) {
      throw new Error('Air-gap archives must be below the artifacts directory');
    }
    const path = await regularPackageFile(
      airgapRoot,
      airgapRootRealPath,
      artifact.archivePath,
    );
    const actual = await digestFile(path);
    if (
      actual.sizeBytes !== artifact.sizeBytes ||
      actual.sha256 !== artifact.sha256
    ) {
      throw new Error(
        `Air-gap archive integrity check failed: ${artifact.archivePath}`,
      );
    }
  }
  for (const path of actualPaths) {
    if (
      airgapControlFiles.has(path) ||
      path.startsWith('package/') ||
      indexedPaths.has(path)
    ) {
      continue;
    }
    throw new Error(`Air-gap bundle contains an unindexed file: ${path}`);
  }

  const requiredSources = new Set([
    loadedPackage.record.bundle,
    loadedPackage.record.manifest.deployment.backend!.image,
    ...(loadedPackage.record.manifest.deployment.migration
      ? [loadedPackage.record.manifest.deployment.migration.image]
      : []),
  ]);
  const indexedSources = new Set(
    verified.index.artifacts.map((artifact) => artifact.source),
  );
  for (const source of requiredSources) {
    if (!indexedSources.has(source)) {
      throw new Error(
        `Air-gap index is missing a required immutable artifact: ${source}`,
      );
    }
  }
  return {
    airgapRoot,
    package: loadedPackage,
    index: verified.index,
  };
}

function airgapTargetReference(
  source: string,
  registryPrefixInput: string,
): string {
  const registryPrefix = registryPrefixInput.replace(/\/+$/, '');
  if (
    !registryPrefix ||
    registryPrefix.includes('@') ||
    registryPrefix.includes('://')
  ) {
    throw new Error(
      'Air-gap registry prefix must be a registry/repository path without scheme or digest',
    );
  }
  const digestSeparator = source.lastIndexOf('@sha256:');
  const sourceName = source.slice(0, digestSeparator);
  const sourceDigest = source.slice(digestSeparator);
  const firstSlash = sourceName.indexOf('/');
  const sourceRepository =
    firstSlash === -1 ? sourceName : sourceName.slice(firstSlash + 1);
  return ociDigestReferenceSchema.parse(
    `${registryPrefix}/${sourceRepository}${sourceDigest}`,
  );
}

function createAirgapRegistryMap(
  loaded: Awaited<ReturnType<typeof loadVerifiedAirgap>>,
  registryPrefix: string,
  generatedAt: string,
): PluginAirgapRegistryMapV1 {
  return pluginAirgapRegistryMapV1Schema.parse({
    apiVersion: 'airgap-map.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginAirgapRegistryMap',
    catalogRevision: loaded.index.catalogRevision,
    generatedAt,
    mappings: loaded.index.artifacts.map((artifact) => ({
      source: artifact.source,
      target: airgapTargetReference(artifact.source, registryPrefix),
      archivePath: artifact.archivePath,
    })),
  });
}

async function loadVerifiedAirgapRegistryMap(
  path: string,
  loaded: Awaited<ReturnType<typeof loadVerifiedAirgap>>,
): Promise<PluginAirgapRegistryMapV1> {
  const registryMap = pluginAirgapRegistryMapV1Schema.parse(
    await readJson(path),
  );
  if (registryMap.catalogRevision !== loaded.index.catalogRevision) {
    throw new Error('Air-gap registry map uses another catalog revision');
  }
  const expected = new Map(
    loaded.index.artifacts.map((artifact) => [
      artifact.source,
      artifact.archivePath,
    ]),
  );
  if (registryMap.mappings.length !== expected.size) {
    throw new Error('Air-gap registry map does not cover the exact artifact set');
  }
  for (const mapping of registryMap.mappings) {
    if (expected.get(mapping.source) !== mapping.archivePath) {
      throw new Error(
        'Air-gap registry map source/archive differs from the signed index',
      );
    }
  }
  return registryMap;
}

async function stageVerifiedPackage(
  output: string,
  loaded: Awaited<ReturnType<typeof loadVerifiedPackage>>,
): Promise<{ stagedAssetPath: string; stagedDirectory: string }> {
  const destination = resolve(
    output,
    'plugin-assets',
    loaded.index.pluginId,
    loaded.index.version,
  );
  if (await exists(destination)) {
    throw new Error('Plugin package version is already staged');
  }
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  try {
    for (const file of loaded.index.files.filter(
      (candidate) => candidate.role === 'runtime',
    )) {
      const source = resolve(loaded.packageRoot, file.path);
      const target = resolve(temporary, file.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await copyFile(source, target);
      await chmod(target, 0o444);
      const copied = await digestFile(target);
      if (
        copied.sizeBytes !== file.sizeBytes ||
        copied.sha256 !== file.sha256
      ) {
        throw new Error(`Staged plugin file integrity check failed: ${file.path}`);
      }
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }

  // Compare resolved filesystem identities instead of textual paths. In particular, macOS can
  // expose the same mounted workspace through both /var and /private/var; a package output below
  // that workspace must not be rejected solely because the caller used the other spelling.
  const [workspaceRoot, stagedDestination] = await Promise.all([
    realpath(resolve(process.cwd())),
    realpath(destination),
  ]);
  const relativePath = relative(workspaceRoot, stagedDestination).replaceAll('\\', '/');
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../')
  ) {
    await rm(destination, { recursive: true, force: true });
    throw new Error(
      'Installer output must be below the mounted workspace for package staging',
    );
  }
  return {
    stagedAssetPath: `./${relativePath}`,
    stagedDirectory: destination,
  };
}

async function loadState(output: string): Promise<PluginInstallerStateV1> {
  const path = resolve(output, 'plugin-installer-state.json');
  if (!(await exists(path))) return emptyPluginInstallerStateV1();
  return parsePluginInstallerStateV1(await readJson(path));
}

async function atomicWrite(
  path: string,
  content: string,
  mode = 0o600,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, {
    encoding: 'utf8',
    flag: 'wx',
    mode,
  });
  try {
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function ensureInvocationKeyPair(output: string): Promise<void> {
  const privatePath = resolve(output, 'plugin-invocation-private.pem');
  const publicPath = resolve(output, 'plugin-invocation-public.pem');
  const [privateExists, publicExists] = await Promise.all([
    exists(privatePath),
    exists(publicPath),
  ]);
  if (privateExists !== publicExists) {
    throw new Error(
      'Plugin invocation key pair is incomplete; restore both files or rotate both explicitly',
    );
  }
  if (privateExists) {
    await chmod(publicPath, 0o644);
    return;
  }

  const pair = generateKeyPairSync('ed25519');
  await atomicWrite(
    privatePath,
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  );
  await atomicWrite(
    publicPath,
    pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    0o644,
  );
}

async function ensureSecretBrokerInputs(output: string): Promise<void> {
  const policyPath = resolve(output, 'plugin-secret-broker-policy.json');
  const secretRoot = resolve(output, 'plugin-broker-secrets');
  await mkdir(secretRoot, { recursive: true, mode: 0o700 });
  if (!(await exists(policyPath))) {
    await atomicWrite(
      policyPath,
      `${JSON.stringify(
        {
          apiVersion: 'secret-broker-policy.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginSecretBrokerPolicy',
          entries: [],
        },
        null,
        2,
      )}\n`,
    );
  }
}

async function ensureDeploymentFiles(
  output: string,
  state: PluginInstallerStateV1,
): Promise<void> {
  const root = resolve(output, 'plugin-config-files');
  await ensurePrivateDirectory(root);
  for (const record of Object.values(state.plugins).sort((left, right) =>
    left.pluginId.localeCompare(right.pluginId),
  )) {
    const pluginRoot = resolve(root, record.pluginId);
    const references = new Set(
      record.resources.configuration
        .filter((item) => item.source === 'deployment_file')
        .map((item) => item.reference),
    );
    if (references.size === 0) continue;
    await ensurePrivateDirectory(pluginRoot);
    for (const reference of [...references].sort()) {
      const path = resolve(pluginRoot, reference);
      try {
        const details = await lstat(path);
        if (!details.isFile() || details.isSymbolicLink()) {
          throw new Error(
            `Deployment file must be a regular non-symlink file: ${record.pluginId}/${reference}`,
          );
        }
        await chmod(path, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await atomicWrite(path, '');
      }
    }
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Plugin deployment directory is not a regular directory: ${path}`);
  }
  await chmod(path, 0o700);
}

function hostVisiblePath(containerPath: string): string {
  const hostRoot = process.env.ENTERPRISEGLUE_PLUGIN_HOST_ROOT?.trim();
  if (!hostRoot) return containerPath;
  const workspaceRoot = resolve(process.cwd());
  const relativePath = relative(workspaceRoot, containerPath);
  if (relativePath === '..' || relativePath.startsWith('../')) {
    throw new Error(
      'Containerized installer inputs and output must remain below the mounted workspace',
    );
  }
  return resolve(hostRoot, relativePath);
}

async function writeOutputs(
  output: string,
  state: PluginInstallerStateV1,
  previousState: PluginInstallerStateV1,
): Promise<void> {
  const journalPath = resolve(output, 'plugin-installer-transaction.json');
  if (await exists(journalPath)) {
    throw new Error(
      'An unresolved plugin installer transaction must be recovered first',
    );
  }
  await atomicWrite(
    journalPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        targetRevision: state.revision,
        previousState,
      },
      null,
      2,
    )}\n`,
  );
  try {
    await writeOutputSnapshot(output, state);
    await unlink(journalPath);
  } catch (error) {
    try {
      await writeOutputSnapshot(output, previousState);
      await unlink(journalPath);
    } catch {
      // Keep the journal. The next invocation will recover the complete prior
      // snapshot before accepting another lifecycle operation.
    }
    throw error;
  }
}

async function writeOutputSnapshot(
  output: string,
  state: PluginInstallerStateV1,
): Promise<void> {
  await mkdir(output, { recursive: true });
  await ensureInvocationKeyPair(output);
  await ensureSecretBrokerInputs(output);
  await ensureDeploymentFiles(output, state);
  const composeState = structuredClone(state);
  for (const record of Object.values(composeState.plugins)) {
    record.stagedAssetPath = hostVisiblePath(resolve(record.stagedAssetPath));
  }
  await atomicWrite(
    resolve(output, 'docker-compose.plugins.generated.yaml'),
    renderComposePluginOverlayV1(composeState, {
      stateSourcePath: hostVisiblePath(
        resolve(output, 'plugin-installer-state.json'),
      ),
      executionObservationSourcePath: hostVisiblePath(
        resolve(output, 'plugin-lifecycle-observation.json'),
      ),
      invocationPrivateKeySourcePath: hostVisiblePath(
        resolve(output, 'plugin-invocation-private.pem'),
      ),
      invocationPublicKeySourcePath: hostVisiblePath(
        resolve(output, 'plugin-invocation-public.pem'),
      ),
      secretBrokerPolicySourcePath: hostVisiblePath(
        resolve(output, 'plugin-secret-broker-policy.json'),
      ),
      secretBrokerSecretRootSourcePath: hostVisiblePath(
        resolve(output, 'plugin-broker-secrets'),
      ),
      deploymentFileSourceRoot: hostVisiblePath(
        resolve(output, 'plugin-config-files'),
      ),
      engineEventPollingEnabled: booleanEnvironment(
        'ENTERPRISEGLUE_PLUGIN_ENGINE_EVENT_POLLING_ENABLED',
        false,
      ),
    }),
  );
  await atomicWrite(
    resolve(output, 'helm.plugins.generated.values.yaml'),
    renderHelmPluginValuesV1(state),
  );
  const lifecyclePlan = structuredClone(state.lifecyclePlan);
  if (lifecyclePlan?.migrationImage) {
    lifecyclePlan.migrationImage =
      state.imageMappings[lifecyclePlan.migrationImage] ??
      lifecyclePlan.migrationImage;
  }
  const lifecyclePlanEnvelope = createPluginLifecyclePlanEnvelopeV1(
    state.revision,
    lifecyclePlan ?? null,
  );
  await atomicWrite(
    resolve(output, 'plugin-lifecycle-plan.json'),
    `${JSON.stringify(lifecyclePlanEnvelope, null, 2)}\n`,
  );
  await writePluginDeploymentExecutionObservationV1(
    output,
    lifecyclePlanEnvelope,
    null,
  );
  await atomicWrite(
    resolve(output, 'plugin-installer-state.json'),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

async function recoverInterruptedOutputTransaction(
  output: string,
): Promise<boolean> {
  const journalPath = resolve(output, 'plugin-installer-transaction.json');
  if (!(await exists(journalPath))) return false;
  const input = await readJson(journalPath);
  if (
    !input ||
    typeof input !== 'object' ||
    (input as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !Number.isInteger((input as { targetRevision?: unknown }).targetRevision)
  ) {
    throw new Error(
      'Plugin installer transaction journal is invalid; manual recovery is required',
    );
  }
  const previousState = parsePluginInstallerStateV1(
    (input as { previousState?: unknown }).previousState,
  );
  await writeOutputSnapshot(output, previousState);
  await unlink(journalPath);
  return true;
}

function booleanEnvironment(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

async function loadInstallRecord(values: Arguments) {
  const catalog = await loadVerifiedCatalog(values);
  const pluginId = required(values, 'plugin') as PluginId;
  const version = required(values, 'version');
  const release = selectPluginCatalogReleaseV1(catalog, pluginId, version);
  assertPluginReleaseTestedHostV1(
    release,
    required(values, 'host-version'),
  );
  const manifestBytes = await readFile(required(values, 'manifest'));
  const resourceBytes = await readFile(required(values, 'resources'));
  const manifest = parse(manifestBytes.toString('utf8'));
  const resources = parse(resourceBytes.toString('utf8'));
  const grantSet = pluginPermissionGrantSetV1Schema.parse(
    await readJson(required(values, 'permission-grants')),
  );
  if (grantSet.pluginId !== pluginId) {
    throw new Error('Permission grant file does not match the requested plugin');
  }
  const record = verifyPluginInstallInputV1({
    release,
    manifestBytes,
    manifest,
    resourceBytes,
    resources,
    grantedPermissions: grantSet.permissions,
    stagedAssetPath: required(values, 'asset-path'),
  });
  if (record.pluginId !== pluginId) {
    throw new Error('Requested plugin ID does not match the verified manifest');
  }
  return record;
}

function toolStatus(command: string, args: string[]): {
  available: boolean;
  version?: string;
} {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env },
  });
  if (result.status !== 0) return { available: false };
  const version = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .trim()
    .split('\n')[0]
    ?.slice(0, 200);
  return { available: true, version };
}

function usage(): string {
  return [
    'eg-plugin doctor',
    'eg-plugin catalog --catalog FILE --catalog-signature FILE --trust FILE',
    'eg-plugin verify-compatibility-matrix --catalog FILE --catalog-signature FILE --matrix FILE --matrix-signature FILE --trust FILE',
    'eg-plugin install|upgrade --catalog FILE --catalog-signature FILE --trust FILE --host-version VERSION --plugin ID --version VERSION --manifest FILE --resources FILE --permission-grants FILE --asset-path ./PATH --output DIR',
    'eg-plugin install-package|upgrade-package --package DIR --trust FILE --host-version VERSION [--permission-grants FILE] --output DIR',
    'eg-plugin install-oci|upgrade-oci --subject REGISTRY/REPOSITORY@sha256:DIGEST --trust FILE --cosign-policy FILE --host-version VERSION [--registry-config FILE] [--registry-ca FILE] [--permission-grants FILE] [--max-download-bytes BYTES] --output DIR',
    'eg-plugin prepare-airgap --airgap DIR --trust FILE --host-version VERSION --registry-prefix REGISTRY/PATH --output DIR',
    'eg-plugin import-airgap --airgap DIR --trust FILE --host-version VERSION --registry-map FILE [--registry-config FILE] [--registry-ca FILE]',
    'eg-plugin install-airgap-package|upgrade-airgap-package --airgap DIR --trust FILE --host-version VERSION --registry-map FILE [--permission-grants FILE] --output DIR',
    'eg-plugin apply-compose --output DIR --project-directory DIR --compose-files FILE[,FILE...] --project-name NAME [--utility-image IMAGE@sha256:DIGEST] [--image-mode pull|local] [--supersede-execution-revision N]',
    'eg-plugin apply-kubernetes --output DIR --project-directory DIR --chart DIR --values FILE --namespace NAME --release-name NAME [--utility-image IMAGE@sha256:DIGEST] [--kube-context NAME] [--platform kubernetes|openshift] [--rollout-timeout-seconds N] [--supersede-execution-revision N]',
    'eg-plugin enable|disable|rollback --plugin ID --output DIR [--supersede-execution-revision N]',
    'eg-plugin uninstall --plugin ID --data-action retain|export|delete --output DIR [--supersede-execution-revision N]',
    'eg-plugin status --output DIR',
  ].join('\n');
}

const lifecycleMutationCommands = new Set([
  'install',
  'upgrade',
  'install-package',
  'upgrade-package',
  'install-oci',
  'upgrade-oci',
  'install-airgap-package',
  'upgrade-airgap-package',
  'enable',
  'disable',
  'rollback',
  'uninstall',
]);

async function assertLifecycleMutationMayProceed(
  command: string,
  output: string,
  values: Arguments,
): Promise<void> {
  if (
    !(await exists(
      resolve(output, 'plugin-lifecycle-execution.json'),
    ))
  ) {
    return;
  }
  const execution = await new FilePluginLifecycleExecutionStoreV1(
    output,
  ).read();
  if (execution.status === 'succeeded') return;

  const supersedeRevision = optionalRevision(
    values,
    'supersede-execution-revision',
  );
  if (
    (execution.status === 'failed' ||
      execution.status === 'manual_intervention') &&
    supersedeRevision === execution.revision
  ) {
    const recoveryCommand = {
      install: 'uninstall',
      upgrade: 'rollback',
      rollback: 'rollback',
      enable: 'disable',
      disable: 'enable',
      uninstall: undefined,
    }[execution.operation];
    const requestedPluginId = values.plugin?.trim();
    if (
      recoveryCommand === command &&
      requestedPluginId === execution.pluginId
    ) {
      return;
    }
    throw new PluginLifecycleExecutionError(
      'execution_active',
      recoveryCommand
        ? `Execution ${execution.executionId} may only be superseded by '${recoveryCommand} --plugin ${execution.pluginId}' at revision ${execution.revision}`
        : `Execution ${execution.executionId} cannot be superseded; resume its uninstall plan or perform manual recovery`,
    );
  }
  const recovery =
    execution.status === 'failed' ||
    execution.status === 'manual_intervention'
      ? ` Resolve or replace it only with --supersede-execution-revision ${execution.revision}.`
      : ' Resume the current plan with apply-compose; a live execution cannot be replaced.';
  throw new PluginLifecycleExecutionError(
    'execution_active',
    `Lifecycle execution ${execution.executionId} is ${execution.status} at revision ${execution.revision}.${recovery}`,
  );
}

export async function runPluginInstallerCliV1(
  argv: string[],
  write: (line: string) => void = console.log,
  options: {
    docker?: DockerCommandPortV1;
    cluster?: ClusterCommandPortV1;
    oci?: OciAcquisitionCommandPortV1;
  } = {},
): Promise<number> {
  const { command, values } = parseArguments(argv);
  if (command === 'help' || command === '--help') {
    write(usage());
    return 0;
  }
  if (command === 'doctor') {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const result = {
      node: { available: nodeMajor >= 22, version: process.versions.node },
      docker: toolStatus('docker', ['--version']),
      compose: toolStatus('docker', ['compose', 'version']),
      helm: toolStatus('helm', ['version', '--short']),
      oras: toolStatus('oras', ['version']),
      cosign: toolStatus('cosign', ['version']),
    };
    write(JSON.stringify(result, null, 2));
    return result.node.available && result.docker.available ? 0 : 2;
  }
  if (command === 'catalog') {
    const catalog = await loadVerifiedCatalog(values);
    write(
      JSON.stringify(
        {
          revision: catalog.metadata.revision,
          expiresAt: catalog.metadata.expiresAt,
          plugins: catalog.entries.map((entry) => ({
            pluginId: entry.pluginId,
            displayName: entry.displayName,
            releases: entry.releases.map((release) => ({
              version: release.version,
              channel: release.channel,
              revoked: release.revoked,
            })),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === 'verify-compatibility-matrix') {
    const trust = await loadTrust(required(values, 'trust'));
    const catalog = verifySignedPluginCatalogV1({
      payload: await readFile(required(values, 'catalog')),
      envelope: await readJson(required(values, 'catalog-signature')),
      trust,
    });
    const verified = verifySignedPluginCompatibilityMatrixV1({
      payload: await readFile(required(values, 'matrix')),
      envelope: await readJson(required(values, 'matrix-signature')),
      trust,
    });
    assertPluginCatalogCompatibilityMatrixV1({
      catalog,
      matrix: verified.matrix,
    });
    write(
      JSON.stringify(
        {
          status: 'verified',
          pluginId: verified.matrix.pluginId,
          publisher: verified.matrix.publisher,
          matrixRevision: verified.matrix.metadata.revision,
          hostVersions: verified.matrix.hostVersions,
          pluginVersions: verified.matrix.pluginVersions,
          cells: verified.matrix.cells.map((cell) => ({
            hostVersion: cell.hostVersion,
            pluginVersion: cell.pluginVersion,
            suiteRevision: cell.suiteRevision,
            evidenceSha256: cell.evidenceSha256,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (command === 'install-oci' || command === 'upgrade-oci') {
    const output = resolve(required(values, 'output'));
    await recoverInterruptedOutputTransaction(output);
    await assertLifecycleMutationMayProceed(command, output, values);
    const acquired = await acquirePluginOciPackageV1({
      subject: required(values, 'subject'),
      cosignPolicyFile: required(values, 'cosign-policy'),
      registryConfigFile: values['registry-config']?.trim() || undefined,
      registryCaFile: values['registry-ca']?.trim() || undefined,
      allowPlainHttp: optionalBoolean(values, 'allow-plain-http'),
      allowInsecureTls: optionalBoolean(values, 'allow-insecure-tls'),
      maximumDownloadBytes: optionalMaximumDownloadBytes(values),
      command: options.oci,
    });
    try {
      const verified = await loadVerifiedPackage({
        ...values,
        package: acquired.packageRoot,
      });
      assertPluginOciCatalogSubjectV1(
        verified.record.bundle,
        acquired.receipt.subject,
      );
      write(
        JSON.stringify({
          event: 'plugin_oci_acquisition_verified',
          ...acquired.receipt,
          customerCiRequired: false,
        }),
      );
      return await runPluginInstallerCliV1(
        [
          command === 'install-oci'
            ? 'install-package'
            : 'upgrade-package',
          '--package',
          acquired.packageRoot,
          '--trust',
          required(values, 'trust'),
          '--host-version',
          required(values, 'host-version'),
          ...(values['permission-grants']?.trim()
            ? [
                '--permission-grants',
                values['permission-grants'].trim(),
              ]
            : []),
          '--output',
          output,
        ],
        write,
        options,
      );
    } finally {
      await acquired.cleanup();
    }
  }
  if (command === 'prepare-airgap') {
    const loaded = await loadVerifiedAirgap(values);
    const output = resolve(required(values, 'output'));
    const generatedAt = new Date().toISOString();
    const registryMap = createAirgapRegistryMap(
      loaded,
      required(values, 'registry-prefix'),
      generatedAt,
    );
    await mkdir(output, { recursive: true, mode: 0o700 });
    const mapPath = resolve(output, 'airgap-registry-map.json');
    const planPath = resolve(output, 'airgap-import-plan.json');
    await atomicWrite(mapPath, `${JSON.stringify(registryMap, null, 2)}\n`);
    await atomicWrite(
      planPath,
      `${JSON.stringify(
        {
          apiVersion: 'airgap-import-plan.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginAirgapImportPlan',
          catalogRevision: loaded.index.catalogRevision,
          generatedAt,
          verificationRequiredAfterImport: true,
          entries: loaded.index.artifacts.map((artifact) => {
            const mapping = registryMap.mappings.find(
              (candidate) => candidate.source === artifact.source,
            )!;
            return {
              archivePath: artifact.archivePath,
              mediaType: artifact.mediaType,
              source: artifact.source,
              target: mapping.target,
              requiredTargetDigest: mapping.target.slice(
                mapping.target.lastIndexOf('@sha256:') + 8,
              ),
            };
          }),
        },
        null,
        2,
      )}\n`,
    );
    write(
      JSON.stringify({
        status: 'verified',
        catalogRevision: loaded.index.catalogRevision,
        artifactCount: loaded.index.artifacts.length,
        registryMap: mapPath,
        importPlan: planPath,
      }),
    );
    return 0;
  }
  if (command === 'import-airgap') {
    const loaded = await loadVerifiedAirgap(values);
    const registryMap = await loadVerifiedAirgapRegistryMap(
      required(values, 'registry-map'),
      loaded,
    );
    const imported = await importPluginAirgapArchivesV1({
      airgapRoot: loaded.airgapRoot,
      index: loaded.index,
      registryMap,
      registryConfigFile: values['registry-config']?.trim() || undefined,
      registryCaFile: values['registry-ca']?.trim() || undefined,
      allowPlainHttp: optionalBoolean(values, 'allow-plain-http'),
      allowInsecureTls: optionalBoolean(values, 'allow-insecure-tls'),
      command: options.oci,
    });
    write(
      JSON.stringify({
        event: 'plugin_airgap_import_verified',
        status: 'imported',
        catalogRevision: imported.catalogRevision,
        artifactCount: imported.artifactCount,
        customerCiRequired: false,
        receipts: imported.receipts,
      }),
    );
    return 0;
  }
  if (command === 'apply-compose') {
    const output = resolve(required(values, 'output'));
    const projectDirectory = resolve(
      required(values, 'project-directory'),
    );
    const composeFiles = required(values, 'compose-files')
      .split(',')
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => resolve(projectDirectory, path));
    const imageMode = values['image-mode']?.trim() ?? 'pull';
    if (imageMode !== 'pull' && imageMode !== 'local') {
      throw new Error('--image-mode must be pull or local');
    }
    const leaseSeconds = Number(values['lease-seconds'] ?? '120');
    if (
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 1 ||
      leaseSeconds > 300
    ) {
      throw new Error('--lease-seconds must be an integer from 1 through 300');
    }
    const store = new FilePluginLifecycleExecutionStoreV1(output);
    const envelope = await store.readPlan();
    if (!envelope.plan || !envelope.planSha256) {
      throw new Error('apply-compose requires a non-empty lifecycle plan');
    }
    const executionId = `compose-${envelope.desiredRevision}-${envelope.planSha256.slice(
      0,
      24,
    )}`;
    await store.initialize({
      executionId,
      occurredAt: new Date().toISOString(),
      supersedeExecutionRevision: optionalRevision(
        values,
        'supersede-execution-revision',
      ),
    });
    const execution = await runPluginLifecycleExecutionV1({
      store,
      adapter: new ComposePluginLifecyclePhaseAdapterV1({
        outputDirectory: output,
        projectDirectory,
        composeFiles,
        projectName: required(values, 'project-name'),
        utilityImage:
          values['utility-image']?.trim() ||
          process.env.EG_PLUGIN_INSTALLER_IMAGE?.trim() ||
          required(values, 'utility-image'),
        imageMode,
        docker: options.docker,
      }),
      owner:
        values.owner?.trim() ??
        `compose-worker-${process.pid}-${randomUUID()}`,
      leaseDurationMs: leaseSeconds * 1_000,
    });
    write(
      JSON.stringify({
        executionId: execution.executionId,
        revision: execution.revision,
        desiredRevision: execution.desiredRevision,
        pluginId: execution.pluginId,
        operation: execution.operation,
        status: execution.status,
        completedPhases: execution.completedPhases,
        nextPhase: execution.nextPhase ?? null,
        reasonCode: execution.reasonCode,
      }),
    );
    return execution.status === 'succeeded' ? 0 : 3;
  }
  if (command === 'apply-kubernetes') {
    const output = resolve(required(values, 'output'));
    const projectDirectory = resolve(
      required(values, 'project-directory'),
    );
    const chartPath = resolve(
      projectDirectory,
      required(values, 'chart'),
    );
    const valuesFile = resolve(
      projectDirectory,
      required(values, 'values'),
    );
    const namespace = required(values, 'namespace');
    const releaseName = required(values, 'release-name');
    const platform = values.platform?.trim() ?? 'kubernetes';
    if (platform !== 'kubernetes' && platform !== 'openshift') {
      throw new Error('--platform must be kubernetes or openshift');
    }
    const leaseSeconds = Number(values['lease-seconds'] ?? '120');
    if (
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 1 ||
      leaseSeconds > 300
    ) {
      throw new Error('--lease-seconds must be an integer from 1 through 300');
    }
    const rolloutTimeoutSeconds = Number(
      values['rollout-timeout-seconds'] ?? '300',
    );
    if (
      !Number.isInteger(rolloutTimeoutSeconds) ||
      rolloutTimeoutSeconds < 10 ||
      rolloutTimeoutSeconds > 1_800
    ) {
      throw new Error(
        '--rollout-timeout-seconds must be an integer from 10 through 1800',
      );
    }
    const artifactStorageMiB = Number(
      values['artifact-storage-mib'] ?? '2048',
    );
    if (
      !Number.isInteger(artifactStorageMiB) ||
      artifactStorageMiB < 64 ||
      artifactStorageMiB > 1_048_576
    ) {
      throw new Error(
        '--artifact-storage-mib must be an integer from 64 through 1048576',
      );
    }
    const imagePullSecrets = (
      values['image-pull-secrets'] ?? ''
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const planPath = resolve(output, 'plugin-lifecycle-plan.json');
    const store = new KubernetesPluginLifecycleExecutionStoreV1({
      namespace,
      planPath,
      workingDirectory: projectDirectory,
      context: values['kube-context'],
      command: options.cluster,
    });
    const envelope = await store.readPlan();
    if (!envelope.plan || !envelope.planSha256) {
      throw new Error(
        'apply-kubernetes requires a non-empty lifecycle plan',
      );
    }
    const executionId = `kubernetes-${envelope.desiredRevision}-${envelope.planSha256.slice(
      0,
      24,
    )}`;
    await store.initialize({
      executionId,
      occurredAt: new Date().toISOString(),
      supersedeExecutionRevision: optionalRevision(
        values,
        'supersede-execution-revision',
      ),
    });
    const execution = await runPluginLifecycleExecutionV1({
      store,
      adapter: new KubernetesPluginLifecyclePhaseAdapterV1({
        outputDirectory: output,
        projectDirectory,
        chartPath,
        valuesFile,
        namespace,
        releaseName,
        utilityImage:
          values['utility-image']?.trim() ||
          process.env.EG_PLUGIN_INSTALLER_IMAGE?.trim() ||
          required(values, 'utility-image'),
        context: values['kube-context'],
        artifactStorageMiB,
        storageClassName: values['storage-class'],
        imagePullSecrets,
        rolloutTimeoutSeconds,
        runAsUser: platform === 'openshift' ? null : 65_532,
        command: options.cluster,
      }),
      owner:
        values.owner?.trim() ??
        `kubernetes-worker-${process.pid}-${randomUUID()}`,
      leaseDurationMs: leaseSeconds * 1_000,
    });
    write(
      JSON.stringify({
        executionId: execution.executionId,
        revision: execution.revision,
        desiredRevision: execution.desiredRevision,
        pluginId: execution.pluginId,
        operation: execution.operation,
        status: execution.status,
        completedPhases: execution.completedPhases,
        nextPhase: execution.nextPhase ?? null,
        reasonCode: execution.reasonCode,
      }),
    );
    return execution.status === 'succeeded' ? 0 : 3;
  }

  const output = resolve(required(values, 'output'));
  const recovered = await recoverInterruptedOutputTransaction(output);
  if (lifecycleMutationCommands.has(command)) {
    await assertLifecycleMutationMayProceed(command, output, values);
  }
  let state = await loadState(output);
  const previousState = structuredClone(state);
  const occurredAt = new Date().toISOString();

  let stagedDirectory: string | undefined;
  if (
    command === 'install' ||
    command === 'upgrade' ||
    command === 'install-package' ||
    command === 'upgrade-package' ||
    command === 'install-airgap-package' ||
    command === 'upgrade-airgap-package'
  ) {
    let record;
    if (
      command === 'install-airgap-package' ||
      command === 'upgrade-airgap-package'
    ) {
      const airgap = await loadVerifiedAirgap(values);
      const registryMap = await loadVerifiedAirgapRegistryMap(
        required(values, 'registry-map'),
        airgap,
      );
      const staged = await stageVerifiedPackage(output, airgap.package);
      stagedDirectory = staged.stagedDirectory;
      state = withPluginImageMappingsV1(state, {
        ...state.imageMappings,
        ...Object.fromEntries(
          registryMap.mappings.map((mapping) => [
            mapping.source,
            mapping.target,
          ]),
        ),
      });
      record = {
        ...airgap.package.record,
        stagedAssetPath: staged.stagedAssetPath,
      };
    } else if (
      command === 'install-package' ||
      command === 'upgrade-package'
    ) {
      const loaded = await loadVerifiedPackage(values);
      const staged = await stageVerifiedPackage(output, loaded);
      stagedDirectory = staged.stagedDirectory;
      record = {
        ...loaded.record,
        stagedAssetPath: staged.stagedAssetPath,
      };
    } else {
      record = await loadInstallRecord(values);
    }
    try {
      state =
        command === 'install' ||
        command === 'install-package' ||
        command === 'install-airgap-package'
          ? installPluginV1(state, record, occurredAt)
          : upgradePluginV1(state, record, occurredAt);
    } catch (error) {
      if (stagedDirectory) {
        await rm(stagedDirectory, { recursive: true, force: true });
      }
      throw error;
    }
  } else if (command === 'enable' || command === 'disable') {
    state = setPluginEnabledV1(
      state,
      required(values, 'plugin') as PluginId,
      command === 'enable',
      occurredAt,
    );
  } else if (command === 'rollback') {
    state = rollbackPluginV1(
      state,
      required(values, 'plugin') as PluginId,
      occurredAt,
    );
  } else if (command === 'uninstall') {
    const dataAction = required(values, 'data-action');
    if (!['retain', 'export', 'delete'].includes(dataAction)) {
      throw new Error('--data-action must be retain, export, or delete');
    }
    state = uninstallPluginV1(
      state,
      required(values, 'plugin') as PluginId,
      dataAction as 'retain' | 'export' | 'delete',
      occurredAt,
    );
  } else if (command === 'status') {
    let lifecycleExecution = null;
    if (
      await exists(
        resolve(output, 'plugin-lifecycle-execution.json'),
      )
    ) {
      const executionStore =
        new FilePluginLifecycleExecutionStoreV1(output);
      const execution = await executionStore.read();
      lifecycleExecution =
        createPluginDeploymentExecutionObservationV1(
          await executionStore.readPlan(),
          execution,
        );
    }
    write(
      JSON.stringify(
        {
          revision: state.revision,
          plugins: Object.values(state.plugins).map((record) => ({
            pluginId: record.pluginId,
            version: record.version,
            enabled: record.enabled,
            bundle: record.bundle,
          })),
          lastOperation: state.history.at(-1) ?? null,
          lifecyclePlan: state.lifecyclePlan ?? null,
          lifecycleExecution,
          recoveredInterruptedTransaction: recovered,
        },
        null,
        2,
      ),
    );
    return 0;
  } else {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }

  try {
    await writeOutputs(output, state, previousState);
  } catch (error) {
    if (stagedDirectory) {
      await rm(stagedDirectory, { recursive: true, force: true });
    }
    throw error;
  }
  write(
    JSON.stringify({
      revision: state.revision,
      output,
      plugins: Object.keys(state.plugins).sort(),
      lifecyclePlan: resolve(output, 'plugin-lifecycle-plan.json'),
    }),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPluginInstallerCliV1(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'installer_error';
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`${code}: ${message}`);
      process.exitCode = 1;
    });
}
