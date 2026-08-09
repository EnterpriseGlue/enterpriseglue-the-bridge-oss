import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { secretResolver } from './SecretResolver.js';
import { IdentityProviderFailure, classifyIdentityProviderFailure } from './IdentityProviderFailure.js';
import { readBoundedIdentityProviderJson, validateIdentityProviderCallbackUrl, validateIdentityProviderEndpointUrl } from './IdentityProviderEndpointPolicy.js';

export interface GenericOidcProviderConfiguration {
  issuerUrl: string;
  clientId: string;
  clientSecretRef?: string;
  callbackUrl: string;
  scopes: string[];
  expectedAudience?: string;
}

interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcAuthorizationRequest {
  url: string;
  codeVerifier: string;
}

export interface OidcIdentityClaims extends JwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  tid?: string;
  nonce?: string;
}

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
  if (!scopes.includes('openid')) throw new Error('OIDC scopes must include openid');
  return {
    issuerUrl: normalizeIssuer(issuerUrl), clientId: clientId.trim(), callbackUrl,
    scopes, clientSecretRef: typeof input.clientSecretRef === 'string' ? input.clientSecretRef : undefined,
    expectedAudience: typeof input.expectedAudience === 'string' ? input.expectedAudience : undefined,
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
  return { issuer: discoveredIssuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, jwks_uri: jwksUri };
}

function resolveSecretReference(reference?: string): string | null {
  if (!reference?.trim()) return null;
  return secretResolver.resolveStored(reference.startsWith('ref:') ? reference : `ref:${reference}`);
}

export class GenericOidcService {
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
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('code_challenge', base64Url(createHash('sha256').update(codeVerifier).digest()));
      return { url: url.toString(), codeVerifier };
    } catch (error) { throw classifyIdentityProviderFailure(error); }
  }

  async exchangeCode(rawConfiguration: Record<string, unknown>, input: { code: string; codeVerifier: string; nonce: string }): Promise<OidcIdentityClaims> {
    try {
      const provider = config(rawConfiguration);
      const metadata = await discover(provider.issuerUrl);
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: provider.callbackUrl, client_id: provider.clientId, code_verifier: input.codeVerifier });
      const clientSecret = resolveSecretReference(provider.clientSecretRef);
      if (clientSecret) body.set('client_secret', clientSecret);
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

  private async verifyIdToken(token: string, metadata: OidcDiscoveryDocument, provider: GenericOidcProviderConfiguration, nonce: string): Promise<OidcIdentityClaims> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.header.kid || !decoded.header.alg || decoded.header.alg === 'none') throw new Error('OIDC ID token header is invalid');
    const jwks = await fetchJson(validateIdentityProviderEndpointUrl(metadata.jwks_uri, 'OIDC JWKS URI', ['https:']));
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    const jwk = keys.find((key) => key && typeof key === 'object' && (key as Record<string, unknown>).kid === decoded.header.kid) as JsonWebKey | undefined;
    if (!jwk) throw new Error('OIDC signing key was not found in the provider JWKS');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const claims = jwt.verify(token, key, {
      algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'], issuer: metadata.issuer,
      audience: provider.clientId,
    }) as OidcIdentityClaims;
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
    if (!claims.sub) throw new IdentityProviderFailure('missing_subject', 'OIDC ID token subject is invalid');
    if (claims.nonce !== nonce) throw new IdentityProviderFailure('invalid_signature', 'OIDC ID token nonce is invalid');
    return claims;
  }
}

export const genericOidcService = new GenericOidcService();
