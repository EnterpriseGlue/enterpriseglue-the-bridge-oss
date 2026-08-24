import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import {
  pluginOfflineDeliveryManifestV1Schema,
  pluginOfflineDeliveryReceiptV1Schema,
  type PluginOfflineDeliveryReceiptV1,
} from '@enterpriseglue/plugin-sdk/manager';
import { verifySignedJsonPayloadV1 } from '@enterpriseglue/plugin-runtime/supply-chain';

import {
  parseTrustedPluginSignersV1,
  pluginReleaseOciArtifactTypeV1,
} from './releaseResolver.js';
import { readManagerSecureBytesFileV1 } from './secureFile.js';

const manifestFile = 'delivery.json';
const signatureFile = 'delivery.signature.json';

export interface ImportPluginOfflineDeliveryOptionsV1 {
  deliveryRoot: string;
  intakeRoot: string;
  trustFile: string;
  maximumBytes?: number;
  now?: () => Date;
}

async function regularBytes(path: string, maximumBytes: number): Promise<Buffer> {
  const bytes = await readManagerSecureBytesFileV1(path, maximumBytes);
  if (bytes.byteLength < 1) {
    throw new Error('offline_delivery_control_file_invalid');
  }
  return bytes;
}

async function inventoryFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name);
    const path = relative(root, target).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) {
      throw new Error('offline_delivery_symlink_forbidden');
    }
    if (entry.isDirectory()) {
      files.push(...(await inventoryFiles(root, target)));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error('offline_delivery_file_type_forbidden');
    }
  }
  return files.sort();
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

function assertExactInventory(actual: string[], expected: string[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((path, index) => path !== expected[index])
  ) {
    throw new Error('offline_delivery_inventory_mismatch');
  }
}

export async function importPluginOfflineDeliveryV1(
  options: ImportPluginOfflineDeliveryOptionsV1,
): Promise<PluginOfflineDeliveryReceiptV1> {
  const maximumBytes = options.maximumBytes ?? 20 * 1024 ** 3;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1024 ** 2 ||
    maximumBytes > 100 * 1024 ** 3
  ) {
    throw new Error('offline_delivery_maximum_bytes_invalid');
  }
  const deliveryRoot = await realpath(resolve(options.deliveryRoot));
  const deliveryDetails = await lstat(deliveryRoot);
  if (!deliveryDetails.isDirectory() || deliveryDetails.isSymbolicLink()) {
    throw new Error('offline_delivery_root_invalid');
  }
  const [manifestBytes, signatureBytes, trustBytes] = await Promise.all([
    regularBytes(resolve(deliveryRoot, manifestFile), 5 * 1024 ** 2),
    regularBytes(resolve(deliveryRoot, signatureFile), 64 * 1024),
    regularBytes(resolve(options.trustFile), 1024 ** 2),
  ]);
  const verified = verifySignedJsonPayloadV1(
    manifestBytes,
    JSON.parse(signatureBytes.toString('utf8')),
    pluginOfflineDeliveryManifestV1Schema,
    parseTrustedPluginSignersV1(JSON.parse(trustBytes.toString('utf8'))),
    5 * 1024 ** 2,
  );
  const delivery = verified.data;
  const now = options.now?.() ?? new Date();
  if (Date.parse(delivery.expiresAt) <= now.getTime()) {
    throw new Error('offline_delivery_expired');
  }
  for (const file of delivery.files) {
    if (
      (file.role === 'airgap_content' && !file.path.startsWith('airgap/')) ||
      (file.role !== 'airgap_content' && file.path.startsWith('airgap/'))
    ) {
      throw new Error('offline_delivery_role_path_mismatch');
    }
  }
  assertExactInventory(
    await inventoryFiles(deliveryRoot),
    [manifestFile, signatureFile, ...delivery.files.map((file) => file.path)].sort(),
  );
  let observedBytes = manifestBytes.byteLength + signatureBytes.byteLength;
  for (const file of delivery.files) {
    const target = resolve(deliveryRoot, file.path);
    if (
      target === deliveryRoot ||
      !target.startsWith(`${deliveryRoot}${sep}`)
    ) {
      throw new Error('offline_delivery_path_invalid');
    }
    const observed = await digestFile(target);
    observedBytes += observed.sizeBytes;
    if (
      observedBytes > maximumBytes ||
      observed.sizeBytes !== file.sizeBytes ||
      observed.sha256 !== file.sha256
    ) {
      throw new Error('offline_delivery_artifact_mismatch');
    }
  }

  const intakeRoot = resolve(options.intakeRoot);
  await mkdir(intakeRoot, { recursive: true, mode: 0o700 });
  const intakeDetails = await lstat(intakeRoot);
  if (!intakeDetails.isDirectory() || intakeDetails.isSymbolicLink()) {
    throw new Error('offline_delivery_intake_invalid');
  }
  const digest = delivery.release.slice(delivery.release.lastIndexOf(':') + 1);
  const target = resolve(intakeRoot, `sha256-${digest}`);
  const temporary = resolve(intakeRoot, `.import-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const file of delivery.files) {
      const destination = resolve(temporary, file.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(resolve(deliveryRoot, file.path), destination);
      await chmod(destination, 0o600);
    }
    const payloadSha256 = createHash('sha256')
      .update(await readFile(resolve(temporary, 'release.json')))
      .digest('hex');
    const signatureSha256 = createHash('sha256')
      .update(await readFile(resolve(temporary, 'release.signature.json')))
      .digest('hex');
    await writeFile(
      resolve(temporary, 'release.acquisition.json'),
      `${JSON.stringify(
        {
          apiVersion: 'release-acquisition.plugin.enterpriseglue.io/v1',
          kind: 'EnterpriseGluePluginReleaseAcquisition',
          subject: delivery.release,
          artifactType: pluginReleaseOciArtifactTypeV1,
          source: 'offline_import',
          payloadSha256,
          signatureSha256,
          verifiedAt: now.toISOString(),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    try {
      await rename(temporary, target);
    } catch (error) {
      const existing = await lstat(target).catch(() => undefined);
      if (!existing?.isDirectory() || existing.isSymbolicLink()) throw error;
      const existingReceipt = JSON.parse(
        await readFile(resolve(target, 'release.acquisition.json'), 'utf8'),
      ) as { subject?: unknown; payloadSha256?: unknown };
      if (
        existingReceipt.subject !== delivery.release ||
        existingReceipt.payloadSha256 !== payloadSha256
      ) {
        throw new Error('offline_delivery_existing_import_conflict');
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return pluginOfflineDeliveryReceiptV1Schema.parse({
    apiVersion: 'offline-delivery-receipt.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginOfflineDeliveryReceipt',
    requestId: delivery.deliveryId,
    deliverySha256: createHash('sha256').update(manifestBytes).digest('hex'),
    importedArtifacts: [delivery.release],
    result: 'verified',
    reasonCode: 'none',
    completedAt: now.toISOString(),
  });
}
