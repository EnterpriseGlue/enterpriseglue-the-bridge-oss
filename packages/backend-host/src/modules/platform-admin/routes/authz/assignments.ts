import type { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { apiLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '@enterpriseglue/shared/middleware/validate.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import {
  authzGroupService,
  permissionService,
  EnginePermissions,
  Permission,
  PlatformPermissions,
  ProjectPermissions,
  SYSTEM_ROLE_IDS,
} from '@enterpriseglue/shared/services/platform-admin/index.js';
import { AUTHZ_PRINCIPAL_TYPES, AUTHZ_RESOURCE_TYPES } from '@enterpriseglue/shared/authz/permission-actions.js';

const authzResourceTypeSchema = z.enum(AUTHZ_RESOURCE_TYPES);
const authzPrincipalTypeSchema = z.enum(AUTHZ_PRINCIPAL_TYPES);
const idParamSchema = z.object({ id: z.string().uuid() });
const resourceIdParamSchema = z.object({ id: z.string().min(1) });
const roleAssignmentQuerySchema = z.object({
  principalType: authzPrincipalTypeSchema.optional(),
  principalId: z.string().min(1).optional(),
  resourceType: authzResourceTypeSchema.optional(),
  resourceId: z.string().optional(),
  scopeType: authzResourceTypeSchema.optional(),
  scopeId: z.string().optional(),
});
const roleAssignmentCreateSchema = z.object({
  principalType: authzPrincipalTypeSchema,
  principalId: z.string().min(1),
  roleId: z.string().min(1),
  resourceType: authzResourceTypeSchema.optional(),
  resourceId: z.string().nullable().optional(),
  scopeType: authzResourceTypeSchema.optional(),
  scopeId: z.string().nullable().optional(),
  expiresAt: z.number().nullable().optional(),
});
const authzGroupCreateSchema = z.object({
  key: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullable().optional(),
});
const authzGroupUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  isArchived: z.boolean().optional(),
});
const authzGroupMembershipQuerySchema = z.object({
  groupId: z.string().min(1).optional(),
  userId: z.string().uuid().optional(),
});
const authzGroupMembershipCreateSchema = z.object({
  groupId: z.string().min(1),
  userId: z.string().uuid(),
  expiresAt: z.number().nullable().optional(),
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
  engine: new Set([SYSTEM_ROLE_IDS.ENGINE_OPERATOR, SYSTEM_ROLE_IDS.ENGINE_DEPLOYER]),
};

function toScopedAssignmentResource(resourceType?: unknown, resourceId?: unknown): ScopedAssignmentResource | null {
  if ((resourceType !== 'project' && resourceType !== 'engine') || typeof resourceId !== 'string' || !resourceId.trim()) return null;
  return { resourceType, resourceId: resourceId.trim() };
}

function isScopedManagerAssignableRole(role: ScopedAssignableRoleLike, resource: ScopedAssignmentResource): boolean {
  if (role.scope !== resource.resourceType || !role.isAssignable || role.isArchived) return false;
  if (role.kind === 'custom') return true;
  if (role.kind !== 'system') return false;
  const allowed = scopedManagerAssignableSystemRoleIds[resource.resourceType];
  return allowed.has(role.id) || Boolean(role.key && allowed.has(role.key));
}

async function hasPlatformPermission(req: Request, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: 'platform',
  });
}

async function hasAnyPlatformPermission(req: Request, permissions: Permission[]): Promise<boolean> {
  for (const permission of permissions) {
    if (await hasPlatformPermission(req, permission)) return true;
  }
  return false;
}

function scopedAssignmentPermission(resourceType: ScopedAssignmentResource['resourceType']): Permission {
  return resourceType === 'project' ? ProjectPermissions.MEMBERS_MANAGE : EnginePermissions.MEMBERS_MANAGE;
}

function scopedAssignmentViewPermission(resourceType: ScopedAssignmentResource['resourceType']): Permission {
  return resourceType === 'project' ? ProjectPermissions.MEMBERS_VIEW : EnginePermissions.MEMBERS_VIEW;
}

async function hasScopedAssignmentPermission(req: Request, resource: ScopedAssignmentResource, permission: Permission): Promise<boolean> {
  return permissionService.hasPermission(permission, {
    userId: req.user!.userId,
    tenantId: req.tenant?.tenantId || null,
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
  });
}

async function canViewScopedAssignments(req: Request, resource: ScopedAssignmentResource): Promise<boolean> {
  return await hasScopedAssignmentPermission(req, resource, scopedAssignmentViewPermission(resource.resourceType)) ||
    await hasScopedAssignmentPermission(req, resource, scopedAssignmentPermission(resource.resourceType));
}

async function canManageScopedAssignments(req: Request, resource: ScopedAssignmentResource): Promise<boolean> {
  return hasScopedAssignmentPermission(req, resource, scopedAssignmentPermission(resource.resourceType));
}

async function assertCanViewRoleAssignments(req: Request, resource: ScopedAssignmentResource | null): Promise<void> {
  if (await hasAnyPlatformPermission(req, roleReadPermissions)) return;
  if (!resource || !await canViewScopedAssignments(req, resource)) throw Errors.adminRequired();
}

async function assertCanAssignScopedRole(req: Request, input: z.infer<typeof roleAssignmentCreateSchema>): Promise<void> {
  if (await hasPlatformPermission(req, PlatformPermissions.AUTHZ_ROLES_MANAGE)) return;
  const resource = toScopedAssignmentResource(input.resourceType, input.resourceId);
  if (!resource || !await canManageScopedAssignments(req, resource)) throw Errors.adminRequired();

  const role = await permissionService.getRole(input.roleId, req.tenant?.tenantId || null);
  if (!role) throw Errors.notFound('Role');
  if (!isScopedManagerAssignableRole(role, resource)) {
    throw Errors.forbidden('Resource managers can assign only delegated system roles or active custom roles for the same resource scope');
  }
}

