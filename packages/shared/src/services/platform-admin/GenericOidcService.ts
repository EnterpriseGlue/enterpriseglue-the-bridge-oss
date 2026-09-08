import { createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { secretResolver } from './SecretResolver.js';
import { IdentityProviderFailure, classifyIdentityProviderFailure } from './IdentityProviderFailure.js';
import { readBoundedIdentityProviderJson, validateIdentityProviderCallbackUrl, validateIdentityProviderEndpointUrl, validateIdentityProviderLogoutRedirectUrl } from './IdentityProviderEndpointPolicy.js';

export interface GenericOidcProviderConfiguration {
  issuerUrl: string;
  clientId: string;
  clientAuthentication: 'client_secret_post' | 'apple_private_key_jwt';
  clientSecretRef?: string;
  appleTeamId?: string;
  appleKeyId?: string;
  applePrivateKeyRef?: string;
  callbackUrl: string;
  scopes: string[];
  expectedAudience?: string;
  requestedAcrValues: string[];
  mfaAmrValues: string[];
  mfaAcrValues: string[];
  postLogoutRedirectUrl?: string;
}

interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

export interface OidcAuthorizationRequest {
  url: string;
  codeVerifier: string;
  responseMode?: 'query' | 'form_post';
}

export interface OidcIdentityClaims extends JwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | 'true' | 'false';
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  tid?: string;
  nonce?: string;
  sid?: string;
  amr?: string[];
  acr?: string;
}

export interface OidcBackChannelLogoutClaims extends JwtPayload {
  sub?: string;
  sid?: string;
  events: Record<string, unknown>;
}

const BACK_CHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

function base64Url(value: Buffer): string {
  return value.toString('base64url');
}

function normalizeIssuer(value: string): string {
  return value.replace(/\/$/, '');
}

function config(input: Record<string, unknown>): GenericOidcProviderConfiguration {
  const issuerUrl = typeof input.issuerUrl === 'string' ? input.issuerUrl : '';
  const clientId = typeof input.clientId === 'string' ? input.clientId : '';
  const callbackUrl = typeof input.callbackUrl === 'string' ? input.callbackUrl : '';
  const scopes = Array.isArray(input.scopes) ? input.scopes.filter((scope): scope is string => typeof scope === 'string' && Boolean(scope.trim())) : [];
  validateIdentityProviderEndpointUrl(issuerUrl, 'OIDC issuerUrl', ['https:']);
  validateIdentityProviderCallbackUrl(callbackUrl, 'oidc');
  if (!clientId.trim()) throw new Error('OIDC clientId is required');
  if (typeof input.expectedAudience === 'string' && input.expectedAudience.trim() !== clientId.trim()) {
    throw new Error('OIDC expectedAudience must equal clientId; ID tokens are always audience-bound to this client');
  }
  const clientAuthentication = input.clientAuthentication === 'apple_private_key_jwt'
    ? 'apple_private_key_jwt'
    : 'client_secret_post';
  const appleTeamId = typeof input.appleTeamId === 'string' ? input.appleTeamId.trim() : undefined;
  const appleKeyId = typeof input.appleKeyId === 'string' ? input.appleKeyId.trim() : undefined;
  const applePrivateKeyRef = typeof input.applePrivateKeyRef === 'string' ? input.applePrivateKeyRef.trim() : undefined;
  if (clientAuthentication === 'apple_private_key_jwt') {
    if (normalizeIssuer(issuerUrl) !== 'https://appleid.apple.com') throw new Error('Apple private-key authentication requires the Apple issuer');
    if (!appleTeamId || !/^[A-Z0-9]{10}$/.test(appleTeamId)) throw new Error('Apple Team ID must be a 10-character identifier');
    if (!appleKeyId || !/^[A-Z0-9]{10}$/.test(appleKeyId)) throw new Error('Apple Key ID must be a 10-character identifier');
    if (!applePrivateKeyRef) throw new Error('Apple private key reference is required');
    if (typeof input.clientSecretRef === 'string' && input.clientSecretRef.trim()) throw new Error('Apple client secrets are generated from the private key');
    if (scopes.some((scope) => !['name', 'email'].includes(scope))) throw new Error('Apple scopes may contain only name and email');
  } else if (!scopes.includes('openid')) {
    throw new Error('OIDC scopes must include openid');
  }
  const strings = (value: unknown, max: number) => Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).slice(0, max).map((entry) => entry.trim())
    : [];
  const postLogoutRedirectUrl = typeof input.postLogoutRedirectUrl === 'string' && input.postLogoutRedirectUrl.trim()
    ? validateIdentityProviderLogoutRedirectUrl(input.postLogoutRedirectUrl).toString()
    : undefined;
  return {
    issuerUrl: normalizeIssuer(issuerUrl), clientId: clientId.trim(), callbackUrl, clientAuthentication,
    scopes, clientSecretRef: typeof input.clientSecretRef === 'string' ? input.clientSecretRef : undefined,
    appleTeamId, appleKeyId, applePrivateKeyRef,
    expectedAudience: typeof input.expectedAudience === 'string' ? input.expectedAudience : undefined,
    requestedAcrValues: strings(input.requestedAcrValues, 20),
    mfaAmrValues: strings(input.mfaAmrValues, 20),
    mfaAcrValues: strings(input.mfaAcrValues, 20),
    postLogoutRedirectUrl,
  };
}

