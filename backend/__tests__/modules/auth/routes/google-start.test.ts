import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import googleStartRouter from '../../../../../packages/backend-host/src/modules/auth/routes/google-start.js';

vi.mock('@enterpriseglue/shared/services/google.js', () => ({
  isGoogleAuthEnabled: vi.fn().mockResolvedValue(false),
  getGoogleAuthorizationUrl: vi.fn().mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?state=test'),
}));

describe('GET /api/auth/google/start', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(googleStartRouter);
    vi.clearAllMocks();
  });

  it('returns 503 when Google auth is not configured', async () => {
    const response = await request(app).get('/api/auth/google/start');

    expect(response.status).toBe(503);
    expect(response.body.error).toContain('not configured');
  });
});
