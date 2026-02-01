import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import providersRouter from '../../../../src/modules/git/routes/providers.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { GitProvider } from '../../../../src/shared/db/entities/GitProvider.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/git/RemoteGitService.js', () => ({
  remoteGitService: {},
}));

vi.mock('@shared/services/git/CredentialService.js', () => ({
  credentialService: {},
}));

vi.mock('@shared/services/encryption.js', () => ({
  encrypt: vi.fn((v) => `encrypted:${v}`),
  isEncrypted: vi.fn(() => false),
}));

describe('GET /git-api/providers', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(providersRouter);
    vi.clearAllMocks();
  });

  it('returns list of active git providers', async () => {
    const providerRepo = {
      find: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          name: 'GitHub',
          type: 'github',
          baseUrl: 'https://github.com',
          apiUrl: 'https://api.github.com',
          customBaseUrl: null,
          customApiUrl: null,
          supportsOAuth: true,
          supportsPAT: true,
        },
      ]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitProvider) return providerRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/git-api/providers');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].name).toBe('GitHub');
  });
});
