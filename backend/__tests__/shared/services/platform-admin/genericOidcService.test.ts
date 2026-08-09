import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericOidcService } from '@enterpriseglue/shared/services/platform-admin/GenericOidcService.js';

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
});
