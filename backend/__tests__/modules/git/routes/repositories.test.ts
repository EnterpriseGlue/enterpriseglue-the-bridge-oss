import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import repositoriesRouter from '../../../../../packages/backend-host/src/modules/git/routes/repositories.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: 'tenant-a' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/git/GitService.js', () => ({
  GitService: class {
    listUserRepositories = vi.fn().mockResolvedValue([]);
    initRepository = vi.fn().mockResolvedValue({ id: 'repo-1' });
    cloneRepository = vi.fn().mockResolvedValue({ id: 'repo-1' });
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
    GIT_CONNECT: 'project:git:connect',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
  },
}));

describe('git repositories routes', () => {
  let app: express.Application;
  let rawRows: any[];
  let deleteRepo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(repositoriesRouter);
    vi.clearAllMocks();
    rawRows = [];
    deleteRepo = vi.fn().mockResolvedValue({ affected: 1 });
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(true);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([]);

    const qb = {
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn(async () => rawRows),
      getRawOne: vi.fn(async () => rawRows[0] ?? null),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitRepository) {
          return {
            createQueryBuilder: vi.fn().mockReturnValue(qb),
            findOne: vi.fn(async ({ where }: any) => {
              const id = String(where?.id || '');
              const row = rawRows.find((candidate) => String(candidate.id) === id) ?? rawRows[0];
              return row?.projectId ? { id, projectId: row.projectId } : null;
            }),
            delete: deleteRepo,
          };
        }
        if (entity === Project) {
          return {
            find: vi.fn(async () => rawRows.map((row) => ({ id: String(row.projectId), tenantId: 'tenant-a' }))),
            findOne: vi.fn(async ({ where }: any) => ({ id: String(where?.id), tenantId: 'tenant-a' })),
          };
        }
        return {};
      },
    });
  });

  it('placeholder test for git repositories', () => {
    expect(true).toBe(true);
  });

  it('lists repositories through scoped files-view permission without legacy project membership', async () => {
    const allowedProjectId = '11111111-1111-4111-8111-111111111111';
    const deniedProjectId = '22222222-2222-4222-8222-222222222222';
    rawRows = [
      { id: 'repo-1', projectId: allowedProjectId, repositoryName: 'allowed' },
      { id: 'repo-2', projectId: deniedProjectId, repositoryName: 'denied' },
    ];
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([allowedProjectId, deniedProjectId]);
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (_permission: string, context: any) => context.resourceId === allowedProjectId);

    const response = await request(app).get('/git-api/repositories');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 'repo-1', projectId: allowedProjectId, repositoryName: 'allowed' },
    ]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: allowedProjectId,
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: deniedProjectId,
    }));
  });

  it('deletes a repository through scoped git-connect permission without legacy edit role', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    rawRows = [{ projectId }];
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:git:connect');

    const response = await request(app).delete('/git-api/repositories/repo-1');

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:git:connect', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(deleteRepo).toHaveBeenCalledWith({ id: 'repo-1' });
  });
});
