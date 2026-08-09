import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('identityFlowLimiter', () => {
  afterEach(() => {
    delete process.env.EG_IDENTITY_FLOW_RATE_LIMIT_MAX;
    vi.resetModules();
  });

  it('counts successful pre-auth requests across canonical and compatibility aliases', async () => {
    process.env.EG_IDENTITY_FLOW_RATE_LIMIT_MAX = '2';
    vi.resetModules();
    const { identityFlowLimiter } = await vi.importActual<typeof import('@enterpriseglue/shared/middleware/rateLimiter.js')>(
      '@enterpriseglue/shared/middleware/rateLimiter.js',
    );
    const app = express();
    app.get('/api/t/:tenantSlug/auth/providers/:providerId/start', identityFlowLimiter, (_req, res) => res.status(204).end());
    app.get('/api/auth/providers/:providerId/start', identityFlowLimiter, (_req, res) => res.status(204).end());

    expect((await request(app).get('/api/t/default/auth/providers/provider-1/start').set('X-Forwarded-For', '203.0.113.10')).status).toBe(204);
    expect((await request(app).get('/api/auth/providers/provider-1/start').set('X-Forwarded-For', '203.0.113.11')).status).toBe(204);
    const blocked = await request(app).get('/api/t/default/auth/providers/provider-2/start').set('X-Forwarded-For', '203.0.113.12');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many identity provider requests, please try again later.' });

    const trustedProxyApp = express();
    trustedProxyApp.set('trust proxy', 1);
    trustedProxyApp.get('/start', identityFlowLimiter, (req, res) => res.status(200).json({ ip: req.ip }));
    const firstTrusted = await request(trustedProxyApp).get('/start').set('X-Forwarded-For', '198.51.100.20');
    const secondTrusted = await request(trustedProxyApp).get('/start').set('X-Forwarded-For', '198.51.100.21');
    expect(firstTrusted.body.ip).toBe('198.51.100.20');
    expect(secondTrusted.body.ip).toBe('198.51.100.21');
  });
});
