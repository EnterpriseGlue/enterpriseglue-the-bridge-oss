import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import enginesRouter from '../../../../src/modules/mission-control/engines/routes.js';
import { engineService } from '../../../../src/shared/services/platform-admin/index.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/middleware/platformAuth.js', () => ({
  isPlatformAdmin: () => true,
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/services/platform-admin/index.js', () => ({
  engineService: {
    listEngines: vi.fn().mockResolvedValue([]),
    getEngine: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1' }),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
    getUserEngines: vi.fn().mockResolvedValue([]),
    getEngineRole: vi.fn().mockResolvedValue('owner'),
  },
}));

describe('mission-control engines routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(enginesRouter);
    vi.clearAllMocks();
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Engine 1' }]),
      }),
    });
  });

  it('returns list of engines', async () => {
    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'e1', name: 'Engine 1', myRole: 'admin' }]);
  });

  it('returns engine detail when user has access', async () => {
    const response = await request(app).get('/engines-api/engines/e1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'e1', name: 'Engine 1' });
    expect((engineService as any).hasEngineAccess).not.toHaveBeenCalled();
  });
});
