import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import auditRouter from '../../../src/modules/audit/routes/audit.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { AuditLog } from '../../../src/shared/db/entities/AuditLog.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/middleware/tenant.js', () => ({
  resolveTenantContext: () => (_req: any, _res: any, next: any) => next(),
  requireTenantRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/audit.js', () => ({
  getUserAuditLogs: vi.fn().mockResolvedValue([]),
  getResourceAuditLogs: vi.fn().mockResolvedValue([]),
}));

describe('GET /api/audit/logs', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(auditRouter);
    vi.clearAllMocks();
  });

  it('retrieves audit logs with pagination', async () => {
    const auditRepo = {
      createQueryBuilder: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([
          [{ id: 'log-1', action: 'test.action', createdAt: Date.now(), details: '{}' }],
          1,
        ]),
      })),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/audit/logs?limit=10&offset=0');

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);
    expect(response.body.pagination.limit).toBe(10);
  });

  it('filters logs by action', async () => {
    const auditRepo = {
      createQueryBuilder: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      })),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === AuditLog) return auditRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/audit/logs?action=user.login');

    expect(response.status).toBe(200);
  });
});
