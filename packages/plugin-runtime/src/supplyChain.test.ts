import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertPluginCatalogCompatibilityMatrixV1,
  assertPluginReleaseTestedHostV1,
  selectPluginCatalogReleaseV1,
  verifyArtifactBytesV1,
  verifySignedPluginCatalogV1,
  verifySignedPluginCompatibilityMatrixV1,
  verifySignedPluginPackageIndexV1,
  type TrustedPluginSignerV1,
} from './supplyChain.js';

const hash = '2'.repeat(64);
const pluginId = 'io.enterpriseglue.example';

function catalog(revoked = false) {
  return {
    apiVersion: 'catalog.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginCatalog',
    metadata: {
      revision: '1.0.0',
      generatedAt: '2026-07-24T00:00:00.000Z',
      expiresAt: '2026-08-24T00:00:00.000Z',
    },
    entries: [
      {
        pluginId,
        displayName: 'Example',
        publisher: 'io.enterpriseglue',
        releases: [
          {
            version: '1.0.0',
            channel: 'stable',
            bundle: `registry.example/plugins/example@sha256:${hash}`,
            manifestSha256: hash,
            hostCompatibility: '^0.4.0',
            testedHostVersions: ['0.4.5', '0.4.6'],
            sdkCompatibility: '^0.1.0',
            revoked,
            revocationReasonCode: revoked ? 'security' : 'none',
          },
        ],
      },
    ],
  };
}

function compatibilityCatalog() {
  const value = catalog();
  const current = value.entries[0]!.releases[0]!;
  current.version = '1.1.0';
  current.testedHostVersions = ['0.4.5', '0.4.6'];
  value.entries[0]!.releases.push({
    ...structuredClone(current),
    version: '1.0.0',
    bundle: `registry.example/plugins/example@sha256:${'3'.repeat(64)}`,
    manifestSha256: '4'.repeat(64),
  });
  return value;
}

function compatibilityMatrix() {
  return {
    apiVersion: 'compatibility-matrix.plugin.enterpriseglue.io/v1',
    kind: 'EnterpriseGluePluginCompatibilityMatrix',
    metadata: {
      revision: '1.0.0',
      generatedAt: '2026-07-25T02:00:00.000Z',
    },
    pluginId,
    publisher: 'io.enterpriseglue',
    hostVersions: {
      current: '0.4.6',
      previous: '0.4.5',
    },
    pluginVersions: {
      current: '1.1.0',
      previous: '1.0.0',
    },
    cells: ['0.4.6', '0.4.5'].flatMap((hostVersion) =>
      ['1.1.0', '1.0.0'].map((pluginVersion, index) => ({
        hostVersion,
        pluginVersion,
        hostArtifact: `registry.example/enterpriseglue/host@sha256:${
          hostVersion === '0.4.6' ? '5'.repeat(64) : '6'.repeat(64)
        }`,
        pluginArtifact: `registry.example/plugins/example@sha256:${
          pluginVersion === '1.1.0' ? hash : '3'.repeat(64)
        }`,
        result: 'passed',
        suiteRevision: 'plugin-acceptance-v1',
        testedAt: '2026-07-25T01:00:00.000Z',
        evidenceSha256: `${hostVersion === '0.4.6' ? 'a' : 'b'}${
          index === 0 ? '1' : '2'
        }`.padEnd(64, '0'),
      })),
    ),
  };
}

function signed(
  value: unknown,
  privateKey: KeyObject,
  publicKey: KeyObject,
  status: TrustedPluginSignerV1['status'] = 'active',
) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  const payloadSha256 = createHash('sha256').update(payload).digest('hex');
  return {
    payload,
    envelope: {
      apiVersion: 'signature.plugin.enterpriseglue.io/v1',
      algorithm: 'Ed25519',
      publisher: 'io.enterpriseglue',
      keyId: 'release-key-1',
      payloadSha256,
      signature: sign(null, payload, privateKey).toString('base64url'),
    },
    trust: [
      {
        publisher: 'io.enterpriseglue',
        keyId: 'release-key-1',
        publicKey,
        status,
      },
    ] satisfies TrustedPluginSignerV1[],
  };
}

