import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { IsNull, MoreThan } from 'typeorm';

import { config } from '@enterpriseglue/shared/config/index.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { runWithPlatformDatabaseCapability } from '../platform-database-context.js';
import type { AuthenticatedUserJwtPayload } from '@enterpriseglue/shared/utils/jwt.js';
import {
  PlatformCloudIdentityClaimsSchema,
  type PlatformCloudIdentityAction,
  PlatformCloudOrganizationRequesterSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/tenant.js';

export const PLATFORM_CLOUD_IDENTITY_V1_SCHEMA = 'platform-cloud-identity.enterpriseglue.io/v1' as const;
const PLATFORM_CLOUD_IDENTITY_V2_SCHEMA = 'platform-cloud-identity.enterpriseglue.io/v2' as const;
type Requester = ReturnType<typeof PlatformCloudOrganizationRequesterSchema.parse>;

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
  async organizationRequester(principal: AuthenticatedUserJwtPayload): Promise<Requester> {
    const denied = () => Errors.forbidden('Sign in with a verified account to request an organization');
    if (!principal.sessionId || principal.recovery) throw denied();
    const dataSource = await getDataSource();
    const user = await dataSource.getRepository(User).findOneBy({ id: principal.userId, email: principal.email,
      isActive: true, isEmailVerified: true, authSessionVersion: principal.authSessionVersion ?? 0 });
    if (!user) throw denied();
    const session = await dataSource.getRepository(RefreshToken).findOneBy({ id: principal.sessionId, userId: principal.userId,
      tenantId: principal.tenantId || IsNull(), revokedAt: IsNull(), expiresAt: MoreThan(Date.now()) });
    if (!session) throw denied();

    const authenticationMethod: string | undefined = principal.authenticationMethod;
    let method: Requester['method'];
    if (authenticationMethod === 'email_link' && user.authProvider === 'email_link' && !session.identityProviderId && !principal.mfaVerified) {
      method = 'email';
    } else if (authenticationMethod === 'passkey' && principal.mfaVerified && !session.identityProviderId) {
      method = 'passkey';
    } else {
      const providerId = session.identityProviderId;
      if (!providerId || !session.providerSubjectId || (authenticationMethod !== 'oidc' && authenticationMethod !== 'saml' && authenticationMethod !== 'ldap')) throw denied();
      const provider = await runWithPlatformDatabaseCapability({ kind: 'session-account', providerId, userId: principal.userId }, () =>
        dataSource.getRepository(IdentityProvider).findOneBy({ id: providerId, isEnabled: true, authenticationMode: 'direct', protocol: authenticationMethod }));
      if (!provider) throw denied();
      method = organizationProviderMethod(provider);
    }
    return PlatformCloudOrganizationRequesterSchema.parse({ email: user.email, method });
  }

  issue(input: {
    userId: string;
    shardId: string;
    action: PlatformCloudIdentityAction;
    requester?: Requester;
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
      schemaVersion: input.requester ? PLATFORM_CLOUD_IDENTITY_V2_SCHEMA : PLATFORM_CLOUD_IDENTITY_V1_SCHEMA,
      iss: issuer,
      aud: audience,
      sub: `user:${bounded(input.userId, 250)}`,
      jti: `pci_${randomUUID().replace(/-/g, '')}`,
      shardId: bounded(input.shardId, 160),
      action: input.action,
      iat: now,
      nbf: Math.max(0, now - 2),
      exp: now + 90,
      ...(input.requester ? { requester: input.requester } : {}),
    });
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: keyId })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');
    return { token: `${header}.${payload}.${signature}`, expiresIn: 90 };
  }
}

function organizationProviderMethod(provider: IdentityProvider): Requester['method'] {
  if (provider.tenantId || provider.protocol !== 'oidc') return 'sso';
  let issuer: string;
  try { issuer = new URL(JSON.parse(provider.configurationJson).issuerUrl).origin; }
  catch { return 'sso'; }
  if (issuer === 'https://accounts.google.com') return 'google';
  if (issuer === 'https://login.microsoftonline.com') return 'microsoft';
  return 'sso';
}

function bounded(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized) || normalized.length > maximum) {
    throw Errors.unauthorized('Platform cloud identity claim is invalid');
  }
  return normalized;
}

export const platformCloudIdentityService = new PlatformCloudIdentityService();
