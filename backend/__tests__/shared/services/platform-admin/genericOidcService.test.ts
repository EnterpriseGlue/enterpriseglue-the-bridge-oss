import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';
import { MockOidcProvider } from '../../../../test/identity-mocks/index.js';

const configuration = {
  issuerUrl: 'https://issuer.example.test',
  clientId: 'enterpriseglue',
  callbackUrl: 'http://localhost:5173/api/auth/identity/callback',
  scopes: ['openid'],
};

describe('GenericOidcService endpoint policy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY;
    delete process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS;
    delete process.env.EG_TEST_APPLE_PRIVATE_KEY;
  });

  it('blocks a configured issuer before fetch when it is not allowlisted', async () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = 'another.example.test';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(genericOidcService.testConnection(configuration)).rejects.toThrow('not permitted');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('revalidates every discovery-derived endpoint and disables redirects', async () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = 'issuer.example.test';
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      issuer: 'https://issuer.example.test',
      authorization_endpoint: 'https://attacker.example.test/authorize',
      token_endpoint: 'https://issuer.example.test/token',
      jwks_uri: 'https://issuer.example.test/jwks',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(genericOidcService.testConnection(configuration)).rejects.toThrow('not permitted');
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'error' }));
  });

  it('cancels a non-success provider response before reporting the failure', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, body: { cancel } }));

    await expect(genericOidcService.testConnection(configuration)).rejects.toThrow('OIDC discovery request failed');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('verifies an OIDC back-channel logout token and returns only its trusted identifiers', async () => {
    const provider = new MockOidcProvider();
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    const logoutToken = provider.issueLogoutToken({
      sub: 'subject-1', sid: 'session-1',
      events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
    });

    await expect(genericOidcService.verifyBackChannelLogoutToken(provider.configuration(), logoutToken)).resolves.toMatchObject({
      sub: 'subject-1', sid: 'session-1',
    });
  });

  it.each([
    ['a nonce', { sub: 'subject-1', nonce: 'not-allowed', events: { 'http://schemas.openid.net/event/backchannel-logout': {} } }],
    ['no logout event', { sub: 'subject-1', events: {} }],
    ['no subject or session', { events: { 'http://schemas.openid.net/event/backchannel-logout': {} } }],
  ])('rejects a cryptographically valid logout token with %s', async (_label, claims) => {
    const provider = new MockOidcProvider();
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    await expect(genericOidcService.verifyBackChannelLogoutToken(provider.configuration(), provider.issueLogoutToken(claims)))
      .rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('creates a provider end-session request with only a canonical local return URL', async () => {
    const provider = new MockOidcProvider();
    vi.stubGlobal('fetch', provider.fetch.bind(provider));
    const result = await genericOidcService.createLogoutRequest({
      ...provider.configuration(), postLogoutRedirectUrl: 'http://localhost:5173/login',
    }, 'logout-state');
    const target = new URL(result!);
    expect(target.origin).toBe(provider.issuer);
    expect(target.searchParams.get('client_id')).toBe(provider.clientId);
    expect(target.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/login');
    expect(target.searchParams.get('state')).toBe('logout-state');
  });

  it('uses an Apple form-post request and generates a short-lived ES256 client secret for token exchange', async () => {
    const appleClientKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const appleSigningKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.EG_TEST_APPLE_PRIVATE_KEY = appleClientKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const signingJwk = appleSigningKeys.publicKey.export({ format: 'jwk' });
    const configuration = {
      issuerUrl: 'https://appleid.apple.com',
      clientId: 'ai.enterpriseglue.web',
      clientAuthentication: 'apple_private_key_jwt',
      appleTeamId: 'TEAMID1234',
      appleKeyId: 'KEYID12345',
      applePrivateKeyRef: 'ref:env://EG_TEST_APPLE_PRIVATE_KEY',
      callbackUrl: 'http://localhost:5173/api/auth/identity/callback',
      scopes: ['name', 'email'],
    };
    let tokenRequest: URLSearchParams | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) return new Response(JSON.stringify({
        issuer: 'https://appleid.apple.com',
        authorization_endpoint: 'https://appleid.apple.com/auth/authorize',
        token_endpoint: 'https://appleid.apple.com/auth/token',
        jwks_uri: 'https://appleid.apple.com/auth/keys',
      }), { status: 200 });
      if (url.endsWith('/auth/keys')) return new Response(JSON.stringify({ keys: [{ ...signingJwk, kid: 'apple-signing-key', alg: 'RS256', use: 'sig' }] }), { status: 200 });
      if (url.endsWith('/auth/token')) {
        tokenRequest = new URLSearchParams(String(init?.body));
        const idToken = jwt.sign({ nonce: 'nonce-apple', email: 'person@privaterelay.appleid.com', email_verified: 'true' }, appleSigningKeys.privateKey, {
          algorithm: 'RS256', keyid: 'apple-signing-key', issuer: 'https://appleid.apple.com', audience: configuration.clientId, subject: 'apple-subject-1', expiresIn: 300,
        });
        return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    }));

    const authorization = await genericOidcService.createAuthorizationRequest(configuration, 'state-apple', 'nonce-apple');
    const authorizationUrl = new URL(authorization.url);
    expect(authorization.responseMode).toBe('form_post');
    expect(authorizationUrl.searchParams.get('response_mode')).toBe('form_post');
    expect(authorizationUrl.searchParams.get('scope')).toBe('name email');
    expect(authorizationUrl.searchParams.has('code_challenge')).toBe(false);

    const claims = await genericOidcService.exchangeCode(configuration, {
      code: 'apple-code', codeVerifier: authorization.codeVerifier, nonce: 'nonce-apple',
    });
    expect(claims).toMatchObject({ sub: 'apple-subject-1', email: 'person@privaterelay.appleid.com', email_verified: true });
    expect(genericOidcService.withCallbackUser(configuration, claims, JSON.stringify({
      email: 'person@privaterelay.appleid.com', name: { firstName: 'Ada', lastName: 'Lovelace' },
    }))).toMatchObject({ given_name: 'Ada', family_name: 'Lovelace', name: 'Ada Lovelace' });
    expect(() => genericOidcService.withCallbackUser(configuration, claims, JSON.stringify({
      email: 'attacker@example.test', name: { firstName: '<script>' },
    }))).toThrow('does not match');
    expect(tokenRequest!.get('code_verifier')).toBeNull();
    const clientSecret = tokenRequest!.get('client_secret');
    expect(clientSecret).toBeTruthy();
    const verified = jwt.verify(clientSecret!, appleClientKeys.publicKey, {
      algorithms: ['ES256'], issuer: configuration.appleTeamId, subject: configuration.clientId, audience: 'https://appleid.apple.com',
    });
    expect(verified).toMatchObject({ iss: configuration.appleTeamId, sub: configuration.clientId, aud: 'https://appleid.apple.com' });
    const decoded = jwt.decode(clientSecret!, { complete: true });
    expect(decoded && typeof decoded !== 'string' ? decoded.header : null).toMatchObject({ alg: 'ES256', kid: configuration.appleKeyId });
    expect(Number((verified as jwt.JwtPayload).exp) - Number((verified as jwt.JwtPayload).iat)).toBe(300);
  });

  it('rejects an Apple client-authentication profile that uses the wrong issuer', async () => {
    await expect(genericOidcService.createAuthorizationRequest({
      issuerUrl: 'https://issuer.example.test', clientId: 'ai.enterpriseglue.web', clientAuthentication: 'apple_private_key_jwt',
      appleTeamId: 'TEAMID1234', appleKeyId: 'KEYID12345', applePrivateKeyRef: 'ref:env://EG_TEST_APPLE_PRIVATE_KEY',
      callbackUrl: 'http://localhost:5173/api/auth/identity/callback', scopes: ['email'],
    }, 'state', 'nonce')).rejects.toThrow('Apple issuer');
  });

  it('rejects an Apple private key that is not P-256 before token exchange', async () => {
    const wrongCurve = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    process.env.EG_TEST_APPLE_PRIVATE_KEY = wrongCurve.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      issuer: 'https://appleid.apple.com', authorization_endpoint: 'https://appleid.apple.com/auth/authorize',
      token_endpoint: 'https://appleid.apple.com/auth/token', jwks_uri: 'https://appleid.apple.com/auth/keys',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(genericOidcService.exchangeCode({
      issuerUrl: 'https://appleid.apple.com', clientId: 'ai.enterpriseglue.web', clientAuthentication: 'apple_private_key_jwt',
      appleTeamId: 'TEAMID1234', appleKeyId: 'KEYID12345', applePrivateKeyRef: 'ref:env://EG_TEST_APPLE_PRIVATE_KEY',
      callbackUrl: 'http://localhost:5173/api/auth/identity/callback', scopes: ['email'],
    }, { code: 'code', codeVerifier: 'unused', nonce: 'nonce' })).rejects.toThrow('P-256');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
