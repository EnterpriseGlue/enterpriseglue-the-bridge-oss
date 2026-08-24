import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  ociDigestReferenceSchema,
} from '@enterpriseglue/plugin-sdk';
import { acquireSignedPluginOciDocumentV1 } from '@enterpriseglue/plugin-installer';
import {
  verifySignedPluginReleaseV1,
  type TrustedPluginSignerV1,
} from '@enterpriseglue/plugin-runtime/supply-chain';

import type { PluginReleaseResolverPortV1 } from './manager.js';

export interface FilePluginReleaseResolverOptionsV1 {
  root: string;
  trustFile: string;
  maximumBytes?: number;
}

export const pluginReleaseOciArtifactTypeV1 =
  'application/vnd.enterpriseglue.plugin.release.v1+json';

export interface OciPluginReleaseResolverOptionsV1 {
  trustFile: string;
  cosignPolicyFile: string;
  registryConfigFile?: string;
  registryCaFile?: string;
  maximumDownloadBytes?: number;
  allowPlainHttp?: boolean;
  allowInsecureTls?: boolean;
  acquisition?: typeof acquireSignedPluginOciDocumentV1;
}

interface VerifiedReleaseAcquisitionReceiptV1 {
  apiVersion: 'release-acquisition.plugin.enterpriseglue.io/v1';
  kind: 'EnterpriseGluePluginReleaseAcquisition';
  subject: string;
  artifactType: typeof pluginReleaseOciArtifactTypeV1;
  source: 'offline_import' | 'trusted_mirror';
  payloadSha256: string;
  signatureSha256: string;
  verifiedAt: string;
}

function parseAcquisitionReceipt(
  input: unknown,
): VerifiedReleaseAcquisitionReceiptV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('manager_release_acquisition_receipt_invalid');
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    'apiVersion',
    'kind',
    'subject',
    'artifactType',
    'source',
    'payloadSha256',
    'signatureSha256',
    'verifiedAt',
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.apiVersion !== 'release-acquisition.plugin.enterpriseglue.io/v1' ||
    value.kind !== 'EnterpriseGluePluginReleaseAcquisition' ||
    typeof value.subject !== 'string' ||
    value.artifactType !== pluginReleaseOciArtifactTypeV1 ||
    !['offline_import', 'trusted_mirror'].includes(String(value.source)) ||
    typeof value.payloadSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.payloadSha256) ||
    typeof value.signatureSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.signatureSha256) ||
    typeof value.verifiedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.verifiedAt))
  ) {
    throw new Error('manager_release_acquisition_receipt_invalid');
  }
  return value as unknown as VerifiedReleaseAcquisitionReceiptV1;
}

async function verifyReleaseFiles(input: {
  payload: Uint8Array;
  signature: unknown;
  trust: unknown;
}) {
  const signers = parseTrustedPluginSignersV1(input.trust);
  return verifySignedPluginReleaseV1({
    payload: input.payload,
    envelope: input.signature,
    trust: signers,
    maximumBytes: 1_048_576,
  }).release;
}

