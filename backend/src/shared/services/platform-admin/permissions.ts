/**
 * Platform IAM Permission Strings & Service
 * 
 * Allow-only grants with implicit deny.
 * Permissions extend roles - they never restrict.
 */

import { getDataSource } from '@shared/db/data-source.js';
import { PermissionGrant } from '@shared/db/entities/PermissionGrant.js';
import { IsNull, MoreThan, LessThan } from 'typeorm';
import { generateId } from '@shared/utils/id.js';

// ============================================================================
// Permission String Constants
// ============================================================================

/**
 * Platform-level permissions (no resource scope)
 */
export const PlatformPermissions = {
  // Engine management
  ENGINE_CREATE: 'platform:engine:create',
  ENGINE_DELETE: 'platform:engine:delete',
  
  // User management  
  USER_MANAGE: 'platform:user:manage',
  USER_VIEW: 'platform:user:view',
  
  // Settings
  SETTINGS_MANAGE: 'platform:settings:manage',
  
  // Audit
  AUDIT_VIEW: 'platform:audit:view',
  
  // Git providers
  GIT_PROVIDER_MANAGE: 'platform:git-provider:manage',
} as const;

/**
 * Project-scoped permissions
 */
export const ProjectPermissions = {
  // Project management
  PROJECT_DELETE: 'project:delete',
  PROJECT_SETTINGS: 'project:settings:manage',
  
  // Members
  MEMBERS_MANAGE: 'project:members:manage',
  MEMBERS_VIEW: 'project:members:view',
  
  // Files
  FILES_CREATE: 'project:files:create',
  FILES_EDIT: 'project:files:edit',
  FILES_DELETE: 'project:files:delete',
  FILES_VIEW: 'project:files:view',
  
  // Versions/checkpoints
  VERSIONS_CREATE: 'project:versions:create',
  VERSIONS_RESTORE: 'project:versions:restore',
  
  // Git operations
  GIT_PUSH: 'project:git:push',
  GIT_PULL: 'project:git:pull',
  GIT_CONNECT: 'project:git:connect',
  
  // Deploy (to engine)
  DEPLOY: 'project:deploy',
} as const;

/**
 * Engine-scoped permissions
 */
export const EnginePermissions = {
  // Engine management
  ENGINE_EDIT: 'engine:edit',
  ENGINE_DELETE: 'engine:delete',
  ENGINE_ACTIVATE: 'engine:activate',
  
  // Members
  MEMBERS_MANAGE: 'engine:members:manage',
  MEMBERS_VIEW: 'engine:members:view',
  
  // Deployments
  DEPLOY: 'engine:deploy',
  DEPLOY_VIEW: 'engine:deploy:view',
  
  // Mission Control actions
  PROCESS_START: 'engine:process:start',
  PROCESS_CANCEL: 'engine:process:cancel',
  PROCESS_MODIFY: 'engine:process:modify',
  
  INSTANCE_VIEW: 'engine:instance:view',
  INSTANCE_DELETE: 'engine:instance:delete',
  INSTANCE_RETRY: 'engine:instance:retry',
  
  VARIABLES_EDIT: 'engine:variables:edit',
} as const;

// All permissions combined for validation
export const AllPermissions = {
  ...PlatformPermissions,
  ...ProjectPermissions,
  ...EnginePermissions,
} as const;

export type PlatformPermission = typeof PlatformPermissions[keyof typeof PlatformPermissions];
export type ProjectPermission = typeof ProjectPermissions[keyof typeof ProjectPermissions];
export type EnginePermission = typeof EnginePermissions[keyof typeof EnginePermissions];
export type Permission = PlatformPermission | ProjectPermission | EnginePermission;

export type ResourceType = 'platform' | 'project' | 'engine';

// ============================================================================
// Role → Permission Mapping
// ============================================================================

/**
 * Platform roles and their implicit permissions
 */
export const PlatformRolePermissions: Record<string, Permission[]> = {
  admin: [
    // Admins get all platform permissions
    ...Object.values(PlatformPermissions),
  ],
  developer: [
    PlatformPermissions.USER_VIEW,
  ],
  user: [],
};

/**
 * Project roles and their implicit permissions
 */