async function fetchJson(url: URL): Promise<Record<string, unknown>> {
  const response = await fetch(url, { redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`OIDC discovery request failed (${response.status})`);
  }
  return readBoundedIdentityProviderJson(response, 'OIDC provider response');
}

async function discover(issuerUrl: string): Promise<OidcDiscoveryDocument> {
  const issuer = validateIdentityProviderEndpointUrl(issuerUrl, 'OIDC issuerUrl', ['https:']);
  const document = await fetchJson(new URL('.well-known/openid-configuration', `${issuer.toString().replace(/\/$/, '')}/`));
  const expectedIssuer = normalizeIssuer(issuer.toString());
  const discoveredIssuer = typeof document.issuer === 'string' ? normalizeIssuer(document.issuer) : '';
  if (discoveredIssuer !== expectedIssuer) throw new Error('OIDC discovery issuer does not match the configured issuer');
  const authorizationEndpoint = typeof document.authorization_endpoint === 'string' ? document.authorization_endpoint : '';
  const tokenEndpoint = typeof document.token_endpoint === 'string' ? document.token_endpoint : '';
  const jwksUri = typeof document.jwks_uri === 'string' ? document.jwks_uri : '';
  validateIdentityProviderEndpointUrl(authorizationEndpoint, 'OIDC authorization endpoint', ['https:']);
  validateIdentityProviderEndpointUrl(tokenEndpoint, 'OIDC token endpoint', ['https:']);
  validateIdentityProviderEndpointUrl(jwksUri, 'OIDC JWKS URI', ['https:']);
  const endSessionEndpoint = typeof document.end_session_endpoint === 'string' && document.end_session_endpoint.trim()
    ? validateIdentityProviderEndpointUrl(document.end_session_endpoint, 'OIDC end-session endpoint', ['https:']).toString()
    : undefined;
  return { issuer: discoveredIssuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, jwks_uri: jwksUri, end_session_endpoint: endSessionEndpoint };
}

async function resolveSecretReference(
  reference?: string,
  context?: { tenantId?: string | null; correlationId?: string },
  purpose: 'oidc.client_secret' | 'oidc.apple_private_key' = 'oidc.client_secret',
): Promise<string | null> {
  if (!reference?.trim()) return null;
  const stored = reference.startsWith('ref:') ? reference : `ref:${reference}`;
  if (!stored.includes('tenant-secret://')) return secretResolver.resolveStored(stored);
  if (!context?.tenantId) throw new Error('OIDC tenant secret context is unavailable');
  return secretResolver.resolveTenantStored(stored, {
    tenantId: context.tenantId,
    purpose,
    ...(context.correlationId ? { correlationId: context.correlationId } : {}),
  });
}

async function appleClientSecret(
  provider: GenericOidcProviderConfiguration,
  context?: { tenantId?: string | null; correlationId?: string },
): Promise<string> {
  const privateKeyPem = await resolveSecretReference(provider.applePrivateKeyRef, context, 'oidc.apple_private_key');
  if (!privateKeyPem) throw new Error('Apple private key is unavailable');
  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error('Apple private key is invalid');
  }
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Apple private key must use the P-256 elliptic curve');
  }
  return jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    keyid: provider.appleKeyId!,
    issuer: provider.appleTeamId!,
    subject: provider.clientId,
    audience: 'https://appleid.apple.com',
    expiresIn: 5 * 60,
  });
}

