import { createRequire } from 'node:module';
import { secretResolver } from './SecretResolver.js';

const require = createRequire(import.meta.url);
const nodeSaml = require('@node-saml/node-saml');

type SamlProfile = Record<string, unknown>;
type SignatureAlgorithm = 'sha256' | 'sha512';

export interface GenericSamlProviderConfiguration {
  entityId: string;
  callbackUrl: string;
  ssoUrl: string;
  signingCertificateRef: string;
  signatureAlgorithm: SignatureAlgorithm;
  nameIdAttribute?: string;
  emailAttribute?: string;
  groupAttribute?: string;
}

export interface GenericSamlUserClaims {
  subjectId: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  directoryTenantId: string | null;
  claims: Record<string, unknown>;
}

function requireHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`SAML ${field} is required`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`SAML ${field} must be a valid URL`); }
  if (url.protocol !== 'https:') throw new Error(`SAML ${field} must use HTTPS`);
  return url.toString();
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`SAML ${field} is required`);
  return value.trim();
}

function normalizePemCertificate(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('BEGIN CERTIFICATE')) return trimmed.replace(/\r\n/g, '\n');
  const body = trimmed.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

function values(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(new Set(source.map((entry) => String(entry).trim()).filter(Boolean)));
}

function first(profile: SamlProfile, ...keys: Array<string | undefined>): string | null {
  for (const key of keys) {
    if (!key) continue;
    const value = values(profile[key])[0];
    if (value) return value;
  }
  return null;
}

function configuration(raw: Record<string, unknown>): GenericSamlProviderConfiguration {
  if (raw.signatureAlgorithm !== undefined && raw.signatureAlgorithm !== 'sha256' && raw.signatureAlgorithm !== 'sha512') {
    throw new Error('SAML signatureAlgorithm must be sha256 or sha512');
  }
  const signatureAlgorithm: SignatureAlgorithm = raw.signatureAlgorithm === 'sha512' ? 'sha512' : 'sha256';
  return {
    entityId: required(raw.entityId, 'entityId'),
    callbackUrl: requireHttpsUrl(raw.callbackUrl, 'callbackUrl'),
    ssoUrl: requireHttpsUrl(raw.ssoUrl, 'ssoUrl'),
    signingCertificateRef: required(raw.signingCertificateRef, 'signingCertificateRef'),
    signatureAlgorithm,
    nameIdAttribute: typeof raw.nameIdAttribute === 'string' ? raw.nameIdAttribute.trim() || undefined : undefined,
    emailAttribute: typeof raw.emailAttribute === 'string' ? raw.emailAttribute.trim() || undefined : undefined,
    groupAttribute: typeof raw.groupAttribute === 'string' ? raw.groupAttribute.trim() || undefined : undefined,
  };
}

function client(raw: Record<string, unknown>): { config: GenericSamlProviderConfiguration; saml: any } {
  const config = configuration(raw);
  const certificate = secretResolver.resolveStored(config.signingCertificateRef.startsWith('ref:') ? config.signingCertificateRef : `ref:${config.signingCertificateRef}`);
  if (!certificate) throw new Error('SAML signing certificate reference is unavailable');
  return {
    config,
    saml: new nodeSaml.SAML({
      issuer: config.entityId,
      callbackUrl: config.callbackUrl,
      entryPoint: config.ssoUrl,
      idpCert: normalizePemCertificate(certificate),
      signatureAlgorithm: config.signatureAlgorithm,
      validateInResponseTo: 'never',
      acceptedClockSkewMs: 300_000,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
    }),
  };
}

export class GenericSamlService {
  async createAuthorizationRequest(raw: Record<string, unknown>, relayState: string): Promise<{ url: string; entryPoint: string }> {
    const { config, saml } = client(raw);
    return { url: await saml.getAuthorizeUrlAsync(relayState, undefined, {}), entryPoint: config.ssoUrl };
  }

  async validatePostResponse(raw: Record<string, unknown>, samlResponse: string): Promise<SamlProfile> {
    const { saml } = client(raw);
    const { profile, loggedOut } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
    if (loggedOut) throw new Error('Unexpected SAML logout response');
    if (!profile) throw new Error('SAML assertion did not contain a profile');
    return profile as SamlProfile;
  }

  extractUserClaims(raw: Record<string, unknown>, profile: SamlProfile): GenericSamlUserClaims {
    const config = configuration(raw);
    const nameId = first(profile, config.nameIdAttribute, 'nameID', 'nameId', 'NameID');
    const email = first(profile, config.emailAttribute, 'email', 'mail', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress') || (nameId?.includes('@') ? nameId : null);
    if (!email) throw new Error('SAML assertion must contain an email address');
    const subjectId = nameId || first(profile, 'oid', 'http://schemas.microsoft.com/identity/claims/objectidentifier') || email;
    const groups = values(profile[config.groupAttribute || 'groups']);
    const claims: Record<string, unknown> = { ...profile, sub: subjectId, email: email.toLowerCase() };
    if (groups.length) claims.groups = groups;
    return {
      subjectId,
      email: email.toLowerCase(),
      displayName: first(profile, 'name', 'displayName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'),
      firstName: first(profile, 'given_name', 'givenName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'),
      lastName: first(profile, 'family_name', 'surname', 'sn', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'),
      directoryTenantId: first(profile, 'tid', 'tenantid', 'http://schemas.microsoft.com/identity/claims/tenantid'),
      claims,
    };
  }
}

export const genericSamlService = new GenericSamlService();
