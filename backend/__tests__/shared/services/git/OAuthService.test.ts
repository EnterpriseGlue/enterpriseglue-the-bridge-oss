import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { oauthService } from '@enterpriseglue/shared/services/git/OAuthService.js';
import { secretResolver } from '@enterpriseglue/shared/services/platform-admin/SecretResolver.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  return mock;
});

const originalEnv = { ...process.env };

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'git-1', type: 'github', supportsOAuth: true, oauthClientId: 'client-1',
    oauthClientSecret: 'ref:env://GIT_SECRET', oauthScopes: 'repo,read:user',
    oauthAuthUrl: 'https://github.com/login/oauth/authorize',
    oauthTokenUrl: 'https://93.184.216.34/oauth/token',
    ...overrides,
  } as any;
}

describe('OAuthService outbound boundary', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.NODE_ENV = 'production';
    process.env.EG_ADMIN_INTEGRATION_ALLOWED_HOSTS = '93.184.216.34';
    process.env.EG_ADMIN_INTEGRATION_ALLOW_PRIVATE_HOSTS = 'false';
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(provider()) }),
    });
    vi.spyOn(secretResolver, 'resolveStored').mockReturnValue('resolved-client-secret');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => vi.unstubAllGlobals());

  it('rejects an unsafe token endpoint before sending the OAuth client secret', async () => {
    const unsafe = provider({ oauthTokenUrl: 'https://169.254.169.254/oauth/token' });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(unsafe) }),
    });
    const { state } = await oauthService.startOAuthFlow('user-1', 'git-1', 'https://app.example.com/callback');

    await expect(oauthService.exchangeCode('code-1', state, 'https://app.example.com/callback'))
      .rejects.toThrow('not permitted by endpoint policy');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forces no redirects, bounds token fields, and caps provider expiry', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'Bearer',
      scope: 'repo', expires_in: '999999999',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const tokens = await oauthService.refreshToken('git-1', 'old-refresh-token');

    expect(tokens).toEqual({
      accessToken: 'access-token', refreshToken: 'refresh-token', tokenType: 'Bearer',
      scope: 'repo', expiresIn: 86_400,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe('error');
    expect(String(init.body)).toContain('client_secret=resolved-client-secret');
    expect(String(init.body)).toContain('refresh_token=old-refresh-token');
  });

  it('rejects empty or oversized access tokens', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: '' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'x'.repeat(16_385) }), { status: 200 }));
    await expect(oauthService.refreshToken('git-1', 'refresh')).rejects.toThrow('invalid access token');
    await expect(oauthService.refreshToken('git-1', 'refresh')).rejects.toThrow('invalid access token');
  });
});
