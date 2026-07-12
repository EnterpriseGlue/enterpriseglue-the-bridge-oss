/**
 * Unified Authorization Middleware
 * Flexible authorization that can check platform, project, and engine roles
 * in a single middleware call.
 */

import { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';
import { projectMemberService } from '../../services/platform-admin/ProjectMemberService.js';
import { engineService } from '../../services/platform-admin/EngineService.js';
import { logAudit } from '../../services/audit.js';
import type { ProjectRole } from '@enterpriseglue/shared/contracts/roles.js';
import type { EngineRole } from '@enterpriseglue/shared/constants/roles.js';
import { permissionService, type Permission, type PermissionContext } from '../../services/platform-admin/permissions.js';

type PermissionFallback = Permission | Permission[];

export interface AuthorizeOptions {
  /**
   * Deprecated platform role metadata. Role values no longer grant access.
   * Use platformPermissions for authorization.
   */
  platformRoles?: string[];

  /**
   * Platform permissions that satisfy the platform check.
   */
  platformPermissions?: PermissionFallback;

  /**
   * Deprecated project role metadata. Role values no longer grant access.
   * Use projectPermissions for authorization.
   */
  projectRoles?: ProjectRole[];

  /**
   * Project permissions that satisfy the project check.
   */
  projectPermissions?: PermissionFallback;

  /**
   * Deprecated engine role metadata. Role values no longer grant access.
   * Use enginePermissions for authorization.
   */
  engineRoles?: EngineRole[];

  /**
   * Engine permissions that satisfy the engine check.
   */
  enginePermissions?: PermissionFallback;

  /**
   * Custom authorization check function
   * Return true to allow, false to deny
   */
  custom?: (req: Request) => Promise<boolean>;

  /**
   * If true, log all access denials to audit log
   * Default: true
   */
  auditDenials?: boolean;
}

function normalizePermissions(permissions?: PermissionFallback): Permission[] {
  if (!permissions) return [];
  return Array.isArray(permissions) ? permissions : [permissions];
}

async function hasAnyPermission(permissions: Permission[], context: PermissionContext): Promise<boolean> {
  for (const permission of permissions) {
    if (await permissionService.hasPermission(permission, context)) {
      return true;
    }
  }
  return false;
}

function permissionLabel(permissions: Permission[]): string {
  return permissions.length > 0 ? permissions.join('|') : 'none';
}

/**
 * Flexible authorization middleware
 * 
 * Usage:
 * ```typescript
 * // Require platform admin
 * app.get('/admin', authorize({ platformRoles: ['admin'] }), handler);
 * 
 * // Require project owner or delegate
 * app.post('/projects/:projectId/settings', 
 *   authorize({ projectRoles: ['owner', 'delegate'] }), handler);
 * 
 * // Require engine access
 * app.post('/engines/:engineId/deploy',
 *   authorize({ engineRoles: ['owner', 'delegate', 'deployer'] }), handler);
 * 
 * // Combined checks
 * app.post('/admin/engines/:engineId',
 *   authorize({ 
 *     platformRoles: ['admin'], 
 *     engineRoles: ['owner'] 
 *   }), handler);
 * ```
 */
export function authorize(options: AuthorizeOptions) {
  const { auditDenials = true } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw Errors.unauthorized('Authentication required');
    }

    const userId = req.user.userId;
    const failures: string[] = [];

    try {
      // Platform permission check
      const platformPermissions = normalizePermissions(options.platformPermissions);
      if ((options.platformRoles && options.platformRoles.length > 0) || platformPermissions.length > 0) {
        const userRole = (req.user as any).platformRole || (req.user as any).role || 'user';
        const permissionAllowed = platformPermissions.length > 0
          ? await hasAnyPermission(platformPermissions, {
            userId,
            tenantId: req.tenant?.tenantId || null,
            platformRole: userRole,
            resourceType: 'platform',
          })
          : false;
        if (!permissionAllowed) {
          const roleRequirement = options.platformRoles && options.platformRoles.length > 0
            ? options.platformRoles.join('|')
            : 'none';
          failures.push(`Platform access: role ${roleRequirement} no longer grants access; need permission ${permissionLabel(platformPermissions)}, have role ${userRole}`);
        }
      }

      // Project permission check
      const projectPermissions = normalizePermissions(options.projectPermissions);
      if ((options.projectRoles && options.projectRoles.length > 0) || projectPermissions.length > 0) {
        const projectId = req.params.projectId || req.body?.projectId;
        if (!projectId) {
          throw Errors.validation('projectId required for this operation');
        }

        const membership = await projectMemberService.getMembership(projectId, userId);
        const permissionAllowed = projectPermissions.length > 0
          ? await hasAnyPermission(projectPermissions, {
            userId,
            tenantId: req.tenant?.tenantId || null,
            platformRole: req.user?.platformRole || (req.user as any)?.role,
            projectRole: membership?.role,
            resourceType: 'project',
            resourceId: String(projectId),
          })
          : false;
        if (!permissionAllowed) {
          const roleRequirement = options.projectRoles && options.projectRoles.length > 0
            ? options.projectRoles.join('|')
            : 'none';
          failures.push(
            `Project access: role ${roleRequirement} no longer grants access; need permission ${permissionLabel(projectPermissions)}, have role ${membership?.role || 'none'}`
          );
        } else if (membership) {
          (req as any).projectRole = membership.role;
          (req as any).projectMembership = membership;
        }
      }

      // Engine permission check
      const enginePermissions = normalizePermissions(options.enginePermissions);
      if ((options.engineRoles && options.engineRoles.length > 0) || enginePermissions.length > 0) {
        const engineId = req.params.engineId || req.body?.engineId;
        if (!engineId) {
          throw Errors.validation('engineId required for this operation');
        }

        const role = await engineService.getEngineRole(userId, engineId, req.tenant?.tenantId || null);
        const permissionAllowed = enginePermissions.length > 0
          ? await hasAnyPermission(enginePermissions, {
            userId,
            tenantId: req.tenant?.tenantId || null,
            platformRole: req.user?.platformRole || (req.user as any)?.role,
            engineRole: role || undefined,
            resourceType: 'engine',
            resourceId: String(engineId),
          })
          : false;
        if (!permissionAllowed) {
          const roleRequirement = options.engineRoles && options.engineRoles.length > 0
            ? options.engineRoles.join('|')
            : 'none';
          failures.push(`Engine access: role ${roleRequirement} no longer grants access; need permission ${permissionLabel(enginePermissions)}, have role ${role || 'none'}`);
        } else {
          (req as any).engineRole = role;
        }
      }

      // Custom check
      if (options.custom) {
        const passed = await options.custom(req);
        if (!passed) {
          failures.push('Custom authorization check failed');
        }
      }

      // If any checks failed, deny access
      if (failures.length > 0) {
        // Log denial
        if (auditDenials) {
          const isTenantScopedRequest = String(req.originalUrl || '').startsWith('/api/t/');
          const tenantId = isTenantScopedRequest ? (req as any).tenant?.tenantId : null;

          await logAudit({
            tenantId,
            action: 'authz.access.denied',
            userId,
            resourceType: req.baseUrl || req.path,
            resourceId: (req.params.id || req.params.projectId || req.params.engineId) as string | undefined,
            details: { failures, path: req.path, method: req.method },
            ipAddress: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
            userAgent: req.headers['user-agent'],
          });
        }

        throw Errors.forbidden('Access denied');
      }

      // All checks passed
      next();
    } catch (error) {
      console.error('Authorization error:', error);
      throw Errors.internal('Authorization check failed');
    }
  };
}

