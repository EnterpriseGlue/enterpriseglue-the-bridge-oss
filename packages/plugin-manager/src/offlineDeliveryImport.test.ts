import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { importPluginOfflineDeliveryV1 } from './offlineDeliveryImport.js';

const roots: string[] = [];
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'eg-offline-delivery-'));
  const intake = await mkdtemp(join(tmpdir(), 'eg-offline-intake-'));
  roots.push(root, intake);
  await mkdir(join(root, 'airgap'), { recursive: true });
  const files = new Map<string, Buffer>([
    ['release.json', Buffer.from('{"release":true}')],
    ['release.signature.json', Buffer.from('{"signature":true}')],
    ['airgap-registry-map.json', Buffer.from('{"mappings":[]}')],
    ['airgap/index.json', Buffer.from('{"index":true}')],
  ]);
  for (const [path, bytes] of files) await writeFile(join(root, path), bytes);
  const release = `registry.example/releases/example@sha256:${'a'.repeat(64)}`;
  const manifest = Buffer.from(
    JSON.stringify({
      apiVersion: 'offline-delivery.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginOfflineDelivery',
      deliveryId: 'delivery-001',
      release,
      generatedAt: '2026-08-24T00:00:00.000Z',
      expiresAt: '2026-09-24T00:00:00.000Z',
      files: [...files].map(([path, bytes]) => ({
        path,
        role:
          path === 'release.json'
            ? 'release_metadata'
            : path === 'release.signature.json'
              ? 'release_signature'
              : path === 'airgap-registry-map.json'
                ? 'registry_map'
                : 'airgap_content',
        sizeBytes: bytes.byteLength,
        sha256: sha256(bytes),
      })),
    }),
  );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  await writeFile(join(root, 'delivery.json'), manifest);
  await writeFile(
    join(root, 'delivery.signature.json'),
    JSON.stringify({
      apiVersion: 'signature.plugin.enterpriseglue.io/v1',
      algorithm: 'Ed25519',
      publisher: 'io.enterpriseglue',
      keyId: 'delivery-key-1',
      payloadSha256: sha256(manifest),
      signature: sign(null, manifest, privateKey).toString('base64url'),
    }),
  );
  const trustFile = join(intake, 'trust.json');
  await writeFile(
    trustFile,
    JSON.stringify({
      signers: [
        {
          publisher: 'io.enterpriseglue',
          keyId: 'delivery-key-1',
          publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
          status: 'active',
        },
      ],
    }),
  );
  return { root, intake, trustFile, release };
}

describe('importPluginOfflineDeliveryV1', () => {
  it('verifies the signed outer inventory and creates a digest-selected local intake', async () => {
    const input = await fixture();
    const receipt = await importPluginOfflineDeliveryV1({
      deliveryRoot: input.root,
      intakeRoot: input.intake,
      trustFile: input.trustFile,
      now: () => new Date('2026-08-24T12:00:00.000Z'),
    });
    expect(receipt).toMatchObject({
      requestId: 'delivery-001',
      importedArtifacts: [input.release],
      result: 'verified',
    });
    const target = join(input.intake, `sha256-${'a'.repeat(64)}`);
    await expect(
      readFile(join(target, 'release.acquisition.json'), 'utf8'),
    ).resolves.toContain(input.release);
    await expect(
      readFile(join(target, 'airgap/index.json'), 'utf8'),
    ).resolves.toContain('index');
  });

  it('rejects content changed after the outer inventory was signed', async () => {
    const input = await fixture();
    await writeFile(join(input.root, 'airgap/index.json'), 'tampered');
    await expect(
      importPluginOfflineDeliveryV1({
        deliveryRoot: input.root,
        intakeRoot: input.intake,
        trustFile: input.trustFile,
        now: () => new Date('2026-08-24T12:00:00.000Z'),
      }),
    ).rejects.toThrow('offline_delivery_artifact_mismatch');
  });
});
