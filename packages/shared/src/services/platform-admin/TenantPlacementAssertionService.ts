import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

export const TENANT_PLACEMENT_ASSERTION_V2_SCHEMA = 'placement-assertion.enterpriseglue.io/v2' as const;

interface PlacementJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface PlacementJwks {
  keys: PlacementJwk[];
}

export interface TenantPlacementClaimV2 {
  schemaVersion: typeof TENANT_PLACEMENT_ASSERTION_V2_SCHEMA;
  issuer: string;
  audience: string;
  tenantId: string;
  tenantSlug: string;
  shardId: string;
  placementEpoch: number;
  routingIdentity: {
    hostname: string;
    pathPrefix: string;
  };
  correlationId: string;
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
  keyId: string;
}

export interface TenantPlacementV2VerificationInput {
  compactJws: string;
  hostname: string;
  requestPath: string;
  nowSeconds?: number;
}

interface RawPlacementClaims {
  schemaVersion?: unknown;
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  tenantId?: unknown;
  tenantSlug?: unknown;
  shardId?: unknown;
  placementEpoch?: unknown;
  routingIdentity?: unknown;
  correlationId?: unknown;
  iat?: unknown;
  nbf?: unknown;
  exp?: unknown;
}

function unauthorized(message: string): never {
  throw Errors.unauthorized(message);
}

function parseJsonSegment(value: string, label: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 32_768) {
    unauthorized(`Invalid tenant placement v2 ${label}`);
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      unauthorized(`Invalid tenant placement v2 ${label}`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    unauthorized(`Invalid tenant placement v2 ${label}`);
  }
}

function boundedString(value: unknown, label: string, maximum = 255): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    unauthorized(`Invalid tenant placement v2 ${label}`);
  }
  return value;
}

function integerClaim(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    unauthorized(`Invalid tenant placement v2 ${label}`);
  }
  return Number(value);
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

function normalizePath(value: string): string {
  const path = value.split('?', 1)[0] || '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function routeMatches(requestPath: string, pathPrefix: string): boolean {
  return requestPath === pathPrefix || requestPath.startsWith(`${pathPrefix}/`);
}

function readJwks(jwksJson: string | undefined): PlacementJwks {
  if (!jwksJson) unauthorized('Tenant placement v2 assertions are not configured');
  let raw: unknown;
  try {
    raw = JSON.parse(jwksJson);
  } catch {
    unauthorized('Tenant placement v2 JWKS is invalid');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as PlacementJwks).keys)) {
    unauthorized('Tenant placement v2 JWKS is invalid');
  }
  return raw as PlacementJwks;
}

function selectVerificationKey(jwks: PlacementJwks, kid: string): KeyObject {
  const matches = jwks.keys.filter((candidate) => candidate.kid === kid);
  if (matches.length !== 1) unauthorized('Unknown tenant placement v2 key');
  const jwk = matches[0]!;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || (jwk.alg && jwk.alg !== 'ES256') || (jwk.use && jwk.use !== 'sig') || 'd' in jwk) {
    unauthorized('Tenant placement v2 key is not an ES256 public verification key');
  }
  try {
    return createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    unauthorized('Tenant placement v2 key cannot be loaded');
  }
}