describe('plugin supply-chain verification', () => {
  it('verifies a trusted signed catalog and selects an active release', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const input = signed(catalog(), privateKey, publicKey);
    const verified = verifySignedPluginCatalogV1({
      ...input,
      now: new Date('2026-07-25T00:00:00.000Z'),
    });

    const release = selectPluginCatalogReleaseV1(
      verified,
      pluginId,
      '1.0.0',
    );
    expect(release.version).toBe('1.0.0');
    expect(() =>
      assertPluginReleaseTestedHostV1(release, '0.4.6'),
    ).not.toThrow();
    expect(() =>
      assertPluginReleaseTestedHostV1(release, '0.4.4'),
    ).toThrowError(expect.objectContaining({ code: 'host_version_not_tested' }));
    expect(() =>
      assertPluginReleaseTestedHostV1(
        {
          ...release,
          hostCompatibility: '>=9.0.0 <10.0.0',
        },
        '0.4.6',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'host_version_incompatible' }),
    );
    expect(() =>
      assertPluginReleaseTestedHostV1(
        {
          ...release,
          hostCompatibility: 'not-a-range',
        },
        '0.4.6',
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'host_compatibility_invalid' }),
    );
  });

  it('rejects tampering, inactive signer, expiry, and revoked release', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const input = signed(catalog(), privateKey, publicKey);
    const tampered = Buffer.from(input.payload);
    tampered[0] ^= 1;
    expect(() =>
      verifySignedPluginCatalogV1({
        ...input,
        payload: tampered,
        now: new Date('2026-07-25T00:00:00.000Z'),
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'payload_digest_invalid' }),
    );

    expect(() =>
      verifySignedPluginCatalogV1({
        ...signed(catalog(), privateKey, publicKey, 'revoked'),
        now: new Date('2026-07-25T00:00:00.000Z'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'signer_inactive' }));

    expect(() =>
      verifySignedPluginCatalogV1({
        ...input,
        now: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'catalog_expired' }));

    const revokedInput = signed(catalog(true), privateKey, publicKey);
    const verified = verifySignedPluginCatalogV1({
      ...revokedInput,
      now: new Date('2026-07-25T00:00:00.000Z'),
    });
    expect(() =>
      selectPluginCatalogReleaseV1(verified, pluginId, '1.0.0'),
    ).toThrowError(expect.objectContaining({ code: 'release_revoked' }));
  });

  it('checks offline artifact size and digest exactly', () => {
    const payload = Buffer.from('immutable artifact');
    const expected = {
      sizeBytes: payload.byteLength,
      sha256: createHash('sha256').update(payload).digest('hex'),
    };

    expect(() => verifyArtifactBytesV1(payload, expected)).not.toThrow();
    expect(() =>
      verifyArtifactBytesV1(Buffer.from('different'), expected),
    ).toThrowError(expect.objectContaining({ code: 'artifact_size_invalid' }));
    expect(() =>
      verifyArtifactBytesV1(payload, {
        ...expected,
        sha256: '0'.repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ code: 'artifact_digest_invalid' }));
  });

  it('verifies a signed private plugin package index and exposes signer identity', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const input = signed(
      {
        apiVersion: 'package.plugin.enterpriseglue.io/v1',
        kind: 'EnterpriseGluePluginPackageIndex',
        pluginId,
        version: '1.0.0',
        catalogRevision: '1.0.0',
        generatedAt: '2026-07-24T00:00:00.000Z',
        manifestPath: 'plugin.yaml',
        resourcesPath: 'deploy/resources.json',
        files: [
          {
            path: 'plugin.yaml',
            role: 'runtime',
            sizeBytes: 1,
            sha256: hash,
          },
          {
            path: 'deploy/resources.json',
            role: 'runtime',
            sizeBytes: 1,
            sha256: hash,
          },
        ],
      },
      privateKey,
      publicKey,
    );
    const verified = verifySignedPluginPackageIndexV1(input);
    expect(verified.index.pluginId).toBe(pluginId);
    expect(verified.envelope.publisher).toBe('io.enterpriseglue');
  });

  it('verifies and cross-checks a signed four-cell compatibility matrix', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const verifiedCatalog = verifySignedPluginCatalogV1({
      ...signed(compatibilityCatalog(), privateKey, publicKey),
      now: new Date('2026-07-25T03:00:00.000Z'),
    });
    const verifiedMatrix = verifySignedPluginCompatibilityMatrixV1(
      signed(compatibilityMatrix(), privateKey, publicKey),
    );

    expect(() =>
      assertPluginCatalogCompatibilityMatrixV1({
        catalog: verifiedCatalog,
        matrix: verifiedMatrix.matrix,
      }),
    ).not.toThrow();
  });

  it('rejects matrix version order, signer drift, and incomplete catalog claims', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const reversed = compatibilityMatrix();
    reversed.pluginVersions = {
      current: '1.0.0',
      previous: '1.1.0',
    };
    reversed.cells = ['0.4.6', '0.4.5'].flatMap((hostVersion) =>
      ['1.0.0', '1.1.0'].map((pluginVersion, index) => ({
        hostVersion,
        pluginVersion,
        hostArtifact: `registry.example/enterpriseglue/host@sha256:${
          hostVersion === '0.4.6' ? '5'.repeat(64) : '6'.repeat(64)
        }`,
        pluginArtifact: `registry.example/plugins/example@sha256:${
          pluginVersion === '1.1.0' ? hash : '3'.repeat(64)
        }`,
        result: 'passed',
        suiteRevision: 'plugin-acceptance-v1',
        testedAt: '2026-07-25T01:00:00.000Z',
        evidenceSha256: `${hostVersion === '0.4.6' ? 'a' : 'b'}${
          index === 0 ? '1' : '2'
        }`.padEnd(64, '0'),
      })),
    );
    expect(() =>
      verifySignedPluginCompatibilityMatrixV1(
        signed(reversed, privateKey, publicKey),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'compatibility_matrix_version_order_invalid',
      }),
    );

    const previewHost = compatibilityMatrix();
    previewHost.hostVersions.current = '0.4.7-rc.1';
    previewHost.cells = previewHost.cells.map((cell) =>
      cell.hostVersion === '0.4.6'
        ? { ...cell, hostVersion: '0.4.7-rc.1' }
        : cell,
    );
    expect(() =>
      verifySignedPluginCompatibilityMatrixV1(
        signed(previewHost, privateKey, publicKey),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'compatibility_matrix_version_order_invalid',
      }),
    );

    const otherPublisher = compatibilityMatrix();
    otherPublisher.publisher = 'io.enterpriseglue.other';
    expect(() =>
      verifySignedPluginCompatibilityMatrixV1(
        signed(otherPublisher, privateKey, publicKey),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'compatibility_matrix_catalog_mismatch' }),
    );

    const incompleteCatalog = compatibilityCatalog();
    incompleteCatalog.entries[0]!.releases[1]!.testedHostVersions = ['0.4.6'];
    expect(() =>
      assertPluginCatalogCompatibilityMatrixV1({
        catalog: incompleteCatalog,
        matrix: compatibilityMatrix() as never,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'compatibility_matrix_host_not_tested',
      }),
    );

    const artifactDrift = compatibilityMatrix();
    artifactDrift.cells[0]!.pluginArtifact =
      `registry.example/plugins/example@sha256:${'9'.repeat(64)}`;
    artifactDrift.cells[2]!.pluginArtifact =
      `registry.example/plugins/example@sha256:${'9'.repeat(64)}`;
    expect(() =>
      assertPluginCatalogCompatibilityMatrixV1({
        catalog: compatibilityCatalog(),
        matrix: artifactDrift as never,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'compatibility_matrix_artifact_mismatch',
      }),
    );
  });
});
