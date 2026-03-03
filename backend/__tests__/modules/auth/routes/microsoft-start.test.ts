import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import microsoftStartRouter from '../../../../../packages/backend-host/src/modules/auth/routes/microsoft-start.js';

vi.mock('@enterpriseglue/shared/services/microsoft.js', () => ({
  isMicrosoftAuthEnabled: vi.fn().mockReturnValue(false),
  getAuthorizationUrl: vi.fn().mockResolvedValue('https://login.microsoftonline.com/oauth2/v2.0/authorize?state=test'),
}));

describe('GET /api/auth/microsoft/start', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(microsoftStartRouter);
    vi.clearAllMocks();
  });

  it('returns 503 when Microsoft auth is not configured', async () => {
    const response = await request(app).get('/api/auth/microsoft/start');

    expect(response.status).toBe(503);
    expect(response.body.error).toContain('not configured');
  });
});
