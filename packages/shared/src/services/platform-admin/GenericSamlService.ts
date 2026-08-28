import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { secretResolver } from './SecretResolver.js';
import { classifyIdentityProviderFailure } from './IdentityProviderFailure.js';
import { validateIdentityProviderCallbackUrl, validateIdentityProviderEndpointUrl, validateIdentityProviderSamlLogoutCallbackUrl } from './IdentityProviderEndpointPolicy.js';

const require = createRequire(import.meta.url);
const nodeSaml = require('@node-saml/node-saml');

type SamlProfile = Record<string, unknown>;
type SignatureAlgorithm = 'sha256' | 'sha512';

export interface GenericSamlProviderConfiguration {
  entityId: string;
  idpEntityId: string;
  callbackUrl: string;
  ssoUrl: string;
  signingCertificateRef: string;
  signatureAlgorithm: SignatureAlgorithm;
  sloUrl?: string;
  logoutCallbackUrl?: string;
  requestSigningPrivateKeyRef?: string;
  requestSigningCertificateRef?: string;
  requestedAuthnContext: string[];
  mfaAuthnContextValues: string[];
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
  const sloUrl = typeof raw.sloUrl === 'string' && raw.sloUrl.trim()
    ? validateIdentityProviderEndpointUrl(raw.sloUrl, 'SAML sloUrl', ['https:']).toString()
    : undefined;
  const logoutCallbackUrl = typeof raw.logoutCallbackUrl === 'string' && raw.logoutCallbackUrl.trim()
    ? validateIdentityProviderSamlLogoutCallbackUrl(raw.logoutCallbackUrl).toString()
    : undefined;
  const requestSigningPrivateKeyRef = typeof raw.requestSigningPrivateKeyRef === 'string' && raw.requestSigningPrivateKeyRef.trim()
    ? raw.requestSigningPrivateKeyRef.trim()
    : undefined;
  if (sloUrl && !logoutCallbackUrl) throw new Error('SAML logoutCallbackUrl is required when sloUrl is configured');
  if (sloUrl && !requestSigningPrivateKeyRef) throw new Error('SAML requestSigningPrivateKeyRef is required when sloUrl is configured');
  return {
    entityId: required(raw.entityId, 'entityId'),
    idpEntityId: required(raw.idpEntityId, 'idpEntityId'),
    callbackUrl: validateIdentityProviderCallbackUrl(required(raw.callbackUrl, 'callbackUrl'), 'saml').toString(),
    ssoUrl: validateIdentityProviderEndpointUrl(required(raw.ssoUrl, 'ssoUrl'), 'SAML ssoUrl', ['https:']).toString(),
    signingCertificateRef: required(raw.signingCertificateRef, 'signingCertificateRef'),
    signatureAlgorithm,
    sloUrl,
    logoutCallbackUrl,
    requestSigningPrivateKeyRef,
    requestSigningCertificateRef: typeof raw.requestSigningCertificateRef === 'string' && raw.requestSigningCertificateRef.trim()
      ? raw.requestSigningCertificateRef.trim()
      : undefined,
    requestedAuthnContext: Array.isArray(raw.requestedAuthnContext)
      ? raw.requestedAuthnContext.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, 20)
      : [],
    mfaAuthnContextValues: Array.isArray(raw.mfaAuthnContextValues)
      ? raw.mfaAuthnContextValues.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, 20)
      : [],
    nameIdAttribute: typeof raw.nameIdAttribute === 'string' ? raw.nameIdAttribute.trim() || undefined : undefined,
    emailAttribute: typeof raw.emailAttribute === 'string' ? raw.emailAttribute.trim() || undefined : undefined,
    groupAttribute: typeof raw.groupAttribute === 'string' ? raw.groupAttribute.trim() || undefined : undefined,
  };
}

