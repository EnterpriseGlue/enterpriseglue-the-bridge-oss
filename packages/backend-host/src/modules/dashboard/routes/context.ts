import { Router, Request, Response } from 'express';
import { requireAuth } from '@enterpriseglue/shared/middleware/auth.js';
import { requireAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { dashboardLimiter } from '@enterpriseglue/shared/middleware/rateLimiter.js';
import { asyncHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { In } from 'typeorm';
import {
  EnginePermissions,
  PlatformPermissions,
  ProjectPermissions,
  permissionService,
  type CurrentUserPermissionsSnapshot,
  type Permission,
} from '@enterpriseglue/shared/services/platform-admin/index.js';

const r = Router();

export type DashboardContext = {
  isPlatformAdmin: boolean;
  // Engine access
  ownedEngineIds: string[]; // Deprecated display metadata; authorization never reads it.
  delegatedEngineIds: string[]; // Deprecated display metadata; authorization never reads it.
  accessibleEngineIds: string[]; // Engines visible through the evaluator.
  runtimeScopedEngineIds: string[]; // Resource-aware engines visible through process or decision scope
  // Project access
  projectMemberships: Array<{
    projectId: string;
    projectName: string;
    role: string;
  }>;
  // Computed visibility flags
  canViewActiveUsers: boolean;
  canViewAllProjects: boolean;
  canViewEngines: boolean;
  canViewProcessData: boolean;
  canViewDeployments: boolean;
  canViewMetrics: boolean;
};

function hasPlatformPermission(permissions: Permission[], permission: Permission): boolean {
  return permissions.includes(permission);
}

function hasAnyEnginePermission(
  snapshot: CurrentUserPermissionsSnapshot,
  permissions: Permission[]
): boolean {
  return snapshot.engines.some((engine) =>
    permissions.some((permission) => engine.permissions.includes(permission))
  );
}

function hasAnyProjectPermission(
  snapshot: CurrentUserPermissionsSnapshot,
  permissions: Permission[]
): boolean {
  return snapshot.projects.some((project) =>
    permissions.some((permission) => project.permissions.includes(permission))
  );
}

/**
 * GET /api/dashboard/context
 * Returns the user's dashboard context for role-based visibility
 */
r.get('/api/dashboard/context', requireAuth, requireAction('platform.dashboard.read'), dashboardLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const dataSource = await getDataSource();
  const projectMemberRepo = dataSource.getRepository(ProjectMember);
  const projectRepo = dataSource.getRepository(Project);
  const tenantId = req.tenant?.tenantId;

  const permissionSnapshot = await permissionService.getCurrentUserPermissions(userId, tenantId);
  const isAdmin = hasPlatformPermission(permissionSnapshot.platform, PlatformPermissions.SETTINGS_MANAGE);
  const evaluatorEngineIds = permissionSnapshot.engines.map((engine) => engine.resourceId);
  const resourceAwareEngines = evaluatorEngineIds.length > 0
    ? await dataSource.getRepository(Engine).find({
      where: { id: In(evaluatorEngineIds), runtimeAccessScope: 'resource_aware' },
      select: ['id'],
    })
    : [];
  const runtimeVisibleEngineIds = (await Promise.all(resourceAwareEngines.map(async (engine) => {
    const [processes, decisions] = await Promise.all([
      permissionService.getVisibleRuntimeResources({
        userId,
        tenantId,
        engineId: engine.id,
        resourceKind: 'process_definition',
        permission: EnginePermissions.INSTANCE_VIEW,
        limit: 5_000,
      }),
      permissionService.getVisibleRuntimeResources({
        userId,
        tenantId,
        engineId: engine.id,
        resourceKind: 'decision_definition',
        permission: EnginePermissions.INSTANCE_VIEW,
        limit: 5_000,
      }),
    ]).catch(() => [[], []] as [unknown[], unknown[]]);
    return processes.length > 0 || decisions.length > 0 ? engine.id : null;
  }))).filter((id): id is string => Boolean(id));
  const accessibleEngineIds = Array.from(new Set([
    ...evaluatorEngineIds,
    ...runtimeVisibleEngineIds,
  ]));

  // Get project memberships
  const projectMemberRows = await projectMemberRepo.find({
    where: { userId },
    select: ['projectId', 'role'],
  });

  // Get project names for both legacy memberships and scoped RBAC project assignments.
  const projectIds = Array.from(new Set([
    ...projectMemberRows.map(p => p.projectId),
    ...permissionSnapshot.projects.map((project) => project.resourceId),
  ]));
  let projectNameMap = new Map<string, string>();
  if (projectIds.length > 0) {
    const projectRows = await projectRepo.find({
      where: { id: In(projectIds) },
      select: ['id', 'name'],
    });
    for (const p of projectRows) {
      projectNameMap.set(p.id, p.name);
    }
  }

  const legacyRoleByProjectId = new Map(projectMemberRows.map((membership) => [membership.projectId, membership.role]));
  const projectMemberships = projectIds.map(projectId => ({
    projectId,
    projectName: projectNameMap.get(projectId) || 'Unknown',
    role: legacyRoleByProjectId.get(projectId) || 'permission',
  }));

  // Compute visibility only from evaluator-backed permission snapshots.
  const canViewActiveUsers =
    hasPlatformPermission(permissionSnapshot.platform, PlatformPermissions.USERS_VIEW) ||
    hasPlatformPermission(permissionSnapshot.platform, PlatformPermissions.USER_VIEW) ||
    hasPlatformPermission(permissionSnapshot.platform, PlatformPermissions.USER_MANAGE);
  const canViewEngineInstances = hasAnyEnginePermission(permissionSnapshot, [EnginePermissions.INSTANCE_VIEW]) || runtimeVisibleEngineIds.length > 0;
  const canViewEngineDeployments = hasAnyEnginePermission(permissionSnapshot, [EnginePermissions.DEPLOY_VIEW]);
  const canViewProjectDeployments = hasAnyProjectPermission(permissionSnapshot, [
    ProjectPermissions.FILES_VIEW,
    ProjectPermissions.DEPLOY,
  ]);
  const context: DashboardContext = {
    isPlatformAdmin: isAdmin,
    ownedEngineIds: [],
    delegatedEngineIds: [],
    accessibleEngineIds,
    runtimeScopedEngineIds: runtimeVisibleEngineIds,
    projectMemberships,
    // Visibility flags
    canViewActiveUsers: isAdmin || canViewActiveUsers,
    canViewAllProjects: isAdmin,
    canViewEngines: accessibleEngineIds.length > 0 || permissionSnapshot.engines.length > 0,
    canViewProcessData: canViewEngineInstances,
    canViewDeployments: canViewEngineDeployments || canViewProjectDeployments,
    canViewMetrics: canViewEngineInstances,
  };

  res.json(context);
}));

export default r;
