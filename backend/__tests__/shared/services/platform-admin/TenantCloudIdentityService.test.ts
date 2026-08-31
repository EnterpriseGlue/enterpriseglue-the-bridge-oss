import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { config } from '@enterpriseglue/shared/config/index.js';
import { tenantCloudIdentityService } from '@enterpriseglue/shared/services/platform-admin/TenantCloudIdentityService.js';

const original = {
  key: config.tenantWorkloadReceiptPrivateKey,
  keyId: config.tenantWorkloadReceiptKeyId,
  issuer: config.tenantWorkloadReceiptIssuer,
  audience: config.tenantCloudIdentityAudience,
};

afterEach(() => {
  (config as any).tenantWorkloadReceiptPrivateKey = original.key;
  (config as any).tenantWorkloadReceiptKeyId = original.keyId;
  (config as any).tenantWorkloadReceiptIssuer = original.issuer;
  (config as any).tenantCloudIdentityAudience = original.audience;
});

describe('TenantCloudIdentityService', () => {
  it('signs a short-lived tenant, role, release and epoch-bound identity without SSO data', () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    (config as any).tenantWorkloadReceiptPrivateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    (config as any).tenantWorkloadReceiptKeyId = 'shard-key-1';
    (config as any).tenantWorkloadReceiptIssuer = 'https://shard-a.internal/';
    (config as any).tenantCloudIdentityAudience = 'enterpriseglue-cloud-control';
    const issued = tenantCloudIdentityService.issue({ userId: 'user-1', tenantId: 'tenant-alpha', tenantSlug: 'alpha', tenantRole: 'tenant_admin', shardId: 'shard-a', releaseId: 'release-2', placementEpoch: 7, assignmentEpoch: 9, now: new Date('2027-01-15T08:00:00.000Z') });
    const [header, payload, signature] = issued.token.split('.') as [string, string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    expect(claims).toMatchObject({ tenantId: 'tenant-alpha', tenantRole: 'tenant_admin', releaseId: 'release-2', assignmentEpoch: 9, exp: claims.iat + 90 });
    expect(JSON.stringify(claims)).not.toMatch(/sso|secret|provider/i);
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))).toBe(true);
  });
});
