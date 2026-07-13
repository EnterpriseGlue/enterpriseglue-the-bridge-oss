import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import auditRouter from '../../../../packages/backend-host/src/modules/audit/routes/audit.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/db/entities/AuditLog.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { piiRedactionService } from '@enterpriseglue/shared/services/pii/PiiRedactionService.js';
import { permissionService, PlatformPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/tenant.js', () => ({
  resolveTenantContext: () => (_req: any, _res: any, next: any) => next(),
  requireTenantRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  getUserAuditLogs: vi.fn().mockResolvedValue([]),
  getResourceAuditLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock('@enterpriseglue/shared/services/pii/PiiRedactionService.js', () => ({
  piiRedactionService: {
    redactPayload: vi.fn((_req: any, payload: any) => Promise.resolve(payload)),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', async () => {
  const actual = await vi.importActual<typeof import('@enterpriseglue/shared/services/platform-admin/permissions.js')>(
    '@enterpriseglue/shared/services/platform-admin/permissions.js'
  );

  return {
    ...actual,
    permissionService: {
      hasPermission: vi.fn().mockResolvedValue(false),
    },
  };
});

describe('GET /api/audit/logs', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(auditRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    (piiRedactionService.redactPayload as unknown as Mock).mockImplementation(
      (_req: any, payload: any) => Promise.resolve(payload)
    );
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === PlatformPermissions.AUDIT_VIEW
    );
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
    expect(piiRedactionService.redactPayload).toHaveBeenCalledOnce();
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      PlatformPermissions.AUDIT_VIEW,
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'platform',
      })
    );
    expect((permissionService.hasPermission as unknown as Mock).mock.calls[0][1]).not.toHaveProperty('platformRole');
  });

  it('requires audit read permission through the action middleware', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get('/api/audit/logs');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('platform.audit.read');
    expect(getDataSource).not.toHaveBeenCalled();
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      PlatformPermissions.AUDIT_VIEW,
      expect.objectContaining({
        userId: 'user-1',
        resourceType: 'platform',
      })
    );
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

  it('requires an elevated permission for unredacted audit payloads', async () => {
    const response = await request(app).get('/api/audit/logs?includePii=true');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain(PlatformPermissions.AUDIT_UNREDACTED_VIEW);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      PlatformPermissions.AUDIT_UNREDACTED_VIEW,
      expect.objectContaining({
        userId: 'user-1',
      })
    );
    const unredactedContext = (permissionService.hasPermission as unknown as Mock).mock.calls
      .find(([permission]) => permission === PlatformPermissions.AUDIT_UNREDACTED_VIEW)?.[1];
    expect(unredactedContext).not.toHaveProperty('platformRole');
    expect(getDataSource).not.toHaveBeenCalled();
    expect(piiRedactionService.redactPayload).not.toHaveBeenCalled();
  });

  it('returns unredacted audit payloads without redaction when permitted', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const auditRepo = {
      createQueryBuilder: vi.fn(() => ({
        orderBy: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([
          [{ id: 'log-1', action: 'test.action', createdAt: Date.now(), details: '{"email":"person@example.com"}' }],
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

    const response = await request(app).get('/api/audit/logs?redaction=none');

    expect(response.status).toBe(200);
    expect(response.body.logs[0].details).toEqual({ email: 'person@example.com' });
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      PlatformPermissions.AUDIT_UNREDACTED_VIEW,
      expect.objectContaining({ userId: 'user-1' })
    );
    expect(piiRedactionService.redactPayload).not.toHaveBeenCalled();
  });
});
