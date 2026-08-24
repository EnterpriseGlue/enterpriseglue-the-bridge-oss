import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';

import {
  pluginAirgapIndexV1Schema,
  pluginCatalogV1Schema,
  pluginCompatibilityMatrixV1Schema,
  pluginPackageIndexV1Schema,
  pluginReleaseV1Schema,
  semVerSchema,
  signedArtifactEnvelopeV1Schema,
  type PluginAirgapIndexV1,
  type PluginCatalogReleaseV1,
  type PluginCatalogV1,
  type PluginCompatibilityMatrixV1,
  type PluginId,
  type PluginPackageIndexV1,
  type PluginReleaseV1,
  type SignedArtifactEnvelopeV1,
} from '@enterpriseglue/plugin-sdk';
import {
  gt,
  prerelease,
  satisfies,
  validRange,
} from 'semver';
import type { z } from 'zod';

export type PluginSupplyChainErrorCode =
  | 'payload_too_large'
  | 'signature_envelope_invalid'
  | 'signer_unknown'
  | 'signer_inactive'
  | 'payload_digest_invalid'
  | 'signature_invalid'
  | 'payload_schema_invalid'
  | 'catalog_not_yet_valid'
  | 'catalog_expired'
  | 'plugin_not_in_catalog'
  | 'release_not_in_catalog'
  | 'release_revoked'
  | 'release_signer_mismatch'
  | 'host_version_invalid'
  | 'host_compatibility_invalid'
  | 'host_version_incompatible'
  | 'host_version_not_tested'
  | 'compatibility_matrix_version_order_invalid'
  | 'compatibility_matrix_catalog_mismatch'
  | 'compatibility_matrix_artifact_mismatch'
  | 'compatibility_matrix_release_unavailable'
  | 'compatibility_matrix_host_not_tested'
  | 'artifact_size_invalid'
  | 'artifact_digest_invalid';

export class PluginSupplyChainError extends Error {
  constructor(
    public readonly code: PluginSupplyChainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PluginSupplyChainError';
  }
}

export interface TrustedPluginSignerV1 {
  publisher: PluginId;
  keyId: string;
  publicKey: KeyObject | string | Buffer;
  status: 'active' | 'retiring' | 'revoked' | 'compromised';
}

function sha256(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function publicKey(key: KeyObject | string | Buffer): KeyObject {
  if (typeof key !== 'string' && !Buffer.isBuffer(key)) return key;
  return createPublicKey(key);
}

export function verifySignedJsonPayloadV1<T>(
  payload: Uint8Array,
  envelopeInput: unknown,
  schema: z.ZodType<T>,
  trust: readonly TrustedPluginSignerV1[],
  maximumBytes = 5 * 1024 * 1024,
): { data: T; envelope: SignedArtifactEnvelopeV1 } {
  if (payload.byteLength === 0 || payload.byteLength > maximumBytes) {
    throw new PluginSupplyChainError(
      'payload_too_large',
      'Signed payload has an invalid size',
    );
  }
  const envelopeResult =
    signedArtifactEnvelopeV1Schema.safeParse(envelopeInput);
  if (!envelopeResult.success) {
    throw new PluginSupplyChainError(
      'signature_envelope_invalid',
      'Signature envelope is invalid',
    );
  }
  const envelope = envelopeResult.data;
  const signer = trust.find(
    (entry) =>
      entry.publisher === envelope.publisher && entry.keyId === envelope.keyId,
  );
  if (!signer) {
    throw new PluginSupplyChainError(
      'signer_unknown',
      'Artifact signer is not trusted',
    );
  }
  if (signer.status !== 'active' && signer.status !== 'retiring') {
    throw new PluginSupplyChainError(
      'signer_inactive',
      'Artifact signer is revoked or compromised',
    );
  }

  const digest = sha256(payload);
  if (!equalHex(digest, envelope.payloadSha256)) {
    throw new PluginSupplyChainError(
      'payload_digest_invalid',
      'Signed payload digest does not match its envelope',
    );
  }
  const signature = Buffer.from(envelope.signature, 'base64url');
  if (!verify(null, payload, publicKey(signer.publicKey), signature)) {
    throw new PluginSupplyChainError(
      'signature_invalid',
      'Signed payload signature is invalid',
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload).toString('utf8'));
  } catch {
    throw new PluginSupplyChainError(
      'payload_schema_invalid',
      'Signed payload is not valid JSON',
    );
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new PluginSupplyChainError(
      'payload_schema_invalid',
      'Signed payload does not satisfy its closed schema',
    );
  }
  return { data: parsed.data, envelope };
}

