import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { existsSync } from 'fs';
import enginesRouter from '../../../../../packages/backend-host/src/modules/mission-control/engines/routes.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/platformAuth.js', () => ({
  isPlatformAdmin: () => true,
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    listEngines: vi.fn().mockResolvedValue([]),
    getEngine: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1' }),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
    getUserEngines: vi.fn().mockResolvedValue([
      { engine: { id: 'e1', name: 'Engine 1' }, role: 'admin' },
    ]),
    getEngineRole: vi.fn().mockResolvedValue('owner'),
  },
}));

vi.mock('@enterpriseglue/shared/constants/roles.js', () => ({
  ENGINE_VIEW_ROLES: ['owner', 'delegate', 'operator', 'viewer'],
  ENGINE_MANAGE_ROLES: ['owner', 'delegate'],
  MANAGE_ROLES: ['owner', 'delegate'],
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:5173',
  },
}));

describe('mission-control engines routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(enginesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Engine 1' }]),
        findOneBy: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1' }),
      }),
    });
  });

  it('returns list of engines', async () => {
    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 'e1', name: 'Engine 1', myRole: 'admin', username: null, passwordEnc: null },
    ]);
  });

  it('returns engine detail when user has access', async () => {
    const response = await request(app).get('/engines-api/engines/e1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'e1', name: 'Engine 1' });
    expect((engineService as any).hasEngineAccess).toHaveBeenCalled();
  });

  it('rejects localhost engine URLs when running in Docker', async () => {
    (existsSync as any).mockReturnValue(true);

    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Docker local engine', baseUrl: 'http://localhost:8080/engine-rest', type: 'operaton' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field: 'baseUrl' });
    expect(String(response.body.error || '')).toContain('host.docker.internal:8080/engine-rest');
  });
});
