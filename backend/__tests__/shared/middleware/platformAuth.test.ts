import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  requirePlatformAdmin,
  requirePlatformRole,
  checkPlatformAdmin,
  isPlatformAdmin,
} from '@enterpriseglue/shared/middleware/platformAuth.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    AUTHZ_ROLES_MANAGE: 'platform:authz:roles:manage',
    DASHBOARD_VIEW: 'platform:dashboard:view',
    PROJECT_CREATE: 'project:create',
    SETTINGS_MANAGE: 'platform:settings:manage',
    USERS_PERMANENT_DELETE: 'platform:users:permanent-delete',
  },
  permissionService: {
    hasPermission: vi.fn(),
  },
}));

describe('platformAuth middleware', () => {
  let req: any;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
    (permissionService.hasPermission as any).mockResolvedValue(true);
  });

  async function waitForNext() {
    for (let i = 0; i < 10; i += 1) {
      if ((next as any).mock.calls.length > 0) return;
      await Promise.resolve();
    }
  }

  it('enforces platform admin-equivalent permissions', async () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    requirePlatformAdmin(req as Request, res as Response, next);
    await waitForNext();
    expect(next).toHaveBeenCalled();
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:settings:manage', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:users:permanent-delete', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:authz:roles:manage', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
  });

  it('runs requireAuth when user missing', async () => {
    req.user = undefined;
    requirePlatformAdmin(req as Request, res as Response, next);
    await waitForNext();
    expect(next).toHaveBeenCalled();
  });

  it('rejects users missing platform admin-equivalent permissions', async () => {
    (permissionService.hasPermission as any).mockResolvedValue(false);
    req.user = { userId: 'user-1', platformRole: 'user' };
    requirePlatformAdmin(req as Request, res as Response, next);
    await waitForNext();
    expect(next).toHaveBeenCalledWith(Errors.adminRequired());
  });

  it('allows specific platform role compatibility through permissions', async () => {
    (permissionService.hasPermission as any).mockImplementation(async (permission: string) => (
      permission === 'platform:dashboard:view'
    ));
    req.user = { userId: 'user-1', platformRole: 'user' };
    const middleware = requirePlatformRole('admin', 'user');
    await middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('sets isPlatformAdmin flag from permissions', async () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    await checkPlatformAdmin(req as Request, res as Response, next);
    expect((req as any).isPlatformAdmin).toBe(true);
  });

  it('detects platform admin via helper after checkPlatformAdmin has run', async () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    await checkPlatformAdmin(req as Request, res as Response, next);
    expect(isPlatformAdmin(req as Request)).toBe(true);
  });
});
