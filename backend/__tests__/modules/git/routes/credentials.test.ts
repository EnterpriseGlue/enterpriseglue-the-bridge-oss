import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import credentialsRouter from '../../../../../packages/backend-host/src/modules/git/routes/credentials.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/git/CredentialService.js', () => ({
  credentialService: {
    listUserCredentials: vi.fn().mockResolvedValue([]),
    saveCredential: vi.fn().mockResolvedValue({ id: 'cred-1' }),
    deleteCredential: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/git/OAuthService.js', () => ({
  oauthService: {},
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

  it('placeholder test for credentials', () => {
    expect(true).toBe(true);
  });
});
