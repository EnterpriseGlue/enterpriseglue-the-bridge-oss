import { createRequire } from 'node:module';
import { logger } from '@shared/utils/logger.js';
import { config } from '@shared/config/index.js';
import { getDataSource } from '@shared/db/data-source.js';
import { User } from '@shared/db/entities/User.js';
import { generateId } from '@shared/utils/id.js';
import { ssoClaimsMappingService, type SsoClaims } from './platform-admin/SsoClaimsMappingService.js';
import { ssoProviderService } from './platform-admin/SsoProviderService.js';

const require = createRequire(import.meta.url);
const nodeSaml = require('@node-saml/node-saml');

type SamlClient = any;
type SamlProfile = Record<string, unknown>;

type SignatureAlgorithm = 'sha1' | 'sha256' | 'sha512';

const EMAIL_CLAIM_KEYS = [
  'email',
  'mail',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];

const OID_CLAIM_KEYS = [
  'oid',
  'http://schemas.microsoft.com/identity/claims/objectidentifier',
  'http://schemas.microsoft.com/identity/claims/objectid',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
];

const GIVEN_NAME_CLAIM_KEYS = [
  'given_name',
  'givenName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];

const FAMILY_NAME_CLAIM_KEYS = [
  'family_name',
  'surname',
  'sn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
];

const NAME_CLAIM_KEYS = [
  'name',
  'displayName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];

const GROUP_CLAIM_KEYS = [
  'groups',
  'group',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
  'http://schemas.xmlsoap.org/claims/Group',
];

const ROLE_CLAIM_KEYS = [
  'roles',
  'role',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
  'http://schemas.xmlsoap.org/claims/Role',
];

const TENANT_ID_CLAIM_KEYS = [
  'tid',
  'tenantid',
  'http://schemas.microsoft.com/identity/claims/tenantid',
];

export interface SamlUserInfo {
  email: string;
  oid?: string;
  tid?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  groups: string[];
  roles: string[];
  nameId?: string;
}

function normalizePemCertificate(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('BEGIN CERTIFICATE')) {
    return trimmed.replace(/\r\n/g, '\n');
  }

  const body = trimmed.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

function getFirstClaimValue(profile: SamlProfile, keys: string[]): unknown {
  for (const key of keys) {
    if (profile[key] !== undefined && profile[key] !== null) {
      return profile[key];
    }
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    return asString(value[0]);
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];

  if (Array.isArray(value)) {
    return value
      .map((v) => asString(v))
      .filter((v): v is string => Boolean(v));
  }

  const single = asString(value);
  return single ? [single] : [];
}

function uniqueLowerCase(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }

  return output;
}

async function getEnabledSamlProvider() {
  const provider = await ssoProviderService.getProviderByType('saml');
  if (!provider || !provider.enabled) {
    throw new Error('SAML authentication is not enabled');
  }
  if (!provider.entityId || !provider.ssoUrl || !provider.certificateEnc) {
    throw new Error('SAML provider is missing required configuration');
  }
  return provider;
}

function getSamlClient(provider: Awaited<ReturnType<typeof getEnabledSamlProvider>>): SamlClient {
  if (!provider.entityId || !provider.ssoUrl || !provider.certificateEnc) {
    throw new Error('SAML provider is missing required configuration');
  }

  const callbackUrl =
    provider.callbackUrl || `${config.frontendUrl.replace(/\/$/, '')}/api/auth/saml/callback`;

  return new nodeSaml.SAML({
    issuer: provider.entityId,
    callbackUrl,
    entryPoint: provider.ssoUrl,
    idpCert: normalizePemCertificate(provider.certificateEnc),
    signatureAlgorithm: (provider.signatureAlgorithm || 'sha256') as SignatureAlgorithm,
    validateInResponseTo: 'never',
    acceptedClockSkewMs: 300000,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
  });
}

export async function isSamlAuthEnabled(): Promise<boolean> {
  try {
    await getEnabledSamlProvider();
    return true;
  } catch {
    return false;
  }
}

export async function getSamlAuthorizationUrl(relayState: string): Promise<{ url: string; entryPoint: string }> {
  const provider = await getEnabledSamlProvider();
  const samlClient = getSamlClient(provider);
  const url = await samlClient.getAuthorizeUrlAsync(relayState, undefined, {});
  return { url, entryPoint: provider.ssoUrl! };
}

export async function validateSamlPostResponse(samlResponse: string): Promise<{ profile: SamlProfile; providerId: string }> {
  const provider = await getEnabledSamlProvider();
  const samlClient = getSamlClient(provider);

  const { profile, loggedOut } = await samlClient.validatePostResponseAsync({
    SAMLResponse: samlResponse,
  });

  if (loggedOut) {
    throw new Error('Unexpected SAML logout response');
  }

  if (!profile) {
    throw new Error('No SAML profile returned');
  }

  return {
    profile: profile as SamlProfile,
    providerId: provider.id,
  };
}

export async function generateSamlServiceProviderMetadata(): Promise<string> {
  const provider = await getEnabledSamlProvider();
  const samlClient = getSamlClient(provider);
  return samlClient.generateServiceProviderMetadata(null, null);
}

export function extractSamlUserInfo(profile: SamlProfile): SamlUserInfo {
  const nameId = asString(profile.nameID) || asString(profile.nameId) || asString(profile.NameID);

  let email = asString(getFirstClaimValue(profile, EMAIL_CLAIM_KEYS));
  if (!email && nameId?.includes('@')) {
    email = nameId;
  }

  if (!email) {
    throw new Error('Email not found in SAML assertion');
  }

  const oid = asString(getFirstClaimValue(profile, OID_CLAIM_KEYS));
  const givenName = asString(getFirstClaimValue(profile, GIVEN_NAME_CLAIM_KEYS));
  const familyName = asString(getFirstClaimValue(profile, FAMILY_NAME_CLAIM_KEYS));
  const name = asString(getFirstClaimValue(profile, NAME_CLAIM_KEYS));
  const tid = asString(getFirstClaimValue(profile, TENANT_ID_CLAIM_KEYS));

  const groups = uniqueLowerCase(
    GROUP_CLAIM_KEYS.flatMap((key) => asStringArray(profile[key]))
  );
  const roles = uniqueLowerCase(
    ROLE_CLAIM_KEYS.flatMap((key) => asStringArray(profile[key]))
  );

  return {
    email: email.toLowerCase(),
    oid,
    tid,
    name,
    given_name: givenName,
    family_name: familyName,
    groups,
    roles,
    nameId,
  };
}

export async function provisionSamlUser(userInfo: SamlUserInfo, providerId: string) {
  const dataSource = await getDataSource();
  const userRepo = dataSource.getRepository(User);
  const now = Date.now();

  const ssoClaims: SsoClaims = {
    email: userInfo.email,
    groups: userInfo.groups,
    roles: userInfo.roles,
  };

  const resolvedRole = await ssoClaimsMappingService.resolveRoleFromClaims(ssoClaims, providerId);

  logger.info('[SAML Auth] SSO claims role resolution:', {
    email: userInfo.email,
    groups: userInfo.groups,
    roles: userInfo.roles,
    resolvedRole,
  });

  const existingByEntraId = userInfo.oid ? await userRepo.findOneBy({ entraId: userInfo.oid }) : null;

  if (existingByEntraId) {
    const user = existingByEntraId;
    const currentRole = user.platformRole || 'user';
    const platformRole = currentRole === 'admin' ? 'admin' : resolvedRole;

    await userRepo.update({ id: user.id }, {
      email: userInfo.email,
      authProvider: 'microsoft',
      entraEmail: userInfo.email,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
      platformRole,
      lastLoginAt: now,
      updatedAt: now,
    });

    return {
      ...user,
      email: userInfo.email,
      platformRole,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
    };
  }

  const existingByEmail = await userRepo.findOneBy({ email: userInfo.email });

  if (existingByEmail) {
    const user = existingByEmail;
    const currentRole = user.platformRole || 'user';
    const platformRole = currentRole === 'admin' ? 'admin' : resolvedRole;

    await userRepo.update({ id: user.id }, {
      authProvider: 'microsoft',
      entraId: userInfo.oid || user.entraId,
      entraEmail: userInfo.email,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
      platformRole,
      lastLoginAt: now,
      updatedAt: now,
      mustResetPassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    return {
      ...user,
      authProvider: 'microsoft',
      entraId: userInfo.oid || user.entraId,
      platformRole,
      firstName: userInfo.given_name || user.firstName,
      lastName: userInfo.family_name || user.lastName,
    };
  }

  const userId = generateId();

  await userRepo.insert({
    id: userId,
    email: userInfo.email,
    authProvider: 'microsoft',
    passwordHash: null,
    entraId: userInfo.oid || null,
    entraEmail: userInfo.email,
    firstName: userInfo.given_name || null,
    lastName: userInfo.family_name || null,
    platformRole: resolvedRole,
    isActive: true,
    mustResetPassword: false,
    failedLoginAttempts: 0,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  });

  return await userRepo.findOneBy({ id: userId });
}