function records(value: unknown): Array<Record<string, unknown>> {
  const source = Array.isArray(value) ? value : [value];
  return source.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

/**
 * node-saml verifies XML signatures and assertion audience, but its POST
 * validator intentionally does not enforce the HTTP-POST recipient when
 * InResponseTo validation is disabled. Direct provider callbacks bind the
 * signed response to our configured ACS URL here, after signature validation
 * and without including raw assertion data in any error.
 */
function requireExpectedRecipientAndRequest(profile: SamlProfile, callbackUrl: string, expectedRequestId: string): void {
  if (profile.inResponseTo !== expectedRequestId) {
    throw new Error('SAML response does not match the issued authentication request');
  }
  const getAssertion = profile.getAssertion;
  if (typeof getAssertion !== 'function') throw new Error('SAML response did not include a validated assertion');
  const assertion = getAssertion();
  const parsedAssertions = records(assertion).flatMap((entry) => records(entry.Assertion));
  const confirmations = parsedAssertions
    .flatMap((entry) => records(entry.Subject))
    .flatMap((subject) => records(subject.SubjectConfirmation))
    .flatMap((confirmation) => records(confirmation.SubjectConfirmationData));
  const recipients = confirmations
    .flatMap((data) => records(data.$))
    .map((attributes) => attributes.Recipient)
    .filter((recipient): recipient is string => typeof recipient === 'string' && Boolean(recipient));
  if (!recipients.some((recipient) => recipient === callbackUrl)) {
    throw new Error('SAML response recipient does not match the callback URL');
  }
  const requestIds = confirmations
    .flatMap((data) => records(data.$))
    .map((attributes) => attributes.InResponseTo)
    .filter((requestId): requestId is string => typeof requestId === 'string' && Boolean(requestId));
  if (!requestIds.some((requestId) => requestId === expectedRequestId)) {
    throw new Error('SAML subject confirmation does not match the issued authentication request');
  }
}

function requestCorrelationCache(expectedRequestId: string) {
  return {
    async saveAsync(key: string, value: string) {
      return key === expectedRequestId ? { value, createdAt: Date.now() } : null;
    },
    async getAsync(key: string) {
      return key === expectedRequestId ? new Date().toISOString() : null;
    },
    async removeAsync(key: string | null) {
      return key === expectedRequestId ? key : null;
    },
  };
}

async function resolveSamlSecret(
  reference: string | undefined,
  purpose: 'saml.idp_signing_certificate' | 'saml.request_signing_private_key' | 'saml.request_signing_certificate',
  context?: { tenantId?: string | null; correlationId?: string },
): Promise<string | null> {
  if (!reference) return null;
  const stored = reference.startsWith('ref:') ? reference : `ref:${reference}`;
  if (!stored.includes('tenant-secret://')) return secretResolver.resolveStored(stored);
  if (!context?.tenantId) throw new Error('SAML tenant secret context is unavailable');
  return secretResolver.resolveTenantStored(stored, {
    tenantId: context.tenantId,
    purpose,
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
  });
}

async function client(
  raw: Record<string, unknown>,
  expectedRequestId: string,
  secretContext?: { tenantId?: string | null; correlationId?: string },
): Promise<{ config: GenericSamlProviderConfiguration; saml: any }> {
  if (!/^_[A-Za-z0-9_-]{32,160}$/.test(expectedRequestId)) throw new Error('SAML authentication request id is invalid');
  const config = configuration(raw);
  const certificate = await resolveSamlSecret(config.signingCertificateRef, 'saml.idp_signing_certificate', secretContext);
  if (!certificate) throw new Error('SAML signing certificate reference is unavailable');
  const requestSigningPrivateKey = config.requestSigningPrivateKeyRef
    ? await resolveSamlSecret(config.requestSigningPrivateKeyRef, 'saml.request_signing_private_key', secretContext)
    : null;
  const requestSigningCertificate = config.requestSigningCertificateRef
    ? await resolveSamlSecret(config.requestSigningCertificateRef, 'saml.request_signing_certificate', secretContext)
    : null;
  if (config.sloUrl && !requestSigningPrivateKey) throw new Error('SAML request-signing private key reference is unavailable');
  return {
    config,
    saml: new nodeSaml.SAML({
      issuer: config.entityId,
      callbackUrl: config.callbackUrl,
      entryPoint: config.ssoUrl,
      idpIssuer: config.idpEntityId,
      idpCert: normalizePemCertificate(certificate),
      signatureAlgorithm: config.signatureAlgorithm,
      validateInResponseTo: 'always',
      requestIdExpirationPeriodMs: 10 * 60 * 1000,
      cacheProvider: requestCorrelationCache(expectedRequestId),
      generateUniqueId: () => expectedRequestId,
      acceptedClockSkewMs: 300_000,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      ...(config.sloUrl ? { logoutUrl: config.sloUrl } : {}),
      ...(requestSigningPrivateKey ? { privateKey: requestSigningPrivateKey } : {}),
      ...(requestSigningCertificate ? { publicCert: normalizePemCertificate(requestSigningCertificate) } : {}),
      disableRequestedAuthnContext: config.requestedAuthnContext.length === 0,
      ...(config.requestedAuthnContext.length > 0 ? { authnContext: config.requestedAuthnContext } : {}),
    }),
  };
}

export class GenericSamlService {
  async createAuthorizationRequest(raw: Record<string, unknown>, relayState: string, requestId: string, secretContext?: { tenantId?: string | null; correlationId?: string }): Promise<{ url: string; entryPoint: string }> {
    try {
      const { config, saml } = await client(raw, requestId, secretContext);
      return { url: await saml.getAuthorizeUrlAsync(relayState, undefined, {}), entryPoint: config.ssoUrl };
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  async validatePostResponse(raw: Record<string, unknown>, samlResponse: string, expectedRequestId: string, secretContext?: { tenantId?: string | null; correlationId?: string }): Promise<SamlProfile> {
    try {
      const { config, saml } = await client(raw, expectedRequestId, secretContext);
      const { profile, loggedOut } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
      if (loggedOut) throw new Error('Unexpected SAML logout response');
      if (!profile) throw new Error('SAML assertion did not contain a profile');
      const normalizedProfile = profile as SamlProfile;
      if (normalizedProfile.issuer !== config.idpEntityId) throw new Error('SAML assertion issuer does not match the configured identity provider');
      requireExpectedRecipientAndRequest(normalizedProfile, config.callbackUrl, expectedRequestId);
      return normalizedProfile;
    } catch (error) { throw classifyIdentityProviderFailure(error, 'invalid_signature'); }
  }

  extractUserClaims(raw: Record<string, unknown>, profile: SamlProfile): GenericSamlUserClaims {
    try {
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
    } catch (error) { throw classifyIdentityProviderFailure(error, 'missing_subject'); }
  }

  authenticationAssurance(raw: Record<string, unknown>, profile: SamlProfile): { mfaVerified: boolean; authnContext: string[] } {
    const config = configuration(raw);
    const getAssertion = profile.getAssertion;
    const assertion = typeof getAssertion === 'function' ? getAssertion() : null;
    const authnContext = records(assertion).flatMap((entry) => records(entry.Assertion))
      .flatMap((entry) => records(entry.AuthnStatement))
      .flatMap((entry) => records(entry.AuthnContext))
      .flatMap((entry) => records(entry.AuthnContextClassRef))
      .map((entry) => entry._)
      .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry));
    return {
      mfaVerified: config.mfaAuthnContextValues.length > 0
        && authnContext.some((value) => config.mfaAuthnContextValues.includes(value)),
      authnContext,
    };
  }

  async createLogoutRequest(
    raw: Record<string, unknown>,
    relayState: string,
    profile: { nameID: string; nameIDFormat: string; sessionIndex?: string },
    correlatedRequestId?: string,
    secretContext?: { tenantId?: string | null; correlationId?: string },
  ): Promise<{ url: string; requestId: string } | null> {
    const requestId = correlatedRequestId || `_${randomBytes(32).toString('base64url')}`;
    try {
      const { config, saml } = await client(raw, requestId, secretContext);
      if (!config.sloUrl) return null;
      return { url: await saml.getLogoutUrlAsync(profile, relayState, {}), requestId };
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  /** Accepts only XML-signed HTTP-POST LogoutRequest messages from the configured IdP. */
  async validatePostLogoutRequest(raw: Record<string, unknown>, samlRequest: string, secretContext?: { tenantId?: string | null; correlationId?: string }): Promise<SamlProfile> {
    const requestId = `_${randomBytes(32).toString('base64url')}`;
    try {
      const { config, saml } = await client(raw, requestId, secretContext);
      if (!config.sloUrl) throw new Error('SAML single logout is not configured');
      const { profile, loggedOut } = await saml.validatePostRequestAsync({ SAMLRequest: samlRequest });
      if (!loggedOut || !profile || profile.issuer !== config.idpEntityId) throw new Error('Invalid SAML LogoutRequest');
      return profile as SamlProfile;
    } catch (error) { throw classifyIdentityProviderFailure(error, 'invalid_signature'); }
  }

  async createLogoutResponse(raw: Record<string, unknown>, request: SamlProfile, relayState: string, secretContext?: { tenantId?: string | null; correlationId?: string }): Promise<string> {
    const requestId = `_${randomBytes(32).toString('base64url')}`;
    try {
      const { config, saml } = await client(raw, requestId, secretContext);
      if (!config.sloUrl) throw new Error('SAML single logout is not configured');
      return await saml.getLogoutResponseUrlAsync(request, relayState, {}, true);
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  async validateRedirectLogoutResponse(
    raw: Record<string, unknown>,
    query: Record<string, unknown>,
    originalQuery: string,
    expectedRequestId: string,
    secretContext?: { tenantId?: string | null; correlationId?: string },
  ): Promise<void> {
    try {
      if (typeof query.Signature !== 'string' || typeof query.SigAlg !== 'string') throw new Error('SAML Redirect LogoutResponse must be signed');
      const { saml } = await client(raw, expectedRequestId, secretContext);
      const { loggedOut } = await saml.validateRedirectAsync(query, originalQuery);
      if (!loggedOut) throw new Error('Invalid SAML LogoutResponse');
    } catch (error) { throw classifyIdentityProviderFailure(error, 'invalid_signature'); }
  }

  async validatePostLogoutResponse(raw: Record<string, unknown>, samlResponse: string, expectedRequestId: string, secretContext?: { tenantId?: string | null; correlationId?: string }): Promise<void> {
    try {
      const { saml } = await client(raw, expectedRequestId, secretContext);
      const { loggedOut } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
      if (!loggedOut) throw new Error('Invalid SAML LogoutResponse');
    } catch (error) { throw classifyIdentityProviderFailure(error, 'invalid_signature'); }
  }
}

export const genericSamlService = new GenericSamlService();
