import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import credentialsRouter from '../../../../../packages/backend-host/src/modules/git/routes/credentials.js';
import { credentialService } from '@enterpriseglue/shared/services/git/CredentialService.js';
import { oauthService } from '@enterpriseglue/shared/services/git/OAuthService.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/git/CredentialService.js', () => ({
  credentialService: {
    listCredentials: vi.fn().mockResolvedValue([]),
    getCredential: vi.fn(),
    saveCredential: vi.fn(),
    renameCredential: vi.fn(),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
    hasValidCredentials: vi.fn(),
    getNamespaces: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/git/OAuthService.js', () => ({
  oauthService: {
    getOAuthConfig: vi.fn(),
    startOAuthFlow: vi.fn(),
    exchangeCode: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

describe('git credentials routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(credentialsRouter);
    vi.clearAllMocks();
  });

  it('returns only OAuth capability metadata and an opaque authorization response', async () => {
    vi.mocked(oauthService.getOAuthConfig).mockResolvedValue({
      supportsOAuth: true, isConfigured: true, scopes: ['repo'],
    });
    vi.mocked(oauthService.startOAuthFlow).mockResolvedValue({
      authUrl: 'https://github.com/login/oauth/authorize?state=opaque-state', state: 'opaque-state',
    });

    const configResponse = await request(app).get('/git-api/oauth/provider-1/config');
    const authorizeResponse = await request(app).get('/git-api/oauth/provider-1/authorize');

    expect(configResponse.status).toBe(200);
    expect(configResponse.body).toEqual({ supportsOAuth: true, isConfigured: true, scopes: ['repo'] });
    expect(authorizeResponse.status).toBe(200);
    expect(authorizeResponse.body).toEqual({
      authUrl: 'https://github.com/login/oauth/authorize?state=opaque-state', state: 'opaque-state',
    });
  });

  it('validates the OAuth callback and never returns exchanged token material', async () => {
    vi.mocked(oauthService.exchangeCode).mockResolvedValue({
      userId: 'user-1', providerId: 'provider-1',
      tokens: { accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 3600, scope: 'repo' },
    });
    vi.mocked(credentialService.saveCredential).mockResolvedValue({
      id: 'cred-1', userId: 'user-1', providerId: 'provider-1', providerName: 'GitHub', providerType: 'github',
      authType: 'oauth', scopes: 'repo', createdAt: 1, updatedAt: 1,
    });

    const invalid = await request(app).post('/git-api/oauth/callback').send({ code: 'code-only' });
    const response = await request(app).post('/git-api/oauth/callback').send({ code: 'code', state: 'state' });

    expect(invalid.status).toBe(400);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'cred-1', authType: 'oauth', scopes: 'repo' });
    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('refreshToken');
    expect(credentialService.saveCredential).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', providerId: 'provider-1', accessToken: 'access-token', refreshToken: 'refresh-token',
    }));
  });
});