export class GenericOidcService {
  withCallbackUser(rawConfiguration: Record<string, unknown>, claims: OidcIdentityClaims, value: unknown): OidcIdentityClaims {
    const provider = config(rawConfiguration);
    if (provider.clientAuthentication !== 'apple_private_key_jwt' || value === undefined) return claims;
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 4096) throw new Error('Apple callback user data is invalid');
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { throw new Error('Apple callback user data is invalid'); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Apple callback user data is invalid');
    const user = parsed as Record<string, unknown>;
    if (typeof user.email !== 'string' || typeof claims.email !== 'string'
      || user.email.trim().toLowerCase() !== claims.email.trim().toLowerCase()) {
      throw new Error('Apple callback email does not match the verified ID token');
    }
    const name = user.name;
    if (!name || Array.isArray(name) || typeof name !== 'object') return claims;
    const profileName = (entry: unknown): string | undefined => {
      if (typeof entry !== 'string') return undefined;
      const normalized = entry.normalize('NFKC').trim();
      if (!normalized || normalized.length > 100 || /[\u0000-\u001f\u007f<>]/.test(normalized)) {
        throw new Error('Apple callback user name is invalid');
      }
      return normalized;
    };
    const firstName = profileName((name as Record<string, unknown>).firstName);
    const lastName = profileName((name as Record<string, unknown>).lastName);
    return {
      ...claims,
      ...(firstName ? { given_name: firstName } : {}),
      ...(lastName ? { family_name: lastName } : {}),
      ...(firstName || lastName ? { name: [firstName, lastName].filter(Boolean).join(' ') } : {}),
    };
  }