export function verifySignedPluginCatalogV1(input: {
  payload: Uint8Array;
  envelope: unknown;
  trust: readonly TrustedPluginSignerV1[];
  now?: Date;
  maximumClockSkewSeconds?: number;
}): PluginCatalogV1 {
  const { data } = verifySignedJsonPayloadV1(
    input.payload,
    input.envelope,
    pluginCatalogV1Schema,
    input.trust,
  );
  const now = (input.now ?? new Date()).getTime();
  const skew = (input.maximumClockSkewSeconds ?? 300) * 1_000;
  if (Date.parse(data.metadata.generatedAt) > now + skew) {
    throw new PluginSupplyChainError(
      'catalog_not_yet_valid',
      'Plugin catalog generation time is in the future',
    );
  }
  if (Date.parse(data.metadata.expiresAt) < now - skew) {
    throw new PluginSupplyChainError(
      'catalog_expired',
      'Plugin catalog has expired',
    );
  }
  return data;
}

export function verifySignedPluginReleaseV1(input: {
  payload: Uint8Array;
  envelope: unknown;
  trust: readonly TrustedPluginSignerV1[];
  maximumBytes?: number;
}): {
  release: PluginReleaseV1;
  envelope: SignedArtifactEnvelopeV1;
} {
  const verified = verifySignedJsonPayloadV1(
    input.payload,
    input.envelope,
    pluginReleaseV1Schema,
    input.trust,
    input.maximumBytes ?? 1024 * 1024,
  );
  if (verified.envelope.publisher !== verified.data.publisher) {
    throw new PluginSupplyChainError(
      'release_signer_mismatch',
      'Plugin release publisher differs from its trusted signer',
    );
  }
  return { release: verified.data, envelope: verified.envelope };
}

export function selectPluginCatalogReleaseV1(
  catalog: PluginCatalogV1,
  pluginId: PluginId,
  version: string,
): PluginCatalogReleaseV1 {
  const entry = catalog.entries.find(
    (candidate) => candidate.pluginId === pluginId,
  );
  if (!entry) {
    throw new PluginSupplyChainError(
      'plugin_not_in_catalog',
      'Plugin is not present in the verified catalog',
    );
  }
  const release = entry.releases.find(
    (candidate) => candidate.version === version,
  );
  if (!release) {
    throw new PluginSupplyChainError(
      'release_not_in_catalog',
      'Plugin version is not present in the verified catalog',
    );
  }
  if (release.revoked) {
    throw new PluginSupplyChainError(
      'release_revoked',
      `Plugin release is revoked: ${release.revocationReasonCode}`,
    );
  }
  return release;
}

export function assertPluginReleaseTestedHostV1(
  release: PluginCatalogReleaseV1,
  hostVersionInput: string,
): void {
  const hostVersion = semVerSchema.safeParse(hostVersionInput);
  if (!hostVersion.success) {
    throw new PluginSupplyChainError(
      'host_version_invalid',
      'EnterpriseGlue host version is not valid SemVer',
    );
  }
  if (!validRange(release.hostCompatibility)) {
    throw new PluginSupplyChainError(
      'host_compatibility_invalid',
      'Plugin release declares an invalid EnterpriseGlue host compatibility range',
    );
  }
  if (
    !satisfies(hostVersion.data, release.hostCompatibility, {
      includePrerelease: true,
    })
  ) {
    throw new PluginSupplyChainError(
      'host_version_incompatible',
      'EnterpriseGlue host version is outside the plugin release compatibility range',
    );
  }
  if (!release.testedHostVersions.includes(hostVersion.data)) {
    throw new PluginSupplyChainError(
      'host_version_not_tested',
      'Plugin release was not tested for this exact EnterpriseGlue host version',
    );
  }
}