export const ProjectRolePermissions: Record<string, ProjectPermission[]> = {
  owner: [
    ProjectPermissions.PROJECT_DELETE,
    ProjectPermissions.PROJECT_SETTINGS,
    ProjectPermissions.MEMBERS_MANAGE,
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.FILES_CREATE,
    ProjectPermissions.FILES_EDIT,
    ProjectPermissions.FILES_DELETE,
    ProjectPermissions.FILES_VIEW,
    ProjectPermissions.VERSIONS_CREATE,
    ProjectPermissions.VERSIONS_RESTORE,
    ProjectPermissions.GIT_PUSH,
    ProjectPermissions.GIT_PULL,
    ProjectPermissions.GIT_CONNECT,
    ProjectPermissions.DEPLOY,
  ],
  delegate: [
    ProjectPermissions.PROJECT_SETTINGS,
    ProjectPermissions.MEMBERS_MANAGE,
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.FILES_CREATE,
    ProjectPermissions.FILES_EDIT,
    ProjectPermissions.FILES_DELETE,
    ProjectPermissions.FILES_VIEW,
    ProjectPermissions.VERSIONS_CREATE,
    ProjectPermissions.VERSIONS_RESTORE,
    ProjectPermissions.GIT_PUSH,
    ProjectPermissions.GIT_PULL,
    ProjectPermissions.GIT_CONNECT,
    ProjectPermissions.DEPLOY,
  ],
  developer: [
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.FILES_CREATE,
    ProjectPermissions.FILES_EDIT,
    ProjectPermissions.FILES_DELETE,
    ProjectPermissions.FILES_VIEW,
    ProjectPermissions.VERSIONS_CREATE,
    ProjectPermissions.VERSIONS_RESTORE,
    ProjectPermissions.GIT_PUSH,
    ProjectPermissions.GIT_PULL,
    ProjectPermissions.DEPLOY,
  ],
  editor: [
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.FILES_CREATE,
    ProjectPermissions.FILES_EDIT,
    ProjectPermissions.FILES_VIEW,
    ProjectPermissions.VERSIONS_CREATE,
    // Note: editors do NOT get DEPLOY by default - requires explicit grant
  ],
  viewer: [
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.FILES_VIEW,
  ],
};

/**
 * Engine roles and their implicit permissions
 */
export const EngineRolePermissions: Record<string, EnginePermission[]> = {
  owner: [
    EnginePermissions.ENGINE_EDIT,
    EnginePermissions.ENGINE_DELETE,
    EnginePermissions.ENGINE_ACTIVATE,
    EnginePermissions.MEMBERS_MANAGE,
    EnginePermissions.MEMBERS_VIEW,
    EnginePermissions.DEPLOY,
    EnginePermissions.DEPLOY_VIEW,
    EnginePermissions.PROCESS_START,
    EnginePermissions.PROCESS_CANCEL,
    EnginePermissions.PROCESS_MODIFY,
    EnginePermissions.INSTANCE_VIEW,
    EnginePermissions.INSTANCE_DELETE,
    EnginePermissions.INSTANCE_RETRY,
    EnginePermissions.VARIABLES_EDIT,
  ],
  delegate: [
    EnginePermissions.ENGINE_EDIT,
    EnginePermissions.ENGINE_ACTIVATE,
    EnginePermissions.MEMBERS_MANAGE,
    EnginePermissions.MEMBERS_VIEW,
    EnginePermissions.DEPLOY,
    EnginePermissions.DEPLOY_VIEW,
    EnginePermissions.PROCESS_START,
    EnginePermissions.PROCESS_CANCEL,
    EnginePermissions.PROCESS_MODIFY,
    EnginePermissions.INSTANCE_VIEW,
    EnginePermissions.INSTANCE_DELETE,
    EnginePermissions.INSTANCE_RETRY,
    EnginePermissions.VARIABLES_EDIT,
  ],
  operator: [
    EnginePermissions.MEMBERS_VIEW,
    EnginePermissions.DEPLOY,
    EnginePermissions.DEPLOY_VIEW,
    EnginePermissions.PROCESS_START,
    EnginePermissions.PROCESS_CANCEL,
    EnginePermissions.PROCESS_MODIFY,
    EnginePermissions.INSTANCE_VIEW,
    EnginePermissions.INSTANCE_DELETE,
    EnginePermissions.INSTANCE_RETRY,
    EnginePermissions.VARIABLES_EDIT,
  ],
  deployer: [
    EnginePermissions.DEPLOY,
    EnginePermissions.DEPLOY_VIEW,
  ],
};

// ============================================================================
// Permission Service
// ============================================================================

export interface PermissionContext {
  userId: string;
  platformRole?: string;
  projectRole?: string;
  engineRole?: string;
  resourceType?: ResourceType;
  resourceId?: string;
}

export interface GrantPermissionInput {
  userId: string;
  permission: Permission;
  resourceType?: ResourceType;
  resourceId?: string;
  grantedById: string;
  expiresAt?: number;
}

