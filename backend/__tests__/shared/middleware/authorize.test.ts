import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authorize } from '@enterpriseglue/shared/middleware/authorize.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { EnginePermissions, permissionService, PlatformPermissions, ProjectPermissions } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    getMembership: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EngineService.js', () => ({
  engineService: {
    getEngineRole: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  permissionService: {
    hasPermission: vi.fn(),
  },
  EnginePermissions: {
    DEPLOY_VIEW: 'engine:deploy:view',
  },
  PlatformPermissions: {
    AUTHZ_ROLES_VIEW: 'platform:authz:roles:view',
  },
  ProjectPermissions: {
    PROJECT_SETTINGS: 'project:settings:manage',
  },
}));

describe('authorize middleware', () => {
  let req: any;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      user: { userId: 'user-1', platformRole: 'user' },
      params: {},
      body: {},
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      path: '/api/test',
      method: 'GET',
    };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
    (permissionService.hasPermission as any).mockResolvedValue(false);
  });

  it('denies role-only platform checks', async () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    const middleware = authorize({ platformRoles: ['admin'] });

    await expect(middleware(req as Request, res as Response, next)).rejects.toEqual(
      Errors.internal('Authorization check failed')
    );

    expect(next).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalled();
  });

  it('denies when missing user', async () => {
    req.user = undefined;
    const middleware = authorize({ platformRoles: ['admin'] });

    await expect(middleware(req as Request, res as Response, next)).rejects.toEqual(
      Errors.unauthorized('Authentication required')
    );
  });

  it('adds project membership info on permission success', async () => {
    (projectMemberService.getMembership as any).mockResolvedValue({
      role: 'owner',
      projectId: 'project-1',
    });
    (permissionService.hasPermission as any).mockResolvedValue(true);
    req.params = { projectId: 'project-1' } as any;

    const middleware = authorize({
      projectRoles: ['owner', 'delegate'],
      projectPermissions: ProjectPermissions.PROJECT_SETTINGS,
    });
    await middleware(req as Request, res as Response, next);

    expect((req as any).projectRole).toBe('owner');
    expect(next).toHaveBeenCalled();
  });

  it('logs denial when roles do not match', async () => {
    (engineService.getEngineRole as any).mockResolvedValue('operator');
    req.params = { engineId: 'engine-1' } as any;

    const middleware = authorize({ engineRoles: ['owner'], auditDenials: true });

    await expect(middleware(req as Request, res as Response, next)).rejects.toEqual(
      Errors.internal('Authorization check failed')
    );

    expect(logAudit).toHaveBeenCalled();
  });

  it('runs custom checks', async () => {
    const middleware = authorize({
      custom: async () => true,
    });

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('allows platform permissions for platform checks', async () => {
    (permissionService.hasPermission as any).mockResolvedValue(true);
    const middleware = authorize({
      platformRoles: ['admin'],
      platformPermissions: PlatformPermissions.AUTHZ_ROLES_VIEW,
    });

    await middleware(req as Request, res as Response, next);

    expect(permissionService.hasPermission).toHaveBeenCalledWith(PlatformPermissions.AUTHZ_ROLES_VIEW, {
      userId: 'user-1',
      tenantId: null,
      platformRole: 'user',
      resourceType: 'platform',
    });
    expect(next).toHaveBeenCalled();
  });

  it('ignores legacy platform role when required permission is missing', async () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    const middleware = authorize({
      platformRoles: ['admin'],
      platformPermissions: PlatformPermissions.AUTHZ_ROLES_VIEW,
    });

    await expect(middleware(req as Request, res as Response, next)).rejects.toEqual(
      Errors.internal('Authorization check failed')
    );

    expect(permissionService.hasPermission).toHaveBeenCalledWith(PlatformPermissions.AUTHZ_ROLES_VIEW, {
      userId: 'user-1',
      tenantId: null,
      platformRole: 'admin',
      resourceType: 'platform',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows project permissions for project checks', async () => {
    (projectMemberService.getMembership as any).mockResolvedValue(null);
    (permissionService.hasPermission as any).mockResolvedValue(true);
    req.params = { projectId: 'project-1' } as any;

    const middleware = authorize({
      projectRoles: ['owner'],
      projectPermissions: ProjectPermissions.PROJECT_SETTINGS,
    });
    await middleware(req as Request, res as Response, next);

    expect(permissionService.hasPermission).toHaveBeenCalledWith(ProjectPermissions.PROJECT_SETTINGS, {
      userId: 'user-1',
      tenantId: null,
      platformRole: 'user',
      projectRole: undefined,
      resourceType: 'project',
      resourceId: 'project-1',
    });
    expect(next).toHaveBeenCalled();
  });

  it('allows engine permissions for engine checks', async () => {
    (engineService.getEngineRole as any).mockResolvedValue(null);
    (permissionService.hasPermission as any).mockResolvedValue(true);
    req.params = { engineId: 'engine-1' } as any;

    const middleware = authorize({
      engineRoles: ['owner'],
      enginePermissions: EnginePermissions.DEPLOY_VIEW,
    });
    await middleware(req as Request, res as Response, next);

    expect(permissionService.hasPermission).toHaveBeenCalledWith(EnginePermissions.DEPLOY_VIEW, {
      userId: 'user-1',
      tenantId: null,
      platformRole: 'user',
      engineRole: undefined,
      resourceType: 'engine',
      resourceId: 'engine-1',
    });
    expect(next).toHaveBeenCalled();
  });
});
