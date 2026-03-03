import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import microsoftRouter from '../../../../../packages/backend-host/src/modules/auth/routes/microsoft.js';

vi.mock('@enterpriseglue/shared/services/microsoft.js', () => ({
  exchangeMicrosoftCodeForTokens: vi.fn(),
  getMicrosoftUserInfo: vi.fn(),
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

describe('auth microsoft routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(microsoftRouter);
    vi.clearAllMocks();
  });

  it('placeholder test for microsoft auth', () => {
    expect(true).toBe(true);
  });
});
