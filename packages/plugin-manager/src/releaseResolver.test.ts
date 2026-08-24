import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FilePluginReleaseResolverV1,
  OciPluginReleaseResolverV1,
  pluginReleaseOciArtifactTypeV1,
} from './releaseResolver.js';

const roots: string[] = [];
const subject = (name: string, character: string) =>
  `registry.example/enterpriseglue/${name}@sha256:${character.repeat(64)}`;

function release() {
  return {
    apiVersion: 'release.plugin.enterpriseglue.io/v1' as const,
    kind: 'EnterpriseGluePluginRelease' as const,
    pluginId: 'io.enterpriseglue.example',
    publisher: 'io.enterpriseglue',
    version: '1.0.0',
    channel: 'stable' as const,
    releaseState: 'available' as const,
    package: subject('package', '1'),
    artifacts: [{ role: 'package' as const, subject: subject('package', '1'), mediaType: 'application/vnd.enterpriseglue.plugin.package.v1+tar', platforms: [{ os: 'linux' as const, architecture: 'amd64' as const }] }],
    compatibility: {
      hostRange: '^0.15.0', hostApiRange: '^1.0.0', sdkRange: '^0.3.0', deploymentModes: ['kubernetes' as const], architectures: ['amd64' as const],
      evidence: [{ hostVersion: '0.15.0', hostArtifact: subject('backend', '2'), deploymentMode: 'kubernetes' as const, platform: 'kubernetes' as const, architecture: 'amd64' as const, database: 'postgres' as const, suiteRevision: 'acceptance-v1', testedAt: '2026-08-24T00:00:00.000Z', evidenceSha256: '3'.repeat(64) }],
    },
    dependencies: [], conflicts: [], requiredCapabilities: [], permissions: [],
    data: { reads: [], generates: [], retentionClass: 'none' as const, leavesDeployment: false },
    infrastructure: { storageMiB: 0, cpuLimit: '250m', memoryLimitMiB: 256, egressPolicy: 'none', secretReferences: [] },
    schemaTransition: { from: 0, to: 0, rollbackClass: 'stateless' as const, backupRequired: false, downtimeExpected: false },
    support: { startsAt: '2026-08-24T00:00:00.000Z', endsAt: '2027-08-24T00:00:00.000Z', reasonCode: 'none' as const },
    evidence: { signature: subject('signature', '4'), provenance: subject('provenance', '5'), sbom: subject('sbom', '6'), scan: subject('scan', '7'), license: subject('license', '8') },
    updateEdges: [],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FilePluginReleaseResolverV1', () => {
  it('binds an immutable reference to signed release bytes and trusted publisher identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-plugin-release-'));
    roots.push(root);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = Buffer.from(JSON.stringify(release()), 'utf8');
    const digest = 'a'.repeat(64);
    const reference = `registry.example/releases/example@sha256:${digest}`;
    const delivery = join(root, `sha256-${digest}`);
    await mkdir(delivery);
    await writeFile(join(delivery, 'release.json'), payload, { mode: 0o600 });
    const signatureBytes = Buffer.from(JSON.stringify({
      apiVersion: 'signature.plugin.enterpriseglue.io/v1',
      algorithm: 'Ed25519',
      publisher: 'io.enterpriseglue',
      keyId: 'release-key-1',
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      signature: sign(null, payload, privateKey).toString('base64url'),
    }));
    await writeFile(join(delivery, 'release.signature.json'), signatureBytes, { mode: 0o600 });
    await writeFile(join(delivery, 'release.acquisition.json'), JSON.stringify({
      apiVersion: 'release-acquisition.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginReleaseAcquisition',
      subject: reference,
      artifactType: pluginReleaseOciArtifactTypeV1,
      source: 'offline_import',
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      signatureSha256: createHash('sha256').update(signatureBytes).digest('hex'),
      verifiedAt: '2026-08-24T00:00:00.000Z',
    }), { mode: 0o600 });
    const trustFile = join(root, 'trust.json');
    await writeFile(trustFile, JSON.stringify({ signers: [{ publisher: 'io.enterpriseglue', keyId: 'release-key-1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), status: 'active' }] }), { mode: 0o600 });

    const resolver = new FilePluginReleaseResolverV1({ root, trustFile });
    await expect(resolver.resolve(reference)).resolves.toMatchObject({
      pluginId: 'io.enterpriseglue.example',
      package: subject('package', '1'),
    });
  });

  it('rejects a release whose verified acquisition receipt does not bind its bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-plugin-release-'));
    roots.push(root);
    const wrongDigest = 'f'.repeat(64);
    const delivery = join(root, `sha256-${wrongDigest}`);
    await mkdir(delivery);
    await writeFile(join(delivery, 'release.json'), JSON.stringify(release()), { mode: 0o600 });
    await writeFile(join(delivery, 'release.signature.json'), '{}', { mode: 0o600 });
    await writeFile(join(delivery, 'release.acquisition.json'), JSON.stringify({
      apiVersion: 'release-acquisition.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginReleaseAcquisition',
      subject: `registry.example/releases/example@sha256:${wrongDigest}`,
      artifactType: pluginReleaseOciArtifactTypeV1,
      source: 'offline_import',
      payloadSha256: '0'.repeat(64),
      signatureSha256: '0'.repeat(64),
      verifiedAt: '2026-08-24T00:00:00.000Z',
    }), { mode: 0o600 });
    await writeFile(join(root, 'trust.json'), JSON.stringify({ signers: [] }), { mode: 0o600 });
    const resolver = new FilePluginReleaseResolverV1({ root, trustFile: join(root, 'trust.json') });
    await expect(resolver.resolve(`registry.example/releases/example@sha256:${wrongDigest}`)).rejects.toThrow('manager_release_acquisition_receipt_mismatch');
  });

  it('resolves a connected release only after immutable OCI and document signatures verify', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eg-plugin-release-oci-'));
    roots.push(root);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const payload = Buffer.from(JSON.stringify(release()), 'utf8');
    const signature = {
      apiVersion: 'signature.plugin.enterpriseglue.io/v1',
      algorithm: 'Ed25519',
      publisher: 'io.enterpriseglue',
      keyId: 'release-key-1',
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      signature: sign(null, payload, privateKey).toString('base64url'),
    };
    await writeFile(join(root, 'release.json'), payload);
    await writeFile(join(root, 'release.signature.json'), JSON.stringify(signature));
    const trustFile = join(root, 'trust.json');
    await writeFile(trustFile, JSON.stringify({ signers: [{ publisher: 'io.enterpriseglue', keyId: 'release-key-1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), status: 'active' }] }));
    let cleaned = false;
    const reference = `registry.example/releases/example@sha256:${'b'.repeat(64)}`;
    const resolver = new OciPluginReleaseResolverV1({
      trustFile,
      cosignPolicyFile: join(root, 'cosign-policy.json'),
      acquisition: async (input) => {
        expect(input).toMatchObject({
          subject: reference,
          artifactType: pluginReleaseOciArtifactTypeV1,
          expectedFiles: ['release.json', 'release.signature.json'],
        });
        return {
          root,
          receipt: {
            subject: reference,
            subjectDigest: `sha256:${'b'.repeat(64)}`,
            artifactType: pluginReleaseOciArtifactTypeV1,
            files: [],
            cosignMode: 'keyless',
          },
          cleanup: async () => { cleaned = true; },
        };
      },
    });
    await expect(resolver.resolve(reference, 'connected_registry')).resolves.toMatchObject({
      pluginId: 'io.enterpriseglue.example',
      version: '1.0.0',
    });
    expect(cleaned).toBe(true);
  });
});