class PermissionServiceClass {
  /**
   * Check if user has a specific permission.
   * 
   * Resolution order:
   * 1. Check if platform admin (admin role = all permissions)
   * 2. Check role-based permissions
   * 3. Check explicit permission grants
   */
  async hasPermission(
    permission: Permission,
    context: PermissionContext
  ): Promise<boolean> {
    const { userId, platformRole, projectRole, engineRole, resourceType, resourceId } = context;

    // 1. Platform admin has all permissions
    if (platformRole === 'admin') {
      return true;
    }

    // 2. Check role-based permissions
    if (this.roleHasPermission(permission, { platformRole, projectRole, engineRole })) {
      return true;
    }

    // 3. Check explicit grants
    return this.hasExplicitGrant(userId, permission, resourceType, resourceId);
  }

  /**
   * Check if a role implicitly grants a permission
   */
  roleHasPermission(
    permission: Permission,
    roles: { platformRole?: string; projectRole?: string; engineRole?: string }
  ): boolean {
    const { platformRole, projectRole, engineRole } = roles;

    // Check platform role permissions
    if (platformRole && PlatformRolePermissions[platformRole]?.includes(permission as any)) {
      return true;
    }

    // Check project role permissions
    if (projectRole && ProjectRolePermissions[projectRole]?.includes(permission as ProjectPermission)) {
      return true;
    }

    // Check engine role permissions
    if (engineRole && EngineRolePermissions[engineRole]?.includes(permission as EnginePermission)) {
      return true;
    }

    return false;
  }

  /**
   * Check if user has an explicit permission grant
   */
  async hasExplicitGrant(
    userId: string,
    permission: Permission,
    resourceType?: ResourceType,
    resourceId?: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);
    const now = Date.now();

    // Build query with TypeORM QueryBuilder for complex OR conditions
    const qb = grantRepo.createQueryBuilder('g')
      .where('g.userId = :userId', { userId })
      .andWhere('g.permission = :permission', { permission })
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now });

    // Resource scope matching
    if (resourceType && resourceId) {
      qb.andWhere(
        '((g.resourceType = :resourceType AND g.resourceId = :resourceId) OR ' +
        '(g.resourceType = :resourceType AND g.resourceId IS NULL) OR ' +
        '(g.resourceType IS NULL))',
        { resourceType, resourceId }
      );
    } else if (resourceType) {
      qb.andWhere(
        '(g.resourceType = :resourceType OR g.resourceType IS NULL)',
        { resourceType }
      );
    }

    const grant = await qb.getOne();
    return !!grant;
  }

  /**
   * Grant a permission to a user
   */
  async grantPermission(input: GrantPermissionInput): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);
    const id = generateId();
    const now = Date.now();

    await grantRepo.insert({
      id,
      userId: input.userId,
      permission: input.permission,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId || null,
      grantedById: input.grantedById,
      expiresAt: input.expiresAt || null,
      createdAt: now,
    });

    return { id };
  }

  /**
   * Revoke a permission from a user
   */
  async revokePermission(
    userId: string,
    permission: Permission,
    resourceType?: ResourceType,
    resourceId?: string
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);

    const qb = grantRepo.createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .andWhere('permission = :permission', { permission });

    if (resourceType) {
      qb.andWhere('resourceType = :resourceType', { resourceType });
    } else {
      qb.andWhere('resourceType IS NULL');
    }

    if (resourceId) {
      qb.andWhere('resourceId = :resourceId', { resourceId });
    } else {
      qb.andWhere('resourceId IS NULL');
    }

    await qb.execute();
    return true;
  }

  /**
   * Get all explicit grants for a user
   */
  async getUserGrants(userId: string): Promise<Array<{
    id: string;
    permission: string;
    resourceType: string | null;
    resourceId: string | null;
    expiresAt: number | null;
    createdAt: number;
  }>> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);
    const now = Date.now();

    const grants = await grantRepo.createQueryBuilder('g')
      .where('g.userId = :userId', { userId })
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now })
      .getMany();

    return grants.map((g) => ({
      id: g.id,
      permission: g.permission,
      resourceType: g.resourceType,
      resourceId: g.resourceId,
      expiresAt: g.expiresAt,
      createdAt: g.createdAt,
    }));
  }

  /**
   * Clean up expired grants (call periodically)
   */
  async cleanupExpiredGrants(): Promise<number> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);
    const now = Date.now();

    const result = await grantRepo.createQueryBuilder()
      .delete()
      .where('expiresAt > 0') // Has expiration
      .andWhere('expiresAt < :now', { now }) // Is expired
      .execute();

    return result.affected || 0;
  }
}

export const permissionService = new PermissionServiceClass();
