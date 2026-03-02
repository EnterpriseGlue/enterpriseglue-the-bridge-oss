import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import deploymentsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/deployments.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/engines/deployment-service.js', () => ({
  deployToEngine: vi.fn().mockResolvedValue({ deploymentId: 'd1' }),
}));

describe('starbase deployments routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(deploymentsRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
      }),
    });
  });

  it('placeholder test for deployments routes', () => {
    expect(true).toBe(true);
  });
});
