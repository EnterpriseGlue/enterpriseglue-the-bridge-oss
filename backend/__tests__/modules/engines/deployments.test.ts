import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import { getDataSource } from '../../../src/shared/db/data-source.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('../../../src/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('undici', () => ({
  fetch: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve('[]'),
  }),
  FormData: class {},
}));

vi.mock('@shared/services/platform-admin/index.js', () => ({
  engineService: {
    canManageEngine: vi.fn().mockResolvedValue(true),
    canViewEngine: vi.fn().mockResolvedValue(true),
    getEngineMembers: vi.fn().mockResolvedValue([]),
    getEngineRole: vi.fn().mockResolvedValue('owner'),
    getUserEngines: vi.fn().mockResolvedValue([]),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
  },
}));


describe('engines deployments routes', () => {
  let app: express.Application;

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    const { default: deploymentsRouter } = await import('../../../src/modules/engines/deployments.js');
    app.use(deploymentsRouter);
    vi.clearAllMocks();

    const mockEngine = {
      id: 'e1',
      baseUrl: 'http://localhost:8080',
      name: 'Test Engine',
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([mockEngine]),
        findOne: vi.fn().mockResolvedValue(mockEngine),
      }),
    });
  });

  it('lists deployments for an engine', async () => {
    // TODO: Convert to E2E test with Prism mock server (see local-docs/ING/api-specs)
    const { fetch } = await import('undici');
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify([])),
    });

    const response = await request(app).get('/engines-api/engines/e1/deployments');
    expect(response.status).toBe(200);
  });

  it('gets deployment by id', async () => {
    // TODO: Convert to E2E test with Prism mock server (see local-docs/ING/api-specs)
    const { fetch } = await import('undici');
    (fetch as any).mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        id: 'd1',
        name: 'invoice-deployment',
        deploymentTime: '2026-01-20T02:00:00.000+0000',
        source: 'process application',
        tenantId: null
      })),
    });

    const response = await request(app).get('/engines-api/engines/e1/deployments/d1');
    expect(response.status).toBe(200);
  });
});
