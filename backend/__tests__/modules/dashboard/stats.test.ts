import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/db/entities/File.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { permissionService as dashboardPermissionService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', type: 'access', platformRole: 'user' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  permissionService: {
    getCurrentUserPermissions: vi.fn(),
  },
}));

function emptyPermissions() {
  return {
    userId: 'user-1',
    platform: [],
    projects: [],
    engines: [],
    authorizationVersion: 'authz:1700000000000:test',
    generatedAt: 1700000000000,
  };
}

describe('GET /api/dashboard/stats', () => {
  let app: express.Application;

  beforeEach(async () => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    const { default: statsRouter } = await import('../../../../packages/backend-host/src/modules/dashboard/routes/stats.js');
    app.use(statsRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    vi.mocked(permissionService.hasPermission).mockImplementation(async (permission: string) =>
      permission === 'platform:dashboard:view'
    );
    vi.mocked(dashboardPermissionService.getCurrentUserPermissions).mockResolvedValue(emptyPermissions());
  });

  it('returns zero stats when no projects', async () => {
    const fileRepo = { createQueryBuilder: vi.fn() };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return fileRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/stats');

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:dashboard:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
    expect(response.body.totalProjects).toBe(0);
    expect(response.body.totalFiles).toBe(0);
    expect(response.body.fileTypes).toEqual({ bpmn: 0, dmn: 0, form: 0 });
  });

  it('returns file type counts for evaluator-visible projects', async () => {
    vi.mocked(dashboardPermissionService.getCurrentUserPermissions).mockResolvedValue({
      ...emptyPermissions(),
      projects: [{ resourceId: 'project-1', permissions: ['project:files:view'] }],
    });
    const qb = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([
        { type: 'bpmn', count: '2' },
        { type: 'dmn', count: '1' },
      ]),
    };
    const fileRepo = { createQueryBuilder: vi.fn().mockReturnValue(qb) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) return fileRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/stats');

    expect(response.status).toBe(200);
    expect(dashboardPermissionService.getCurrentUserPermissions).toHaveBeenCalledWith('user-1', undefined);
    expect(response.body.totalProjects).toBe(1);
    expect(response.body.totalFiles).toBe(3);
    expect(response.body.fileTypes).toEqual({ bpmn: 2, dmn: 1, form: 0 });
  });

  it('denies stats without dashboard view permission', async () => {
    vi.mocked(permissionService.hasPermission).mockResolvedValue(false);

    const response = await request(app).get('/api/dashboard/stats');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('platform.dashboard.read');
    expect(getDataSource).not.toHaveBeenCalled();
  });
});
