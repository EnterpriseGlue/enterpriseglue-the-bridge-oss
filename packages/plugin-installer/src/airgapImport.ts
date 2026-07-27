import { lstat, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import {
  pluginAirgapIndexV1Schema,
  pluginAirgapRegistryMapV1Schema,
  type PluginAirgapIndexV1,
  type PluginAirgapRegistryMapV1,
} from '@enterpriseglue/plugin-sdk';

import {
  SpawnOciAcquisitionCommandPortV1,
  type OciAcquisitionCommandPortV1,
} from './ociAcquisition.js';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const maximumDescriptorBytes = 64 * 1024;

export interface ImportPluginAirgapArchivesInputV1 {
  airgapRoot: string;
  index: PluginAirgapIndexV1;
  registryMap: PluginAirgapRegistryMapV1;
  registryConfigFile?: string;
  registryCaFile?: string;
  allowPlainHttp?: boolean;
  allowInsecureTls?: boolean;
  command?: OciAcquisitionCommandPortV1;
}

export interface PluginAirgapArchiveImportReceiptV1 {
  source: string;
  target: string;
  digest: string;
  archivePath: string;
}

export interface PluginAirgapArchiveImportResultV1 {
  catalogRevision: string;
  artifactCount: number;
  receipts: PluginAirgapArchiveImportReceiptV1[];
}

function digestOf(reference: string): string {
  const digest = reference.slice(reference.lastIndexOf('@') + 1);
  if (!digestPattern.test(digest)) {
    throw new Error('Air-gap reference does not contain a valid SHA-256 digest');
  }
  return digest;
}

function repositoryOf(reference: string): string {
  return reference.slice(0, reference.lastIndexOf('@sha256:'));
}

function importTag(digest: string): string {
  return `eg-airgap-${digest.replace(':', '-')}`;
}

function parseDescriptorDigest(output: string, label: string): string {
  if (Buffer.byteLength(output) > maximumDescriptorBytes) {
    throw new Error(`${label} descriptor exceeded the bounded output limit`);
  }
  let descriptor: unknown;
  try {
    descriptor = JSON.parse(output);
  } catch {
    throw new Error(`${label} descriptor was not valid JSON`);
  }
  const digest =
    descriptor &&
    typeof descriptor === 'object' &&
    !Array.isArray(descriptor) &&
    typeof (descriptor as { digest?: unknown }).digest === 'string'
      ? (descriptor as { digest: string }).digest
      : '';
  if (!digestPattern.test(digest)) {
    throw new Error(`${label} descriptor omitted a valid SHA-256 digest`);
  }
  return digest;
}

async function regularFile(pathInput: string, label: string): Promise<string> {
  const path = resolve(pathInput);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must identify a regular non-symlink file`);
  }
  return realpath(path);
}

async function archiveFile(
  rootInput: string,
  archivePath: string,
): Promise<string> {
  const root = await realpath(resolve(rootInput));
  const path = await regularFile(
    resolve(root, archivePath),
    'Air-gap OCI-layout archive',
  );
  const pathFromRoot = relative(root, path);
  if (
    pathFromRoot.startsWith('..') ||
    pathFromRoot === '' ||
    resolve(root, pathFromRoot) !== path
  ) {
    throw new Error('Air-gap OCI-layout archive escapes the verified root');
  }
  return path;
}

export async function importPluginAirgapArchivesV1(
  input: ImportPluginAirgapArchivesInputV1,
): Promise<PluginAirgapArchiveImportResultV1> {
  if (input.allowPlainHttp && input.allowInsecureTls) {
    throw new Error('Plain HTTP and insecure TLS modes are mutually exclusive');
  }
  const index = pluginAirgapIndexV1Schema.parse(input.index);
  const registryMap = pluginAirgapRegistryMapV1Schema.parse(
    input.registryMap,
  );
  if (registryMap.catalogRevision !== index.catalogRevision) {
    throw new Error('Air-gap registry map uses another catalog revision');
  }
  const mappings = new Map(
    registryMap.mappings.map((mapping) => [mapping.source, mapping]),
  );
  if (mappings.size !== index.artifacts.length) {
    throw new Error('Air-gap registry map does not cover the exact artifact set');
  }
  const registryConfigFile = input.registryConfigFile
    ? await regularFile(
        input.registryConfigFile,
        'OCI registry configuration',
      )
    : undefined;
  const registryCaFile = input.registryCaFile
    ? await regularFile(input.registryCaFile, 'OCI registry CA')
    : undefined;
  const command =
    input.command ?? new SpawnOciAcquisitionCommandPortV1();
  const copyRegistryArgs = [
    ...(registryConfigFile
      ? ['--to-registry-config', registryConfigFile]
      : []),
    ...(registryCaFile ? ['--to-ca-file', registryCaFile] : []),
    ...(input.allowPlainHttp ? ['--to-plain-http'] : []),
    ...(input.allowInsecureTls ? ['--to-insecure'] : []),
  ];
  const fetchRegistryArgs = [
    ...(registryConfigFile
      ? ['--registry-config', registryConfigFile]
      : []),
    ...(registryCaFile ? ['--ca-file', registryCaFile] : []),
    ...(input.allowPlainHttp ? ['--plain-http'] : []),
    ...(input.allowInsecureTls ? ['--insecure'] : []),
  ];
  const receipts: PluginAirgapArchiveImportReceiptV1[] = [];

  for (const artifact of index.artifacts) {
    const mapping = mappings.get(artifact.source);
    if (!mapping || mapping.archivePath !== artifact.archivePath) {
      throw new Error(
        'Air-gap registry map source/archive differs from the signed index',
      );
    }
    const digest = digestOf(artifact.source);
    if (digestOf(mapping.target) !== digest) {
      throw new Error('Air-gap registry mapping changed the source digest');
    }
    const archive = await archiveFile(
      input.airgapRoot,
      artifact.archivePath,
    );
    const localDescriptor = await command.run(
      'oras',
      [
        'manifest',
        'fetch',
        '--oci-layout',
        '--descriptor',
        `${archive}@${digest}`,
      ],
      { timeoutMs: 60_000 },
    );
    if (
      parseDescriptorDigest(
        localDescriptor.stdout,
        'Air-gap archive',
      ) !== digest
    ) {
      throw new Error(
        `Air-gap archive does not contain its indexed digest: ${artifact.archivePath}`,
      );
    }

    const targetTag = `${repositoryOf(mapping.target)}:${importTag(digest)}`;
    await command.run(
      'oras',
      [
        'cp',
        '--from-oci-layout',
        '--no-tty',
        ...copyRegistryArgs,
        `${archive}@${digest}`,
        targetTag,
      ],
      { timeoutMs: 30 * 60_000 },
    );
    const targetDescriptor = await command.run(
      'oras',
      [
        'manifest',
        'fetch',
        '--descriptor',
        ...fetchRegistryArgs,
        targetTag,
      ],
      { timeoutMs: 60_000 },
    );
    if (
      parseDescriptorDigest(
        targetDescriptor.stdout,
        'Imported registry',
      ) !== digest
    ) {
      throw new Error(
        `Imported registry digest differs from the signed archive: ${artifact.archivePath}`,
      );
    }
    receipts.push({
      source: artifact.source,
      target: mapping.target,
      digest,
      archivePath: artifact.archivePath,
    });
  }

  return {
    catalogRevision: index.catalogRevision,
    artifactCount: receipts.length,
    receipts,
  };
}