  async testConnection(rawConfiguration: Record<string, unknown>): Promise<{ issuer: string; authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string }> {
    try {
      const provider = config(rawConfiguration);
      const metadata = await discover(provider.issuerUrl);
      return { issuer: metadata.issuer, authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint, jwksUri: metadata.jwks_uri };
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  async createAuthorizationRequest(rawConfiguration: Record<string, unknown>, state: string, nonce: string): Promise<OidcAuthorizationRequest> {
    try {
      const provider = config(rawConfiguration);
      const metadata = await discover(provider.issuerUrl);
      const codeVerifier = base64Url(randomBytes(48));
      const url = new URL(metadata.authorization_endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', provider.clientId);
      url.searchParams.set('redirect_uri', provider.callbackUrl);
      url.searchParams.set('scope', provider.scopes.join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      const responseMode = provider.clientAuthentication === 'apple_private_key_jwt' ? 'form_post' : 'query';
      if (responseMode === 'form_post') {
        url.searchParams.set('response_mode', responseMode);
      } else {
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('code_challenge', base64Url(createHash('sha256').update(codeVerifier).digest()));
      }
      if (provider.requestedAcrValues.length > 0) url.searchParams.set('acr_values', provider.requestedAcrValues.join(' '));
      return { url: url.toString(), codeVerifier, responseMode };
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  authenticationAssurance(rawConfiguration: Record<string, unknown>, claims: OidcIdentityClaims): { mfaVerified: boolean } {
    const provider = config(rawConfiguration);
    const amr = Array.isArray(claims.amr)
      ? claims.amr.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase())
      : [];
    const configuredAmr = provider.mfaAmrValues.map((entry) => entry.toLowerCase());
    const acceptedAmr = configuredAmr.length > 0 ? configuredAmr : ['mfa', 'otp', 'hwk', 'swk', 'fido'];
    const amrMatch = amr.some((entry) => acceptedAmr.includes(entry));
    const acrMatch = typeof claims.acr === 'string'
      && provider.mfaAcrValues.length > 0
      && provider.mfaAcrValues.includes(claims.acr);
    return { mfaVerified: amrMatch || acrMatch };
  }

  async createLogoutRequest(rawConfiguration: Record<string, unknown>, state: string): Promise<string | null> {
    try {
      const provider = config(rawConfiguration);
      const metadata = await discover(provider.issuerUrl);
      if (!metadata.end_session_endpoint) return null;
      const url = new URL(metadata.end_session_endpoint);
      url.searchParams.set('client_id', provider.clientId);
      url.searchParams.set('state', state);
      if (provider.postLogoutRedirectUrl) url.searchParams.set('post_logout_redirect_uri', provider.postLogoutRedirectUrl);
      return url.toString();
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  async exchangeCode(
    rawConfiguration: Record<string, unknown>,
    input: { code: string; codeVerifier: string; nonce: string },
    secretContext?: { tenantId?: string | null; correlationId?: string },
  ): Promise<OidcIdentityClaims> {
    try {
      const provider = config(rawConfiguration);
      const metadata = await discover(provider.issuerUrl);
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: provider.callbackUrl, client_id: provider.clientId, code_verifier: input.codeVerifier });
      const clientSecret = provider.clientAuthentication === 'apple_private_key_jwt'
        ? await appleClientSecret(provider, secretContext)
        : await resolveSecretReference(provider.clientSecretRef, secretContext);
      if (clientSecret) body.set('client_secret', clientSecret);
      if (provider.clientAuthentication === 'apple_private_key_jwt') body.delete('code_verifier');
      const response = await fetch(metadata.token_endpoint, {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`OIDC token exchange failed (${response.status})`);
      }
      const tokens = await readBoundedIdentityProviderJson(response, 'OIDC token response') as { id_token?: unknown };
      if (typeof tokens.id_token !== 'string') throw new Error('OIDC token response did not include an ID token');
      return await this.verifyIdToken(tokens.id_token, metadata, provider, input.nonce);
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  /** Verifies an OpenID Connect Back-Channel Logout token before any local session is revoked. */
  async verifyBackChannelLogoutToken(rawConfiguration: Record<string, unknown>, token: string): Promise<OidcBackChannelLogoutClaims> {
    try {
      const provider = config(rawConfiguration);
      const metadata = await discover(provider.issuerUrl);
      const claims = await this.verifySignedToken(token, metadata, provider, 'OIDC logout token') as OidcBackChannelLogoutClaims;
      if (!Number.isInteger(claims.iat)) throw new Error('OIDC logout token iat is required');
      const now = Math.floor(Date.now() / 1000);
      if (Number(claims.iat) > now + 300 || Number(claims.iat) < now - 600) throw new Error('OIDC logout token is outside the accepted issue-time window');
      if (claims.nonce !== undefined) throw new Error('OIDC logout token must not contain a nonce');
      if (!claims.events || typeof claims.events !== 'object' || Array.isArray(claims.events)
        || !(BACK_CHANNEL_LOGOUT_EVENT in claims.events)) {
        throw new Error('OIDC logout token does not contain the back-channel logout event');
      }
      if (typeof claims.sid !== 'string' && typeof claims.sub !== 'string') {
        throw new Error('OIDC logout token must contain sid or sub');
      }
      return {
        ...claims,
        ...(typeof claims.sid === 'string' && claims.sid.trim() ? { sid: claims.sid.trim() } : {}),
        ...(typeof claims.sub === 'string' && claims.sub.trim() ? { sub: claims.sub.trim() } : {}),
      };
    } catch (error) { throw classifyIdentityProviderFailure(error, 'invalid_signature'); }
  }

  private async verifyIdToken(token: string, metadata: OidcDiscoveryDocument, provider: GenericOidcProviderConfiguration, nonce: string): Promise<OidcIdentityClaims> {
    const claims = await this.verifySignedToken(token, metadata, provider, 'OIDC ID token') as OidcIdentityClaims;
    if (!claims.sub) throw new IdentityProviderFailure('missing_subject', 'OIDC ID token subject is invalid');
    if (claims.nonce !== nonce) throw new IdentityProviderFailure('invalid_signature', 'OIDC ID token nonce is invalid');
    if (provider.clientAuthentication === 'apple_private_key_jwt' && typeof claims.email_verified === 'string') {
      return { ...claims, email_verified: claims.email_verified === 'true' };
    }
    return claims;
  }

  private async verifySignedToken(
    token: string,
    metadata: OidcDiscoveryDocument,
    provider: GenericOidcProviderConfiguration,
    label: 'OIDC ID token' | 'OIDC logout token',
  ): Promise<JwtPayload> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid || !decoded.header.alg || decoded.header.alg === 'none') throw new Error(`${label} header is invalid`);
    const jwks = await fetchJson(validateIdentityProviderEndpointUrl(metadata.jwks_uri, 'OIDC JWKS URI', ['https:']));
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    const jwk = keys.find((key) => key && typeof key === 'object' && (key as Record<string, unknown>).kid === decoded.header.kid) as JsonWebKey | undefined;
    if (!jwk) throw new Error('OIDC signing key was not found in the provider JWKS');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const claims = jwt.verify(token, key, {
      algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'], issuer: metadata.issuer,
      audience: provider.clientId,
    }) as JwtPayload;
    const audiences = typeof claims.aud === 'string'
      ? [claims.aud]
      : Array.isArray(claims.aud) ? claims.aud.filter((audience): audience is string => typeof audience === 'string' && Boolean(audience)) : [];
    const authorizedParty = typeof claims.azp === 'string' && claims.azp.trim() ? claims.azp.trim() : null;
    if (audiences.length > 1 && !authorizedParty) {
      throw new IdentityProviderFailure('invalid_signature', 'OIDC ID token with multiple audiences must include an authorized party');
    }
    if (authorizedParty && authorizedParty !== provider.clientId) {
      throw new IdentityProviderFailure('invalid_signature', 'OIDC ID token authorized party does not match the configured client');
    }
    return claims;
  }
}

export const genericOidcService = new GenericOidcService();
