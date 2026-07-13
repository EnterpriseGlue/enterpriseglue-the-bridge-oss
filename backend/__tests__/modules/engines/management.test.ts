import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import managementRouter from '../../../../packages/backend-host/src/modules/engines/routes/management.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { engineAccessService, engineService, projectMemberService } from '@enterpriseglue/shared/services/platform-admin/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

const permissionServiceMock = vi.hoisted(() => ({
  hasPermission: vi.fn().mockResolvedValue(false),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'owner-1', email: 'owner@example.com' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/adapters/QueryHelpers.js', () => ({
  addCaseInsensitiveEquals: (_qb: any) => _qb,
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:5173',
  },
}));

vi.mock('@enterpriseglue/shared/constants/roles.js', () => ({
  ENGINE_VIEW_ROLES: ['owner', 'delegate', 'operator', 'viewer'],
  ENGINE_MANAGE_ROLES: ['owner', 'delegate'],
  MANAGE_ROLES: ['owner', 'delegate'],
}));

vi.mock('@enterpriseglue/shared/services/email/index.js', () => ({
  sendInvitationEmail: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/invitations.js', () => ({
  invitationService: {
    createInvitation: vi.fn().mockResolvedValue({
      invitationId: 'inv-1',
      inviteUrl: 'http://localhost:5173/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    }),
    isLocalLoginDisabled: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/UserService.js', () => ({
  userService: {
    createPendingUser: vi.fn().mockResolvedValue({ id: 'pending-1', email: 'nonexistent@example.com' }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    canManageEngine: vi.fn().mockResolvedValue(true),
    canViewEngine: vi.fn().mockResolvedValue(true),
    getEngineMembers: vi.fn().mockResolvedValue([]),
    getEngineRole: vi.fn().mockResolvedValue(null),
    getUserEngines: vi.fn().mockResolvedValue([]),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
    listEngines: vi.fn().mockResolvedValue([]),
    addEngineMember: vi.fn().mockResolvedValue({ id: 'em1', userId: 'target-1', role: 'operator' }),
    updateEngineMemberRole: vi.fn().mockResolvedValue(undefined),
    removeEngineMember: vi.fn().mockResolvedValue(undefined),
    assignDelegate: vi.fn().mockResolvedValue(undefined),
    transferOwnership: vi.fn().mockResolvedValue(undefined),
    setEnvironmentTag: vi.fn().mockResolvedValue(undefined),
    setEnvironmentLocked: vi.fn().mockResolvedValue(undefined),
    getEnvironmentTags: vi.fn().mockResolvedValue([]),
  },
  engineAccessService: {
    requestAccess: vi.fn().mockResolvedValue({ id: 'request-1', status: 'pending' }),
    getPendingRequests: vi.fn().mockResolvedValue([{ id: 'request-1', status: 'pending' }]),
    approveRequest: vi.fn().mockResolvedValue(undefined),
    denyRequest: vi.fn().mockResolvedValue(undefined),
    revokeAccess: vi.fn().mockResolvedValue(undefined),
  },
  projectMemberService: {
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    ENGINE_EDIT: 'engine:edit',
    ENVIRONMENT_SET: 'engine:environment:set',
    ENVIRONMENT_LOCK: 'engine:environment:lock',
    DELEGATE_MANAGE: 'engine:delegate:manage',
    OWNERSHIP_TRANSFER: 'engine:ownership:transfer',
    MEMBERS_MANAGE: 'engine:members:manage',
    MEMBERS_VIEW: 'engine:members:view',
    MEMBERS_LOOKUP: 'engine:members:lookup',
    MEMBERS_INVITE: 'engine:members:invite',
    MEMBERS_ADD: 'engine:members:add',
    MEMBERS_UPDATE_ROLE: 'engine:members:update-role',
    MEMBERS_REMOVE: 'engine:members:remove',
    PROJECT_ACCESS_VIEW: 'engine:project-access:view',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
    PROJECT_ACCESS_DENY: 'engine:project-access:deny',
    PROJECT_ACCESS_REVOKE: 'engine:project-access:revoke',
    INSTANCE_VIEW: 'engine:instance:view',
  },
  ProjectPermissions: {
    PROJECT_SETTINGS: 'project:settings:manage',
  },
  permissionService: {
    hasPermission: permissionServiceMock.hasPermission,
  },
}));

describe('engines management routes', () => {
  let app: express.Application;

  function entityName(entity: unknown): string | undefined {
    return typeof entity === 'function'
      ? entity.name
      : typeof entity === 'object' && entity !== null && 'name' in entity
        ? String((entity as { name?: unknown }).name)
        : undefined;
  }

  function createDefaultRepository(entity: unknown) {
    const name = entityName(entity);
    if (name === 'Engine') {
      return {
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null, name: 'Engine One' }),
      };
    }
    if (name === 'Project') {
      return {
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', tenantId: null }),
      };
    }
    return {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
    };
  }

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(managementRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    permissionServiceMock.hasPermission.mockResolvedValue(true);
    (engineService.hasEngineAccess as any).mockResolvedValue(true);
    (engineService.getEngineRole as any).mockResolvedValue(null);
    (engineService.addEngineMember as any).mockResolvedValue({ id: 'em1', userId: 'target-1', role: 'operator' });
    (engineService.updateEngineMemberRole as any).mockResolvedValue(undefined);
    (engineService.removeEngineMember as any).mockResolvedValue(undefined);
    (engineService.assignDelegate as any).mockResolvedValue(undefined);
    (engineService.transferOwnership as any).mockResolvedValue(undefined);
    (engineService.setEnvironmentTag as any).mockResolvedValue(undefined);
    (engineService.setEnvironmentLocked as any).mockResolvedValue(undefined);
    (engineService.getEnvironmentTags as any).mockResolvedValue([]);
    (engineAccessService.requestAccess as any).mockResolvedValue({ id: 'request-1', status: 'pending' });
    (engineAccessService.getPendingRequests as any).mockResolvedValue([{ id: 'request-1', status: 'pending' }]);
    (engineAccessService.approveRequest as any).mockResolvedValue(undefined);
    (engineAccessService.denyRequest as any).mockResolvedValue(undefined);
    (engineAccessService.revokeAccess as any).mockResolvedValue(undefined);
    (projectMemberService.hasRole as any).mockResolvedValue(true);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: createDefaultRepository,
    });
  });

  it('gets engine members list', async () => {
    const response = await request(app).get('/engines-api/engines/e1/members');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ members: [], pendingInvites: [] });
  });

  it('gets engine members list through scoped members-view permission without legacy view role', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:members:view');

    const response = await request(app).get('/engines-api/engines/e1/members');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ members: [], pendingInvites: [] });
  });

  it('gets current user role on engine', async () => {
    const response = await request(app).get('/engines-api/engines/e1/my-role');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('role');
    expect(engineService.getEngineRole).toHaveBeenCalledWith('owner-1', 'e1', null);
  });

  it('gets user engines list', async () => {
    const response = await request(app).get('/engines-api/my-engines');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('adds existing user as engine member and logs audit', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'target@example.com', role: 'operator' });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'engine.member.added',
      resourceType: 'engine',
    }));
  });

  it('adds an engine member through scoped members-add permission without legacy manage role', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:members:add');
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'target@example.com', role: 'operator' });

    expect(response.status).toBe(201);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:members:add', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('looks up engine member candidates through scoped members-lookup permission without legacy manage role', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:members:lookup');
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', firstName: 'Target', lastName: 'User', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .get('/engines-api/engines/e1/members/lookup')
      .query({ email: 'target@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      mode: 'direct-add',
      user: {
        id: 'target-1',
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
      },
    });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:members:lookup', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('adds an existing engine member through scoped members-add permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:members:add');
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'target@example.com', role: 'operator' });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:members:add', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('invites an engine member through scoped members-invite permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:members:invite');
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'nonexistent@example.com', role: 'operator' });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(true);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:members:invite', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('updates engine member role through scoped members-update-role permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    (engineService.getEngineRole as any).mockResolvedValue('operator');
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:members:update-role');

    const response = await request(app)
      .patch('/engines-api/engines/e1/members/11111111-1111-4111-8111-111111111111')
      .send({ role: 'deployer' });

    expect(response.status).toBe(200);
    expect(engineService.updateEngineMemberRole).toHaveBeenCalledWith('e1', '11111111-1111-4111-8111-111111111111', 'deployer', 'owner-1');
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:members:update-role', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('removes engine member through scoped members-remove permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    (engineService.getEngineRole as any).mockResolvedValue('operator');
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:members:remove');

    const response = await request(app)
      .delete('/engines-api/engines/e1/members/11111111-1111-4111-8111-111111111111');

    expect(response.status).toBe(204);
    expect(engineService.removeEngineMember).toHaveBeenCalledWith('e1', '11111111-1111-4111-8111-111111111111', 'owner-1');
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:members:remove', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('sets engine environment through scoped environment-set permission without broad engine-edit permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:environment:set');

    const response = await request(app)
      .post('/engines-api/engines/e1/environment')
      .send({ environmentTagId: 'tag-1' });

    expect(response.status).toBe(200);
    expect(engineService.setEnvironmentTag).toHaveBeenCalledWith('e1', 'tag-1');
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:environment:set', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('locks engine environment through scoped environment-lock permission without broad engine-edit permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:environment:lock');

    const response = await request(app)
      .post('/engines-api/engines/e1/lock')
      .send({ locked: true });

    expect(response.status).toBe(200);
    expect(engineService.setEnvironmentLocked).toHaveBeenCalledWith('e1', true);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:environment:lock', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('views engine access requests through scoped project-access-view permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:project-access:view');

    const response = await request(app).get('/engines-api/engines/e1/access-requests');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'request-1', status: 'pending' }]);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:project-access:view', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('approves engine access requests through scoped project-access-approve permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:project-access:approve');

    const response = await request(app).post('/engines-api/engines/e1/access-requests/request-1/approve');

    expect(response.status).toBe(200);
    expect(engineAccessService.approveRequest).toHaveBeenCalledWith('request-1', 'owner-1');
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:project-access:approve', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('denies engine access requests through scoped project-access-deny permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:project-access:deny');

    const response = await request(app).post('/engines-api/engines/e1/access-requests/request-1/deny');

    expect(response.status).toBe(200);
    expect(engineAccessService.denyRequest).toHaveBeenCalledWith('request-1', 'owner-1');
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:project-access:deny', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('revokes project engine access through scoped project-access-revoke permission without broad members-manage permission', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:project-access:revoke');

    const response = await request(app).delete('/engines-api/engines/e1/projects/project-1');

    expect(response.status).toBe(204);
    expect(engineAccessService.revokeAccess).toHaveBeenCalledWith('project-1', 'e1');
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:project-access:revoke', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('requests engine access through scoped project settings permission without legacy project manager role', async () => {
    (projectMemberService.hasRole as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'project:settings:manage');

    const response = await request(app)
      .post('/engines-api/engines/e1/request-access')
      .send({ projectId: '11111111-1111-4111-8111-111111111111' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'request-1', status: 'pending' });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('project:settings:manage', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'project',
      resourceId: '11111111-1111-4111-8111-111111111111',
    }));
    expect(engineAccessService.requestAccess).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'e1',
      'owner-1'
    );
  });

  it('assigns delegate through scoped delegate-management permission without legacy owner role', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:delegate:manage');
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'delegate-1', email: 'delegate@example.com' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/delegate')
      .send({ email: 'delegate@example.com' });

    expect(response.status).toBe(200);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:delegate:manage', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
    expect(engineService.assignDelegate).toHaveBeenCalledWith('e1', 'delegate-1');
  });

  it('transfers ownership through scoped ownership-transfer permission without legacy owner role', async () => {
    (engineService.hasEngineAccess as any).mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:ownership:transfer');
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'new-owner-1', email: 'new-owner@example.com' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/transfer-ownership')
      .send({ newOwnerEmail: 'new-owner@example.com' });

    expect(response.status).toBe(200);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:ownership:transfer', expect.objectContaining({
      userId: 'owner-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
    expect(engineService.transferOwnership).toHaveBeenCalledWith('e1', 'new-owner-1');
  });

  it('creates an invitation for a non-existent engine user', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'nonexistent@example.com', role: 'operator' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      invited: true,
      emailSent: false,
      inviteUrl: 'http://localhost:5173/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
    }));
  });

  it('rejects delegate role on the generic engine members endpoint', async () => {
    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'target@example.com', role: 'delegate' });

    expect(response.status).toBe(400);
  });

  it('reissues a manual engine invitation', async () => {
    const invitationId = '11111111-1111-4111-8111-111111111111';
    const invitationRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({
        id: invitationId,
        resourceType: 'engine',
        resourceId: 'e1',
        userId: 'pending-1',
        email: 'pending@example.com',
        tenantSlug: 'default',
        resourceName: 'Engine One',
        resourceRole: 'operator',
        deliveryMethod: 'manual',
        status: 'pending',
        revokedAt: null,
        completedAt: null,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) {
          return {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if ((entity as any)?.name === 'Invitation') return invitationRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post(`/engines-api/engines/e1/pending-invites/${invitationId}/reissue`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      invited: true,
      emailSent: false,
      inviteUrl: 'http://localhost:5173/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
    }));
    expect(invitationService.createInvitation).toHaveBeenCalled();
  });
});
