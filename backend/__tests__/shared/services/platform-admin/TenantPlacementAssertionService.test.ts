import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '@enterpriseglue/shared/config/index.js';
import {
  TENANT_PLACEMENT_ASSERTION_V2_SCHEMA,
  TENANT_PLACEMENT_ASSERTION_V3_SCHEMA,
  TenantPlacementAssertionService,
} from '@enterpriseglue/shared/services/platform-admin/TenantPlacementAssertionService.js';

const now = 1_800_000_000;
const original = {
  jwks: config.tenantPlacementV2JwksJson,
  issuer: config.tenantPlacementV2Issuer,
  audience: config.tenantPlacementV2Audience,
  shardId: config.tenantPlacementV2ShardId,
  clockSkew: config.tenantPlacementV2ClockSkewSeconds,
  maximumAge: config.tenantPlacementMaxAgeSeconds,
  releaseId: config.tenantPlacementReleaseId,
};

function keyPair(kid: string) {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: { ...publicJwk, kid, alg: 'ES256', use: 'sig' },
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function assertion(
  key: ReturnType<typeof keyPair>,
  claimOverrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {},
): string {
  const header = encode({ alg: 'ES256', typ: 'JWT', kid: key.kid, ...headerOverrides });
  const payload = encode({
    schemaVersion: TENANT_PLACEMENT_ASSERTION_V2_SCHEMA,
    iss: 'https://control.enterpriseglue.test',
    aud: 'enterpriseglue-shard',
    sub: 'tenant:tenant-alpha',
    tenantId: 'tenant-alpha',
    tenantSlug: 'alpha',
    shardId: 'shard-a',
    placementEpoch: 7,
    routingIdentity: { hostname: 'app.enterpriseglue.test', pathPrefix: '/api/t/alpha' },
    correlationId: 'correlation-001',
    iat: now - 10,
    nbf: now - 10,
    exp: now + 30,
    ...claimOverrides,
  });
  const signature = sign(
    'sha256', Buffer.from(`${header}.${payload}`, 'ascii'),
    { key: key.privateKey, dsaEncoding: 'ieee-p1363' },
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('TenantPlacementAssertionService placement v2', () => {
  const active = keyPair('kms-active');
  const retiring = keyPair('kms-retiring');
  const service = new TenantPlacementAssertionService();

  beforeEach(() => {
    (config as any).tenantPlacementV2JwksJson = JSON.stringify({ keys: [active.publicJwk, retiring.publicJwk] });
    (config as any).tenantPlacementV2Issuer = 'https://control.enterpriseglue.test';
    (config as any).tenantPlacementV2Audience = 'enterpriseglue-shard';
    (config as any).tenantPlacementV2ShardId = 'shard-a';
    (config as any).tenantPlacementV2ClockSkewSeconds = 5;
    (config as any).tenantPlacementMaxAgeSeconds = 120;
    (config as any).tenantPlacementReleaseId = 'release-2';
  });

  afterEach(() => {
    (config as any).tenantPlacementV2JwksJson = original.jwks;
    (config as any).tenantPlacementV2Issuer = original.issuer;
    (config as any).tenantPlacementV2Audience = original.audience;
    (config as any).tenantPlacementV2ShardId = original.shardId;
    (config as any).tenantPlacementV2ClockSkewSeconds = original.clockSkew;
    (config as any).tenantPlacementMaxAgeSeconds = original.maximumAge;
    (config as any).tenantPlacementReleaseId = original.releaseId;
  });

  it('verifies KMS-compatible ES256 assertions using public JWKS material only', () => {
    expect(service.verifyV2({
      compactJws: assertion(active),
      hostname: 'app.enterpriseglue.test',
      requestPath: '/api/t/alpha/projects?limit=25',
      nowSeconds: now,
    })).toMatchObject({
      tenantId: 'tenant-alpha', tenantSlug: 'alpha', shardId: 'shard-a',
      placementEpoch: 7, correlationId: 'correlation-001', keyId: 'kms-active',
    });
  });

  it('accepts overlapping active and retiring verification keys', () => {
    expect(service.verifyV2({
      compactJws: assertion(retiring),
      hostname: 'app.enterpriseglue.test',
      requestPath: '/api/t/alpha',
      nowSeconds: now,
    }).keyId).toBe('kms-retiring');
  });

  it('rejects malformed-length and invalid fixed-length signatures independently', () => {
    const [header, payload] = assertion(active).split('.');
    const verify = (signature: string) => service.verifyV2({
      compactJws: `${header}.${payload}.${signature}`,
      hostname: 'app.enterpriseglue.test',
      requestPath: '/api/t/alpha',
      nowSeconds: now,
    });

    expect(() => verify(Buffer.alloc(63).toString('base64url')))
      .toThrow('Invalid tenant placement v2 signature');
    expect(() => verify(Buffer.alloc(64).toString('base64url')))
      .toThrow('Invalid tenant placement v2 signature');
  });

  it.each([
    ['unknown key', () => assertion(active, {}, { kid: 'missing' }), 'Unknown tenant placement v2 key'],
    ['wrong issuer', () => assertion(active, { iss: 'https://attacker.test' }), 'issuer'],
    ['wrong audience', () => assertion(active, { aud: 'another-shard' }), 'audience'],
    ['wrong shard', () => assertion(active, { shardId: 'shard-b' }), 'another shard'],
    ['expired window', () => assertion(active, { iat: now - 200, nbf: now - 200, exp: now - 100 }), 'Expired or not-yet-valid'],
  ])('rejects %s', (_label, token, message) => {
    expect(() => service.verifyV2({
      compactJws: token(),
      hostname: 'app.enterpriseglue.test',
      requestPath: '/api/t/alpha/projects',
      nowSeconds: now,
    })).toThrow(message);
  });

  it('binds the assertion to the exact canonical host and tenant path', () => {
    const compactJws = assertion(active);
    expect(() => service.verifyV2({
      compactJws, hostname: 'other.enterpriseglue.test', requestPath: '/api/t/alpha/projects', nowSeconds: now,
    })).toThrow('does not match the request route');
    expect(() => service.verifyV2({
      compactJws, hostname: 'app.enterpriseglue.test', requestPath: '/api/t/bravo/projects', nowSeconds: now,
    })).toThrow('does not match the request route');
  });

  it('verifies v3 release and assignment affinity without weakening v2', () => {
    const compactJws = assertion(active, {
      schemaVersion: TENANT_PLACEMENT_ASSERTION_V3_SCHEMA,
      region: 'europe-west4',
      releaseId: 'release-2',
      assignmentEpoch: 9,
    });
    expect(service.verifyV3({ compactJws, hostname: 'app.enterpriseglue.test', requestPath: '/api/t/alpha/projects', nowSeconds: now })).toMatchObject({ releaseId: 'release-2', assignmentEpoch: 9, placementEpoch: 7 });
    (config as any).tenantPlacementReleaseId = 'release-1';
    expect(() => service.verifyV3({ compactJws, hostname: 'app.enterpriseglue.test', requestPath: '/api/t/alpha/projects', nowSeconds: now })).toThrow('another release');
    expect(service.verifyV2({ compactJws: assertion(active), hostname: 'app.enterpriseglue.test', requestPath: '/api/t/alpha/projects', nowSeconds: now }).placementEpoch).toBe(7);
  });

  it('rejects malformed-length and invalid fixed-length v3 signatures independently', () => {
    const compactJws = assertion(active, {
      schemaVersion: TENANT_PLACEMENT_ASSERTION_V3_SCHEMA,
      region: 'europe-west4',
      releaseId: 'release-2',
      assignmentEpoch: 9,
    });
    const [header, payload] = compactJws.split('.');
    const verify = (signature: string) => service.verifyV3({
      compactJws: `${header}.${payload}.${signature}`,
      hostname: 'app.enterpriseglue.test',
      requestPath: '/api/t/alpha',
      nowSeconds: now,
    });

    expect(() => verify(Buffer.alloc(63).toString('base64url')))
      .toThrow('Invalid tenant placement v3 signature');
    expect(() => verify(Buffer.alloc(64).toString('base64url')))
      .toThrow('Invalid tenant placement v3 signature');
  });
});
