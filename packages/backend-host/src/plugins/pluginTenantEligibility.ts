import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from 'node:crypto';

import {
  pluginTenantEligibilityClaimsV1Schema,
  type PluginId,
  type PluginTenantEligibilityClaimsV1,
} from '@enterpriseglue/plugin-sdk';

const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export type PluginTenantEligibilityVerificationCodeV1 =
  | 'eligibility_projection_invalid'
  | 'eligibility_projection_signature_invalid'
  | 'eligibility_projection_scope_invalid'
  | 'eligibility_projection_stale'
  | 'eligibility_verifier_unavailable';

export class PluginTenantEligibilityVerificationErrorV1 extends Error {
  constructor(
    public readonly status: 400 | 409 | 503,
    public readonly code: PluginTenantEligibilityVerificationCodeV1,
  ) {
    super(code);
    this.name = 'PluginTenantEligibilityVerificationErrorV1';
  }
}

export interface VerifiedPluginTenantEligibilityV1 {
  claims: PluginTenantEligibilityClaimsV1;
  signatureSha256: string;
}

export interface PluginTenantEligibilityVerifierV1 {
  verify(input: {
    signedProjection: string;
    tenantRef: string;
    pluginId: PluginId;
    pluginVersion: string;
    releaseDigest: string;
    now: Date;
  }): VerifiedPluginTenantEligibilityV1;
}

export interface Es256PluginTenantEligibilityVerifierOptionsV1 {
  jwksJson: string;
  issuer: string;
  audience: string;
  clockSkewSeconds?: number;
  maxLifetimeSeconds?: number;
}

interface JwsHeader {
  alg: 'ES256';
  kid: string;
  typ?: 'JWT';
}

/** Verifies a compact ES256 JWS and returns only its validated safe claims. */
export class Es256PluginTenantEligibilityVerifierV1
  implements PluginTenantEligibilityVerifierV1
{
  private readonly keys: ReadonlyMap<string, KeyObject>;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clockSkewSeconds: number;
  private readonly maxLifetimeSeconds: number;

  constructor(options: Es256PluginTenantEligibilityVerifierOptionsV1) {
    this.issuer = required(options.issuer, 'eligibility_verifier_unavailable');
    this.audience = required(options.audience, 'eligibility_verifier_unavailable');
    this.clockSkewSeconds = boundedInteger(
      options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
      0,
      300,
    );
    this.maxLifetimeSeconds = boundedInteger(
      options.maxLifetimeSeconds ?? DEFAULT_MAX_LIFETIME_SECONDS,
      60,
      30 * 24 * 60 * 60,
    );
    this.keys = parseEs256Jwks(options.jwksJson);
  }

  verify(input: {
    signedProjection: string;
    tenantRef: string;
    pluginId: PluginId;
    pluginVersion: string;
    releaseDigest: string;
    now: Date;
  }): VerifiedPluginTenantEligibilityV1 {
    const parts = input.signedProjection.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw eligibilityError(400, 'eligibility_projection_invalid');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = parseHeader(decodeJson(encodedHeader));
    const key = this.keys.get(header.kid);
    if (!key) {
      throw eligibilityError(400, 'eligibility_projection_signature_invalid');
    }
    const signature = decodeBase64Url(encodedSignature);
    if (
      signature.byteLength !== 64 ||
      !verify(
        'sha256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
        { key, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    ) {
      throw eligibilityError(400, 'eligibility_projection_signature_invalid');
    }

    const parsed = pluginTenantEligibilityClaimsV1Schema.safeParse(
      decodeJson(encodedPayload),
    );
    if (!parsed.success) {
      throw eligibilityError(400, 'eligibility_projection_invalid');
    }
    const claims = parsed.data;
    if (
      claims.iss !== this.issuer ||
      claims.aud !== this.audience ||
      claims.tenantRef !== input.tenantRef ||
      claims.pluginId !== input.pluginId ||
      claims.pluginVersion !== input.pluginVersion ||
      claims.release !== input.releaseDigest ||
      claims.state === 'not_required'
    ) {
      throw eligibilityError(409, 'eligibility_projection_scope_invalid');
    }

    const nowSeconds = Math.floor(input.now.getTime() / 1_000);
    if (
      claims.iat > nowSeconds + this.clockSkewSeconds ||
      claims.exp <= nowSeconds - this.clockSkewSeconds ||
      claims.exp - claims.iat > this.maxLifetimeSeconds
    ) {
      throw eligibilityError(409, 'eligibility_projection_stale');
    }

    return {
      claims,
      signatureSha256: createHash('sha256')
        .update(input.signedProjection, 'utf8')
        .digest('hex'),
    };
  }
}

export function configuredPluginTenantEligibilityVerifierV1(
  environment: NodeJS.ProcessEnv = process.env,
): PluginTenantEligibilityVerifierV1 | undefined {
  const requiredMode = environment.EG_TENANT_APP_ELIGIBILITY_REQUIRED === 'true';
  const jwksJson = environment.EG_TENANT_APP_ELIGIBILITY_JWKS_JSON?.trim();
  const issuer = environment.EG_TENANT_APP_ELIGIBILITY_ISSUER?.trim();
  const audience = environment.EG_TENANT_APP_ELIGIBILITY_AUDIENCE?.trim();
  if (!requiredMode && !jwksJson && !issuer && !audience) return undefined;
  if (!jwksJson || !issuer || !audience) {
    throw eligibilityError(503, 'eligibility_verifier_unavailable');
  }
  return new Es256PluginTenantEligibilityVerifierV1({
    jwksJson,
    issuer,
    audience,
    clockSkewSeconds: environmentInteger(
      environment.EG_TENANT_APP_ELIGIBILITY_CLOCK_SKEW_SECONDS,
      DEFAULT_CLOCK_SKEW_SECONDS,
    ),
    maxLifetimeSeconds: environmentInteger(
      environment.EG_TENANT_APP_ELIGIBILITY_MAX_LIFETIME_SECONDS,
      DEFAULT_MAX_LIFETIME_SECONDS,
    ),
  });
}

function parseEs256Jwks(jwksJson: string): ReadonlyMap<string, KeyObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jwksJson);
  } catch {
    throw eligibilityError(503, 'eligibility_verifier_unavailable');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.keys) || parsed.keys.length === 0) {
    throw eligibilityError(503, 'eligibility_verifier_unavailable');
  }
  const keys = new Map<string, KeyObject>();
  for (const candidate of parsed.keys) {
    if (
      !isRecord(candidate) ||
      candidate.kty !== 'EC' ||
      candidate.crv !== 'P-256' ||
      candidate.alg !== 'ES256' ||
      (candidate.use !== undefined && candidate.use !== 'sig') ||
      typeof candidate.kid !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(candidate.kid) ||
      typeof candidate.x !== 'string' ||
      typeof candidate.y !== 'string' ||
      candidate.d !== undefined ||
      keys.has(candidate.kid)
    ) {
      throw eligibilityError(503, 'eligibility_verifier_unavailable');
    }
    try {
      keys.set(candidate.kid, createPublicKey({
        key: candidate as JsonWebKey,
        format: 'jwk',
      }));
    } catch {
      throw eligibilityError(503, 'eligibility_verifier_unavailable');
    }
  }
  return keys;
}