export function parseTrustedPluginSignersV1(
  input: unknown,
): TrustedPluginSignerV1[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !Array.isArray((input as { signers?: unknown }).signers)
  ) {
    throw new Error('manager_release_trust_invalid');
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
      throw new Error('manager_release_trust_invalid');
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

async function readRegularJsonFile(
  pathInput: string,
  maximumBytes: number,
): Promise<unknown> {
  const path = resolve(pathInput);
  const details = await lstat(path);
  if (
    !details.isFile() ||
    details.isSymbolicLink() ||
    details.size > maximumBytes
  ) {
    throw new Error('manager_release_companion_file_invalid');
  }
  const bytes = await readFile(path);
  if (bytes.byteLength > maximumBytes) {
    throw new Error('manager_release_companion_file_too_large');
  }
  return JSON.parse(bytes.toString('utf8'));
}

export class FilePluginReleaseResolverV1
  implements PluginReleaseResolverPortV1
{
  private readonly root: string;
  private readonly trustFile: string;
  private readonly maximumBytes: number;

  constructor(options: FilePluginReleaseResolverOptionsV1) {
    this.root = resolve(options.root);
    this.trustFile = resolve(options.trustFile);
    this.maximumBytes = options.maximumBytes ?? 1_048_576;
  }

  async resolve(releaseInput: string) {
    const release = ociDigestReferenceSchema.parse(releaseInput);
    const digest = release.slice(release.lastIndexOf(':') + 1);
    const rootPath = await realpath(this.root);
    const rootDetails = await lstat(rootPath);
    if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
      throw new Error('manager_release_root_invalid');
    }
    const deliveryRoot = resolve(rootPath, `sha256-${digest}`);
    const path = resolve(deliveryRoot, 'release.json');
    const signaturePath = resolve(deliveryRoot, 'release.signature.json');
    const receiptPath = resolve(deliveryRoot, 'release.acquisition.json');
    if (!path.startsWith(`${rootPath}/`)) {
      throw new Error('manager_release_path_invalid');
    }
    const details = await lstat(path);
    if (
      !details.isFile() ||
      details.isSymbolicLink() ||
      details.size > this.maximumBytes
    ) {
      throw new Error('manager_release_file_invalid');
    }
    const payload = await readFile(path);
    if (payload.byteLength > this.maximumBytes) {
      throw new Error('manager_release_file_too_large');
    }
    const [signatureBytes, receiptInput, trust] = await Promise.all([
      this.readBytesFile(signaturePath, 64 * 1024),
      this.readJsonFile(receiptPath, 64 * 1024),
      this.readJsonFile(this.trustFile, this.maximumBytes),
    ]);
    const signature = JSON.parse(signatureBytes.toString('utf8')) as unknown;
    const receipt = parseAcquisitionReceipt(receiptInput);
    if (
      receipt.subject !== release ||
      receipt.payloadSha256 !==
        createHash('sha256').update(payload).digest('hex') ||
      receipt.signatureSha256 !==
        createHash('sha256').update(signatureBytes).digest('hex')
    ) {
      throw new Error('manager_release_acquisition_receipt_mismatch');
    }
    const verified = await verifyReleaseFiles({ payload, signature, trust });
    if (verified.pluginId.length === 0) {
      throw new Error('manager_release_identity_invalid');
    }
    return verified;
  }

  private async readJsonFile(path: string, maximumBytes: number): Promise<unknown> {
    return JSON.parse(
      (await this.readBytesFile(path, maximumBytes)).toString('utf8'),
    );
  }

  private async readBytesFile(
    path: string,
    maximumBytes: number,
  ): Promise<Buffer> {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink() || details.size > maximumBytes) {
      throw new Error('manager_release_companion_file_invalid');
    }
    const payload = await readFile(path);
    if (payload.byteLength > maximumBytes) {
      throw new Error('manager_release_companion_file_too_large');
    }
    return payload;
  }

}

export class OciPluginReleaseResolverV1
  implements PluginReleaseResolverPortV1
{
  private readonly acquisition: typeof acquireSignedPluginOciDocumentV1;

  constructor(private readonly options: OciPluginReleaseResolverOptionsV1) {
    this.acquisition = options.acquisition ?? acquireSignedPluginOciDocumentV1;
  }

  async resolve(releaseInput: string) {
    const subject = ociDigestReferenceSchema.parse(releaseInput);
    const acquired = await this.acquisition({
      subject,
      artifactType: pluginReleaseOciArtifactTypeV1,
      expectedFiles: ['release.json', 'release.signature.json'],
      cosignPolicyFile: this.options.cosignPolicyFile,
      registryConfigFile: this.options.registryConfigFile,
      registryCaFile: this.options.registryCaFile,
      allowPlainHttp: this.options.allowPlainHttp,
      allowInsecureTls: this.options.allowInsecureTls,
      maximumDownloadBytes: Math.min(
        this.options.maximumDownloadBytes ?? 2 * 1024 ** 2,
        2 * 1024 ** 2,
      ),
    });
    try {
      const [payload, signature, trust] = await Promise.all([
        readFile(resolve(acquired.root, 'release.json')),
        readFile(resolve(acquired.root, 'release.signature.json')).then(
          (bytes) => JSON.parse(bytes.toString('utf8')),
        ),
        readRegularJsonFile(this.options.trustFile, 1_048_576),
      ]);
      return await verifyReleaseFiles({ payload, signature, trust });
    } finally {
      await acquired.cleanup();
    }
  }
}

export class SourceAwarePluginReleaseResolverV1
  implements PluginReleaseResolverPortV1
{
  constructor(
    private readonly connected: PluginReleaseResolverPortV1,
    private readonly offline: PluginReleaseResolverPortV1,
  ) {}

  resolve(
    release: string,
    source: Parameters<PluginReleaseResolverPortV1['resolve']>[1],
  ) {
    return source === 'offline_delivery'
      ? this.offline.resolve(release, source)
      : this.connected.resolve(release, source);
  }
}
