import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import contextRouter from '../../../../packages/backend-host/src/modules/dashboard/routes/context.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { engineService, permissionService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { permissionService as actionPermissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'user' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    getUserEngines: vi.fn(),
  },
  permissionService: {
    getCurrentUserPermissions: vi.fn(),
  },
  PlatformPermissions: {
    SETTINGS_MANAGE: 'platform:settings:manage',
    USER_MANAGE: 'platform:user:manage',
    USER_VIEW: 'platform:user:view',
    USERS_VIEW: 'platform:users:view',
  },
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
    DEPLOY: 'project:deploy',
  },
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    DEPLOY_VIEW: 'engine:deploy:view',
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    AUTHZ_CHECK: 'platform:authz:check',
  },
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
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
    hasPermission: vi.fn().mockResolvedValue(true),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
    getKnownEngineIdsForUser: vi.fn().mockResolvedValue([]),
    syncLegacyRoleAssignments: vi.fn().mockResolvedValue(undefined),
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

describe('GET /api/dashboard/context', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(contextRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    vi.mocked(actionPermissionService.hasPermission).mockImplementation(async (permission: string) =>
      permission === 'platform:dashboard:view'
    );
    vi.mocked(engineService.getUserEngines).mockResolvedValue([]);
    vi.mocked(permissionService.getCurrentUserPermissions).mockResolvedValue(emptyPermissions());
  });

  it('returns context for regular user', async () => {
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(actionPermissionService.hasPermission).toHaveBeenCalledWith('platform:dashboard:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
    expect(response.body.isPlatformAdmin).toBe(false);
    expect(response.body.ownedEngineIds).toEqual([]);
    expect(response.body.projectMemberships).toEqual([]);
  });

  it('denies dashboard context without dashboard view permission', async () => {
    vi.mocked(actionPermissionService.hasPermission).mockResolvedValue(false);

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('platform.dashboard.read');
    expect(engineService.getUserEngines).not.toHaveBeenCalled();
    expect(permissionService.getCurrentUserPermissions).not.toHaveBeenCalled();
  });

  it('returns context with engine ownership', async () => {
    vi.mocked(engineService.getUserEngines).mockResolvedValue([
      { engine: { id: 'engine-1' } as any, role: 'owner', environmentTag: null },
    ]);
    vi.mocked(permissionService.getCurrentUserPermissions).mockResolvedValue({
      ...emptyPermissions(),
      engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
    });
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(response.body.ownedEngineIds).toEqual(['engine-1']);
    expect(response.body.canViewEngines).toBe(true);
    expect(response.body.canViewProcessData).toBe(true);
  });

  it('returns context with project memberships', async () => {
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([
      { projectId: 'project-1', role: 'owner' }
    ]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([
      { id: 'project-1', name: 'Test Project' }
    ]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(response.body.projectMemberships).toHaveLength(1);
    expect(response.body.projectMemberships[0].projectName).toBe('Test Project');
    expect(response.body.canViewDeployments).toBe(true);
  });

  it('derives dashboard visibility from scoped permission snapshots', async () => {
    vi.mocked(permissionService.getCurrentUserPermissions).mockResolvedValue({
      ...emptyPermissions(),
      platform: ['platform:users:view'],
      projects: [{ resourceId: 'project-2', permissions: ['project:deploy'] }],
      engines: [{ resourceId: 'engine-2', permissions: ['engine:deploy:view'] }],
    });
    vi.mocked(engineService.getUserEngines).mockResolvedValue([
      { engine: { id: 'engine-2' } as any, role: 'custom', environmentTag: null },
    ]);
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([
      { id: 'project-2', name: 'Scoped Project' },
    ]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(response.body.canViewActiveUsers).toBe(true);
    expect(response.body.canViewEngines).toBe(true);
    expect(response.body.canViewDeployments).toBe(true);
    expect(response.body.projectMemberships).toEqual([
      { projectId: 'project-2', projectName: 'Scoped Project', role: 'permission' },
    ]);
  });

  it('derives platform-admin dashboard flags from platform permissions', async () => {
    vi.mocked(permissionService.getCurrentUserPermissions).mockResolvedValue({
      ...emptyPermissions(),
      platform: ['platform:settings:manage'],
    });
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(response.body.isPlatformAdmin).toBe(true);
    expect(response.body.canViewAllProjects).toBe(true);
  });
});
