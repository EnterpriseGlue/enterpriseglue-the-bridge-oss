import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import membersRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/members.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PermissionGrant } from '@enterpriseglue/shared/db/entities/PermissionGrant.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/db/entities/ProjectMember.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { getEmailConfigForTenant } from '@enterpriseglue/shared/services/email/index.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const authMocks = vi.hoisted(() => ({
  currentUser: { userId: 'owner-1', email: 'owner@example.com' } as any,
  tenantId: null as string | null,
}));
const accessAuthorityDecisionMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

const projectId = '00000000-0000-0000-0000-000000000001';

function entityName(entity: unknown): string | undefined {
  return (entity as any)?.name;
}

function projectRepository() {
  return {
    findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: 'tenant-default', name: 'Project One' }),
  };
}

function defaultRepository(entity: unknown) {
  if (entityName(entity) === 'Project') return projectRepository();
  if (entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
  if (entityName(entity) === 'Invitation') return { find: vi.fn().mockResolvedValue([]) };
  return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
}

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = authMocks.currentUser;
    req.tenant = { tenantId: authMocks.tenantId };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/adapters/QueryHelpers.js', () => ({
  addCaseInsensitiveEquals: (_qb: any) => _qb,
  caseInsensitiveColumn: (col: string) => `LOWER(${col})`,
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:5173',
  },
}));

vi.mock('@enterpriseglue/shared/constants/roles.js', () => ({
  MANAGE_ROLES: ['owner', 'delegate'],
}));

vi.mock('@enterpriseglue/shared/services/email/index.js', () => ({
  sendInvitationEmail: vi.fn(),
  getEmailConfigForTenant: vi.fn(),
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

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
    hasRole: vi.fn().mockResolvedValue(true),
    getMembers: vi.fn().mockResolvedValue([]),
    getMembership: vi.fn().mockResolvedValue({ role: 'owner', roles: ['owner'] }),
    getProjectOwners: vi.fn().mockResolvedValue(['owner-1']),
    addMember: vi.fn().mockResolvedValue({ id: 'pm1', userId: 'target-1', role: 'viewer' }),
    updateRoles: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    transferOwnership: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/AccessAuthorityService.js', () => ({
  getAccessAuthorityDecision: accessAuthorityDecisionMock,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
    getKnownEngineIdsForUser: vi.fn().mockResolvedValue([]),
    syncLegacyRoleAssignments: vi.fn().mockResolvedValue(undefined),
  },
  PlatformPermissions: {
    AUTHZ_CHECK: 'platform:authz:check',
  },
  EnginePermissions: {
    DEPLOY_VIEW: 'engine:deploy:view',
    INSTANCE_VIEW: 'engine:instance:view',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
  },
  ProjectPermissions: {
    MEMBERS_MANAGE: 'project:members:manage',
    MEMBERS_VIEW: 'project:members:view',
    MEMBERS_SEARCH: 'project:members:search',
    MEMBERS_INVITE: 'project:members:invite',
    MEMBERS_ADD: 'project:members:add',
    MEMBERS_UPDATE_ROLE: 'project:members:update-role',
    MEMBERS_REMOVE: 'project:members:remove',
    MEMBERS_MANAGE_DEPLOY_GRANT: 'project:members:manage-deploy-grant',
    DELEGATE_MANAGE: 'project:delegate:manage',
    OWNERSHIP_TRANSFER: 'project:ownership:transfer',
    FILES_EDIT: 'project:files:edit',
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
}));

