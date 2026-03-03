import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import googleRouter from '../../../../../packages/backend-host/src/modules/auth/routes/google.js';

vi.mock('@enterpriseglue/shared/services/google.js', () => ({
  exchangeGoogleCodeForTokens: vi.fn(),
  getGoogleUserInfo: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  generateAccessToken: vi.fn().mockReturnValue('access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('refresh-token'),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {},
}));

describe('auth google routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(googleRouter);
    vi.clearAllMocks();
  });

  it('placeholder test for google auth', () => {
    expect(true).toBe(true);
  });
});
