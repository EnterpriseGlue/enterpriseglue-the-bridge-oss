import { generateKeyPairSync, sign } from 'node:crypto';

import type { PluginId, PluginTenantEligibilityClaimsV1 } from '@enterpriseglue/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  Es256PluginTenantEligibilityVerifierV1,
  PluginTenantEligibilityVerificationErrorV1,
  configuredPluginTenantEligibilityVerifierV1,
} from './pluginTenantEligibility.js';

const pluginId = 'io.enterpriseglue.reference' as PluginId;
const releaseDigest = `registry.example/reference@sha256:${'a'.repeat(64)}`;
const now = new Date('2026-08-28T12:00:00.000Z');

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const jwksJson = JSON.stringify({
    keys: [{ ...publicJwk, kid: 'eligibility-key-1', alg: 'ES256', use: 'sig' }],
  });
  const verifier = new Es256PluginTenantEligibilityVerifierV1({
    jwksJson,
    issuer: 'https://control.enterpriseglue.example',
    audience: 'enterpriseglue-shard',
  });
  const claims: PluginTenantEligibilityClaimsV1 = {
    schemaVersion: 'tenant-eligibility.plugin.enterpriseglue.io/v1',
    iss: 'https://control.enterpriseglue.example',
    aud: 'enterpriseglue-shard',
    jti: 'projection-event-1',
    tenantRef: 'tenant-alpha',
    pluginId,
    pluginVersion: '1.0.0',
    release: releaseDigest,
    state: 'active',
    effectiveFrom: '2026-08-28T11:00:00.000Z',
    effectiveUntil: '2026-08-29T11:00:00.000Z',
    limitsHash: 'b'.repeat(64),
    revision: 3,
    projectionRef: 'subscription-projection-1',
    iat: Math.floor(now.getTime() / 1_000) - 60,
    exp: Math.floor(now.getTime() / 1_000) + 3_600,
  };
  const compact = (payload: PluginTenantEligibilityClaimsV1, key = privateKey) => {
    const header = Buffer.from(JSON.stringify({
      alg: 'ES256',
      kid: 'eligibility-key-1',
      typ: 'JWT',
    })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = sign(
      'sha256',
      Buffer.from(`${header}.${body}`, 'ascii'),
      { key, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    return `${header}.${body}.${signature}`;
  };
  return { verifier, claims, compact };
}

function verifyFixture(
  verifier: Es256PluginTenantEligibilityVerifierV1,
  signedProjection: string,
) {
  return verifier.verify({
    signedProjection,
    tenantRef: 'tenant-alpha',
    pluginId,
    pluginVersion: '1.0.0',
    releaseDigest,
    now,
  });
}

describe('Es256PluginTenantEligibilityVerifierV1', () => {
  it('accepts a scoped ES256 projection and returns validated claims plus a digest', () => {
    const { verifier, claims, compact } = fixture();
    expect(verifyFixture(verifier, compact(claims))).toMatchObject({
      claims,
      signatureSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it.each([
    ['tenantRef', 'tenant-bravo'],
    ['pluginId', 'io.enterpriseglue.other'],
    ['pluginVersion', '2.0.0'],
    ['release', `registry.example/reference@sha256:${'c'.repeat(64)}`],
    ['iss', 'https://attacker.example'],
    ['aud', 'other-shard'],
  ] as const)('rejects a projection with mismatched %s', (field, value) => {
    const { verifier, claims, compact } = fixture();
    const projection = compact({ ...claims, [field]: value });
    expect(() => verifyFixture(verifier, projection)).toThrowError(
      expect.objectContaining({ code: 'eligibility_projection_scope_invalid' }),
    );
  });

  it('rejects stale, future, overlong and tampered projections', () => {
    const { verifier, claims, compact } = fixture();
    for (const candidate of [
      {
        ...claims,
        iat: Math.floor(now.getTime() / 1_000) - 3_600,
        exp: Math.floor(now.getTime() / 1_000) - 120,
      },
      { ...claims, iat: Math.floor(now.getTime() / 1_000) + 120 },
      { ...claims, exp: claims.iat + 8 * 24 * 60 * 60 },
    ]) {
      expect(() => verifyFixture(verifier, compact(candidate))).toThrowError(
        expect.objectContaining({ code: 'eligibility_projection_stale' }),
      );
    }
    const signed = compact(claims);
    const [header, body, signature] = signed.split('.');
    const tampered = `${header}.${body}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    expect(() => verifyFixture(verifier, tampered)).toThrowError(
      expect.objectContaining({ code: 'eligibility_projection_signature_invalid' }),
    );
    const unknownHeader = Buffer.from(JSON.stringify({
      alg: 'ES256',
      kid: 'unknown-key',
      typ: 'JWT',
    })).toString('base64url');
    expect(() => verifyFixture(
      verifier,
      `${unknownHeader}.${body}.${signature}`,
    )).toThrowError(
      expect.objectContaining({ code: 'eligibility_projection_signature_invalid' }),
    );
  });

  it('requires a complete verifier configuration only when enabled or partially set', () => {
    expect(configuredPluginTenantEligibilityVerifierV1({})).toBeUndefined();
    expect(() => configuredPluginTenantEligibilityVerifierV1({
      EG_TENANT_APP_ELIGIBILITY_REQUIRED: 'true',
    })).toThrowError(PluginTenantEligibilityVerificationErrorV1);
  });
});