export class TenantPlacementAssertionService {
  verifyV2(input: TenantPlacementV2VerificationInput): TenantPlacementClaimV2 {
    const parts = input.compactJws.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) unauthorized('Invalid tenant placement v2 assertion');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = parseJsonSegment(encodedHeader, 'header');
    if (header.alg !== 'ES256' || (header.typ !== undefined && header.typ !== 'JWT')) {
      unauthorized('Unsupported tenant placement v2 algorithm');
    }
    const kid = boundedString(header.kid, 'key ID', 160);
    const key = selectVerificationKey(readJwks(config.tenantPlacementV2JwksJson), kid);
    let signature: Buffer;
    try {
      signature = Buffer.from(encodedSignature, 'base64url');
    } catch {
      unauthorized('Invalid tenant placement v2 signature');
    }
    if (signature.length !== 64) {
      unauthorized('Invalid tenant placement v2 signature');
    }
    const signatureIsValid = verifySignature(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
      { key, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    if (!signatureIsValid) {
      unauthorized('Invalid tenant placement v2 signature');
    }

    const raw = parseJsonSegment(encodedPayload, 'payload') as RawPlacementClaims;
    if (raw.schemaVersion !== TENANT_PLACEMENT_ASSERTION_V2_SCHEMA) {
      unauthorized('Unsupported tenant placement v2 schema');
    }
    const issuer = boundedString(raw.iss, 'issuer');
    const expectedIssuer = config.tenantPlacementV2Issuer;
    if (!expectedIssuer || issuer !== expectedIssuer) unauthorized('Invalid tenant placement v2 issuer');
    const expectedAudience = config.tenantPlacementV2Audience;
    const audiences = Array.isArray(raw.aud) ? raw.aud : [raw.aud];
    if (!expectedAudience || !audiences.includes(expectedAudience)) unauthorized('Invalid tenant placement v2 audience');

    const tenantId = boundedString(raw.tenantId, 'tenant ID', 160);
    if (raw.sub !== `tenant:${tenantId}`) unauthorized('Invalid tenant placement v2 subject');
    const tenantSlug = boundedString(raw.tenantSlug, 'tenant slug', 63).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenantSlug)) unauthorized('Invalid tenant placement v2 tenant slug');
    const shardId = boundedString(raw.shardId, 'shard ID', 160);
    if (!config.tenantPlacementV2ShardId || shardId !== config.tenantPlacementV2ShardId) {
      unauthorized('Tenant placement v2 assertion targets another shard');
    }
    const placementEpoch = integerClaim(raw.placementEpoch, 'placement epoch', 1);
    const correlationId = boundedString(raw.correlationId, 'correlation ID', 160);
    if (correlationId.length < 8) unauthorized('Invalid tenant placement v2 correlation ID');
    const issuedAt = integerClaim(raw.iat, 'issued-at time', 1);
    const notBefore = integerClaim(raw.nbf, 'not-before time', 1);
    const expiresAt = integerClaim(raw.exp, 'expiry time', 1);
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    const skew = config.tenantPlacementV2ClockSkewSeconds;
    const maximumAge = config.tenantPlacementMaxAgeSeconds;
    if (issuedAt > now + skew || notBefore > now + skew || expiresAt <= now - skew) {
      unauthorized('Expired or not-yet-valid tenant placement v2 assertion');
    }
    if (notBefore < issuedAt - skew || expiresAt <= notBefore || expiresAt - issuedAt > maximumAge) {
      unauthorized('Invalid tenant placement v2 validity window');
    }
    if (now - issuedAt > maximumAge + skew) unauthorized('Stale tenant placement v2 assertion');

    if (!raw.routingIdentity || typeof raw.routingIdentity !== 'object' || Array.isArray(raw.routingIdentity)) {
      unauthorized('Invalid tenant placement v2 routing identity');
    }
    const routing = raw.routingIdentity as Record<string, unknown>;
    const hostname = normalizeHostname(boundedString(routing.hostname, 'routing hostname', 253));
    const pathPrefix = boundedString(routing.pathPrefix, 'routing path', 255);
    if (pathPrefix !== `/t/${tenantSlug}` && pathPrefix !== `/api/t/${tenantSlug}`) {
      unauthorized('Invalid tenant placement v2 routing path');
    }
    if (hostname !== normalizeHostname(input.hostname) || !routeMatches(normalizePath(input.requestPath), pathPrefix)) {
      unauthorized('Tenant placement v2 assertion does not match the request route');
    }

    return {
      schemaVersion: TENANT_PLACEMENT_ASSERTION_V2_SCHEMA,
      issuer,
      audience: expectedAudience,
      tenantId,
      tenantSlug,
      shardId,
      placementEpoch,
      routingIdentity: { hostname, pathPrefix },
      correlationId,
      issuedAt,
      notBefore,
      expiresAt,
      keyId: kid,
    };
  }
}

export const tenantPlacementAssertionService = new TenantPlacementAssertionService();
