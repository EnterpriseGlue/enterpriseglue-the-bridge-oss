import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config } from '@enterpriseglue/shared/config/index.js';
import {
  PLATFORM_CLOUD_IDENTITY_V1_SCHEMA,
  platformCloudIdentityService,
} from '@enterpriseglue/shared/services/platform-admin/PlatformCloudIdentityService.js';
import { verifyToken } from '@enterpriseglue/shared/utils/jwt.js';

const original = {
  key: config.tenantWorkloadReceiptPrivateKey,
  keyId: config.tenantWorkloadReceiptKeyId,
  issuer: config.tenantWorkloadReceiptIssuer,
  audience: config.platformCloudIdentityAudience,
};

describe('PlatformCloudIdentityService', () => {
  let publicKey: KeyObject;

  beforeEach(() => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    publicKey = pair.publicKey;
    config.tenantWorkloadReceiptPrivateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    config.tenantWorkloadReceiptKeyId = 'shard-key-1';
    config.tenantWorkloadReceiptIssuer = 'regional-shard-01';
    config.platformCloudIdentityAudience = 'enterpriseglue-cloud-platform';
  });

  afterEach(() => {
    config.tenantWorkloadReceiptPrivateKey = original.key;
    config.tenantWorkloadReceiptKeyId = original.keyId;
    config.tenantWorkloadReceiptIssuer = original.issuer;
    config.platformCloudIdentityAudience = original.audience;
  });

  it.each(['platform.tenants.read', 'platform.tenants.manage'] as const)(
    'signs one short-lived %s assertion without tenant or session data',
    (action) => {
      const issued = platformCloudIdentityService.issue({
        userId: 'user-1',
        shardId: 'regional-shard-01',
        action,
        now: new Date('2027-01-15T08:00:00.000Z'),
      });
      const [header, payload, signature] = issued.token.split('.') as [string, string, string];
      const protectedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

      expect(protectedHeader).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'shard-key-1' });
      expect(claims).toMatchObject({
        schemaVersion: PLATFORM_CLOUD_IDENTITY_V1_SCHEMA,
        iss: 'regional-shard-01',
        aud: 'enterpriseglue-cloud-platform',
        sub: 'user:user-1',
        shardId: 'regional-shard-01',
        action,
        exp: claims.iat + 90,
        nbf: claims.iat - 2,
      });
      expect(issued.expiresIn).toBe(90);
      expect(JSON.stringify(claims)).not.toMatch(/tenantId|tenantSlug|sso|secret|cookie|refresh/i);
      expect(verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      )).toBe(true);
    },
  );

  it('fails closed when the platform-specific audience is unavailable', () => {
    config.platformCloudIdentityAudience = undefined;
    expect(() => platformCloudIdentityService.issue({
      userId: 'user-1',
      shardId: 'regional-shard-01',
      action: 'platform.tenants.read',
    })).toThrow('Platform cloud identity signing service unavailable');
  });

  it('cannot be presented as a host session token at tenant endpoints', () => {
    const issued = platformCloudIdentityService.issue({
      userId: 'user-1',
      shardId: 'regional-shard-01',
      action: 'platform.tenants.read',
      now: new Date(),
    });

    expect(() => verifyToken(issued.token)).toThrow('Invalid token');
  });

  it('rejects invalid runtime claim values before signing', () => {
    expect(() => platformCloudIdentityService.issue({
      userId: 'user with spaces',
      shardId: 'regional-shard-01',
      action: 'platform.tenants.read',
    })).toThrow('Platform cloud identity claim is invalid');
  });
});
