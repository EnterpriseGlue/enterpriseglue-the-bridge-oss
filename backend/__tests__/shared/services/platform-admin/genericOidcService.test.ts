import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
