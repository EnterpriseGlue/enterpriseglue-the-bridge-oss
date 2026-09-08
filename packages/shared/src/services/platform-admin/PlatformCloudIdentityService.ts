import { createPrivateKey, randomUUID, sign } from 'node:crypto';

import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  PlatformCloudIdentityClaimsSchema,
  type PlatformCloudIdentityAction,
} from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';

export const PLATFORM_CLOUD_IDENTITY_V1_SCHEMA = 'platform-cloud-identity.enterpriseglue.io/v1' as const;

export interface PlatformCloudIdentityClaimsV1 {
  schemaVersion: typeof PLATFORM_CLOUD_IDENTITY_V1_SCHEMA;
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  shardId: string;
  action: PlatformCloudIdentityAction;
  iat: number;
  nbf: number;
  exp: number;
}

/**
 * Mints a short-lived, secret-free host attestation after the route has
 * authenticated the user and authorized the exact requested platform action.
 */
export class PlatformCloudIdentityService {
  issue(input: {
    userId: string;
    shardId: string;
    action: PlatformCloudIdentityAction;
    now?: Date;
  }): { token: string; expiresIn: 90 } {
    const privateKeyPem = config.tenantWorkloadReceiptPrivateKey;
    const keyId = config.tenantWorkloadReceiptKeyId;
    const issuer = config.tenantWorkloadReceiptIssuer;
    const audience = config.platformCloudIdentityAudience;
    if (!privateKeyPem || !keyId || !issuer || !audience) {
      throw Errors.serviceUnavailable('Platform cloud identity signing');
    }
    const privateKey = createPrivateKey(privateKeyPem);
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw Errors.serviceUnavailable('Platform cloud identity signing');
    }

    const now = Math.floor((input.now ?? new Date()).getTime() / 1_000);
    const claims = PlatformCloudIdentityClaimsSchema.parse({
      schemaVersion: PLATFORM_CLOUD_IDENTITY_V1_SCHEMA,
      iss: issuer,
      aud: audience,
      sub: `user:${bounded(input.userId, 250)}`,
      jti: `pci_${randomUUID().replace(/-/g, '')}`,
      shardId: bounded(input.shardId, 160),
      action: input.action,
      iat: now,
      nbf: Math.max(0, now - 2),
      exp: now + 90,
    }) satisfies PlatformCloudIdentityClaimsV1;
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: keyId })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    return { token: `${header}.${payload}.${signature}`, expiresIn: 90 };
  }
}

function bounded(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized) || normalized.length > maximum) {
    throw Errors.unauthorized('Platform cloud identity claim is invalid');
  }
  return normalized;
}

export const platformCloudIdentityService = new PlatformCloudIdentityService();
