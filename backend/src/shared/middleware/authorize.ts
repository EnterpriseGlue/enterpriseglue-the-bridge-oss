/**
 * Unified Authorization Middleware
 * Flexible authorization that can check platform, project, and engine roles
 * in a single middleware call.
 */

import { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';
import { projectMemberService } from '../services/platform-admin/ProjectMemberService.js';
import { engineService } from '../services/platform-admin/EngineService.js';
import { logAudit } from '../services/audit.js';
import type { ProjectRole } from '@enterpriseglue/contracts/roles';
import type { EngineRole } from '@shared/constants/roles.js';

export interface AuthorizeOptions {
  /**
   * Platform level roles to check
   * e.g., ['admin'] or ['admin', 'developer']
   */
  platformRoles?: string[];

  /**
   * Project level roles to check
   * Requires projectId in params or body
   * e.g., ['owner', 'delegate'] or ['owner', 'delegate', 'developer']
   */
  projectRoles?: ProjectRole[];

  /**
   * Engine level roles to check
   * Requires engineId in params or body
   * e.g., ['owner', 'delegate'] or ['operator', 'deployer']
   */
  engineRoles?: EngineRole[];

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
      // Platform role check
      if (options.platformRoles && options.platformRoles.length > 0) {
        const userRole = (req.user as any).platformRole || 'user';
        if (!options.platformRoles.includes(userRole)) {
          failures.push(`Platform role: need ${options.platformRoles.join('|')}, have ${userRole}`);
        }
      }

      // Project role check
      if (options.projectRoles && options.projectRoles.length > 0) {
        const projectId = req.params.projectId || req.body?.projectId;
        if (!projectId) {
          throw Errors.validation('projectId required for this operation');
        }

        const membership = await projectMemberService.getMembership(projectId, userId);
        if (!membership || !options.projectRoles.includes(membership.role as ProjectRole)) {
          failures.push(
            `Project role: need ${options.projectRoles.join('|')}, have ${membership?.role || 'none'}`
          );
        } else {
          (req as any).projectRole = membership.role;
          (req as any).projectMembership = membership;
        }
      }

      // Engine role check
      if (options.engineRoles && options.engineRoles.length > 0) {
        const engineId = req.params.engineId || req.body?.engineId;
        if (!engineId) {
          throw Errors.validation('engineId required for this operation');
        }

        const role = await engineService.getEngineRole(userId, engineId);
        if (!role || !options.engineRoles.includes(role)) {
          failures.push(`Engine role: need ${options.engineRoles.join('|')}, have ${role || 'none'}`);
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
          const tenantId = req.user?.platformRole === 'admin' && !isTenantScopedRequest
            ? null
            : (req as any).tenant?.tenantId;

          await logAudit({
            tenantId,
            action: 'authz.access.denied',
            userId,
            resourceType: req.baseUrl || req.path,
            resourceId: req.params.id || req.params.projectId || req.params.engineId,
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
  platformAdmin: () => authorize({ platformRoles: ['admin'] }),

  /**
   * Require platform admin or developer
   */
  platformDeveloper: () => authorize({ platformRoles: ['admin', 'developer'] }),

  /**
   * Require project owner
   */
  projectOwner: () => authorize({ projectRoles: ['owner'] }),

  /**
   * Require project owner or delegate
   */
  projectManager: () => authorize({ projectRoles: ['owner', 'delegate'] }),

  /**
   * Require project member with any role
   */
  projectMember: () => authorize({ projectRoles: ['owner', 'delegate', 'developer', 'editor', 'viewer'] }),

  /**
   * Require project member who can edit
   */
  projectEditor: () => authorize({ projectRoles: ['owner', 'delegate', 'developer', 'editor'] }),

  /**
   * Require engine owner
   */
  engineOwner: () => authorize({ engineRoles: ['owner'] }),

  /**
   * Require engine owner or delegate
   */
  engineManager: () => authorize({ engineRoles: ['owner', 'delegate'] }),

  /**
   * Require engine access (any role)
   */
  engineAccess: () => authorize({ engineRoles: ['owner', 'delegate', 'operator'] }),

  /**
   * Require deploy permission on engine
   */
  engineDeployer: () => authorize({ engineRoles: ['owner', 'delegate', 'operator', 'deployer'] }),
};