function parseHeader(value: unknown): JwsHeader {
  if (!isRecord(value)) {
    throw eligibilityError(400, 'eligibility_projection_invalid');
  }
  const keys = Object.keys(value).sort();
  if (
    value.alg !== 'ES256' ||
    typeof value.kid !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.kid) ||
    (value.typ !== undefined && value.typ !== 'JWT') ||
    keys.some((key) => !['alg', 'kid', 'typ'].includes(key))
  ) {
    throw eligibilityError(400, 'eligibility_projection_invalid');
  }
  return {
    alg: 'ES256',
    kid: value.kid,
    ...(value.typ === 'JWT' ? { typ: 'JWT' as const } : {}),
  };
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(decodeBase64Url(value).toString('utf8'));
  } catch {
    throw eligibilityError(400, 'eligibility_projection_invalid');
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw eligibilityError(400, 'eligibility_projection_invalid');
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) {
      throw new Error('non-canonical');
    }
    return decoded;
  } catch {
    throw eligibilityError(400, 'eligibility_projection_invalid');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function required(
  value: string,
  code: PluginTenantEligibilityVerificationCodeV1,
): string {
  const normalized = value.trim();
  if (!normalized) throw eligibilityError(503, code);
  return normalized;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw eligibilityError(503, 'eligibility_verifier_unavailable');
  }
  return value;
}

function environmentInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^[0-9]+$/.test(value.trim())) {
    throw eligibilityError(503, 'eligibility_verifier_unavailable');
  }
  return Number(value);
}

function eligibilityError(
  status: 400 | 409 | 503,
  code: PluginTenantEligibilityVerificationCodeV1,
): PluginTenantEligibilityVerificationErrorV1 {
  return new PluginTenantEligibilityVerificationErrorV1(status, code);
}
