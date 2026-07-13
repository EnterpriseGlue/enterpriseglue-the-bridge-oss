/**
 * Platform Authorization Middleware
 * Handles platform-level compatibility checks for legacy middleware exports.
 *
 * New product routes should prefer requireAction(...) with route-specific
 * action ids. These helpers remain for source compatibility with legacy callers
 * and EE plugin integration points, but authorization is permission-backed.
 */

import { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';
import { requireAuth } from './auth.js';
import {
  permissionService,
  PlatformPermissions,
  type Permission,
} from '../../services/platform-admin/permissions.js';

const PLATFORM_ADMIN_COMPAT_PERMISSIONS: Permission[] = [
  PlatformPermissions.SETTINGS_MANAGE,
  PlatformPermissions.USERS_PERMANENT_DELETE,
  PlatformPermissions.AUTHZ_ROLES_MANAGE,
];

const PLATFORM_ROLE_COMPAT_PERMISSIONS: Record<string, Permission[]> = {
  admin: PLATFORM_ADMIN_COMPAT_PERMISSIONS,
  developer: [PlatformPermissions.PROJECT_CREATE],
  user: [PlatformPermissions.DASHBOARD_VIEW],
};

async function hasAllPlatformPermissions(req: Request, permissions: Permission[]): Promise<boolean> {
  if (!req.user) return false;

  for (const permission of permissions) {
    const allowed = await permissionService.hasPermission(permission, {
      userId: req.user.userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType: 'platform',
    });
    if (!allowed) {
      return false;
    }
  }

  return true;
}

async function hasAnyPlatformRoleCompatibility(req: Request, allowedRoles: string[]): Promise<boolean> {
  for (const role of allowedRoles) {
    const permissions = PLATFORM_ROLE_COMPAT_PERMISSIONS[role];
    if (permissions && await hasAllPlatformPermissions(req, permissions)) {
      return true;
    }
  }

  return false;
}

/**
 * Require platform admin-equivalent permissions.
 *
 * @deprecated Prefer requireAction with a route-specific action id.
 */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const enforceAdmin = async () => {
    if (!req.user) {
      throw Errors.unauthorized('Authentication required');
    }

    if (!await hasAllPlatformPermissions(req, PLATFORM_ADMIN_COMPAT_PERMISSIONS)) {
      throw Errors.adminRequired();
    }

    next();
  };

  // If user is not yet authenticated, run requireAuth first.
  // This makes requirePlatformAdmin safe to use even when routes
  // forget to add requireAuth explicitly.
  if (!req.user) {
    return requireAuth(req, res, () => {
      void enforceAdmin().catch(next);
    });
  }

  void enforceAdmin().catch(next);
}

/**
 * Require permissions matching specific legacy platform role labels.
 * Usage: requirePlatformRole('admin', 'user')
 *
 * @deprecated Prefer requireAction with a route-specific action id.
 */
export function requirePlatformRole(...allowedRoles: string[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw Errors.unauthorized('Authentication required');
      }

      if (!await hasAnyPlatformRoleCompatibility(req, allowedRoles)) {
        throw Errors.forbidden('Insufficient platform permissions');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Check if user has platform admin-equivalent permissions.
 * Sets req.isPlatformAdmin for use in legacy route handlers.
 *
 * @deprecated Prefer requireAction or permissionService for route authorization.
 */
export async function checkPlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    (req as any).isPlatformAdmin = req.user
      ? await hasAllPlatformPermissions(req, PLATFORM_ADMIN_COMPAT_PERMISSIONS)
      : false;
    next();
  } catch (error) {
    (req as any).isPlatformAdmin = false;
    next(error);
  }
}

/**
 * Check whether checkPlatformAdmin has marked the request as platform admin.
 *
 * @deprecated Prefer permissionService for route authorization.
 */
export function isPlatformAdmin(req: Request): boolean {
  return (req as any).isPlatformAdmin === true;
}
