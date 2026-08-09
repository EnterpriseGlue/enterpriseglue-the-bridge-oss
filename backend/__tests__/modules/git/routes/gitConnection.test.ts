import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import gitConnectionRouter from '../../../../../packages/backend-host/src/modules/git/routes/gitConnection.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: 'tenant-a' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
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

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/encryption.js', () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
}));

vi.mock('@enterpriseglue/shared/services/git/RemoteGitService.js', () => ({
  remoteGitService: {
    getClient: vi.fn().mockResolvedValue({
      testWriteAccess: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('git project connection routes', () => {
  let app: express.Application;
  let repoFindOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(gitConnectionRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    repoFindOne = vi.fn().mockResolvedValue({
      id: 'repo-1',
      projectId: '11111111-1111-4111-8111-111111111111',
      providerId: 'github',
      repositoryName: 'repo',
      namespace: 'org',
      defaultBranch: 'main',
      remoteUrl: 'https://github.com/org/repo',
      encryptedToken: 'secret',
      lastValidatedAt: 1700000000,
      tokenScopeHint: 'contents:write',
      connectedByUserId: 'user-1',
      lastSyncAt: 1700000001,
    });

    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitRepository) {
          return {
            findOne: repoFindOne,
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            insert: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue({ affected: 1 }),
          };
        }
        if (entity === Project) {
          return {
            findOne: vi.fn(async ({ where }: any) => ({ id: String(where?.id), tenantId: 'tenant-a' })),
          };
        }
        return {
          insert: vi.fn().mockResolvedValue(undefined),
        };
      },
    });
  });

  it('reads project connection through scoped files-view permission without legacy project membership', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:files:view');

    const response = await request(app)
      .get('/git-api/project-connection')
      .query({ projectId });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      connected: true,
      providerId: 'github',
      repositoryName: 'repo',
      namespace: 'org',
      defaultBranch: 'main',
      hasToken: true,
    });
    expect(response.body).not.toHaveProperty('token');
    expect(response.body).not.toHaveProperty('encryptedToken');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(repoFindOne).toHaveBeenCalledWith({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  });
});
