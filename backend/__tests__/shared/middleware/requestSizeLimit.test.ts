import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { enforceParsedPayloadLimit } from '@enterpriseglue/shared/middleware/requestSizeLimit.js';

describe('administrative request hardening', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects parsed JSON above a route-family payload budget', async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.post('/bounded', enforceParsedPayloadLimit(128), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const response = await request(app).post('/bounded').send({ value: 'x'.repeat(256) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'Request payload exceeds the allowed size',
      code: 'PAYLOAD_TOO_LARGE',
      maxBytes: 128,
    });
  });

  it('normalizes parser-level payload failures to the same safe 413 contract', async () => {
    const app = express();
    app.use(express.json({ limit: '100b' }));
    app.post('/global-limit', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const response = await request(app).post('/global-limit').send({ value: 'x'.repeat(256) });

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      error: 'Request payload exceeds the allowed size',
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('enforces the production reconciliation budget with a stable 429 response', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { reconciliationLimiter } = await vi.importActual<typeof import('@enterpriseglue/shared/middleware/rateLimiter.js')>(
      '@enterpriseglue/shared/middleware/rateLimiter.js',
    );
    const app = express();
    app.use((req: any, _res, next) => { req.user = { userId: 'admin-1' }; next(); });
    app.get('/reconcile', reconciliationLimiter, (_req, res) => res.json({ ok: true }));

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect((await request(app).get('/reconcile')).status).toBe(200);
    }
    const response = await request(app).get('/reconcile');
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: 'Too many reconciliation or connection-test requests, please slow down.',
      code: 'RATE_LIMITED',
    });
  });
});
