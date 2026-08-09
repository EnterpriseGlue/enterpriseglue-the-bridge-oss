import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import {
  permissionService,
  EnginePermissions,
  Permission,
  PlatformPermissions,
  ProjectPermissions,
  SYSTEM_ROLE_IDS,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { AUTHZ_RESOURCE_TYPES } from '@enterpriseglue/shared/authz/permission-actions.js';
import {
  CustomPermissionCreateSchema,
  CustomRoleCreateSchema,
  CustomRoleUpdateSchema,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';

const authzResourceTypeSchema = z.enum(AUTHZ_RESOURCE_TYPES);
const roleIdParamSchema = z.object({ id: z.string().min(1) });
const rolesQuerySchema = z.object({
  scope: authzResourceTypeSchema.optional(),
  kind: z.enum(['system', 'custom']).optional(),
  assignable: z.enum(['true', 'false']).optional(),
  resourceType: z.enum(['project', 'engine']).optional(),
  resourceId: z.string().optional(),
});

type ScopedAssignmentResource = {
  resourceType: 'project' | 'engine';
  resourceId: string;
};

type ScopedAssignableRoleLike = {
  id: string;
  key?: string | null;
  scope: string | null;
  kind: string;
  isAssignable: boolean;
  isArchived?: boolean;
};

const roleReadPermissions = [
  PlatformPermissions.AUTHZ_ROLES_VIEW,
  PlatformPermissions.AUTHZ_ROLES_MANAGE,
] as Permission[];

const scopedManagerAssignableSystemRoleIds: Record<ScopedAssignmentResource['resourceType'], Set<string>> = {
  project: new Set([
    SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
    SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
    SYSTEM_ROLE_IDS.PROJECT_EDITOR,
    SYSTEM_ROLE_IDS.PROJECT_VIEWER,
  ]),
  engine: new Set([
    SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
    SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
  ]),
};

function toScopedAssignmentResource(resourceType?: unknown, resourceId?: unknown): ScopedAssignmentResource | null {
  if ((resourceType !== 'project' && resourceType !== 'engine') || typeof resourceId !== 'string' || !resourceId.trim()) {
    return null;
  }
  return { resourceType, resourceId: resourceId.trim() };
}

function isScopedManagerAssignableRole(role: ScopedAssignableRoleLike, resource: ScopedAssignmentResource): boolean {
  if (role.scope !== resource.resourceType || !role.isAssignable || role.isArchived) return false;
  if (role.kind === 'custom') return true;
  if (role.kind !== 'system') return false;
  const allowed = scopedManagerAssignableSystemRoleIds[resource.resourceType];
  return allowed.has(role.id) || Boolean(role.key && allowed.has(role.key));
}

async function hasAnyPlatformPermission(req: Request, permissions: Permission[]): Promise<boolean> {
  for (const permission of permissions) {
    if (await permissionService.hasPermission(permission, {
      userId: req.user!.userId,
      tenantId: req.tenant?.tenantId || null,
      resourceType: 'platform',
    })) {
      return true;
    }
  }
  return false;
}

async function canManageScopedAssignments(req: Request, resource: ScopedAssignmentResource): Promise<boolean> {
  const permission = resource.resourceType === 'project'
    ? ProjectPermissions.MEMBERS_MANAGE
    : EnginePermissions.MEMBERS_MANAGE;
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  });
}

export interface RoleRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

export function registerRoleRoutes(router: Router, { requirePlatformAction }: RoleRouteDependencies): void {
  router.get('/api/authz/permissions', apiLimiter, requireAuth, requirePlatformAction('platform.authz.permissions.read'), asyncHandler(async (_req: Request, res: Response) => {
    res.json(await permissionService.getPermissionCatalog());
  }));

  router.post('/api/authz/permissions', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateBody(CustomPermissionCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await permissionService.createCustomPermission({
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        createdById: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create custom permission error:', error);
      throw Errors.badRequest(error.message || 'Failed to create custom permission');
    }
  }));

  router.get('/api/authz/roles', apiLimiter, requireAuth, validateQuery(rolesQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const resource = toScopedAssignmentResource(req.query.resourceType, req.query.resourceId);
      const canListPlatformRoles = await hasAnyPlatformPermission(req, roleReadPermissions);
      if (!canListPlatformRoles) {
        if (!resource || !await canManageScopedAssignments(req, resource)) throw Errors.adminRequired();
        if (req.query.scope !== resource.resourceType || req.query.assignable !== 'true') {
          throw Errors.forbidden('Resource managers can list only assignable roles for their managed resource scope');
        }
      }

      let roles = (await permissionService.getRoles(req.tenant?.tenantId || null)).filter((role) => {
        if (req.query.scope && role.scope !== req.query.scope) return false;
        if (req.query.kind && role.kind !== req.query.kind) return false;
        if (req.query.assignable === 'true' && (!role.isAssignable || role.isArchived)) return false;
        if (req.query.assignable === 'false' && role.isAssignable) return false;
        return true;
      });
      if (!canListPlatformRoles && resource) roles = roles.filter((role) => isScopedManagerAssignableRole(role, resource));
      res.json(roles);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Get roles error:', error);
      throw Errors.internal('Failed to get roles');
    }
  }));

  router.get('/api/authz/roles/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.read'), validateParams(roleIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const role = await permissionService.getRole(String(req.params.id), req.tenant?.tenantId || null);
      if (!role) throw Errors.notFound('Role');
      res.json(role);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Get role error:', error);
      throw Errors.internal('Failed to get role');
    }
  }));

  router.post('/api/authz/roles', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateBody(CustomRoleCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await permissionService.createCustomRole({
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        createdById: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create custom role error:', error);
      throw Errors.badRequest(error.message || 'Failed to create custom role');
    }
  }));

  router.put('/api/authz/roles/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateParams(roleIdParamSchema), validateBody(CustomRoleUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await permissionService.updateCustomRole(String(req.params.id), {
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        updatedById: req.user!.userId,
      });
      res.json({ success: true });
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Update custom role error:', error);
      throw Errors.badRequest(error.message || 'Failed to update custom role');
    }
  }));

  router.delete('/api/authz/roles/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.roles.manage'), validateParams(roleIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await permissionService.archiveCustomRole(String(req.params.id), req.user!.userId);
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Archive custom role error:', error);
      throw Errors.badRequest(error.message || 'Failed to archive custom role');
    }
  }));
}
