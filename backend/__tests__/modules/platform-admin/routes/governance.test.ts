import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import governanceRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/governance.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  policyService: {
    listPolicies: vi.fn().mockResolvedValue([]),
  },
}));

describe('platform-admin governance routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(governanceRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
      }),
    });
  });

  it('serializes governance user-search results through the shared safe schema', async () => {
    const qb = {
      select: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'user-1', email: 'owner@example.test', firstName: 'Owner', lastName: null,
        passwordHash: 'must-not-leak',
      }]),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ createQueryBuilder: vi.fn().mockReturnValue(qb) }),
    });

    const response = await request(app).get('/users/search').query({ q: 'owner' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id: 'user-1', email: 'owner@example.test', firstName: 'Owner', lastName: null,
    }]);
    expect(response.body[0]).not.toHaveProperty('passwordHash');
  });
});