async function assertCanRemoveScopedAssignment(req: Request, id: string): Promise<void> {
  if (await hasPlatformPermission(req, PlatformPermissions.AUTHZ_ROLES_MANAGE)) return;
  const assignment = await (await getDataSource()).getRepository(RbacRoleAssignment).findOne({ where: { id } });
  if (!assignment) throw Errors.notFound('Role assignment');

  const resource = toScopedAssignmentResource(assignment.resourceType, assignment.resourceId);
  if (!resource || !await canManageScopedAssignments(req, resource)) throw Errors.adminRequired();
  const role = await permissionService.getRole(assignment.roleId, req.tenant?.tenantId || null);
  if (!role || !isScopedManagerAssignableRole(role, resource) || assignment.source !== 'manual') {
    throw Errors.forbidden('Resource managers can remove only manual delegated system or custom role assignments for the same resource scope');
  }
}

export interface AssignmentRouteDependencies {
  requirePlatformAction: (actionId: string) => RequestHandler;
}

export function registerAssignmentRoutes(router: Router, { requirePlatformAction }: AssignmentRouteDependencies): void {
  router.get('/api/authz/role-assignments', apiLimiter, requireAuth, validateQuery(roleAssignmentQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const resource = toScopedAssignmentResource(req.query.resourceType, req.query.resourceId);
      await assertCanViewRoleAssignments(req, resource);
      const assignments = await permissionService.listRoleAssignments({
        tenantId: req.tenant?.tenantId || null,
        principalType: typeof req.query.principalType === 'string' ? req.query.principalType as any : undefined,
        principalId: typeof req.query.principalId === 'string' ? req.query.principalId : undefined,
        resourceType: typeof req.query.resourceType === 'string' ? req.query.resourceType as any : undefined,
        resourceId: typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined,
        scopeType: typeof req.query.scopeType === 'string' ? req.query.scopeType as any : undefined,
        scopeId: typeof req.query.scopeId === 'string' ? req.query.scopeId : undefined,
      });
      res.json(assignments);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List role assignments error:', error);
      throw Errors.internal('Failed to list role assignments');
    }
  }));

  router.post('/api/authz/role-assignments', apiLimiter, requireAuth, validateBody(roleAssignmentCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await assertCanAssignScopedRole(req, req.body);
      const result = await permissionService.assignRole({
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        createdById: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Assign role error:', error);
      throw Errors.badRequest(error.message || 'Failed to assign role');
    }
  }));

  router.delete('/api/authz/role-assignments/:id', apiLimiter, requireAuth, validateParams(idParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await assertCanRemoveScopedAssignment(req, String(req.params.id));
      await permissionService.removeRoleAssignment(String(req.params.id), req.user!.userId);
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Remove role assignment error:', error);
      throw Errors.badRequest(error.message || 'Failed to remove role assignment');
    }
  }));

  router.get('/api/authz/groups', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.read'), asyncHandler(async (req: Request, res: Response) => {
    try {
      const groups = await authzGroupService.listGroups({
        tenantId: req.tenant?.tenantId || null,
        includeArchived: req.query.includeArchived === 'true',
      });
      res.json(groups);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List authz groups error:', error);
      throw Errors.internal('Failed to list authorization groups');
    }
  }));

  router.post('/api/authz/groups', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateBody(authzGroupCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await authzGroupService.createGroup({
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        source: 'manual',
        createdById: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create authz group error:', error);
      throw Errors.badRequest(error.message || 'Failed to create authorization group');
    }
  }));

  router.put('/api/authz/groups/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateParams(resourceIdParamSchema), validateBody(authzGroupUpdateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await authzGroupService.updateGroup(String(req.params.id), {
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        updatedById: req.user!.userId,
      });
      res.json({ success: true });
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Update authz group error:', error);
      throw Errors.badRequest(error.message || 'Failed to update authorization group');
    }
  }));

  router.delete('/api/authz/groups/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await authzGroupService.updateGroup(String(req.params.id), {
        tenantId: req.tenant?.tenantId || null,
        isArchived: true,
        updatedById: req.user!.userId,
      });
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Archive authz group error:', error);
      throw Errors.badRequest(error.message || 'Failed to archive authorization group');
    }
  }));

  router.get('/api/authz/group-memberships', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.read'), validateQuery(authzGroupMembershipQuerySchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const memberships = await authzGroupService.listMemberships({
        tenantId: req.tenant?.tenantId || null,
        groupId: typeof req.query.groupId === 'string' ? req.query.groupId : undefined,
        userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
      });
      res.json(memberships);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('List authz group memberships error:', error);
      throw Errors.internal('Failed to list authorization group memberships');
    }
  }));

  router.post('/api/authz/group-memberships', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateBody(authzGroupMembershipCreateSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await authzGroupService.addMembership({
        ...req.body,
        tenantId: req.tenant?.tenantId || null,
        source: 'manual',
        createdById: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Create authz group membership error:', error);
      throw Errors.badRequest(error.message || 'Failed to create authorization group membership');
    }
  }));

  router.delete('/api/authz/group-memberships/:id', apiLimiter, requireAuth, requirePlatformAction('platform.authz.groups.manage'), validateParams(resourceIdParamSchema), asyncHandler(async (req: Request, res: Response) => {
    try {
      await authzGroupService.removeMembership(String(req.params.id), req.user!.userId);
      res.status(204).send();
    } catch (error: any) {
      if (error.statusCode) throw error;
      logger.error('Delete authz group membership error:', error);
      throw Errors.badRequest(error.message || 'Failed to remove authorization group membership');
    }
  }));
}
