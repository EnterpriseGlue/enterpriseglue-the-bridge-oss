import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import syncRouter from '../../../../../packages/backend-host/src/modules/git/routes/sync.js';
import { GitSyncRequestSchema } from '@enterpriseglue/shared/schemas/git/repository.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { vcsService } from '@enterpriseglue/shared/services/versioning/index.js';

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
  GitService: {
    getProjectAccessToken: vi.fn().mockResolvedValue('token'),
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
  PlatformPermissions: {
    AUTHZ_CHECK: 'platform:authz:check',
  },
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
    GIT_PULL: 'project:git:pull',
    GIT_PUSH: 'project:git:push',
  },
  EnginePermissions: {
    DEPLOY_VIEW: 'engine:deploy:view',
    INSTANCE_VIEW: 'engine:instance:view',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
  },
  SYSTEM_ROLE_IDS: {
    ENGINE_OWNER: 'system.engine.owner',
    ENGINE_DELEGATE: 'system.engine.delegate',
    ENGINE_OPERATOR: 'system.engine.operator',
    ENGINE_DEPLOYER: 'system.engine.deployer',
  },
  ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE: {
    'system.engine.owner': 'owner',
    'system.engine.delegate': 'delegate',
    'system.engine.operator': 'operator',
    'system.engine.deployer': 'deployer',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
    getKnownEngineIdsForUser: vi.fn().mockResolvedValue([]),
    syncLegacyRoleAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/versioning/index.js', () => ({
  vcsService: {
    getUserBranch: vi.fn().mockResolvedValue({ id: 'draft-branch-1' }),
    getCommits: vi.fn().mockResolvedValue([]),
    syncFromMainDb: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ id: 'commit-1' }),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    mergeToMain: vi.fn().mockResolvedValue({ filesChanged: 0 }),
    commitCurrentState: vi.fn().mockResolvedValue({ id: 'commit-1' }),
    getMainBranch: vi.fn().mockResolvedValue(null),
    updateLastPushCommit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/git/RemoteGitService.js', () => ({
  remoteGitService: {
    getClient: vi.fn().mockResolvedValue({
      testWriteAccess: vi.fn().mockResolvedValue(undefined),
    }),
    pullFromRemote: vi.fn().mockResolvedValue({ filesCount: 0 }),
    pushToRemote: vi.fn().mockResolvedValue({
      pushedFilesCount: 0,
      deletionsCount: 0,
      skippedFilesCount: 0,
      totalFilesCount: 0,
      usedRemoteTree: false,
      isFirstSync: false,
      commit: null,
    }),
  },
}));

describe('git sync routes', () => {
  let app: express.Application;
  let repoFindOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(syncRouter);
    vi.clearAllMocks();
    repoFindOne = vi.fn().mockResolvedValue({
      id: 'repo-1',
      projectId: '11111111-1111-4111-8111-111111111111',
      providerId: 'github',
      namespace: 'org',
      repositoryName: 'repo',
      defaultBranch: 'main',
      lastSyncAt: 1700000000,
      lastCommitSha: 'abc1234',
    });
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(true);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([]);
    (vcsService.getUserBranch as unknown as Mock).mockResolvedValue({ id: 'draft-branch-1' });
    (vcsService.getCommits as unknown as Mock).mockResolvedValue([]);

    const qb = {
      innerJoin: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitRepository) {
          return {
            findOne: repoFindOne,
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            createQueryBuilder: vi.fn().mockReturnValue(qb),
          };
        }
        if (entity === Project) {
          return {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn(async ({ where }: any) => ({ id: String(where?.id), tenantId: 'tenant-a' })),
          };
        }
        return {
          insert: vi.fn().mockResolvedValue(undefined),
        };
      },
    });
  });

  it('placeholder test for git sync', () => {
    expect(true).toBe(true);
  });

  it('defaults a valid sync request to push', () => {
    expect(GitSyncRequestSchema.parse({
      projectId: '11111111-1111-4111-8111-111111111111',
      message: 'Synchronize models',
    }).direction).toBe('push');
  });

  it('returns sync status through scoped git-pull permission without legacy edit role', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:git:pull');
    (vcsService.getCommits as unknown as Mock).mockResolvedValue([
      { id: 'old', createdAt: 1699999999 },
      { id: 'new', createdAt: 1700000001 },
    ]);

    const response = await request(app)
      .get('/git-api/sync/status')
      .query({ projectId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      hasLocalChanges: true,
      hasRemoteChanges: false,
      lastSyncAt: 1700000000,
      localCommitCount: 1,
      remoteCommitCount: 0,
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:git:pull', expect.objectContaining({
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