describe('starbase members routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(membersRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    accessAuthorityDecisionMock.mockResolvedValue(null);
    authMocks.currentUser = { userId: 'owner-1', email: 'owner@example.com' };
    authMocks.tenantId = null;
    (getEmailConfigForTenant as unknown as Mock).mockResolvedValue(null);
    (projectMemberService.hasAccess as Mock).mockResolvedValue(true);
    (projectMemberService.hasRole as Mock).mockResolvedValue(true);
    (projectMemberService.getMembers as Mock).mockResolvedValue([]);
    (projectMemberService.getMembership as Mock).mockReset().mockResolvedValue(null);
    (projectMemberService.getProjectOwners as Mock).mockResolvedValue(['owner-1']);
    (projectMemberService.addMember as Mock).mockResolvedValue({ id: 'pm1', userId: 'target-1', role: 'viewer' });
    (projectMemberService.updateRoles as Mock).mockResolvedValue(undefined);
    (projectMemberService.removeMember as Mock).mockResolvedValue(undefined);
    (projectMemberService.transferOwnership as Mock).mockResolvedValue(undefined);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission.startsWith('project:members:') ||
      permission === 'project:delegate:manage' ||
      permission === 'project:ownership:transfer'
    );
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: defaultRepository,
    });
  });

  it('returns project member invite capabilities', async () => {
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    (getEmailConfigForTenant as unknown as Mock).mockResolvedValue({ provider: 'smtp' });
    (invitationService.isLocalLoginDisabled as Mock).mockResolvedValue(true);

    const response = await request(app)
      .get('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/capabilities');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ssoRequired: true, emailConfigured: true });
  });

  it('returns direct-add mode for an existing non-member user lookup', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', firstName: 'Target', lastName: 'User', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.getMembership as Mock).mockResolvedValueOnce(null);

    const response = await request(app)
      .get('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/lookup')
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
  });

  it('returns existing-member mode for an existing project member lookup', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', firstName: 'Target', lastName: 'User', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.getMembership as Mock).mockResolvedValueOnce({ role: 'viewer', roles: ['viewer'] });

    const response = await request(app)
      .get('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/lookup')
      .query({ email: 'target@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      mode: 'existing-member',
      user: {
        id: 'target-1',
        email: 'target@example.com',
        firstName: 'Target',
        lastName: 'User',
      },
    });
  });

  it('adds existing user as project member and logs audit', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };
    const memberRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return memberRepo;
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.getMembership as Mock).mockResolvedValueOnce(null);

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'target@example.com', roles: ['viewer'] });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.member.added',
      resourceType: 'project',
    }));
  });

  it('keeps project members readable but rejects manual changes when project access is SSO-managed', async () => {
    accessAuthorityDecisionMock.mockResolvedValue({
      domain: 'project',
      mode: 'sso_managed',
      manualMutationsAllowed: false,
      reason: 'Project access is SSO-managed; manual access changes are disabled',
    });

    const listResponse = await request(app).get(`/starbase-api/projects/${projectId}/members`);
    expect(listResponse.status).toBe(200);

    const createResponse = await request(app)
      .post(`/starbase-api/projects/${projectId}/members`)
      .send({ email: 'target@example.com', roles: ['viewer'] });

    expect(createResponse.status).toBe(403);
    expect(projectMemberService.addMember).not.toHaveBeenCalled();
  });

  it('lists project members through scoped members-view permission without legacy membership', async () => {
    const grantQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project || entityName(entity) === 'Project') return projectRepository();
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        return {
          find: vi.fn().mockResolvedValue([]),
          findOne: vi.fn().mockResolvedValue(null),
          createQueryBuilder: vi.fn().mockReturnValue(grantQueryBuilder),
        };
      },
    });

    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.hasAccess as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:view'
    );

    const response = await request(app)
      .get('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members');

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:view',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('reports deploy-grant eligibility from canonical file-edit permission rather than the legacy member role', async () => {
    const grantQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ userId: 'canonical-editor-1' }]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project || entityName(entity) === 'Project') return projectRepository();
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PermissionGrant || entityName(entity) === 'PermissionGrant') return { createQueryBuilder: vi.fn().mockReturnValue(grantQueryBuilder) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (projectMemberService.getMembers as Mock).mockResolvedValue([
      { userId: 'canonical-editor-1', role: 'viewer', roles: ['viewer'] },
      { userId: 'legacy-editor-1', role: 'editor', roles: ['editor'] },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string, context?: { userId?: string }) =>
      permission === 'project:members:view' ||
      (permission === 'project:files:edit' && context?.userId === 'canonical-editor-1')
    );

    const response = await request(app)
      .get('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members');

    expect(response.status).toBe(200);
    expect(response.body.members).toEqual([
      expect.objectContaining({ userId: 'canonical-editor-1', deployAllowed: true }),
      expect.objectContaining({ userId: 'legacy-editor-1', deployAllowed: null }),
    ]);
    expect(grantQueryBuilder.where).toHaveBeenCalledWith(
      'pg.userId IN (:...deployEligibleUserIds)',
      { deployEligibleUserIds: ['canonical-editor-1'] },
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:files:edit',
      expect.objectContaining({
        userId: 'canonical-editor-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      }),
    );
  });

  it('adds existing user through scoped members-add action without legacy manager role', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };
    const memberRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return memberRepo;
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:add'
    );

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'target@example.com', roles: ['viewer'] });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:add',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('propagates the selected tenant into project member authorization checks', async () => {
    authMocks.tenantId = 'tenant-a';
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (projectMemberService.getMembership as Mock).mockResolvedValue(null);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:members:add');

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'target@example.com', roles: ['viewer'] });

    expect(response.status).toBe(201);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:add',
      expect.objectContaining({ tenantId: 'tenant-a', resourceType: 'project', resourceId: '00000000-0000-0000-0000-000000000001' }),
    );
  });

  it('searches users through scoped members-search permission without legacy manager role', async () => {
    const userQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{ id: 'target-1', email: 'target@example.com', firstName: 'Target', lastName: 'User' }]),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project || entityName(entity) === 'Project') return projectRepository();
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === User || entityName(entity) === 'User') return { createQueryBuilder: vi.fn().mockReturnValue(userQueryBuilder) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:search'
    );

    const response = await request(app)
      .get('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/user-search')
      .query({ q: 'ta' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'target-1', email: 'target@example.com', firstName: 'Target', lastName: 'User' }]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:search',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('adds existing user through scoped members-add permission without broad members-manage permission', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:add'
    );

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'target@example.com', roles: ['viewer'] });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:add',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('invites pending user through scoped members-invite permission without broad members-manage permission', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:invite'
    );

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'nonexistent@example.com', roles: ['viewer'], deliveryMethod: 'email' });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(true);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:invite',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('updates project member roles through scoped members-update-role permission without broad members-manage permission', async () => {
    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock).mockImplementation(async (_projectId: string, userId: string) =>
      userId === '11111111-1111-4111-8111-111111111111'
        ? { role: 'viewer', roles: ['viewer'] }
        : null
    );
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:update-role'
    );

    const response = await request(app)
      .patch('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/11111111-1111-4111-8111-111111111111')
      .send({ roles: ['editor'] });

    expect(response.status).toBe(200);
    expect(projectMemberService.updateRoles).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      ['editor']
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:update-role',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('removes project member through scoped members-remove permission without broad members-manage permission', async () => {
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    (invitationService as any).revokeOutstandingInvitations = vi.fn().mockResolvedValue(undefined);
    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock).mockResolvedValue({ role: 'viewer', roles: ['viewer'] });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:remove'
    );

    const response = await request(app)
      .delete('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/11111111-1111-4111-8111-111111111111');

    expect(response.status).toBe(204);
    expect(projectMemberService.removeMember).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      '11111111-1111-4111-8111-111111111111'
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:remove',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('denies non-self project member removal when member-remove action is missing', async () => {
    (projectMemberService.getMembership as Mock).mockResolvedValue({ role: 'viewer', roles: ['viewer'] });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .delete('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/11111111-1111-4111-8111-111111111111');

    expect(response.status).toBe(403);
    expect(projectMemberService.removeMember).not.toHaveBeenCalled();
  });

  it('allows self removal without member-remove action when target is not owner', async () => {
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    const selfUserId = '11111111-1111-4111-8111-111111111111';
    authMocks.currentUser = { userId: selfUserId, email: 'self@example.com' };
    (invitationService as any).revokeOutstandingInvitations = vi.fn().mockResolvedValue(undefined);
    (projectMemberService.getMembership as Mock).mockResolvedValue({ role: 'viewer', roles: ['viewer'] });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .delete(`/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/${selfUserId}`);

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).not.toHaveBeenCalledWith(
      'project:members:remove',
      expect.anything()
    );
    expect(projectMemberService.removeMember).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      selfUserId
    );
  });

  it('updates editor deploy grant through scoped manage-deploy-grant permission without broad members-manage permission', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const grantBuilder = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orIgnore: vi.fn().mockReturnThis(),
      execute,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project || entityName(entity) === 'Project') return projectRepository();
        if (entity === PermissionGrant || entityName(entity) === 'PermissionGrant') return { createQueryBuilder: vi.fn().mockReturnValue(grantBuilder) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), createQueryBuilder: vi.fn().mockReturnValue(grantBuilder) };
      },
    });

    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock).mockResolvedValue({ role: 'editor', roles: ['editor'] });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:manage-deploy-grant' ||
      permission === 'project:files:edit'
    );

    const response = await request(app)
      .put('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/11111111-1111-4111-8111-111111111111/deploy-permission')
      .send({ allowed: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allowed: true });
    expect(execute).toHaveBeenCalled();
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:manage-deploy-grant',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:files:edit',
      expect.objectContaining({
        userId: '11111111-1111-4111-8111-111111111111',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('adds project delegate through scoped delegate-management permission without legacy owner role', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'delegate-1', email: 'delegate@example.com', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock).mockResolvedValueOnce(null);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:add' || permission === 'project:delegate:manage'
    );

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'delegate@example.com', roles: ['delegate'] });

    expect(response.status).toBe(201);
    expect(projectMemberService.addMember).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      'delegate-1',
      ['delegate'],
      'owner-1'
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:delegate:manage',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('does not let a legacy owner membership bypass delegate-management permission', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'delegate-1', email: 'delegate@example.com', passwordHash: 'hash' }),
      }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (projectMemberService.getMembership as Mock).mockResolvedValue({ role: 'owner', roles: ['owner'] });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:add'
    );

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'delegate@example.com', roles: ['delegate'] });

    expect(response.status).toBe(403);
    expect(projectMemberService.addMember).not.toHaveBeenCalled();
    expect(projectMemberService.getMembership).not.toHaveBeenCalled();
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:delegate:manage',
      expect.objectContaining({ userId: 'owner-1', resourceId: '00000000-0000-0000-0000-000000000001' }),
    );
  });

  it('updates project member to delegate through scoped delegate-management permission without legacy owner role', async () => {
    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getMembership as Mock).mockImplementation(async (_projectId: string, userId: string) =>
      userId === '11111111-1111-4111-8111-111111111111' || userId === 'owner-1'
        ? { role: 'viewer', roles: ['viewer'] }
        : null
    );
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:members:update-role' ||
      permission === 'project:delegate:manage'
    );

    const response = await request(app)
      .patch('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members/11111111-1111-4111-8111-111111111111')
      .send({ roles: ['delegate'] });

    expect(response.status).toBe(200);
    expect(projectMemberService.updateRoles).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      ['delegate']
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:delegate:manage',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('transfers project ownership through scoped ownership-transfer permission without legacy owner role', async () => {
    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.hasRole as Mock).mockResolvedValue(false);
    (projectMemberService.getProjectOwners as Mock).mockResolvedValue(['current-owner-1']);
    (projectMemberService.getMembership as Mock).mockResolvedValue({ role: 'viewer', roles: ['viewer'] });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:ownership:transfer'
    );

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/transfer-ownership')
      .send({ newOwnerId: '11111111-1111-4111-8111-111111111111' });

    expect(response.status).toBe(200);
    expect(projectMemberService.transferOwnership).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      'current-owner-1',
      '11111111-1111-4111-8111-111111111111'
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:ownership:transfer',
      expect.objectContaining({
        userId: 'owner-1',
        resourceType: 'project',
        resourceId: '00000000-0000-0000-0000-000000000001',
      })
    );
  });

  it('creates an invitation for a non-existent project user', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };
    const memberRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User || entityName(entity) === 'User') return userRepo;
        if (entity === ProjectMember || entityName(entity) === 'ProjectMember') return memberRepo;
        if (entity === Project || entityName(entity) === 'Project') return { findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: authMocks.tenantId || 'tenant-default', name: 'Project One' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const { projectMemberService } = await import('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    (projectMemberService.getMembership as Mock).mockImplementation(async (_projectId: string, userId: string) =>
      userId === 'owner-1' ? { role: 'owner', roles: ['owner'] } : null
    );

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'nonexistent@example.com', roles: ['viewer'], deliveryMethod: 'email' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      invited: true,
      emailSent: false,
      inviteUrl: 'http://localhost:5173/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
    }));
    expect(invitationService.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      deliveryMethod: 'email',
    }));
  });
});
