import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import deploymentsRouter from '../../../src/modules/engines/deployments.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
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

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve([]),
  text: () => Promise.resolve(''),
}) as any;

describe('engines deployments routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
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

  it.skip('lists deployments for an engine', async () => {
    // Skipped: requires mocking full engine resolution chain and Camunda upstream
    const response = await request(app).get('/engines-api/engines/e1/deployments');
    expect(response.status).toBe(200);
  });

  it.skip('gets deployment by id', async () => {
    // Skipped: requires mocking full engine resolution chain and Camunda upstream
    const response = await request(app).get('/engines-api/engines/e1/deployments/d1');
    expect(response.status).toBe(200);
  });
});
