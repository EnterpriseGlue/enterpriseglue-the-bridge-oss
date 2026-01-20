import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import enginesRouter from '../../../../src/modules/mission-control/engines/routes.js';
import { engineService } from '../../../../src/shared/services/platform-admin/index.js';

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/services/platform-admin/index.js', () => ({
  engineService: {
    listEngines: vi.fn().mockResolvedValue([]),
    getEngine: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1' }),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
  },
}));

describe('mission-control engines routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(enginesRouter);
    vi.clearAllMocks();
  });

  it.skip('returns list of engines', async () => {
    const response = await request(app).get('/mission-control-api/engines');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it.skip('returns engine detail when user has access', async () => {
    const response = await request(app).get('/mission-control-api/engines/e1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'e1', name: 'Engine 1' });
    expect((engineService as any).getEngine).toHaveBeenCalledWith('e1');
  });
});
