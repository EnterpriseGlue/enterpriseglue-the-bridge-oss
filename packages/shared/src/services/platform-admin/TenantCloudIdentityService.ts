import { createPrivateKey, randomUUID, sign } from 'node:crypto';

import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

export const TENANT_CLOUD_IDENTITY_V1_SCHEMA = 'tenant-cloud-identity.enterpriseglue.io/v1' as const;

export interface TenantCloudIdentityClaimsV1 {
  schemaVersion: typeof TENANT_CLOUD_IDENTITY_V1_SCHEMA;
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  tenantId: string;
  tenantSlug: string;
  tenantRole: 'tenant_admin' | 'member';
  shardId: string;
  releaseId: string;
  placementEpoch: number;
  assignmentEpoch: number;
  iat: number;
  nbf: number;
  exp: number;
}

/**
 * Mints a short-lived, secret-free host attestation after native session,
 * tenant membership, route and placement checks have all succeeded.
 */
export class TenantCloudIdentityService {
  issue(input: {
    userId: string;
    tenantId: string;
    tenantSlug: string;
    tenantRole: 'tenant_admin' | 'member';
    shardId: string;
    releaseId: string;
    placementEpoch: number;
    assignmentEpoch: number;
    now?: Date;
  }): { token: string; expiresIn: number } {
    const privateKeyPem = config.tenantWorkloadReceiptPrivateKey;
    const keyId = config.tenantWorkloadReceiptKeyId;
    const issuer = config.tenantWorkloadReceiptIssuer;
    const audience = config.tenantCloudIdentityAudience;
    if (!privateKeyPem || !keyId || !issuer || !audience) throw Errors.serviceUnavailable('Tenant cloud identity signing');
    const privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Errors.serviceUnavailable('Tenant cloud identity signing');
    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    const claims: TenantCloudIdentityClaimsV1 = {
      schemaVersion: TENANT_CLOUD_IDENTITY_V1_SCHEMA,
      iss: issuer,
      aud: audience,
      sub: `user:${bounded(input.userId, 250)}`,
      jti: `tci_${randomUUID().replace(/-/g, '')}`,
      tenantId: bounded(input.tenantId, 160),
      tenantSlug: bounded(input.tenantSlug, 63),
      tenantRole: input.tenantRole,
      shardId: bounded(input.shardId, 160),
      releaseId: bounded(input.releaseId, 256),
      placementEpoch: positiveInteger(input.placementEpoch),
      assignmentEpoch: positiveInteger(input.assignmentEpoch),
      iat: now,
      nbf: now - 2,
      exp: now + 90,
    };
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: keyId })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return { token: `${header}.${payload}.${signature}`, expiresIn: 90 };
  }
}

function bounded(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized) || normalized.length > maximum) throw Errors.unauthorized('Tenant cloud identity claim is invalid');
  return normalized;
}
function positiveInteger(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw Errors.unauthorized('Tenant cloud identity epoch is invalid'); return value; }

export const tenantCloudIdentityService = new TenantCloudIdentityService();
