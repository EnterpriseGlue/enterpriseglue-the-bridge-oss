import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import samlStartRouter from '../../../../../packages/backend-host/src/modules/auth/routes/saml-start.js';

vi.mock('@enterpriseglue/shared/services/saml.js', () => ({
  isSamlAuthEnabled: vi.fn().mockResolvedValue(false),
  getSamlAuthorizationUrl: vi.fn(),
}));

describe('GET /api/auth/saml/start', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(samlStartRouter);
    vi.clearAllMocks();
  });

  it('returns 503 when SAML auth is not configured', async () => {
    const response = await request(app).get('/api/auth/saml/start');

    expect(response.status).toBe(503);
    expect(response.body.error).toContain('not configured');
  });
});