/**
 * Shorthand for common authorization patterns
 */
export const auth = {
  /**
   * Require platform admin
   */
  platformAdmin: () => authorize({ platformPermissions: 'platform:authz:roles:manage' as Permission }),

  /**
   * Require project owner
   */
  projectOwner: () => authorize({ projectPermissions: 'project:ownership:transfer' as Permission }),

  /**
   * Require project owner or delegate
   */
  projectManager: () => authorize({ projectPermissions: 'project:settings:manage' as Permission }),

  /**
   * Require project member with any role
   */
  projectMember: () => authorize({ projectPermissions: 'project:files:view' as Permission }),

  /**
   * Require project member who can edit
   */
  projectEditor: () => authorize({ projectPermissions: 'project:files:edit' as Permission }),

  /**
   * Require engine owner
   */
  engineOwner: () => authorize({ enginePermissions: 'engine:ownership:transfer' as Permission }),

  /**
   * Require engine owner or delegate
   */
  engineManager: () => authorize({ enginePermissions: 'engine:edit' as Permission }),

  /**
   * Require engine access (any role)
   */
  engineAccess: () => authorize({ enginePermissions: 'engine:instance:view' as Permission }),

  /**
   * Require deploy permission on engine
   */
  engineDeployer: () => authorize({ enginePermissions: 'engine:deploy' as Permission }),
};
