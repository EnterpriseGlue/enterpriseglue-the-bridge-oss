import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const handleConnection = vi.fn();
let requireAuthImplementation = (_req: any, _res: any, next: any) => next();

vi.mock('@enterpriseglue/shared/services/notifications/index.js', () => ({
  NotificationSSEManager: class NotificationSSEManager {},
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  notificationsLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => {
  return {
    requireAuth: (req: any, res: any, next: any) => requireAuthImplementation(req, res, next),
  };
});

const { createNotificationStreamRouter } = await import('../../../../packages/backend-host/src/modules/notifications/routes/stream.js');

describe('notification stream routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthImplementation = (_req, _res, next) => next();
    handleConnection.mockImplementation((_req, res) => {
      res.status(204).end();
    });
  });

  it('forwards stream requests to the SSE manager handler', async () => {
    const app = express();
    app.use(createNotificationStreamRouter({ handleConnection } as any));

    const response = await request(app).get('/stream');

    expect(response.status).toBe(204);
    expect(handleConnection).toHaveBeenCalledTimes(1);
  });

  it('rejects unauthenticated stream requests before reaching the SSE manager', async () => {
    requireAuthImplementation = (_req, res) => {
      res.status(401).json({ error: 'Authentication required' });
    };

    const app = express();
    app.use(createNotificationStreamRouter({ handleConnection } as any));

    const response = await request(app).get('/stream');

    expect(response.status).toBe(401);
    expect(handleConnection).not.toHaveBeenCalled();
  });
});