export function verifySignedPluginCompatibilityMatrixV1(input: {
  payload: Uint8Array;
  envelope: unknown;
  trust: readonly TrustedPluginSignerV1[];
}): {
  matrix: PluginCompatibilityMatrixV1;
  envelope: SignedArtifactEnvelopeV1;
} {
  const verified = verifySignedJsonPayloadV1(
    input.payload,
    input.envelope,
    pluginCompatibilityMatrixV1Schema,
    input.trust,
  );
  if (
    [
      verified.data.hostVersions.current,
      verified.data.hostVersions.previous,
      verified.data.pluginVersions.current,
      verified.data.pluginVersions.previous,
    ].some((version) => prerelease(version) !== null) ||
    !gt(
      verified.data.hostVersions.current,
      verified.data.hostVersions.previous,
    ) ||
    !gt(
      verified.data.pluginVersions.current,
      verified.data.pluginVersions.previous,
    )
  ) {
    throw new PluginSupplyChainError(
      'compatibility_matrix_version_order_invalid',
      'Compatibility matrix versions must be stable and current versions must be newer than previous versions',
    );
  }
  if (verified.envelope.publisher !== verified.data.publisher) {
    throw new PluginSupplyChainError(
      'compatibility_matrix_catalog_mismatch',
      'Compatibility matrix publisher differs from its signer',
    );
  }
  return {
    matrix: verified.data,
    envelope: verified.envelope,
  };
}

/**
 * Cross-check a verified positive matrix against the same signed catalog that
 * will distribute the plugin.
 */
export function assertPluginCatalogCompatibilityMatrixV1(input: {
  catalog: PluginCatalogV1;
  matrix: PluginCompatibilityMatrixV1;
}): void {
  const entry = input.catalog.entries.find(
    (candidate) => candidate.pluginId === input.matrix.pluginId,
  );
  if (!entry || entry.publisher !== input.matrix.publisher) {
    throw new PluginSupplyChainError(
      'compatibility_matrix_catalog_mismatch',
      'Compatibility matrix plugin or publisher differs from the catalog',
    );
  }

  for (const pluginVersion of [
    input.matrix.pluginVersions.current,
    input.matrix.pluginVersions.previous,
  ]) {
    const release = entry.releases.find(
      (candidate) => candidate.version === pluginVersion,
    );
    if (!release || release.channel !== 'stable' || release.revoked) {
      throw new PluginSupplyChainError(
        'compatibility_matrix_release_unavailable',
        'Compatibility matrix requires active stable current and previous plugin releases',
      );
    }
    const pluginArtifacts = new Set(
      input.matrix.cells
        .filter((cell) => cell.pluginVersion === pluginVersion)
        .map((cell) => cell.pluginArtifact),
    );
    if (
      pluginArtifacts.size !== 1 ||
      !pluginArtifacts.has(release.bundle)
    ) {
      throw new PluginSupplyChainError(
        'compatibility_matrix_artifact_mismatch',
        'Compatibility matrix plugin artifact differs from the signed catalog release',
      );
    }
    for (const hostVersion of [
      input.matrix.hostVersions.current,
      input.matrix.hostVersions.previous,
    ]) {
      if (!release.testedHostVersions.includes(hostVersion)) {
        throw new PluginSupplyChainError(
          'compatibility_matrix_host_not_tested',
          'Catalog release does not claim the exact matrix host version',
        );
      }
    }
  }
}

export function verifyArtifactBytesV1(
  payload: Uint8Array,
  expected: { sizeBytes: number; sha256: string },
): void {
  if (payload.byteLength !== expected.sizeBytes) {
    throw new PluginSupplyChainError(
      'artifact_size_invalid',
      'Artifact size differs from the signed index',
    );
  }
  if (!equalHex(sha256(payload), expected.sha256)) {
    throw new PluginSupplyChainError(
      'artifact_digest_invalid',
      'Artifact digest differs from the signed index',
    );
  }
}

export function verifySignedPluginAirgapIndexV1(input: {
  payload: Uint8Array;
  envelope: unknown;
  trust: readonly TrustedPluginSignerV1[];
}): {
  index: PluginAirgapIndexV1;
  envelope: SignedArtifactEnvelopeV1;
} {
  const verified = verifySignedJsonPayloadV1(
    input.payload,
    input.envelope,
    pluginAirgapIndexV1Schema,
    input.trust,
  );
  return {
    index: verified.data,
    envelope: verified.envelope,
  };
}

export function verifySignedPluginPackageIndexV1(input: {
  payload: Uint8Array;
  envelope: unknown;
  trust: readonly TrustedPluginSignerV1[];
}): {
  index: PluginPackageIndexV1;
  envelope: SignedArtifactEnvelopeV1;
} {
  const verified = verifySignedJsonPayloadV1(
    input.payload,
    input.envelope,
    pluginPackageIndexV1Schema,
    input.trust,
  );
  return {
    index: verified.data,
    envelope: verified.envelope,
  };
}
