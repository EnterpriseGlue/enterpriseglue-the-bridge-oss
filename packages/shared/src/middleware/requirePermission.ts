/**
 * Permission-based authorization middleware
 * 
 * Uses the platform permission system to check if a user has a specific permission.
 * Combines role-based permissions with explicit permission grants.
 */

import { Request, Response, NextFunction } from 'express';
import { Errors } from './errorHandler.js';
import { 
  permissionService, 
  Permission, 
  ResourceType,
  PermissionContext 
} from '../services/platform-admin/permissions.js';
import { projectMemberService, engineService } from '../services/platform-admin/index.js';

type ResourceExtractor = (req: Request) => { type: ResourceType; id: string } | null;

interface RequirePermissionOptions {
  /**
   * The permission to check
   */
  permission: Permission;
  
  /**
   * Function to extract resource type and ID from request.
   * If not provided, assumes platform-level permission (no resource scope).
   */
  extractResource?: ResourceExtractor;
  
  /**
   * If true, also fetch the user's role for this resource and include it in context.
   * Required for permissions that might be granted via role.
   */
  fetchRole?: boolean;
}

/**
 * Common resource extractors
 */
export const ResourceExtractors = {
  /**
   * Extract project ID from req.params.projectId or req.body.projectId
   */
  project: (req: Request): { type: ResourceType; id: string } | null => {
    const projectId = req.params.projectId || req.body?.projectId;
    if (!projectId) return null;
    return { type: 'project', id: String(projectId) };
  },
  
  /**
   * Extract engine ID from req.params.engineId or req.body.engineId
   */
  engine: (req: Request): { type: ResourceType; id: string } | null => {
    const engineId = req.params.engineId || req.body?.engineId;
    if (!engineId) return null;
    return { type: 'engine', id: String(engineId) };
  },
  
  /**
   * No resource scope (platform-level)
   */
  platform: (_req: Request): { type: ResourceType; id: string } | null => {
    return null;
  },
};

/**
 * Middleware factory that checks if the authenticated user has a specific permission.
 * 
 * @example
 * // Platform permission (no resource scope)
 * router.post('/engines', requireAuth, requirePermission({ 
 *   permission: PlatformPermissions.ENGINE_CREATE 
 * }), handler);
 * 
 * @example
 * // Project permission
 * router.delete('/projects/:projectId', requireAuth, requirePermission({
 *   permission: ProjectPermissions.PROJECT_DELETE,
 *   extractResource: ResourceExtractors.project,
 *   fetchRole: true,
 * }), handler);
 * 
 * @example
 * // Engine permission
 * router.post('/engines/:engineId/deployments', requireAuth, requirePermission({
 *   permission: EnginePermissions.DEPLOY,
 *   extractResource: ResourceExtractors.engine,
 *   fetchRole: true,
 * }), handler);
 */
export function requirePermission(options: RequirePermissionOptions) {
  const { permission, extractResource, fetchRole = false } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        throw Errors.unauthorized('Authentication required');
      }

      const userId = user.userId;
      const platformRole = user.platformRole || (user as any).role;

      // Build permission context
      const context: PermissionContext = {
        userId,
        platformRole,
      };

      // Extract resource if applicable
      const resource = extractResource ? extractResource(req) : null;
      if (resource) {
        context.resourceType = resource.type;
        context.resourceId = resource.id;

        // Fetch role if requested
        if (fetchRole) {
          if (resource.type === 'project') {
            const membership = await projectMemberService.getMembership(resource.id, userId);
            if (membership) {
              context.projectRole = membership.role;
            }
          } else if (resource.type === 'engine') {
            const role = await engineService.getEngineRole(userId, resource.id);
            if (role) {
              context.engineRole = role;
            }
          }
        }
      }

      // Check permission
      const hasPermission = await permissionService.hasPermission(permission, context);

      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'Access denied',
          message: `You do not have the required permission: ${permission}`,
        });
      }

      // Attach context to request for use in handlers
      (req as any).permissionContext = context;

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      throw Errors.internal('Authorization check failed');
    }
  };
}

/**
 * Check multiple permissions (user must have ALL)
 */
export function requireAllPermissions(
  permissions: Permission[],
  extractResource?: ResourceExtractor,
  fetchRole = false
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        throw Errors.unauthorized('Authentication required');
      }

      const userId = user.userId;
      const platformRole = user.platformRole || (user as any).role;

      const context: PermissionContext = {
        userId,
        platformRole,
      };

      const resource = extractResource ? extractResource(req) : null;
      if (resource) {
        context.resourceType = resource.type;
        context.resourceId = resource.id;

        if (fetchRole) {
          if (resource.type === 'project') {
            const membership = await projectMemberService.getMembership(resource.id, userId);
            if (membership) context.projectRole = membership.role;
          } else if (resource.type === 'engine') {
            const role = await engineService.getEngineRole(userId, resource.id);
            if (role) context.engineRole = role;
          }
        }
      }

      // Check all permissions
      for (const permission of permissions) {
        const has = await permissionService.hasPermission(permission, context);
        if (!has) {
          return res.status(403).json({
            error: 'Access denied',
            message: `You do not have the required permission: ${permission}`,
          });
        }
      }

      (req as any).permissionContext = context;
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      throw Errors.internal('Authorization check failed');
    }
  };
}

/**
 * Check multiple permissions (user must have ANY)
 */
export function requireAnyPermission(
  permissions: Permission[],
  extractResource?: ResourceExtractor,
  fetchRole = false
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        throw Errors.unauthorized('Authentication required');
      }

      const userId = user.userId;
      const platformRole = user.platformRole || (user as any).role;

      const context: PermissionContext = {
        userId,
        platformRole,
      };

      const resource = extractResource ? extractResource(req) : null;
      if (resource) {
        context.resourceType = resource.type;
        context.resourceId = resource.id;

        if (fetchRole) {
          if (resource.type === 'project') {
            const membership = await projectMemberService.getMembership(resource.id, userId);
            if (membership) context.projectRole = membership.role;
          } else if (resource.type === 'engine') {
            const role = await engineService.getEngineRole(userId, resource.id);
            if (role) context.engineRole = role;
          }
        }
      }

      // Check if user has any of the permissions
      for (const permission of permissions) {
        const has = await permissionService.hasPermission(permission, context);
        if (has) {
          (req as any).permissionContext = context;
          return next();
        }
      }

      return res.status(403).json({
        error: 'Access denied',
        message: `You do not have any of the required permissions: ${permissions.join(', ')}`,
      });
    } catch (error) {
      console.error('Permission check error:', error);
      throw Errors.internal('Authorization check failed');
    }
  };
}
