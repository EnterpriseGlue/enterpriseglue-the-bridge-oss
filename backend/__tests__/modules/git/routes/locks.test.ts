import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import locksRouter from '../../../../../packages/backend-host/src/modules/git/routes/locks.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { GitLock } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitLock.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const lockManagerMock = vi.hoisted(() => ({
  acquireLock: vi.fn().mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111', fileId: '22222222-2222-4222-8222-222222222222', userId: '33333333-3333-4333-8333-333333333333',
    acquiredAt: 1, lastInteractionAt: 1, expiresAt: 2, heartbeatAt: 1, visibilityState: 'visible', visibilityChangedAt: 1, sessionStatus: 'active',
  }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
  getLockRecord: vi.fn().mockResolvedValue(null),
  getLockHolder: vi.fn().mockResolvedValue(null),
  getProjectLocks: vi.fn().mockResolvedValue([]),
  touchLock: vi.fn().mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111', fileId: '22222222-2222-4222-8222-222222222222', userId: '33333333-3333-4333-8333-333333333333',
    acquiredAt: 1, lastInteractionAt: 1, expiresAt: 2, heartbeatAt: 1, visibilityState: 'visible', visibilityChangedAt: 1, sessionStatus: 'active',
  }),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: 'tenant-a' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/git/LockManager.js', () => ({
  LockManager: class {
    acquireLock = lockManagerMock.acquireLock;
    releaseLock = lockManagerMock.releaseLock;
    getLockRecord = lockManagerMock.getLockRecord;
    getLockHolder = lockManagerMock.getLockHolder;
    getProjectLocks = lockManagerMock.getProjectLocks;
    touchLock = lockManagerMock.touchLock;
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
    FILES_EDIT: 'project:files:edit',
    PROJECT_SETTINGS: 'project:settings:manage',
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

describe('git locks routes', () => {
  let app: express.Application;
  let fileFindOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(locksRouter);
    vi.clearAllMocks();
    fileFindOne = vi.fn().mockResolvedValue({ projectId: 'project-1' });
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(true);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([]);
    lockManagerMock.acquireLock.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111', fileId: '22222222-2222-4222-8222-222222222222', userId: '33333333-3333-4333-8333-333333333333',
      acquiredAt: 1, lastInteractionAt: 1, expiresAt: 2, heartbeatAt: 1, visibilityState: 'visible', visibilityChangedAt: 1, sessionStatus: 'active', accessToken: 'must-not-leak',
    } as any);
    lockManagerMock.getProjectLocks.mockResolvedValue([]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === File) {
          return {
            findOne: fileFindOne,
          };
        }
        if (entity === GitLock) {
          return {
            findOne: vi.fn().mockResolvedValue({ id: 'lock-1', fileId: 'file-1' }),
          };
        }
        if (entity === Project) {
          return {
            findOne: vi.fn(async ({ where }: any) => ({ id: String(where?.id), tenantId: null })),
          };
        }
        return {
          findOne: vi.fn().mockResolvedValue(null),
        };
      },
    });
  });

  it('acquires a lock through scoped files-edit permission without legacy edit role', async () => {
    const fileId = '11111111-1111-4111-8111-111111111111';
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:files:edit');

    const response = await request(app)
      .post('/git-api/locks')
      .send({ fileId });

    expect(response.status).toBe(201);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:edit', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: 'project-1',
    }));
    expect(lockManagerMock.acquireLock).toHaveBeenCalledWith(fileId, 'user-1', expect.objectContaining({
      force: false,
    }));
    expect(response.body).not.toHaveProperty('accessToken');
  });

  it('lists project locks through scoped files-view permission without legacy project access', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:files:view');
    lockManagerMock.getProjectLocks.mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111', fileId: '22222222-2222-4222-8222-222222222222', userId: '33333333-3333-4333-8333-333333333333',
      acquiredAt: 1, lastInteractionAt: 1, expiresAt: 2, heartbeatAt: 1, visibilityState: 'visible', visibilityChangedAt: 1, sessionStatus: 'active', userName: 'User', extra: 'must-not-leak',
    }]);

    const response = await request(app)
      .get('/git-api/locks')
      .query({ projectId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ locks: [expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111', userName: 'User' })] });
    expect(response.body.locks[0]).not.toHaveProperty('extra');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('returns a shared heartbeat receipt for the current lock holder', async () => {
    lockManagerMock.getLockRecord.mockResolvedValue({ id: 'lock-1', fileId: 'file-1', userId: 'user-1', released: false });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app)
      .put('/git-api/locks/11111111-1111-4111-8111-111111111111/heartbeat')
      .send({ visibilityState: 'visible' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ success: true, lock: expect.objectContaining({ sessionStatus: 'active' }) }));
  });
});
