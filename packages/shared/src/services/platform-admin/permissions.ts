/**
 * Platform IAM Permission Strings & Service
 * 
 * Allow-only grants with implicit deny.
 * Permissions extend roles - they never restrict.
 */

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PermissionGrant } from '@enterpriseglue/shared/infrastructure/persistence/entities/PermissionGrant.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMemberRole.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { EngineMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineMember.js';
import { SsoAssignmentMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoAssignmentMapping.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { ApiClient } from '@enterpriseglue/shared/infrastructure/persistence/entities/ApiClient.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js';
import { ServiceAccount } from '@enterpriseglue/shared/infrastructure/persistence/entities/ServiceAccount.js';
import { SsoGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoGroupMapping.js';
import { AuthzPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzPolicy.js';
import { RbacPermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacPermission.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { In, IsNull, Not, type DataSource, type EntityManager } from 'typeorm';
import { normalizeTenantIdForPersistence, tenantIdsForAuthz } from '../../authz/tenant-scope.js';
import { canonicalRoleAssignmentKey } from '../../authz/role-assignment-identity.js';
import type { AuthzPrincipalType, AuthzResourceType } from '../../authz/permission-actions.js';

// ============================================================================
// Permission String Constants
// ============================================================================

/**
 * Platform-level permissions (no resource scope)
 */
export const PlatformPermissions = {
  // Dashboard
  DASHBOARD_VIEW: 'platform:dashboard:view',

  // Projects
  PROJECT_CREATE: 'project:create',

  // Engine management
  ENGINE_CREATE: 'platform:engine:create',
  ENGINE_DELETE: 'platform:engine:delete',
  ENGINE_REGISTRATION_MANAGE: 'platform:engine-registration:manage',
  ENGINE_SETS_VIEW: 'platform:engine-sets:view',
  ENGINE_SETS_MANAGE: 'platform:engine-sets:manage',
  PROJECT_ENGINE_TARGETS_VIEW: 'platform:project-engine-targets:view',
  PROJECT_ENGINE_TARGETS_MANAGE: 'platform:project-engine-targets:manage',
  
  // User management  
  USER_MANAGE: 'platform:user:manage',
  USER_VIEW: 'platform:user:view',
  USERS_VIEW: 'platform:users:view',
  USERS_CREATE: 'platform:users:create',
  USERS_UPDATE: 'platform:users:update',
  USERS_DEACTIVATE: 'platform:users:deactivate',
  USERS_DELETE: 'platform:users:delete',
  USERS_PERMANENT_DELETE: 'platform:users:permanent-delete',
  USERS_UNLOCK: 'platform:users:unlock',
  
  // Settings
  SETTINGS_MANAGE: 'platform:settings:manage',

  // SSO administration
  SSO_PROVIDERS_VIEW: 'platform:sso-providers:view',
  SSO_PROVIDERS_MANAGE: 'platform:sso-providers:manage',
  SSO_PLATFORM_ROLE_MAPPINGS_VIEW: 'platform:sso-platform-role-mappings:view',
  SSO_PLATFORM_ROLE_MAPPINGS_MANAGE: 'platform:sso-platform-role-mappings:manage',
  
  // Audit
  AUDIT_VIEW: 'platform:audit:view',
  AUDIT_UNREDACTED_VIEW: 'platform:audit:unredacted-view',
  
  // Git providers
  GIT_PROVIDER_MANAGE: 'platform:git-provider:manage',

  // RBAC foundation
  AUTHZ_ROLES_VIEW: 'platform:authz:roles:view',
  AUTHZ_ROLES_MANAGE: 'platform:authz:roles:manage',
  AUTHZ_CHECK: 'platform:authz:check',
  SSO_ASSIGNMENTS_VIEW: 'platform:sso-assignments:view',
  SSO_ASSIGNMENTS_MANAGE: 'platform:sso-assignments:manage',
  API_CLIENTS_VIEW: 'platform:api-clients:view',
  API_CLIENTS_MANAGE: 'platform:api-clients:manage',
  SERVICE_ACCOUNTS_VIEW: 'platform:service-accounts:view',
  SERVICE_ACCOUNTS_MANAGE: 'platform:service-accounts:manage',
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
  MEMBERS_SEARCH: 'project:members:search',
  MEMBERS_INVITE: 'project:members:invite',
  MEMBERS_ADD: 'project:members:add',
  MEMBERS_UPDATE_ROLE: 'project:members:update-role',
  MEMBERS_REMOVE: 'project:members:remove',
  MEMBERS_MANAGE_DEPLOY_GRANT: 'project:members:manage-deploy-grant',
  DELEGATE_MANAGE: 'project:delegate:manage',
  OWNERSHIP_TRANSFER: 'project:ownership:transfer',
  
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
  DEPLOYMENT_TARGETS_VIEW: 'project:deployment-targets:view',
  DEPLOYMENT_TARGETS_MANAGE: 'project:deployment-targets:manage',
} as const;

/**
 * Engine-scoped permissions
 */
export const EnginePermissions = {
  // Engine management
  ENGINE_EDIT: 'engine:edit',
  ENGINE_DELETE: 'engine:delete',
  ENGINE_ACTIVATE: 'engine:activate',
  SECRETS_VIEW: 'engine:secrets:view',
  SECRETS_MANAGE: 'engine:secrets:manage',
  ENVIRONMENT_SET: 'engine:environment:set',
  ENVIRONMENT_LOCK: 'engine:environment:lock',
  DELEGATE_MANAGE: 'engine:delegate:manage',
  OWNERSHIP_TRANSFER: 'engine:ownership:transfer',
  
  // Members
  MEMBERS_MANAGE: 'engine:members:manage',
  MEMBERS_VIEW: 'engine:members:view',
  MEMBERS_LOOKUP: 'engine:members:lookup',
  MEMBERS_INVITE: 'engine:members:invite',
  MEMBERS_ADD: 'engine:members:add',
  MEMBERS_UPDATE_ROLE: 'engine:members:update-role',
  MEMBERS_REMOVE: 'engine:members:remove',

  // Project access
  PROJECT_ACCESS_VIEW: 'engine:project-access:view',
  PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
  PROJECT_ACCESS_DENY: 'engine:project-access:deny',
  PROJECT_ACCESS_REVOKE: 'engine:project-access:revoke',
  
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

/**
 * External-engine-system scoped permissions.
 */
export const ExternalEngineSystemPermissions = {
  ENGINE_REGISTRATION_MANAGE: 'external-engine-system:engine-registration:manage',
  PROJECT_TARGETS_MANAGE: 'external-engine-system:project-targets:manage',
} as const;

// All permissions combined for validation
export const AllPermissions = {
  ...PlatformPermissions,
  ...ProjectPermissions,
  ...EnginePermissions,
  ...ExternalEngineSystemPermissions,
} as const;

export type PlatformPermission = typeof PlatformPermissions[keyof typeof PlatformPermissions];
export type ProjectPermission = typeof ProjectPermissions[keyof typeof ProjectPermissions];
export type EnginePermission = typeof EnginePermissions[keyof typeof EnginePermissions];
export type ExternalEngineSystemPermission = typeof ExternalEngineSystemPermissions[keyof typeof ExternalEngineSystemPermissions];
export type Permission = string;

export type ResourceType = AuthzResourceType;
export type RoleScope = ResourceType;
export type PrincipalType = AuthzPrincipalType;
export type RoleKind = 'system' | 'custom';
export type RoleSource = 'system' | 'manual' | 'config' | 'api' | 'automation';
export type PermissionKind = 'system' | 'custom';
export type RoleAssignmentSource = 'legacy' | 'manual' | 'sso' | 'api' | 'system' | 'automation' | 'bootstrap';

export interface PermissionDefinition {
  key: Permission;
  scope: ResourceType;
  category: string;
  label: string;
  description: string;
  kind?: PermissionKind;
  isEditable?: boolean;
  isArchived?: boolean;
  createdById?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface SystemRoleDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  scope: RoleScope;
  kind: RoleKind;
  isEditable: boolean;
  isAssignable: boolean;
  permissions: Permission[];
}

export interface RoleSummary {
  id: string;
  tenantId: string | null;
  key: string;
  name: string;
  description: string | null;
  scope: RoleScope;
  kind: RoleKind;
  isEditable: boolean;
  isAssignable: boolean;
  isArchived: boolean;
  source: RoleSource;
  sourceRef: string | null;
  permissionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface RoleDetail extends RoleSummary {
  permissions: Permission[];
}

export interface CreateCustomRoleInput {
  tenantId?: string | null;
  /** Reserved for controlled config/API provisioning; public UI creation still generates a key. */
  key?: string;
  name: string;
  description?: string | null;
  scope: RoleScope;
  permissionIds: Permission[];
  createdById: string;
  source?: Exclude<RoleSource, 'system'>;
  sourceRef?: string | null;
}

export interface CreateCustomPermissionInput {
  tenantId?: string | null;
  key: Permission;
  scope: ResourceType;
  category: string;
  label: string;
  description?: string | null;
  createdById: string;
}

export interface UpdateCustomRoleInput {
  tenantId?: string | null;
  name?: string;
  description?: string | null;
  permissionIds?: Permission[];
  isArchived?: boolean;
  updatedById?: string;
}

const CUSTOM_ROLE_DENY_FIELD_NAMES = [
  'denyPermissionIds',
  'deniedPermissionIds',
  'denyPermissions',
  'deniedPermissions',
  'permissionDenies',
] as const;

const CUSTOM_ROLE_ALLOW_ONLY_MESSAGE = 'Custom roles are allow-only; use authorization policies for deny rules';

function assertCustomRoleAllowOnlyInput(input: unknown): void {
  if (!input || typeof input !== 'object') return;
  for (const field of CUSTOM_ROLE_DENY_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new Error(CUSTOM_ROLE_ALLOW_ONLY_MESSAGE);
    }
  }
}

function normalizeTenantId(tenantId?: string | null): string | null {
  return normalizeTenantIdForPersistence(tenantId);
}

function canonicalRoleKeyIdentity(tenantId: string | null | undefined, key: string): string {
  return `${normalizeTenantId(tenantId) || 'platform'}:${key.trim()}`;
}

function normalizeRoleSource(source?: Exclude<RoleSource, 'system'>): Exclude<RoleSource, 'system'> {
  const normalized = source || 'manual';
  if (!['manual', 'config', 'api', 'automation'].includes(normalized)) {
    throw new Error('Unsupported custom role source');
  }
  return normalized;
}

function normalizeCustomRoleKey(key: string | undefined, scope: RoleScope, name: string, id: string): string {
  const normalized = key?.trim() || `custom.${scope}.${slugifyRoleName(name)}.${id.slice(0, 8)}`;
  if (!/^custom\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error('Custom role keys must use a stable custom.* key');
  }
  return normalized;
}

function addTenantScopeFilter(qb: { andWhere: (...args: any[]) => any }, alias: string, tenantId?: string | null): void {
  const visibleTenantIds = tenantIdsForAuthz(tenantId);
  if (visibleTenantIds.length === 0) return;
  qb.andWhere(`(${alias}.tenantId IN (:...tenantIds) OR ${alias}.tenantId IS NULL)`, { tenantIds: visibleTenantIds });
}

function stableVersionHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tenantScopedWhere<T extends Record<string, unknown>>(where: T, tenantId?: string | null): T | T[] {
  const visibleTenantIds = tenantIdsForAuthz(tenantId);
  if (visibleTenantIds.length === 0) return where;
  return [
    ...visibleTenantIds.map((visibleTenantId) => ({ ...where, tenantId: visibleTenantId })),
    { ...where, tenantId: IsNull() },
  ] as T[];
}

function parseJsonRecord(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface RoleAssignmentView {
  id: string;
  tenantId: string | null;
  userId: string | null;
  principalType: PrincipalType;
  principalId: string;
  roleId: string;
  roleKey: string | null;
  roleName: string | null;
  roleScope: RoleScope | null;
  resourceType: ResourceType | null;
  resourceId: string | null;
  scopeType: ResourceType | null;
  scopeId: string | null;
  source: RoleAssignmentSource;
  sourceMappingId: string | null;
  sourceRef: string | null;
  expiresAt: number | null;
  lastSeenAt: number | null;
  createdById: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoleAssignmentFilters {
  tenantId?: string | null;
  userId?: string;
  principalType?: PrincipalType;
  principalId?: string;
  resourceType?: ResourceType;
  resourceId?: string | null;
  scopeType?: ResourceType;
  scopeId?: string | null;
}

export interface CreateRoleAssignmentInput {
  tenantId?: string | null;
  userId?: string;
  principalType?: PrincipalType;
  principalId?: string;
  roleId: string;
  resourceType?: ResourceType;
  resourceId?: string | null;
  scopeType?: ResourceType;
  scopeId?: string | null;
  source?: RoleAssignmentSource;
  sourceMappingId?: string | null;
  sourceRef?: string | null;
  expiresAt?: number | null;
  createdById: string;
}

export interface SyncLegacyRoleAssignmentsOptions {
  projectIds?: string[];
  engineIds?: string[];
  now?: number;
}

export interface SyncLegacyRoleAssignmentsResult {
  scannedProjects: number;
  scannedEngines: number;
  upserted: number;
  removed: number;
}

export interface PermissionEvaluationSource {
  type: 'legacy-role' | 'role-assignment' | 'explicit-grant';
  assignmentId?: string;
  roleId?: string;
  role?: string;
  principalType?: PrincipalType;
  principalId?: string;
  source?: string;
  sourceMappingId?: string | null;
  sourceRef?: string | null;
  scopeType?: ResourceType | null;
  scopeId?: string | null;
  groupId?: string | null;
  groupKey?: string | null;
  groupName?: string | null;
  groupMembership?: {
    id: string;
    source: string;
    sourceRef: string | null;
    expiresAt: number | null;
  } | null;
  engineSetId?: string | null;
  engineSetKey?: string | null;
  engineSetName?: string | null;
  selectorFingerprint?: string | null;
  materializationId?: string | null;
  matchedEngineId?: string | null;
  engineRegistration?: {
    engineId: string;
    engineName: string | null;
    externalId: string | null;
    registrationId: string | null;
    registrationSource: string | null;
    externalSystemId: string | null;
    lifecycleStatus: string | null;
    apiClientId: string | null;
    lastExternalSyncAt: number | null;
    lastRegisteredAt: number | null;
    externalUpdatedAt: number | null;
  } | null;
  matchedBy?: Record<string, unknown> | null;
  lineage?: Record<string, unknown> | null;
  ssoMapping?: {
    id: string;
    providerId: string | null;
    claimType: string;
    claimKey: string;
    claimValue: string;
    claimOperator: string | null;
    targetSelectorType: string;
  } | null;
  ssoGroupMapping?: {
    id: string;
    providerId: string | null;
    claimType: string;
    claimKey: string;
    claimValue: string;
    claimOperator: string | null;
    targetGroupId: string;
    syncMode: string;
  } | null;
  permission?: string;
}

export interface BasePermissionEvaluation {
  allowed: boolean;
  reason: string;
  sources: PermissionEvaluationSource[];
}

export interface EffectiveResourcePermissions {
  resourceId: string;
  permissions: Permission[];
}

export interface CurrentUserPermissionsSnapshot {
  userId: string;
  platform: Permission[];
  projects: EffectiveResourcePermissions[];
  engines: EffectiveResourcePermissions[];
  authorizationVersion: string;
  generatedAt: number;
}

export const SYSTEM_ROLE_IDS = {
  PLATFORM_ADMIN: 'system.platform.admin',
  PLATFORM_DEVELOPER: 'system.platform.developer',
  PLATFORM_USER: 'system.platform.user',
  PLATFORM_ACCESS_ADMIN: 'system.platform.access_admin',
  PLATFORM_ACCESS_AUDITOR: 'system.platform.access_auditor',
  PLATFORM_USER_ADMIN: 'system.platform.user_admin',
  PLATFORM_SSO_ADMIN: 'system.platform.sso_admin',
  PLATFORM_ENGINE_REGISTRY_ADMIN: 'system.platform.engine_registry_admin',
  PLATFORM_API_CLIENT_ADMIN: 'system.platform.api_client_admin',
  PROJECT_OWNER: 'system.project.owner',
  PROJECT_DELEGATE: 'system.project.delegate',
  PROJECT_DEPLOYER: 'system.project.deployer',
  PROJECT_DEVELOPER: 'system.project.developer',
  PROJECT_EDITOR: 'system.project.editor',
  PROJECT_VIEWER: 'system.project.viewer',
  ENGINE_OWNER: 'system.engine.owner',
  ENGINE_DELEGATE: 'system.engine.delegate',
  ENGINE_OPERATOR: 'system.engine.operator',
  ENGINE_DEPLOYER: 'system.engine.deployer',
  API_ENGINE_REGISTRAR: 'system.api.engine_registrar',
  API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR: 'system.api.external_engine_system_registrar',
  API_PROJECT_ENGINE_TARGET_REGISTRAR: 'system.api.project_engine_target_registrar',
} as const;

export const ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE: Record<string, 'owner' | 'delegate' | 'operator' | 'deployer'> = {
  [SYSTEM_ROLE_IDS.ENGINE_OWNER]: 'owner',
  [SYSTEM_ROLE_IDS.ENGINE_DELEGATE]: 'delegate',
  [SYSTEM_ROLE_IDS.ENGINE_OPERATOR]: 'operator',
  [SYSTEM_ROLE_IDS.ENGINE_DEPLOYER]: 'deployer',
};

export const PROJECT_SYSTEM_ROLE_TO_LEGACY_ROLE: Record<string, 'owner' | 'delegate' | 'developer' | 'editor' | 'viewer'> = {
  [SYSTEM_ROLE_IDS.PROJECT_OWNER]: 'owner',
  [SYSTEM_ROLE_IDS.PROJECT_DELEGATE]: 'delegate',
  [SYSTEM_ROLE_IDS.PROJECT_DEVELOPER]: 'developer',
  [SYSTEM_ROLE_IDS.PROJECT_EDITOR]: 'editor',
  [SYSTEM_ROLE_IDS.PROJECT_VIEWER]: 'viewer',
};

const LEGACY_PROJECT_ROLE_TO_SYSTEM_ROLE: Record<string, string | undefined> = {
  owner: SYSTEM_ROLE_IDS.PROJECT_OWNER,
  delegate: SYSTEM_ROLE_IDS.PROJECT_DELEGATE,
  developer: SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
  editor: SYSTEM_ROLE_IDS.PROJECT_EDITOR,
  viewer: SYSTEM_ROLE_IDS.PROJECT_VIEWER,
};

const LEGACY_ENGINE_ROLE_TO_SYSTEM_ROLE: Record<string, string | undefined> = {
  owner: SYSTEM_ROLE_IDS.ENGINE_OWNER,
  delegate: SYSTEM_ROLE_IDS.ENGINE_DELEGATE,
  operator: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
  deployer: SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
};

const ENGINE_ROLE_PRECEDENCE: Array<'owner' | 'delegate' | 'operator' | 'deployer'> = ['owner', 'delegate', 'operator', 'deployer'];

function labelFromPermission(permission: string): string {
  return permission
    .split(':')
    .slice(1)
    .join(' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function permissionDefinition(permission: Permission, scope: ResourceType, category: string, description: string): PermissionDefinition {
  return {
    key: permission,
    scope,
    category,
    label: labelFromPermission(permission),
    description,
    kind: 'system',
    isEditable: false,
    isArchived: false,
  };
}

export const PermissionCatalog: PermissionDefinition[] = [
  permissionDefinition(PlatformPermissions.DASHBOARD_VIEW, 'platform', 'Dashboard', 'View the authenticated user dashboard shell and own-resource summary widgets.'),
  permissionDefinition(PlatformPermissions.PROJECT_CREATE, 'platform', 'Projects', 'Create projects from blank, Git-backed, or imported sources.'),
  permissionDefinition(PlatformPermissions.ENGINE_CREATE, 'platform', 'Engine Management', 'Create engines.'),
  permissionDefinition(PlatformPermissions.ENGINE_DELETE, 'platform', 'Engine Management', 'Delete engines.'),
  permissionDefinition(PlatformPermissions.ENGINE_REGISTRATION_MANAGE, 'platform', 'Engine Management', 'Manage external engine registration API clients.'),
  permissionDefinition(PlatformPermissions.ENGINE_SETS_VIEW, 'platform', 'Engine Sets', 'View Engine Sets and materialized engine matches.'),
  permissionDefinition(PlatformPermissions.ENGINE_SETS_MANAGE, 'platform', 'Engine Sets', 'Manage Engine Sets and refresh materializations.'),
  permissionDefinition(PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW, 'platform', 'Project Engine Targets', 'View project-to-engine deployment and import targets.'),
  permissionDefinition(PlatformPermissions.PROJECT_ENGINE_TARGETS_MANAGE, 'platform', 'Project Engine Targets', 'Manage project-to-engine deployment and import targets.'),
  permissionDefinition(PlatformPermissions.USER_MANAGE, 'platform', 'User Management', 'Manage users. Backward-compatible umbrella permission for user operations.'),
  permissionDefinition(PlatformPermissions.USER_VIEW, 'platform', 'User Management', 'View users. Backward-compatible user-view permission.'),
  permissionDefinition(PlatformPermissions.USERS_VIEW, 'platform', 'User Management', 'View users.'),
  permissionDefinition(PlatformPermissions.USERS_CREATE, 'platform', 'User Management', 'Create and invite platform users.'),
  permissionDefinition(PlatformPermissions.USERS_UPDATE, 'platform', 'User Management', 'Update user profile, status, or platform role.'),
  permissionDefinition(PlatformPermissions.USERS_DEACTIVATE, 'platform', 'User Management', 'Deactivate platform users.'),
  permissionDefinition(PlatformPermissions.USERS_DELETE, 'platform', 'User Management', 'Soft delete platform users.'),
  permissionDefinition(PlatformPermissions.USERS_PERMANENT_DELETE, 'platform', 'User Management', 'Permanently delete eligible platform users.'),
  permissionDefinition(PlatformPermissions.USERS_UNLOCK, 'platform', 'User Management', 'Unlock locked platform users.'),
  permissionDefinition(PlatformPermissions.SETTINGS_MANAGE, 'platform', 'Settings', 'Manage platform settings.'),
  permissionDefinition(PlatformPermissions.SSO_PROVIDERS_VIEW, 'platform', 'SSO', 'View configured SSO identity providers.'),
  permissionDefinition(PlatformPermissions.SSO_PROVIDERS_MANAGE, 'platform', 'SSO', 'Create, update, delete, enable, or disable SSO identity providers.'),
  permissionDefinition(PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_VIEW, 'platform', 'SSO', 'View SSO claim mappings that provision platform roles.'),
  permissionDefinition(PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_MANAGE, 'platform', 'SSO', 'Create, update, delete, or test SSO claim mappings that provision platform roles.'),
  permissionDefinition(PlatformPermissions.AUDIT_VIEW, 'platform', 'Audit', 'View audit logs.'),
  permissionDefinition(PlatformPermissions.AUDIT_UNREDACTED_VIEW, 'platform', 'Audit', 'View unredacted audit log payloads when PII redaction is enabled.'),
  permissionDefinition(PlatformPermissions.GIT_PROVIDER_MANAGE, 'platform', 'Git Providers', 'Manage Git provider configuration.'),
  permissionDefinition(PlatformPermissions.AUTHZ_ROLES_VIEW, 'platform', 'Access Control', 'View roles and permissions.'),
  permissionDefinition(PlatformPermissions.AUTHZ_ROLES_MANAGE, 'platform', 'Access Control', 'Manage custom roles.'),
  permissionDefinition(PlatformPermissions.AUTHZ_CHECK, 'platform', 'Access Control', 'Evaluate effective access.'),
  permissionDefinition(PlatformPermissions.SSO_ASSIGNMENTS_VIEW, 'platform', 'SSO Assignments', 'View SSO engine assignment mappings.'),
  permissionDefinition(PlatformPermissions.SSO_ASSIGNMENTS_MANAGE, 'platform', 'SSO Assignments', 'Manage SSO engine assignment mappings.'),
  permissionDefinition(PlatformPermissions.API_CLIENTS_VIEW, 'platform', 'API Clients', 'View API client machine identities.'),
  permissionDefinition(PlatformPermissions.API_CLIENTS_MANAGE, 'platform', 'API Clients', 'Create, rotate, revoke, and audit API client machine identities.'),
  permissionDefinition(PlatformPermissions.SERVICE_ACCOUNTS_VIEW, 'platform', 'Service Accounts', 'View service-account machine identities.'),
  permissionDefinition(PlatformPermissions.SERVICE_ACCOUNTS_MANAGE, 'platform', 'Service Accounts', 'Create, rotate, revoke, and audit service-account machine identities.'),
  permissionDefinition(ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE, 'external_engine_system', 'External Engine Systems', 'Register or update engines for a specific external engine source system.'),
  permissionDefinition(ExternalEngineSystemPermissions.PROJECT_TARGETS_MANAGE, 'external_engine_system', 'External Engine Systems', 'Register or update project-engine deployment targets for a specific external engine source system.'),
  ...Object.values(ProjectPermissions).map((permission) =>
    permissionDefinition(permission, 'project', 'Project', `Grants ${labelFromPermission(permission).toLowerCase()} on projects.`)
  ),
  ...Object.values(EnginePermissions).map((permission) =>
    permissionDefinition(permission, 'engine', 'Engine', `Grants ${labelFromPermission(permission).toLowerCase()} on engines.`)
  ),
];

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
    PlatformPermissions.DASHBOARD_VIEW,
    PlatformPermissions.PROJECT_CREATE,
    PlatformPermissions.ENGINE_CREATE,
    PlatformPermissions.USER_VIEW,
    PlatformPermissions.USERS_VIEW,
  ],
  user: [
    PlatformPermissions.DASHBOARD_VIEW,
    PlatformPermissions.PROJECT_CREATE,
    PlatformPermissions.ENGINE_CREATE,
  ],
};

const CompatiblePermissionCandidates: Partial<Record<Permission, Permission[]>> = {
  [PlatformPermissions.USER_VIEW]: [
    PlatformPermissions.USER_VIEW,
    PlatformPermissions.USERS_VIEW,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.USERS_VIEW]: [
    PlatformPermissions.USERS_VIEW,
    PlatformPermissions.USER_VIEW,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.USERS_CREATE]: [
    PlatformPermissions.USERS_CREATE,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.USERS_UPDATE]: [
    PlatformPermissions.USERS_UPDATE,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.USERS_DEACTIVATE]: [
    PlatformPermissions.USERS_DEACTIVATE,
    PlatformPermissions.USERS_DELETE,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.USERS_DELETE]: [
    PlatformPermissions.USERS_DELETE,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.USERS_PERMANENT_DELETE]: [
    PlatformPermissions.USERS_PERMANENT_DELETE,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.USERS_UNLOCK]: [
    PlatformPermissions.USERS_UNLOCK,
    PlatformPermissions.USER_MANAGE,
  ],
  [PlatformPermissions.SSO_PROVIDERS_VIEW]: [
    PlatformPermissions.SSO_PROVIDERS_VIEW,
    PlatformPermissions.SSO_PROVIDERS_MANAGE,
    PlatformPermissions.SETTINGS_MANAGE,
  ],
  [PlatformPermissions.SSO_PROVIDERS_MANAGE]: [
    PlatformPermissions.SSO_PROVIDERS_MANAGE,
    PlatformPermissions.SETTINGS_MANAGE,
  ],
  [PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_VIEW]: [
    PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_VIEW,
    PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_MANAGE,
    PlatformPermissions.SETTINGS_MANAGE,
  ],
  [PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_MANAGE]: [
    PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_MANAGE,
    PlatformPermissions.SETTINGS_MANAGE,
  ],
  [PlatformPermissions.AUTHZ_ROLES_VIEW]: [
    PlatformPermissions.AUTHZ_ROLES_VIEW,
    PlatformPermissions.AUTHZ_ROLES_MANAGE,
  ],
  [PlatformPermissions.ENGINE_SETS_VIEW]: [
    PlatformPermissions.ENGINE_SETS_VIEW,
    PlatformPermissions.ENGINE_SETS_MANAGE,
  ],
  [PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW]: [
    PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW,
    PlatformPermissions.PROJECT_ENGINE_TARGETS_MANAGE,
  ],
  [PlatformPermissions.SSO_ASSIGNMENTS_VIEW]: [
    PlatformPermissions.SSO_ASSIGNMENTS_VIEW,
    PlatformPermissions.SSO_ASSIGNMENTS_MANAGE,
  ],
  [PlatformPermissions.API_CLIENTS_VIEW]: [
    PlatformPermissions.API_CLIENTS_VIEW,
    PlatformPermissions.API_CLIENTS_MANAGE,
    PlatformPermissions.ENGINE_REGISTRATION_MANAGE,
  ],
  [PlatformPermissions.API_CLIENTS_MANAGE]: [
    PlatformPermissions.API_CLIENTS_MANAGE,
    PlatformPermissions.ENGINE_REGISTRATION_MANAGE,
  ],
  [PlatformPermissions.SERVICE_ACCOUNTS_VIEW]: [
    PlatformPermissions.SERVICE_ACCOUNTS_VIEW,
    PlatformPermissions.SERVICE_ACCOUNTS_MANAGE,
    PlatformPermissions.ENGINE_REGISTRATION_MANAGE,
  ],
  [PlatformPermissions.SERVICE_ACCOUNTS_MANAGE]: [
    PlatformPermissions.SERVICE_ACCOUNTS_MANAGE,
    PlatformPermissions.ENGINE_REGISTRATION_MANAGE,
  ],
  [ProjectPermissions.MEMBERS_VIEW]: [
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.MEMBERS_MANAGE,
  ],
  [ProjectPermissions.MEMBERS_SEARCH]: [
    ProjectPermissions.MEMBERS_SEARCH,
    ProjectPermissions.MEMBERS_MANAGE,
  ],
  [ProjectPermissions.MEMBERS_INVITE]: [
    ProjectPermissions.MEMBERS_INVITE,
    ProjectPermissions.MEMBERS_MANAGE,
  ],
  [ProjectPermissions.MEMBERS_ADD]: [
    ProjectPermissions.MEMBERS_ADD,
    ProjectPermissions.MEMBERS_MANAGE,
  ],
  [ProjectPermissions.MEMBERS_UPDATE_ROLE]: [
    ProjectPermissions.MEMBERS_UPDATE_ROLE,
    ProjectPermissions.MEMBERS_MANAGE,
  ],
  [ProjectPermissions.MEMBERS_REMOVE]: [
    ProjectPermissions.MEMBERS_REMOVE,
    ProjectPermissions.MEMBERS_MANAGE,
  ],
  [ProjectPermissions.MEMBERS_MANAGE_DEPLOY_GRANT]: [
    ProjectPermissions.MEMBERS_MANAGE_DEPLOY_GRANT,
    ProjectPermissions.MEMBERS_MANAGE,
  ],
  [ProjectPermissions.DEPLOYMENT_TARGETS_VIEW]: [
    ProjectPermissions.DEPLOYMENT_TARGETS_VIEW,
    ProjectPermissions.DEPLOYMENT_TARGETS_MANAGE,
  ],
  [EnginePermissions.MEMBERS_VIEW]: [
    EnginePermissions.MEMBERS_VIEW,
    EnginePermissions.MEMBERS_MANAGE,
    EnginePermissions.MEMBERS_LOOKUP,
    EnginePermissions.INSTANCE_VIEW,
  ],
  [EnginePermissions.MEMBERS_LOOKUP]: [
    EnginePermissions.MEMBERS_LOOKUP,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.MEMBERS_INVITE]: [
    EnginePermissions.MEMBERS_INVITE,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.MEMBERS_ADD]: [
    EnginePermissions.MEMBERS_ADD,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.MEMBERS_UPDATE_ROLE]: [
    EnginePermissions.MEMBERS_UPDATE_ROLE,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.MEMBERS_REMOVE]: [
    EnginePermissions.MEMBERS_REMOVE,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.INSTANCE_VIEW]: [
    EnginePermissions.INSTANCE_VIEW,
    EnginePermissions.ENGINE_EDIT,
    EnginePermissions.ENGINE_DELETE,
    EnginePermissions.MEMBERS_VIEW,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.SECRETS_VIEW]: [
    EnginePermissions.SECRETS_VIEW,
    EnginePermissions.SECRETS_MANAGE,
  ],
  [EnginePermissions.ENVIRONMENT_SET]: [
    EnginePermissions.ENVIRONMENT_SET,
    EnginePermissions.ENGINE_EDIT,
  ],
  [EnginePermissions.ENVIRONMENT_LOCK]: [
    EnginePermissions.ENVIRONMENT_LOCK,
    EnginePermissions.ENGINE_EDIT,
  ],
  [EnginePermissions.PROJECT_ACCESS_VIEW]: [
    EnginePermissions.PROJECT_ACCESS_VIEW,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.PROJECT_ACCESS_APPROVE]: [
    EnginePermissions.PROJECT_ACCESS_APPROVE,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.PROJECT_ACCESS_DENY]: [
    EnginePermissions.PROJECT_ACCESS_DENY,
    EnginePermissions.MEMBERS_MANAGE,
  ],
  [EnginePermissions.PROJECT_ACCESS_REVOKE]: [
    EnginePermissions.PROJECT_ACCESS_REVOKE,
    EnginePermissions.MEMBERS_MANAGE,
  ],
};

function compatiblePermissionCandidates(permission: Permission): Permission[] {
  return Array.from(new Set(CompatiblePermissionCandidates[permission] || [permission]));
}

/**
 * Project roles and their implicit permissions
 */
export const ProjectRolePermissions: Record<string, ProjectPermission[]> = {
  owner: [
    ProjectPermissions.PROJECT_DELETE,
    ProjectPermissions.PROJECT_SETTINGS,
    ProjectPermissions.MEMBERS_MANAGE,
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.MEMBERS_SEARCH,
    ProjectPermissions.MEMBERS_INVITE,
    ProjectPermissions.MEMBERS_ADD,
    ProjectPermissions.MEMBERS_UPDATE_ROLE,
    ProjectPermissions.MEMBERS_REMOVE,
    ProjectPermissions.MEMBERS_MANAGE_DEPLOY_GRANT,
    ProjectPermissions.DELEGATE_MANAGE,
    ProjectPermissions.OWNERSHIP_TRANSFER,
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
    ProjectPermissions.DEPLOYMENT_TARGETS_VIEW,
    ProjectPermissions.DEPLOYMENT_TARGETS_MANAGE,
  ],
  delegate: [
    ProjectPermissions.PROJECT_SETTINGS,
    ProjectPermissions.MEMBERS_MANAGE,
    ProjectPermissions.MEMBERS_VIEW,
    ProjectPermissions.MEMBERS_SEARCH,
    ProjectPermissions.MEMBERS_INVITE,
    ProjectPermissions.MEMBERS_ADD,
    ProjectPermissions.MEMBERS_UPDATE_ROLE,
    ProjectPermissions.MEMBERS_REMOVE,
    ProjectPermissions.MEMBERS_MANAGE_DEPLOY_GRANT,
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
    ProjectPermissions.DEPLOYMENT_TARGETS_VIEW,
    ProjectPermissions.DEPLOYMENT_TARGETS_MANAGE,
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
    EnginePermissions.SECRETS_VIEW,
    EnginePermissions.SECRETS_MANAGE,
    EnginePermissions.ENVIRONMENT_SET,
    EnginePermissions.ENVIRONMENT_LOCK,
    EnginePermissions.DELEGATE_MANAGE,
    EnginePermissions.OWNERSHIP_TRANSFER,
    EnginePermissions.MEMBERS_MANAGE,
    EnginePermissions.MEMBERS_VIEW,
    EnginePermissions.MEMBERS_LOOKUP,
    EnginePermissions.MEMBERS_INVITE,
    EnginePermissions.MEMBERS_ADD,
    EnginePermissions.MEMBERS_UPDATE_ROLE,
    EnginePermissions.MEMBERS_REMOVE,
    EnginePermissions.PROJECT_ACCESS_VIEW,
    EnginePermissions.PROJECT_ACCESS_APPROVE,
    EnginePermissions.PROJECT_ACCESS_DENY,
    EnginePermissions.PROJECT_ACCESS_REVOKE,
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
    EnginePermissions.SECRETS_VIEW,
    EnginePermissions.SECRETS_MANAGE,
    EnginePermissions.ENVIRONMENT_SET,
    EnginePermissions.ENVIRONMENT_LOCK,
    EnginePermissions.MEMBERS_MANAGE,
    EnginePermissions.MEMBERS_VIEW,
    EnginePermissions.MEMBERS_LOOKUP,
    EnginePermissions.MEMBERS_INVITE,
    EnginePermissions.MEMBERS_ADD,
    EnginePermissions.MEMBERS_UPDATE_ROLE,
    EnginePermissions.MEMBERS_REMOVE,
    EnginePermissions.PROJECT_ACCESS_VIEW,
    EnginePermissions.PROJECT_ACCESS_APPROVE,
    EnginePermissions.PROJECT_ACCESS_DENY,
    EnginePermissions.PROJECT_ACCESS_REVOKE,
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

export const SystemRoleDefinitions: SystemRoleDefinition[] = [
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
    key: SYSTEM_ROLE_IDS.PLATFORM_ADMIN,
    name: 'Platform Admin',
    description: 'Preserves current platform administrator behavior.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: PlatformRolePermissions.admin,
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_USER,
    key: SYSTEM_ROLE_IDS.PLATFORM_USER,
    name: 'Platform User',
    description: 'Preserves current default platform user behavior.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: PlatformRolePermissions.user,
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_DEVELOPER,
    key: SYSTEM_ROLE_IDS.PLATFORM_DEVELOPER,
    name: 'Platform Developer',
    description: 'Compatibility role for legacy platform developer users.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: false,
    permissions: PlatformRolePermissions.developer,
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_ACCESS_ADMIN,
    key: SYSTEM_ROLE_IDS.PLATFORM_ACCESS_ADMIN,
    name: 'Access Administrator',
    description: 'Manage authorization roles, assignments, policies, groups, and effective-access diagnostics without full platform administration.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [
      PlatformPermissions.AUTHZ_ROLES_VIEW,
      PlatformPermissions.AUTHZ_ROLES_MANAGE,
      PlatformPermissions.AUTHZ_CHECK,
      PlatformPermissions.AUDIT_VIEW,
    ],
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_ACCESS_AUDITOR,
    key: SYSTEM_ROLE_IDS.PLATFORM_ACCESS_AUDITOR,
    name: 'Access Auditor',
    description: 'Read authorization state, effective-access diagnostics, and audit data without mutations.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [
      PlatformPermissions.AUTHZ_ROLES_VIEW,
      PlatformPermissions.AUTHZ_CHECK,
      PlatformPermissions.AUDIT_VIEW,
    ],
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_USER_ADMIN,
    key: SYSTEM_ROLE_IDS.PLATFORM_USER_ADMIN,
    name: 'User Administrator',
    description: 'Manage users and account lifecycle without permanent-delete authority.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [
      PlatformPermissions.USER_VIEW,
      PlatformPermissions.USERS_VIEW,
      PlatformPermissions.USERS_CREATE,
      PlatformPermissions.USERS_UPDATE,
      PlatformPermissions.USERS_DEACTIVATE,
      PlatformPermissions.USERS_DELETE,
      PlatformPermissions.USERS_UNLOCK,
    ],
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_SSO_ADMIN,
    key: SYSTEM_ROLE_IDS.PLATFORM_SSO_ADMIN,
    name: 'SSO Administrator',
    description: 'Manage SSO assignment mappings and current SSO provider settings.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [
      PlatformPermissions.SSO_ASSIGNMENTS_VIEW,
      PlatformPermissions.SSO_ASSIGNMENTS_MANAGE,
      PlatformPermissions.SSO_PROVIDERS_VIEW,
      PlatformPermissions.SSO_PROVIDERS_MANAGE,
      PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_VIEW,
      PlatformPermissions.SSO_PLATFORM_ROLE_MAPPINGS_MANAGE,
    ],
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_ENGINE_REGISTRY_ADMIN,
    key: SYSTEM_ROLE_IDS.PLATFORM_ENGINE_REGISTRY_ADMIN,
    name: 'Engine Registry Administrator',
    description: 'Manage engine inventory registration, Engine Sets, and project-engine target registry state.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [
      PlatformPermissions.ENGINE_REGISTRATION_MANAGE,
      PlatformPermissions.ENGINE_SETS_VIEW,
      PlatformPermissions.ENGINE_SETS_MANAGE,
      PlatformPermissions.PROJECT_ENGINE_TARGETS_VIEW,
      PlatformPermissions.PROJECT_ENGINE_TARGETS_MANAGE,
      PlatformPermissions.ENGINE_CREATE,
      PlatformPermissions.ENGINE_DELETE,
    ],
  },
  {
    id: SYSTEM_ROLE_IDS.PLATFORM_API_CLIENT_ADMIN,
    key: SYSTEM_ROLE_IDS.PLATFORM_API_CLIENT_ADMIN,
    name: 'API Client Administrator',
    description: 'Manage API clients and service-account registry permissions through the current engine-registration administration surface.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [
      PlatformPermissions.API_CLIENTS_VIEW,
      PlatformPermissions.API_CLIENTS_MANAGE,
      PlatformPermissions.SERVICE_ACCOUNTS_VIEW,
      PlatformPermissions.SERVICE_ACCOUNTS_MANAGE,
    ],
  },
  {
    id: SYSTEM_ROLE_IDS.PROJECT_OWNER,
    key: SYSTEM_ROLE_IDS.PROJECT_OWNER,
    name: 'Project Owner',
    description: 'Full project access, including delete.',
    scope: 'project',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: ProjectRolePermissions.owner,
  },
  {
    id: SYSTEM_ROLE_IDS.PROJECT_DELEGATE,
    key: SYSTEM_ROLE_IDS.PROJECT_DELEGATE,
    name: 'Project Delegate',
    description: 'Project management access without implicit ownership transfer.',
    scope: 'project',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: ProjectRolePermissions.delegate,
  },
  {
    id: SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
    key: SYSTEM_ROLE_IDS.PROJECT_DEVELOPER,
    name: 'Project Developer',
    description: 'Project content, versioning, Git, and deploy access.',
    scope: 'project',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: ProjectRolePermissions.developer,
  },
  {
    id: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
    key: SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
    name: 'Project Deployer',
    description: 'Deployment-focused project access for humans or automation.',
    scope: 'project',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [ProjectPermissions.DEPLOY],
  },
  {
    id: SYSTEM_ROLE_IDS.PROJECT_EDITOR,
    key: SYSTEM_ROLE_IDS.PROJECT_EDITOR,
    name: 'Project Editor',
    description: 'Project content editing and version creation access.',
    scope: 'project',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: ProjectRolePermissions.editor,
  },
  {
    id: SYSTEM_ROLE_IDS.PROJECT_VIEWER,
    key: SYSTEM_ROLE_IDS.PROJECT_VIEWER,
    name: 'Project Viewer',
    description: 'Project read-only access.',
    scope: 'project',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: ProjectRolePermissions.viewer,
  },
  {
    id: SYSTEM_ROLE_IDS.ENGINE_OWNER,
    key: SYSTEM_ROLE_IDS.ENGINE_OWNER,
    name: 'Engine Owner',
    description: 'Full engine access, including delete.',
    scope: 'engine',
    kind: 'system',
    isEditable: false,
    isAssignable: false,
    permissions: EngineRolePermissions.owner,
  },
  {
    id: SYSTEM_ROLE_IDS.ENGINE_DELEGATE,
    key: SYSTEM_ROLE_IDS.ENGINE_DELEGATE,
    name: 'Engine Delegate',
    description: 'Engine management access without implicit ownership transfer.',
    scope: 'engine',
    kind: 'system',
    isEditable: false,
    isAssignable: false,
    permissions: EngineRolePermissions.delegate,
  },
  {
    id: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
    key: SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
    name: 'Engine Operator',
    description: 'Mission Control operation access.',
    scope: 'engine',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: EngineRolePermissions.operator,
  },
  {
    id: SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
    key: SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
    name: 'Engine Deployer',
    description: 'Deployment-focused engine access.',
    scope: 'engine',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: EngineRolePermissions.deployer,
  },
  {
    id: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
    key: SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
    name: 'API Engine Registrar',
    description: 'Machine role for API clients that register or update external engine inventory across all external systems.',
    scope: 'platform',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [PlatformPermissions.ENGINE_REGISTRATION_MANAGE],
  },
  {
    id: SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR,
    key: SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR,
    name: 'API External System Registrar',
    description: 'Machine role for API clients that register or update engine inventory for one external engine system.',
    scope: 'external_engine_system',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE],
  },
  {
    id: SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR,
    key: SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR,
    name: 'API Project Engine Target Registrar',
    description: 'Machine role for API clients that register or update project-engine deployment targets for one external engine system.',
    scope: 'external_engine_system',
    kind: 'system',
    isEditable: false,
    isAssignable: true,
    permissions: [ExternalEngineSystemPermissions.PROJECT_TARGETS_MANAGE],
  },
];

const MACHINE_PRINCIPAL_TYPES = new Set<PrincipalType>(['api_client', 'service_account']);
const MACHINE_ASSIGNABLE_SYSTEM_ROLE_IDS = new Set<string>([
  SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR,
  SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR,
  SYSTEM_ROLE_IDS.API_PROJECT_ENGINE_TARGET_REGISTRAR,
  SYSTEM_ROLE_IDS.PROJECT_DEPLOYER,
  SYSTEM_ROLE_IDS.ENGINE_OPERATOR,
  SYSTEM_ROLE_IDS.ENGINE_DEPLOYER,
]);
const MACHINE_ASSIGNABLE_CUSTOM_ROLE_PERMISSIONS: Partial<Record<RoleScope, Set<Permission>>> = {
  platform: new Set<Permission>([PlatformPermissions.ENGINE_REGISTRATION_MANAGE]),
  external_engine_system: new Set<Permission>([
    ExternalEngineSystemPermissions.ENGINE_REGISTRATION_MANAGE,
    ExternalEngineSystemPermissions.PROJECT_TARGETS_MANAGE,
  ]),
  project: new Set<Permission>([ProjectPermissions.DEPLOY]),
  engine: new Set<Permission>(EngineRolePermissions.operator),
};

// ============================================================================
// Permission Service
// ============================================================================

export interface PermissionContext {
  userId?: string;
  principalType?: PrincipalType;
  principalId?: string;
  tenantId?: string | null;
  platformRole?: string;
  projectRole?: string;
  engineRole?: string;
  resourceType?: ResourceType;
  resourceId?: string;
}

export interface GrantPermissionInput {
  tenantId?: string | null;
  userId: string;
  permission: Permission;
  resourceType?: ResourceType;
  resourceId?: string;
  grantedById: string;
  expiresAt?: number;
}

function slugifyRoleName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'role';
}

async function recordAuthzAudit(
  store: DataSource | EntityManager,
  entry: {
    tenantId?: string | null;
    userId?: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await store.getRepository(AuditLog).insert({
      id: generateId(),
      tenantId: normalizeTenantId(entry.tenantId),
      userId: entry.userId || null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ipAddress: null,
      userAgent: null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      createdAt: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to write authorization audit log:', error);
  }
}

class PermissionServiceClass {
  async getPermissionCatalog(): Promise<PermissionDefinition[]> {
    try {
      const dataSource = await getDataSource();
      const rows = await dataSource.getRepository(RbacPermission).find({
        order: { scope: 'ASC', category: 'ASC', key: 'ASC' },
      });
      const byKey = new Map<string, PermissionDefinition>(
        PermissionCatalog.map((permission) => [permission.key, permission])
      );

      for (const row of rows) {
        byKey.set(row.key, {
          key: row.key,
          scope: row.scope as ResourceType,
          category: row.category,
          label: row.label,
          description: row.description || '',
          kind: (row.kind === 'custom' ? 'custom' : 'system'),
          isEditable: Boolean(row.isEditable),
          isArchived: Boolean(row.isArchived),
          createdById: row.createdById,
          createdAt: Number(row.createdAt),
          updatedAt: Number(row.updatedAt),
        });
      }

      return Array.from(byKey.values())
        .filter((permission) => !permission.isArchived)
        .sort((left, right) =>
          left.scope.localeCompare(right.scope) ||
          left.category.localeCompare(right.category) ||
          left.key.localeCompare(right.key)
        );
    } catch (error) {
      logger.warn('Falling back to static permission catalog:', error);
      return PermissionCatalog;
    }
  }

  getSystemRoles(): SystemRoleDefinition[] {
    return SystemRoleDefinitions;
  }

  async seedRbacFoundation(dataSource: DataSource, now: number = Date.now()): Promise<void> {
    const permissionRepo = dataSource.getRepository(RbacPermission);
    const roleRepo = dataSource.getRepository(RbacRole);
    const rolePermissionRepo = dataSource.getRepository(RbacRolePermission);

    await permissionRepo.upsert(
      PermissionCatalog.map((permission) => ({
        id: permission.key,
        key: permission.key,
        scope: permission.scope,
        category: permission.category,
        label: permission.label,
        description: permission.description,
        kind: 'system',
        isEditable: false,
        isArchived: false,
        createdById: null,
        createdAt: now,
        updatedAt: now,
      })),
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true }
    );

    await roleRepo.upsert(
      SystemRoleDefinitions.map((role) => ({
        id: role.id,
        tenantId: null,
        key: role.key,
        roleKeyIdentity: canonicalRoleKeyIdentity(null, role.key),
        name: role.name,
        description: role.description,
        scope: role.scope,
        kind: role.kind,
        isEditable: role.isEditable,
        isAssignable: role.isAssignable,
        isArchived: false,
        source: 'system',
        sourceRef: 'rbac-foundation',
        createdById: null,
        createdAt: now,
        updatedAt: now,
      })),
      { conflictPaths: ['id'], skipUpdateIfNoValuesChanged: true }
    );

    const rolePermissionRows = SystemRoleDefinitions.flatMap((role) =>
      role.permissions.map((permission) => ({
        id: `${role.id}:${permission}`,
        roleId: role.id,
        permissionId: permission,
        createdAt: now,
      }))
    );

    if (rolePermissionRows.length > 0) {
      await rolePermissionRepo.upsert(rolePermissionRows, {
        conflictPaths: ['roleId', 'permissionId'],
        skipUpdateIfNoValuesChanged: true,
      });
    }
  }

  async syncLegacyRoleAssignments(
    options: SyncLegacyRoleAssignmentsOptions = {},
    providedDataSource?: DataSource
  ): Promise<SyncLegacyRoleAssignmentsResult> {
    const dataSource = providedDataSource || await getDataSource();
    const now = options.now ?? Date.now();
    const projectIds = Array.from(new Set((options.projectIds || []).map(String).filter(Boolean)));
    const engineIds = Array.from(new Set((options.engineIds || []).map(String).filter(Boolean)));
    const hasProjectScope = Array.isArray(options.projectIds);
    const hasEngineScope = Array.isArray(options.engineIds);
    const globalSync = !hasProjectScope && !hasEngineScope;
    const scanProjects = globalSync || hasProjectScope;
    const scanEngines = globalSync || hasEngineScope;

    type LegacyAssignmentTarget = Pick<
      RbacRoleAssignment,
      | 'id'
      | 'tenantId'
      | 'userId'
      | 'principalType'
      | 'principalId'
      | 'assignmentKey'
      | 'roleId'
      | 'resourceType'
      | 'resourceId'
      | 'scopeType'
      | 'scopeId'
      | 'source'
      | 'sourceMappingId'
      | 'sourceRef'
      | 'expiresAt'
      | 'lastSeenAt'
      | 'createdById'
      | 'createdAt'
      | 'updatedAt'
    >;

    const targets = new Map<string, LegacyAssignmentTarget>();
    const addTarget = (input: {
      tenantId?: string | null;
      userId?: string | null;
      roleId?: string;
      resourceType: ResourceType;
      resourceId: string;
      createdAt?: number | null;
      sourceKey: string;
    }): void => {
      if (!input.userId || !input.roleId) return;
      const id = `legacy:${input.resourceType}:${input.resourceId}:${input.userId}:${input.roleId}`;
      targets.set(id, {
        id,
        tenantId: input.tenantId ?? null,
        userId: String(input.userId),
        principalType: 'user',
        principalId: String(input.userId),
        assignmentKey: canonicalRoleAssignmentKey({
          tenantId: input.tenantId ?? null,
          principalType: 'user',
          principalId: String(input.userId),
          roleId: input.roleId,
          scopeType: input.resourceType,
          scopeId: input.resourceId,
          source: 'legacy',
          sourceRef: input.sourceKey,
        }),
        roleId: input.roleId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        scopeType: input.resourceType,
        scopeId: input.resourceId,
        source: 'legacy',
        sourceMappingId: input.sourceKey,
        sourceRef: input.sourceKey,
        expiresAt: null,
        lastSeenAt: now,
        createdById: null,
        createdAt: Number(input.createdAt || now),
        updatedAt: now,
      });
    };

    let scannedProjects = 0;
    let scannedEngines = 0;

    if (scanProjects) {
      const projectRepo = dataSource.getRepository(Project);
      const projectMemberRepo = dataSource.getRepository(ProjectMember);
      const projectMemberRoleRepo = dataSource.getRepository(ProjectMemberRole);
      const projects = hasProjectScope && projectIds.length === 0
        ? []
        : await projectRepo.find({
          where: hasProjectScope ? { id: In(projectIds) } : undefined,
          select: ['id', 'ownerId', 'tenantId', 'createdAt', 'updatedAt'],
        });
      scannedProjects = projects.length;
      const projectTenantById = new Map(projects.map((project) => [String(project.id), project.tenantId ?? null]));
      const existingProjectIds = projects.map((project) => String(project.id));

      for (const project of projects) {
        addTarget({
          tenantId: project.tenantId,
          userId: project.ownerId,
          roleId: SYSTEM_ROLE_IDS.PROJECT_OWNER,
          resourceType: 'project',
          resourceId: String(project.id),
          createdAt: project.createdAt,
          sourceKey: `project:${project.id}:owner`,
        });
      }

      const projectScopeWhere = hasProjectScope ? { projectId: In(existingProjectIds) } : undefined;
      const [memberships, roleRows] = existingProjectIds.length === 0 && hasProjectScope
        ? [[], []] as [ProjectMember[], ProjectMemberRole[]]
        : await Promise.all([
          projectMemberRepo.find({ where: projectScopeWhere }),
          projectMemberRoleRepo.find({ where: projectScopeWhere }),
        ]);

      for (const membership of memberships) {
        const projectId = String(membership.projectId);
        addTarget({
          tenantId: projectTenantById.get(projectId) ?? null,
          userId: membership.userId,
          roleId: LEGACY_PROJECT_ROLE_TO_SYSTEM_ROLE[membership.role],
          resourceType: 'project',
          resourceId: projectId,
          createdAt: membership.createdAt || membership.joinedAt,
          sourceKey: `project_member:${projectId}:${membership.userId}:${membership.role}`,
        });
      }

      for (const roleRow of roleRows) {
        const projectId = String(roleRow.projectId);
        addTarget({
          tenantId: projectTenantById.get(projectId) ?? null,
          userId: roleRow.userId,
          roleId: LEGACY_PROJECT_ROLE_TO_SYSTEM_ROLE[roleRow.role],
          resourceType: 'project',
          resourceId: projectId,
          createdAt: roleRow.createdAt,
          sourceKey: `project_member_role:${projectId}:${roleRow.userId}:${roleRow.role}`,
        });
      }
    }

    if (scanEngines) {
      const engineRepo = dataSource.getRepository(Engine);
      const engineMemberRepo = dataSource.getRepository(EngineMember);
      const engines = hasEngineScope && engineIds.length === 0
        ? []
        : await engineRepo.find({
          where: hasEngineScope ? { id: In(engineIds) } : undefined,
          select: ['id', 'ownerId', 'delegateId', 'tenantId', 'createdAt', 'updatedAt'],
        });
      scannedEngines = engines.length;
      const engineTenantById = new Map(engines.map((engine) => [String(engine.id), engine.tenantId ?? null]));
      const existingEngineIds = engines.map((engine) => String(engine.id));

      for (const engine of engines) {
        addTarget({
          tenantId: engine.tenantId,
          userId: engine.ownerId,
          roleId: SYSTEM_ROLE_IDS.ENGINE_OWNER,
          resourceType: 'engine',
          resourceId: String(engine.id),
          createdAt: engine.createdAt,
          sourceKey: `engine:${engine.id}:owner`,
        });
        addTarget({
          tenantId: engine.tenantId,
          userId: engine.delegateId,
          roleId: SYSTEM_ROLE_IDS.ENGINE_DELEGATE,
          resourceType: 'engine',
          resourceId: String(engine.id),
          createdAt: engine.updatedAt || engine.createdAt,
          sourceKey: `engine:${engine.id}:delegate`,
        });
      }

      const memberWhere = hasEngineScope ? { engineId: In(existingEngineIds) } : undefined;
      const memberships = existingEngineIds.length === 0 && hasEngineScope
        ? []
        : await engineMemberRepo.find({ where: memberWhere });

      for (const membership of memberships) {
        const engineId = String(membership.engineId);
        addTarget({
          tenantId: engineTenantById.get(engineId) ?? null,
          userId: membership.userId,
          roleId: LEGACY_ENGINE_ROLE_TO_SYSTEM_ROLE[membership.role],
          resourceType: 'engine',
          resourceId: engineId,
          createdAt: membership.createdAt,
          sourceKey: `engine_member:${engineId}:${membership.userId}:${membership.role}`,
        });
      }
    }

    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
    const scopedExistingWhere = [
      ...(scanProjects && hasProjectScope && projectIds.length > 0
        ? [{ source: 'legacy', resourceType: 'project', resourceId: In(projectIds) }]
        : []),
      ...(scanEngines && hasEngineScope && engineIds.length > 0
        ? [{ source: 'legacy', resourceType: 'engine', resourceId: In(engineIds) }]
        : []),
    ];
    const existing = globalSync
      ? await assignmentRepo.find({ where: { source: 'legacy' } })
      : (scopedExistingWhere.length > 0 ? await assignmentRepo.find({ where: scopedExistingWhere }) : []);
    const targetIds = new Set(targets.keys());
    const staleIds = existing
      .filter((assignment) => !targetIds.has(assignment.id))
      .map((assignment) => assignment.id);

    if (staleIds.length > 0) {
      await assignmentRepo.delete({ id: In(staleIds) });
    }

    const rows = Array.from(targets.values());
    if (rows.length > 0) {
      await assignmentRepo.upsert(rows, {
        conflictPaths: ['id'],
        skipUpdateIfNoValuesChanged: true,
      });
    }

    return {
      scannedProjects,
      scannedEngines,
      upserted: rows.length,
      removed: staleIds.length,
    };
  }

  async getRoles(tenantId?: string | null): Promise<RoleSummary[]> {
    const dataSource = await getDataSource();
    const roleRepo = dataSource.getRepository(RbacRole);
    const rolePermissionRepo = dataSource.getRepository(RbacRolePermission);
    const normalizedTenantId = normalizeTenantId(tenantId);
    const roles = await roleRepo.find({
      where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : undefined,
      order: { scope: 'ASC', name: 'ASC' },
    });
    const rolePermissions = await rolePermissionRepo.find();
    const counts = new Map<string, number>();

    for (const rolePermission of rolePermissions) {
      counts.set(rolePermission.roleId, (counts.get(rolePermission.roleId) || 0) + 1);
    }

    return roles.map((role) => ({
      id: role.id,
      tenantId: role.tenantId,
      key: role.key,
      name: role.name,
      description: role.description,
      scope: role.scope as RoleScope,
      kind: role.kind as RoleKind,
      isEditable: role.isEditable,
      isAssignable: role.isAssignable,
      isArchived: role.isArchived,
      source: (role.source || (role.kind === 'system' ? 'system' : 'manual')) as RoleSource,
      sourceRef: role.sourceRef || null,
      permissionCount: counts.get(role.id) || 0,
      createdAt: Number(role.createdAt),
      updatedAt: Number(role.updatedAt),
    }));
  }

  async getRole(id: string, tenantId?: string | null): Promise<RoleDetail | null> {
    const dataSource = await getDataSource();
    const role = await dataSource.getRepository(RbacRole).findOne({ where: { id } });
    if (!role) return null;
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (normalizedTenantId && role.tenantId && role.tenantId !== normalizedTenantId) {
      return null;
    }

    const permissions = await dataSource.getRepository(RbacRolePermission).find({
      where: { roleId: id },
      order: { permissionId: 'ASC' },
    });

    return {
      id: role.id,
      tenantId: role.tenantId,
      key: role.key,
      name: role.name,
      description: role.description,
      scope: role.scope as RoleScope,
      kind: role.kind as RoleKind,
      isEditable: role.isEditable,
      isAssignable: role.isAssignable,
      isArchived: role.isArchived,
      source: (role.source || (role.kind === 'system' ? 'system' : 'manual')) as RoleSource,
      sourceRef: role.sourceRef || null,
      permissionCount: permissions.length,
      permissions: permissions.map((permission) => permission.permissionId as Permission),
      createdAt: Number(role.createdAt),
      updatedAt: Number(role.updatedAt),
    };
  }

  async createCustomRole(input: CreateCustomRoleInput): Promise<{ id: string }> {
    assertCustomRoleAllowOnlyInput(input);
    const dataSource = await getDataSource();
    const id = generateId();
    const now = Date.now();
    const permissionIds = await this.validateRolePermissions(input.scope, input.permissionIds);
    const name = input.name.trim();
    const source = normalizeRoleSource(input.source);
    const sourceRef = input.sourceRef?.trim() || null;

    if (!name) {
      throw new Error('Role name is required');
    }
    if (source === 'config' && !sourceRef) {
      throw new Error('Config-managed roles require a source reference');
    }
    const key = normalizeCustomRoleKey(input.key, input.scope, name, id);
    const tenantId = normalizeTenantId(input.tenantId);

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(RbacRole).insert({
        id,
        tenantId,
        key,
        roleKeyIdentity: canonicalRoleKeyIdentity(tenantId, key),
        name,
        description: input.description?.trim() || null,
        scope: input.scope,
        kind: 'custom',
        isEditable: true,
        isAssignable: true,
        isArchived: false,
        source,
        sourceRef,
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      });

      await this.replaceRolePermissions(manager, id, permissionIds, now);
      await recordAuthzAudit(manager, {
        tenantId: input.tenantId,
        userId: input.createdById,
        action: 'authz.role.create',
        resourceType: 'role',
        resourceId: id,
        details: {
          roleId: id,
          tenantId: normalizeTenantId(input.tenantId),
          name,
          key,
          scope: input.scope,
          kind: 'custom',
          source,
          sourceRef,
          permissionIds,
        },
      });
    });

    return { id };
  }

  async createCustomPermission(input: CreateCustomPermissionInput): Promise<{ id: string; key: string }> {
    const dataSource = await getDataSource();
    const now = Date.now();
    const key = input.key.trim().toLowerCase();
    const category = input.category.trim();
    const label = input.label.trim();
    const description = input.description?.trim() || null;

    this.validateCustomPermissionKey(input.scope, key);
    if (!category) {
      throw new Error('Permission category is required');
    }
    if (!label) {
      throw new Error('Permission label is required');
    }

    const permissionRepo = dataSource.getRepository(RbacPermission);
    const existing = await permissionRepo.findOne({ where: { key } });
    if (existing) {
      throw new Error('Permission key already exists');
    }

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(RbacPermission).insert({
        id: key,
        key,
        scope: input.scope,
        category,
        label,
        description,
        kind: 'custom',
        isEditable: true,
        isArchived: false,
        createdById: input.createdById,
        createdAt: now,
        updatedAt: now,
      });

      await recordAuthzAudit(manager, {
        tenantId: input.tenantId,
        userId: input.createdById,
        action: 'authz.permission.create',
        resourceType: 'permission',
        resourceId: key,
        details: {
          key,
          scope: input.scope,
          category,
          label,
          kind: 'custom',
        },
      });
    });

    return { id: key, key };
  }

  async updateCustomRole(id: string, input: UpdateCustomRoleInput): Promise<void> {
    assertCustomRoleAllowOnlyInput(input);
    const dataSource = await getDataSource();
    const roleRepo = dataSource.getRepository(RbacRole);
    const role = await roleRepo.findOne({ where: { id } });
    if (!role) {
      throw new Error('Role not found');
    }
    if (role.kind !== 'custom' || !role.isEditable) {
      throw new Error('System roles cannot be edited');
    }
    if (role.source === 'config') {
      throw new Error('Config-managed roles must be updated through their configuration bundle');
    }
    const normalizedTenantId = normalizeTenantId(input.tenantId);
    if (normalizedTenantId && role.tenantId && role.tenantId !== normalizedTenantId) {
      throw new Error('Role not found');
    }

    const now = Date.now();
    const updates: Partial<RbacRole> = { updatedAt: now };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) {
        throw new Error('Role name is required');
      }
      updates.name = name;
    }
    if (input.description !== undefined) {
      updates.description = input.description?.trim() || null;
    }
    if (input.isArchived !== undefined) {
      updates.isArchived = input.isArchived;
      updates.isAssignable = !input.isArchived;
    }
    const permissionIds = input.permissionIds !== undefined
      ? await this.validateRolePermissions(role.scope as RoleScope, input.permissionIds)
      : undefined;

    await dataSource.transaction(async (manager) => {
      await manager.getRepository(RbacRole).update(id, updates);
      if (permissionIds) {
        await this.replaceRolePermissions(manager, id, permissionIds, now);
      }
      await recordAuthzAudit(manager, {
        tenantId: input.tenantId ?? role.tenantId,
        userId: input.updatedById || null,
        action: input.isArchived && !role.isArchived ? 'authz.role.archive' : 'authz.role.update',
        resourceType: 'role',
        resourceId: id,
        details: {
          roleId: id,
          previousName: role.name,
          scope: role.scope,
          changedFields: Object.keys(updates).filter((key) => key !== 'updatedAt'),
          permissionIds: permissionIds || undefined,
        },
      });
    });
  }

  async archiveCustomRole(id: string, archivedById?: string): Promise<void> {
    await this.updateCustomRole(id, { isArchived: true, updatedById: archivedById });
  }

  async listRoleAssignments(filters: RoleAssignmentFilters = {}): Promise<RoleAssignmentView[]> {
    const dataSource = await getDataSource();
    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
    const qb = assignmentRepo.createQueryBuilder('assignment')
      .orderBy('assignment.createdAt', 'DESC');

    addTenantScopeFilter(qb, 'assignment', filters.tenantId);
    if (filters.userId) {
      qb.andWhere('assignment.userId = :userId', { userId: filters.userId });
    }
    if (filters.principalType) {
      qb.andWhere('assignment.principalType = :principalType', { principalType: filters.principalType });
    }
    if (filters.principalId) {
      qb.andWhere('assignment.principalId = :principalId', { principalId: filters.principalId });
    }
    if (filters.resourceType) {
      qb.andWhere('assignment.resourceType = :resourceType', { resourceType: filters.resourceType });
    }
    if (filters.resourceId !== undefined) {
      if (filters.resourceId) {
        qb.andWhere('assignment.resourceId = :resourceId', { resourceId: filters.resourceId });
      } else {
        qb.andWhere('assignment.resourceId IS NULL');
      }
    }
    if (filters.scopeType) {
      qb.andWhere('assignment.scopeType = :scopeType', { scopeType: filters.scopeType });
    }
    if (filters.scopeId !== undefined) {
      if (filters.scopeId) {
        qb.andWhere('assignment.scopeId = :scopeId', { scopeId: filters.scopeId });
      } else {
        qb.andWhere('assignment.scopeId IS NULL');
      }
    }

    const assignments = await qb.getMany();
    const roleIds = Array.from(new Set(assignments.map((assignment) => assignment.roleId)));
    const roles = roleIds.length > 0
      ? await dataSource.getRepository(RbacRole).find({ where: { id: In(roleIds) } })
      : [];
    const rolesById = new Map(roles.map((role) => [role.id, role]));

    return assignments.map((assignment) => {
      const role = rolesById.get(assignment.roleId);
      return {
        id: assignment.id,
        tenantId: assignment.tenantId,
        userId: assignment.principalType === 'user' ? assignment.principalId : null,
        principalType: assignment.principalType as PrincipalType,
        principalId: assignment.principalId!,
        roleId: assignment.roleId,
        roleKey: role?.key || null,
        roleName: role?.name || null,
        roleScope: role ? role.scope as RoleScope : null,
        resourceType: assignment.scopeType as ResourceType | null,
        resourceId: assignment.scopeId,
        scopeType: assignment.scopeType as ResourceType | null,
        scopeId: assignment.scopeId,
        source: assignment.source as RoleAssignmentSource,
        sourceMappingId: assignment.sourceRef || null,
        sourceRef: assignment.sourceRef,
        expiresAt: assignment.expiresAt,
        lastSeenAt: assignment.lastSeenAt,
        createdById: assignment.createdById,
        createdAt: Number(assignment.createdAt),
        updatedAt: Number(assignment.updatedAt),
      };
    });
  }

  async assignRole(input: CreateRoleAssignmentInput): Promise<{ id: string; warnings: string[] }> {
    const dataSource = await getDataSource();
    const role = await dataSource.getRepository(RbacRole).findOne({ where: { id: input.roleId } });
    if (!role) {
      throw new Error('Role not found');
    }
    if (role.isArchived || !role.isAssignable) {
      throw new Error('Role is not assignable');
    }
    const normalizedTenantId = normalizeTenantId(input.tenantId);
    if (normalizedTenantId && role.tenantId && role.tenantId !== normalizedTenantId) {
      throw new Error('Role is not assignable in this tenant');
    }

    const principal = this.normalizeAssignmentPrincipal(input);
    if (principal.principalType === 'user') {
      const user = await dataSource.getRepository(User).findOne({
        where: { id: principal.principalId },
        select: ['id'],
      });
      if (!user) {
        throw new Error('User not found');
      }
    }
    await this.assertAssignablePrincipalExists(dataSource, principal);
    await this.assertMachinePrincipalCanReceiveRole(dataSource, principal, role);

    const scope = role.scope as RoleScope;
    const requestedScopeType = input.scopeType ?? input.resourceType;
    const requestedScopeId = input.scopeId !== undefined ? input.scopeId : input.resourceId;
    const { resourceType, resourceId, scopeType, scopeId } = this.normalizeAssignmentScope(scope, requestedScopeType, requestedScopeId);
    await this.assertResourceExists(dataSource, scopeType, scopeId, normalizedTenantId);
    await this.assertRuntimeScopeEnabled(dataSource, scopeType, scopeId, normalizedTenantId);
    const source = input.source ?? 'manual';
    const sourceRef = input.sourceRef ?? input.sourceMappingId ?? null;
    const assignmentKey = canonicalRoleAssignmentKey({
      tenantId: normalizedTenantId,
      principalType: principal.principalType,
      principalId: principal.principalId,
      roleId: input.roleId,
      scopeType,
      scopeId,
      source,
      sourceRef,
    });

    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
    const duplicateQb = assignmentRepo.createQueryBuilder('assignment')
      .where('assignment.assignmentKey = :assignmentKey', { assignmentKey });

    const existing = await duplicateQb.getOne();
    if (existing) {
      return { id: existing.id, warnings: await this.getRuntimeAssignmentWarnings(dataSource, principal, role, scopeType, scopeId, normalizedTenantId) };
    }

    const id = generateId();
    const now = Date.now();
    await assignmentRepo.insert({
      id,
      tenantId: normalizedTenantId,
      userId: null,
      principalType: principal.principalType,
      principalId: principal.principalId,
      assignmentKey,
      roleId: input.roleId,
      resourceType: null,
      resourceId: null,
      scopeType,
      scopeId,
      source,
      sourceMappingId: null,
      sourceRef,
      expiresAt: input.expiresAt ?? null,
      lastSeenAt: null,
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    });
    await recordAuthzAudit(dataSource, {
      tenantId: normalizedTenantId,
      userId: input.createdById,
      action: 'authz.role_assignment.create',
      resourceType: 'role_assignment',
      resourceId: id,
      details: {
        assignmentId: id,
        tenantId: normalizedTenantId,
        assignedUserId: principal.principalType === 'user' ? principal.principalId : null,
        principalType: principal.principalType,
        principalId: principal.principalId,
        roleId: input.roleId,
        scopeType,
        scopeId,
        resourceType: scopeType,
        resourceId: scopeId,
        source,
        sourceRef,
      },
    });

    return { id, warnings: await this.getRuntimeAssignmentWarnings(dataSource, principal, role, scopeType, scopeId, normalizedTenantId) };
  }

  private async getRuntimeAssignmentWarnings(
    dataSource: DataSource,
    principal: { principalType: PrincipalType; principalId: string },
    role: RbacRole,
    scopeType: ResourceType,
    scopeId: string | null,
    tenantId?: string | null,
  ): Promise<string[]> {
    if (scopeType !== 'engine_runtime_resource' && scopeType !== 'engine_runtime_resource_set') return [];
    const engineId = await this.resolveRuntimeScopeEngineId(dataSource, scopeType, scopeId, tenantId);
    if (!engineId) return [];

    const rolePermissions = await dataSource.getRepository(RbacRolePermission).find({ where: { roleId: role.id }, select: ['permissionId'] });
    const requestedPermissions = new Set(rolePermissions.map((permission) => permission.permissionId));
    if (requestedPermissions.size === 0) return [];

    const principalRefs = [{ principalType: principal.principalType, principalId: principal.principalId }];
    if (principal.principalType === 'user') {
      const groupIds = await this.getUserGroupIdsForEvaluation(dataSource, principal.principalId, tenantId);
      principalRefs.push(...groupIds.map((principalId) => ({ principalType: 'group' as const, principalId })));
    }
    const candidateAssignments = await dataSource.getRepository(RbacRoleAssignment).find({
      where: principalRefs,
      select: ['roleId', 'scopeType', 'scopeId', 'expiresAt', 'source'],
    });
    const activeAssignments = candidateAssignments
      .filter((assignment) => assignment.source !== 'legacy' && (!assignment.expiresAt || assignment.expiresAt > Date.now()));
    const directEngineRoleIds = activeAssignments
      .filter((assignment) => assignment.scopeType === 'engine' && assignment.scopeId === engineId)
      .map((assignment) => assignment.roleId);
    const engineSetIds = activeAssignments
      .filter((assignment) => assignment.scopeType === 'engine_set' && assignment.scopeId)
      .map((assignment) => assignment.scopeId!);
    const matchingEngineSetIds = engineSetIds.length > 0
      ? new Set((await dataSource.getRepository(EngineSetMaterialization).find({ where: { engineSetId: In(engineSetIds), engineId }, select: ['engineSetId'] })).map((row) => row.engineSetId))
      : new Set<string>();
    const engineSetRoleIds = activeAssignments
      .filter((assignment) => assignment.scopeType === 'engine_set' && assignment.scopeId && matchingEngineSetIds.has(assignment.scopeId))
      .map((assignment) => assignment.roleId);
    const activeRoleIds = Array.from(new Set([...directEngineRoleIds, ...engineSetRoleIds]));
    if (activeRoleIds.length === 0) return [];

    const broadPermissions = await dataSource.getRepository(RbacRolePermission).find({ where: { roleId: In(activeRoleIds) }, select: ['permissionId'] });
    const overlap = Array.from(new Set(broadPermissions.map((permission) => permission.permissionId).filter((permission) => requestedPermissions.has(permission))));
    return overlap.length > 0
      ? [`A direct engine-wide assignment already grants: ${overlap.join(', ')}. This runtime-scoped assignment remains additive but does not narrow those permissions.`]
      : [];
  }

  private async resolveRuntimeScopeEngineId(
    dataSource: DataSource,
    scopeType: ResourceType,
    scopeId: string | null,
    tenantId?: string | null,
  ): Promise<string | null> {
    if (scopeType === 'engine_runtime_resource') {
      const resource = await dataSource.getRepository(RuntimeResource).findOne({ where: tenantScopedWhere({ id: scopeId || '', isActive: true }, tenantId), select: ['engineId'] });
      return resource?.engineId || null;
    }
    if (scopeType === 'engine_runtime_resource_set') {
      const set = await dataSource.getRepository(RuntimeResourceSet).findOne({ where: tenantScopedWhere({ id: scopeId || '', isArchived: false }, tenantId), select: ['engineId'] });
      return set?.engineId || null;
    }
    return null;
  }

  async removeRoleAssignment(id: string, removedById?: string): Promise<void> {
    const dataSource = await getDataSource();
    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
    const assignment = await assignmentRepo.findOne({ where: { id } });
    if (!assignment) {
      throw new Error('Role assignment not found');
    }
    if (assignment.source !== 'manual') {
      throw new Error('Only manual role assignments can be removed here');
    }

    await assignmentRepo.delete({ id });
    await recordAuthzAudit(dataSource, {
      tenantId: assignment.tenantId,
      userId: removedById || null,
      action: 'authz.role_assignment.delete',
      resourceType: 'role_assignment',
      resourceId: id,
      details: {
        assignmentId: id,
        tenantId: assignment.tenantId,
        assignedUserId: assignment.principalType === 'user' ? assignment.principalId : null,
        roleId: assignment.roleId,
        resourceType: assignment.scopeType,
        resourceId: assignment.scopeId,
        source: assignment.source,
      },
    });
  }

  private async validateRolePermissions(scope: RoleScope, permissionIds: Permission[]): Promise<Permission[]> {
    const catalogByKey = new Map((await this.getPermissionCatalog()).map((permission) => [permission.key, permission]));
    const uniquePermissionIds = Array.from(new Set(permissionIds));

    if (uniquePermissionIds.length === 0) {
      throw new Error('At least one permission is required');
    }

    for (const permissionId of uniquePermissionIds) {
      const permission = catalogByKey.get(permissionId);
      if (!permission) {
        throw new Error(`Unknown permission: ${permissionId}`);
      }
      if (permission.isArchived) {
        throw new Error(`Permission ${permissionId} is archived`);
      }
      if (permission.scope !== scope) {
        throw new Error(`Permission ${permissionId} does not match ${scope} role scope`);
      }
    }

    return uniquePermissionIds;
  }

  private validateCustomPermissionKey(scope: ResourceType, key: string): void {
    if (!/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*){2,}$/.test(key)) {
      throw new Error('Permission key must use lowercase colon-separated segments');
    }
    if (!key.startsWith(`${scope}:custom:`)) {
      throw new Error(`Custom ${scope} permissions must start with ${scope}:custom:`);
    }
    if (PermissionCatalog.some((permission) => permission.key === key)) {
      throw new Error('Permission key is reserved by the system catalog');
    }
  }

  private async replaceRolePermissions(
    manager: EntityManager,
    roleId: string,
    permissionIds: Permission[],
    now: number
  ): Promise<void> {
    const rolePermissionRepo = manager.getRepository(RbacRolePermission);
    await rolePermissionRepo.delete({ roleId });
    await rolePermissionRepo.insert(permissionIds.map((permissionId) => ({
      id: `${roleId}:${permissionId}`,
      roleId,
      permissionId,
      createdAt: now,
    })));
  }

  private normalizeAssignmentPrincipal(input: {
    userId?: string;
    principalType?: PrincipalType;
    principalId?: string;
  }): { principalType: PrincipalType; principalId: string; legacyUserId: string } {
    const principalType = input.principalType ?? 'user';
    const principalId = input.principalId ?? input.userId;
    if (!principalId) {
      throw new Error('Role assignments require a principalId');
    }
    if (principalType === 'user' && input.userId && input.userId !== principalId) {
      throw new Error('userId must match principalId for user role assignments');
    }

    return {
      principalType,
      principalId,
      legacyUserId: principalType === 'user' ? principalId : principalId,
    };
  }

  private async assertAssignablePrincipalExists(
    dataSource: DataSource,
    principal: { principalType: PrincipalType; principalId: string }
  ): Promise<void> {
    if (principal.principalType === 'api_client') {
      const client = await dataSource.getRepository(ApiClient).findOne({
        where: { id: principal.principalId },
        select: ['id', 'isActive'],
      });
      if (!client || !client.isActive) {
        throw new Error('API client not found or inactive');
      }
      return;
    }

    if (principal.principalType === 'group') {
      const group = await dataSource.getRepository(AuthzGroup).findOne({
        where: { id: principal.principalId },
        select: ['id', 'isArchived'],
      });
      if (!group || group.isArchived) {
        throw new Error('Group not found or archived');
      }
      return;
    }

    if (principal.principalType === 'service_account') {
      const account = await dataSource.getRepository(ServiceAccount).findOne({
        where: { id: principal.principalId },
        select: ['id', 'isActive'],
      });
      if (!account || !account.isActive) {
        throw new Error('Service account not found or inactive');
      }
      return;
    }
  }

  private async assertMachinePrincipalCanReceiveRole(
    dataSource: DataSource,
    principal: { principalType: PrincipalType; principalId: string },
    role: RbacRole
  ): Promise<void> {
    if (!MACHINE_PRINCIPAL_TYPES.has(principal.principalType)) {
      return;
    }

    if (role.kind === 'system') {
      if (MACHINE_ASSIGNABLE_SYSTEM_ROLE_IDS.has(role.id)) {
        if (role.id === SYSTEM_ROLE_IDS.API_ENGINE_REGISTRAR && principal.principalType !== 'api_client') {
          throw new Error('Role is assignable only to API client principals');
        }
        if (role.id === SYSTEM_ROLE_IDS.API_EXTERNAL_ENGINE_SYSTEM_REGISTRAR && principal.principalType !== 'api_client') {
          throw new Error('Role is assignable only to API client principals');
        }
        return;
      }
      throw new Error('Role is not assignable to machine principals');
    }

    if (role.kind !== 'custom') {
      throw new Error('Role is not assignable to machine principals');
    }

    const roleScope = role.scope as RoleScope;
    if (roleScope === 'platform' && principal.principalType !== 'api_client') {
      throw new Error('Platform machine roles are assignable only to API client principals');
    }
    const allowedPermissions = MACHINE_ASSIGNABLE_CUSTOM_ROLE_PERMISSIONS[roleScope];
    if (!allowedPermissions) {
      throw new Error('Role is not assignable to machine principals');
    }

    const rolePermissions = await dataSource.getRepository(RbacRolePermission).find({
      where: { roleId: role.id },
      select: ['permissionId'],
    });
    const unsafePermissions = rolePermissions
      .map((permission) => permission.permissionId)
      .filter((permission) => !allowedPermissions.has(permission));
    if (unsafePermissions.length > 0) {
      throw new Error(`Role is not assignable to machine principals; unsafe permissions: ${unsafePermissions.join(', ')}`);
    }
  }

  private normalizeAssignmentScope(
    roleScope: RoleScope,
    requestedResourceType?: ResourceType,
    requestedResourceId?: string | null
  ): { resourceType: ResourceType; resourceId: string | null; scopeType: ResourceType; scopeId: string | null } {
    const scopeType = requestedResourceType || roleScope;
    const engineScopeTarget = scopeType === 'engine_set' || scopeType === 'engine_runtime_resource' || scopeType === 'engine_runtime_resource_set';
    if (scopeType !== roleScope && !(roleScope === 'engine' && engineScopeTarget)) {
      throw new Error(`Role scope ${roleScope} cannot be assigned to ${scopeType}`);
    }

    if (roleScope === 'platform') {
      return { resourceType: 'platform', resourceId: null, scopeType: 'platform', scopeId: null };
    }

    if (!requestedResourceId) {
      throw new Error(`${scopeType} role assignments require a resource ID`);
    }

    if (roleScope === 'engine' && engineScopeTarget) {
      return { resourceType: 'engine', resourceId: null, scopeType, scopeId: requestedResourceId };
    }

    return { resourceType: roleScope, resourceId: requestedResourceId, scopeType, scopeId: requestedResourceId };
  }

  private async assertResourceExists(dataSource: DataSource, resourceType: ResourceType, resourceId: string | null, tenantId?: string | null): Promise<void> {
    if (resourceType === 'platform') return;

    if (resourceType === 'project') {
      const project = await dataSource.getRepository(Project).findOne({
        where: { id: resourceId || '' },
        select: ['id'],
      });
      if (!project) {
        throw new Error('Project not found');
      }
      return;
    }

    if (resourceType === 'engine') {
      const engine = await dataSource.getRepository(Engine).findOne({
        where: { id: resourceId || '' },
        select: ['id'],
      });
      if (!engine) {
        throw new Error('Engine not found');
      }
      return;
    }

    if (resourceType === 'engine_set') {
      const engineSet = await dataSource.getRepository(EngineSet).findOne({
        where: { id: resourceId || '' },
        select: ['id'],
      });
      if (!engineSet) {
        throw new Error('Engine Set not found');
      }
      return;
    }

    if (resourceType === 'engine_runtime_resource') {
      const runtimeResource = await dataSource.getRepository(RuntimeResource).findOne({
        where: tenantScopedWhere({ id: resourceId || '', isActive: true }, tenantId),
        select: ['id'],
      });
      if (!runtimeResource) throw new Error('Runtime resource not found or inactive');
      return;
    }

    if (resourceType === 'engine_runtime_resource_set') {
      const runtimeResourceSet = await dataSource.getRepository(RuntimeResourceSet).findOne({
        where: tenantScopedWhere({ id: resourceId || '', isArchived: false }, tenantId),
        select: ['id'],
      });
      if (!runtimeResourceSet) throw new Error('Runtime Resource Set not found or archived');
      return;
    }

    if (resourceType === 'external_engine_system') {
      const externalSystem = await dataSource.getRepository(ExternalEngineSystem).findOne({
        where: tenantScopedWhere({ id: resourceId || '' }, tenantId),
        select: ['id', 'isActive'],
      });
      if (!externalSystem || !externalSystem.isActive) {
        throw new Error('External engine system not found or inactive');
      }
      return;
    }

    if (!resourceId) {
      throw new Error(`${resourceType} role assignments require a resource ID`);
    }
  }

  private async assertRuntimeScopeEnabled(
    dataSource: DataSource,
    scopeType: ResourceType,
    scopeId: string | null,
    tenantId?: string | null,
  ): Promise<void> {
    if (scopeType !== 'engine_runtime_resource' && scopeType !== 'engine_runtime_resource_set') return;

    const runtimeScope = scopeType === 'engine_runtime_resource'
      ? await dataSource.getRepository(RuntimeResource).findOne({
        where: tenantScopedWhere({ id: scopeId || '', isActive: true }, tenantId),
        select: ['engineId'],
      })
      : await dataSource.getRepository(RuntimeResourceSet).findOne({
        where: tenantScopedWhere({ id: scopeId || '', isArchived: false }, tenantId),
        select: ['engineId'],
      });
    if (!runtimeScope) throw new Error('Runtime resource scope not found');

    const engine = await dataSource.getRepository(Engine).findOne({
      where: { id: runtimeScope.engineId },
      select: ['id', 'runtimeAccessScope'],
    });
    if (!engine) throw new Error('Runtime resource engine not found');
    if (engine.runtimeAccessScope !== 'resource_aware') {
      throw new Error('Runtime resource assignments require an engine with resource-aware runtime access');
    }
  }

  /**
   * Check if user has a specific permission.
   *
   * Resolution order:
   * 1. Check legacy role fields and memberships
   * 2. Check scoped RBAC role assignments
   * 3. Check explicit permission grants
   */
  async hasPermission(
    permission: Permission,
    context: PermissionContext
  ): Promise<boolean> {
    const result = await this.evaluatePermission(permission, context);
    return result.allowed;
  }

  async evaluatePermission(
    permission: Permission,
    context: PermissionContext
  ): Promise<BasePermissionEvaluation> {
    const { tenantId, resourceType, resourceId } = context;
    const principal = this.resolvePermissionPrincipal(context);
    const candidatePermissions = compatiblePermissionCandidates(permission);
    const sources: PermissionEvaluationSource[] = [];

    if (principal.principalType === 'user') {
      const legacyRoles = await this.resolveLegacyRoles({
        ...context,
        userId: principal.principalId,
      });

      if (legacyRoles.platformRole === 'admin') {
        sources.push({ type: 'legacy-role', role: 'admin', source: 'platform' });
        return { allowed: true, reason: 'role:platform:admin', sources };
      }

      const platformRolePermission = candidatePermissions.find((candidate) =>
        this.roleHasPermission(candidate, { platformRole: legacyRoles.platformRole })
      );
      if (legacyRoles.platformRole && platformRolePermission) {
        sources.push({ type: 'legacy-role', role: legacyRoles.platformRole, source: 'platform' });
        return { allowed: true, reason: `role:platform:${legacyRoles.platformRole}`, sources };
      }

      for (const projectRole of legacyRoles.projectRoles) {
        const projectRolePermission = candidatePermissions.find((candidate) =>
          this.roleHasPermission(candidate, { projectRole })
        );
        if (projectRolePermission) {
          sources.push({ type: 'legacy-role', role: projectRole, source: 'project' });
          return { allowed: true, reason: `role:project:${projectRole}`, sources };
        }
      }

      const engineRolePermission = candidatePermissions.find((candidate) =>
        this.roleHasPermission(candidate, { engineRole: legacyRoles.engineRole })
      );
      if (legacyRoles.engineRole && engineRolePermission) {
        sources.push({ type: 'legacy-role', role: legacyRoles.engineRole, source: 'engine' });
        return { allowed: true, reason: `role:engine:${legacyRoles.engineRole}`, sources };
      }
    }

    for (const candidatePermission of candidatePermissions) {
      const roleAssignmentSources = await this.getRoleAssignmentPermissionSources(
        principal,
        candidatePermission,
        resourceType,
        resourceId,
        tenantId
      );
      if (roleAssignmentSources.length > 0) {
        return {
          allowed: true,
          reason: `role-assignment:${roleAssignmentSources[0].roleId}`,
          sources: roleAssignmentSources,
        };
      }
    }

    if (principal.principalType === 'user') {
      for (const candidatePermission of candidatePermissions) {
        if (await this.hasExplicitGrant(principal.principalId, candidatePermission, resourceType, resourceId, tenantId)) {
          return {
            allowed: true,
            reason: 'grant:explicit',
            sources: [{ type: 'explicit-grant', permission: candidatePermission }],
          };
        }
      }
    }

    return { allowed: false, reason: 'no-permission', sources: [] };
  }

  async getCurrentUserPermissions(userId: string, tenantId?: string | null): Promise<CurrentUserPermissionsSnapshot> {
    const dataSource = await getDataSource();
    const generatedAt = Date.now();
    const platformRole = await this.getUserPlatformRole(dataSource, userId);
    const projectIds = await this.getKnownProjectIds(dataSource, userId, tenantId);
    const engineIds = await this.getKnownEngineIds(dataSource, userId, tenantId);

    return {
      userId,
      platform: await this.evaluatePermissionSet(userId, platformRole, 'platform', undefined, tenantId),
      projects: await Promise.all(projectIds.map(async (projectId) => ({
        resourceId: projectId,
        permissions: await this.evaluatePermissionSet(userId, platformRole, 'project', projectId, tenantId),
      }))),
      engines: await Promise.all(engineIds.map(async (engineId) => ({
        resourceId: engineId,
        permissions: await this.evaluatePermissionSet(userId, platformRole, 'engine', engineId, tenantId),
      }))),
      authorizationVersion: await this.getAuthorizationVersion(dataSource, {
        userId,
        tenantId,
        projectIds,
        engineIds,
      }),
      generatedAt,
    };
  }

  async getKnownProjectIdsForUser(userId: string, tenantId?: string | null): Promise<string[]> {
    const dataSource = await getDataSource();
    return this.getKnownProjectIds(dataSource, userId, tenantId);
  }

  async getKnownEngineIdsForUser(userId: string, tenantId?: string | null): Promise<string[]> {
    const dataSource = await getDataSource();
    return this.getKnownEngineIds(dataSource, userId, tenantId);
  }

  /**
   * Returns the runtime inventory rows a principal may act on. This is used
   * only for resource-aware engines; callers must use engine query pushdown
   * where available and must not substitute an unbounded post-filter.
   */
  async getVisibleRuntimeResources(input: {
    userId: string;
    tenantId?: string | null;
    engineId: string;
    resourceKind: 'process_definition' | 'decision_definition';
    permission: Permission;
    limit?: number;
  }): Promise<RuntimeResource[]> {
    const maxRows = input.limit ?? 500;
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 5_000) {
      throw new Error('Runtime resource authorization limit must be between 1 and 5000');
    }
    const dataSource = await getDataSource();
    const rows = await dataSource.getRepository(RuntimeResource).find({
      where: tenantScopedWhere({ engineId: input.engineId, resourceKind: input.resourceKind, isActive: true }, input.tenantId),
      take: maxRows + 1,
      order: { resourceKey: 'ASC', id: 'ASC' },
    });
    if (rows.length > maxRows) {
      throw new Error('Runtime resource authorization requires engine query pushdown or a bounded result set');
    }
    const decisions = await Promise.all(rows.map(async (resource) => ({
      resource,
      allowed: (await this.evaluatePermission(input.permission, {
        userId: input.userId,
        tenantId: input.tenantId,
        resourceType: 'engine_runtime_resource',
        resourceId: resource.id,
      })).allowed,
    })));
    return decisions.filter((decision) => decision.allowed).map((decision) => decision.resource);
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

  private async resolveLegacyRoles(context: PermissionContext): Promise<{
    platformRole?: string;
    projectRoles: string[];
    engineRole?: string;
  }> {
    if (!context.userId) {
      return { projectRoles: [] };
    }
    const dataSource = await getDataSource();
    const platformRole = context.platformRole || await this.getUserPlatformRole(dataSource, context.userId);
    const projectRoles = context.projectRole
      ? [context.projectRole]
      : await this.getLegacyProjectRoles(dataSource, context.userId, context.resourceType, context.resourceId, context.tenantId);
    const engineRole = context.engineRole || await this.getLegacyEngineRole(dataSource, context.userId, context.resourceType, context.resourceId, context.tenantId);

    return { platformRole, projectRoles, engineRole };
  }

  private async getUserPlatformRole(dataSource: DataSource, userId: string): Promise<string | undefined> {
    const user = await dataSource.getRepository(User).findOne({
      where: { id: userId },
      select: ['id', 'platformRole'],
    });
    return user?.platformRole || undefined;
  }

  private async evaluatePermissionSet(
    userId: string,
    platformRole: string | undefined,
    scope: ResourceType,
    resourceId?: string,
    tenantId?: string | null
  ): Promise<Permission[]> {
    const permissions = (await this.getPermissionCatalog())
      .filter((permission) => permission.scope === scope)
      .map((permission) => permission.key);
    if (platformRole === 'admin') {
      return permissions.sort();
    }

    const allowed = await Promise.all(permissions.map(async (permission) => ({
      permission,
      allowed: (await this.evaluatePermission(permission, {
        userId,
        tenantId,
        platformRole,
        resourceType: scope,
        resourceId,
      })).allowed,
    })));

    return allowed
      .filter((entry) => entry.allowed)
      .map((entry) => entry.permission)
      .sort();
  }

  private async getKnownProjectIds(dataSource: DataSource, userId: string, tenantId?: string | null): Promise<string[]> {
    const ids = new Set<string>();
    const owned = await dataSource.getRepository(Project).find({
      where: tenantScopedWhere({ ownerId: userId }, tenantId),
      select: ['id'],
    });
    owned.forEach((project) => ids.add(project.id));

    const memberships = await dataSource.getRepository(ProjectMember).find({
      where: { userId },
      select: ['projectId'],
    });
    memberships.forEach((membership) => ids.add(membership.projectId));

    const roleRows = await dataSource.getRepository(ProjectMemberRole).find({
      where: { userId },
      select: ['projectId'],
    });
    roleRows.forEach((roleRow) => ids.add(roleRow.projectId));

    const groupIds = await this.getUserGroupIdsForEvaluation(dataSource, userId, tenantId);
    const assignmentQb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .select(['assignment.resourceId', 'assignment.scopeId'])
      .where('1 = 1')
      .andWhere('assignment.scopeType = :resourceType', { resourceType: 'project' })
      .andWhere('assignment.scopeId IS NOT NULL')
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now: Date.now() });
    this.addPrincipalAssignmentFilter(assignmentQb, 'assignment', userId, groupIds);
    addTenantScopeFilter(assignmentQb, 'assignment', tenantId);
    const assignments = await assignmentQb.getMany();
    assignments.forEach((assignment) => {
      const projectId = assignment.scopeId;
      if (projectId) ids.add(projectId);
    });

    const normalizedTenantId = normalizeTenantId(tenantId);
    if (!normalizedTenantId || ids.size === 0) {
      return Array.from(ids).sort();
    }
    const visibleProjects = await dataSource.getRepository(Project).find({
      where: [
        { id: In(Array.from(ids)), tenantId: normalizedTenantId },
        { id: In(Array.from(ids)), tenantId: IsNull() },
      ],
      select: ['id'],
    });
    return visibleProjects.map((project) => project.id).sort();
  }

  private async getKnownEngineIds(dataSource: DataSource, userId: string, tenantId?: string | null): Promise<string[]> {
    const ids = new Set<string>();
    const normalizedTenantId = normalizeTenantId(tenantId);
    const directlyOwned = await dataSource.getRepository(Engine).find({
      where: normalizedTenantId
        ? [
          { ownerId: userId, tenantId: normalizedTenantId },
          { ownerId: userId, tenantId: IsNull() },
          { delegateId: userId, tenantId: normalizedTenantId },
          { delegateId: userId, tenantId: IsNull() },
        ]
        : [
          { ownerId: userId },
          { delegateId: userId },
        ],
      select: ['id'],
    });
    directlyOwned.forEach((engine) => ids.add(engine.id));

    const memberships = await dataSource.getRepository(EngineMember).find({
      where: { userId },
      select: ['engineId'],
    });
    memberships.forEach((membership) => ids.add(membership.engineId));

    const explicitGrantQb = dataSource.getRepository(PermissionGrant)
      .createQueryBuilder('grant')
      .select(['grant.resourceId'])
      .where('grant.userId = :userId', { userId })
      .andWhere('grant.resourceType = :resourceType', { resourceType: 'engine' })
      .andWhere('(grant.expiresAt IS NULL OR grant.expiresAt > :now)', { now: Date.now() });
    addTenantScopeFilter(explicitGrantQb, 'grant', tenantId);
    const explicitGrants = await explicitGrantQb.getMany();
    const hasGlobalExplicitGrant = explicitGrants.some((grant) => grant.resourceId === null);
    explicitGrants.forEach((grant) => {
      if (grant.resourceId) ids.add(grant.resourceId);
    });

    const groupIds = await this.getUserGroupIdsForEvaluation(dataSource, userId, tenantId);
    const assignmentQb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .select(['assignment.resourceId', 'assignment.scopeId'])
      .where('1 = 1')
      .andWhere('assignment.scopeType = :resourceType', { resourceType: 'engine' })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now: Date.now() });
    this.addPrincipalAssignmentFilter(assignmentQb, 'assignment', userId, groupIds);
    addTenantScopeFilter(assignmentQb, 'assignment', tenantId);
    const assignments = await assignmentQb.getMany();
    const hasGlobalEngineAssignment = assignments.some((assignment) => assignment.scopeId === null);
    assignments.forEach((assignment) => {
      const engineId = assignment.scopeId;
      if (engineId) ids.add(engineId);
    });

    const engineSetAssignmentQb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .select(['assignment.scopeId'])
      .where('assignment.scopeType = :scopeType', { scopeType: 'engine_set' })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now: Date.now() });
    this.addPrincipalAssignmentFilter(engineSetAssignmentQb, 'assignment', userId, groupIds);
    addTenantScopeFilter(engineSetAssignmentQb, 'assignment', tenantId);
    const engineSetAssignments = await engineSetAssignmentQb.getMany();
    const engineSetIds = Array.from(new Set(engineSetAssignments.map((assignment) => assignment.scopeId).filter((id): id is string => Boolean(id))));
    if (engineSetIds.length > 0) {
      const materializations = await dataSource.getRepository(EngineSetMaterialization).find({
        where: normalizedTenantId
          ? [
            { engineSetId: In(engineSetIds), tenantId: normalizedTenantId },
            { engineSetId: In(engineSetIds), tenantId: IsNull() },
          ]
          : { engineSetId: In(engineSetIds) },
        select: ['engineId'],
      });
      materializations.forEach((materialization) => ids.add(materialization.engineId));
    }

    // Runtime-resource assignments are not engine-wide grants, but the user
    // must still be able to discover the containing central engine before a
    // later route filters its process/decision resources.
    const runtimeAssignmentQb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .select(['assignment.scopeType', 'assignment.scopeId'])
      .where('assignment.scopeType IN (:...scopeTypes)', {
        scopeTypes: ['engine_runtime_resource', 'engine_runtime_resource_set'],
      })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now: Date.now() });
    this.addPrincipalAssignmentFilter(runtimeAssignmentQb, 'assignment', userId, groupIds);
    addTenantScopeFilter(runtimeAssignmentQb, 'assignment', tenantId);
    const runtimeAssignments = await runtimeAssignmentQb.getMany();
    const runtimeResourceIds = runtimeAssignments
      .filter((assignment) => assignment.scopeType === 'engine_runtime_resource')
      .map((assignment) => assignment.scopeId)
      .filter((id): id is string => Boolean(id));
    const runtimeSetIds = runtimeAssignments
      .filter((assignment) => assignment.scopeType === 'engine_runtime_resource_set')
      .map((assignment) => assignment.scopeId)
      .filter((id): id is string => Boolean(id));
    if (runtimeSetIds.length > 0) {
      const materializations = await dataSource.getRepository(RuntimeResourceSetMaterialization).find({
        where: normalizedTenantId
          ? [
            { runtimeResourceSetId: In(runtimeSetIds), tenantId: normalizedTenantId },
            { runtimeResourceSetId: In(runtimeSetIds), tenantId: IsNull() },
          ]
          : { runtimeResourceSetId: In(runtimeSetIds) },
        select: ['runtimeResourceId'],
      });
      runtimeResourceIds.push(...materializations.map((materialization) => materialization.runtimeResourceId));
    }
    if (runtimeResourceIds.length > 0) {
      const runtimeResources = await dataSource.getRepository(RuntimeResource).find({
        where: normalizedTenantId
          ? [
            { id: In(Array.from(new Set(runtimeResourceIds))), tenantId: normalizedTenantId, isActive: true },
            { id: In(Array.from(new Set(runtimeResourceIds))), tenantId: IsNull(), isActive: true },
          ]
          : { id: In(Array.from(new Set(runtimeResourceIds))), isActive: true },
        select: ['engineId'],
      });
      runtimeResources.forEach((runtimeResource) => ids.add(runtimeResource.engineId));
    }

    if (hasGlobalEngineAssignment || hasGlobalExplicitGrant) {
      const engines = await dataSource.getRepository(Engine).find({
        where: normalizedTenantId
          ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }]
          : undefined,
        select: ['id'],
      });
      engines.forEach((engine) => ids.add(engine.id));
    }

    return Array.from(ids).sort();
  }

  private async getLegacyProjectRoles(
    dataSource: DataSource,
    userId: string,
    resourceType?: ResourceType,
    resourceId?: string,
    tenantId?: string | null
  ): Promise<string[]> {
    if (resourceType !== 'project' || !resourceId) return [];

    const roles = new Set<string>();
    const project = await dataSource.getRepository(Project).findOne({
      where: { id: resourceId },
      select: ['id', 'ownerId', 'tenantId'],
    });
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (normalizedTenantId && project?.tenantId && project.tenantId !== normalizedTenantId) {
      return [];
    }
    if (project?.ownerId === userId) {
      roles.add('owner');
    }

    const membership = await dataSource.getRepository(ProjectMember).findOne({
      where: { projectId: resourceId, userId },
    });
    if (membership?.role) {
      roles.add(membership.role);
    }

    const roleRows = await dataSource.getRepository(ProjectMemberRole).find({
      where: { projectId: resourceId, userId },
    });
    roleRows.forEach((row) => roles.add(row.role));

    return Array.from(roles);
  }

  private async getLegacyEngineRole(
    dataSource: DataSource,
    userId: string,
    resourceType?: ResourceType,
    resourceId?: string,
    tenantId?: string | null
  ): Promise<string | undefined> {
    if (resourceType !== 'engine' || !resourceId) return undefined;

    const engine = await dataSource.getRepository(Engine).findOne({
      where: { id: resourceId },
      select: ['id', 'ownerId', 'delegateId', 'tenantId'],
    });
    if (!engine) return undefined;
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (normalizedTenantId && engine.tenantId && engine.tenantId !== normalizedTenantId) {
      return undefined;
    }
    if (engine.ownerId === userId) return 'owner';
    if (engine.delegateId === userId) return 'delegate';

    const membership = await dataSource.getRepository(EngineMember).findOne({
      where: { engineId: resourceId, userId },
    });

    return membership?.role || undefined;
  }

  private async getUserGroupIdsForEvaluation(dataSource: DataSource, userId: string, tenantId?: string | null): Promise<string[]> {
    const now = Date.now();
    const qb = dataSource.getRepository(AuthzGroupMembership)
      .createQueryBuilder('membership')
      .innerJoin(AuthzGroup, 'authzGroup', 'authzGroup.id = membership.groupId')
      .where('membership.userId = :userId', { userId })
      .andWhere('(membership.expiresAt IS NULL OR membership.expiresAt > :now)', { now })
      .andWhere('authzGroup.isArchived = :isArchived', { isArchived: false });
    addTenantScopeFilter(qb, 'membership', tenantId);
    addTenantScopeFilter(qb, 'authzGroup', tenantId);

    const memberships = await qb.getMany();
    return Array.from(new Set(memberships.map((membership) => membership.groupId))).sort();
  }

  private addPrincipalAssignmentFilter(
    qb: { andWhere: (...args: any[]) => any },
    alias: string,
    userId: string,
    groupIds: string[]
  ): void {
    if (groupIds.length > 0) {
      qb.andWhere(
        `((${alias}.principalType = :userPrincipalType AND ${alias}.principalId = :userId) OR ` +
        `(${alias}.principalType = :groupPrincipalType AND ${alias}.principalId IN (:...groupIds)))`,
        { userPrincipalType: 'user', groupPrincipalType: 'group', userId, groupIds }
      );
      return;
    }

    qb.andWhere(
      `(${alias}.principalType = :userPrincipalType AND ${alias}.principalId = :userId)`,
      { userPrincipalType: 'user', userId }
    );
  }

  private async getAuthorizationVersion(
    dataSource: DataSource,
    input: {
      userId: string;
      tenantId?: string | null;
      projectIds: string[];
      engineIds: string[];
    }
  ): Promise<string> {
    const groupIds = await this.getUserGroupIdsForEvaluation(dataSource, input.userId, input.tenantId).catch(() => []);
    const normalizedTenantId = normalizeTenantId(input.tenantId);
    const projectIds = [...input.projectIds].sort();
    const engineIds = [...input.engineIds].sort();

    const timestamps = await Promise.all([
      this.maxEntityTimestamp(dataSource, User, 'user', ['createdAt', 'updatedAt'], (qb) => {
        qb.where('user.id = :userId', { userId: input.userId });
      }),
      this.maxEntityTimestamp(dataSource, PermissionGrant, 'grant', ['createdAt'], (qb) => {
        qb.where('grant.userId = :userId', { userId: input.userId });
        addTenantScopeFilter(qb, 'grant', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, AuthzGroupMembership, 'membership', ['createdAt', 'updatedAt'], (qb) => {
        qb.where('membership.userId = :userId', { userId: input.userId });
        addTenantScopeFilter(qb, 'membership', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, AuthzGroup, 'authzGroup', ['createdAt', 'updatedAt'], (qb) => {
        if (groupIds.length > 0) {
          qb.where('authzGroup.id IN (:...groupIds)', { groupIds });
        } else {
          qb.where('1 = 0');
        }
        addTenantScopeFilter(qb, 'authzGroup', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, RbacRoleAssignment, 'assignment', ['createdAt', 'updatedAt', 'lastSeenAt'], (qb) => {
        this.addPrincipalAssignmentFilter(qb, 'assignment', input.userId, groupIds);
        addTenantScopeFilter(qb, 'assignment', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, RbacRole, 'role', ['createdAt', 'updatedAt'], (qb) => {
        addTenantScopeFilter(qb, 'role', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, RbacRolePermission, 'rolePermission', ['createdAt']),
      this.maxEntityTimestamp(dataSource, RbacPermission, 'permission', ['createdAt', 'updatedAt']),
      this.maxEntityTimestamp(dataSource, ProjectMember, 'projectMember', ['createdAt', 'updatedAt'], (qb) => {
        qb.where('projectMember.userId = :userId', { userId: input.userId });
      }),
      this.maxEntityTimestamp(dataSource, ProjectMemberRole, 'projectMemberRole', ['createdAt'], (qb) => {
        qb.where('projectMemberRole.userId = :userId', { userId: input.userId });
      }),
      this.maxEntityTimestamp(dataSource, Project, 'project', ['createdAt', 'updatedAt'], (qb) => {
        if (projectIds.length > 0) {
          qb.where('project.id IN (:...projectIds)', { projectIds });
          addTenantScopeFilter(qb, 'project', input.tenantId);
        } else {
          qb.where('1 = 0');
        }
      }),
      this.maxEntityTimestamp(dataSource, EngineMember, 'engineMember', ['createdAt'], (qb) => {
        qb.where('engineMember.userId = :userId', { userId: input.userId });
      }),
      this.maxEntityTimestamp(dataSource, Engine, 'engine', ['createdAt', 'updatedAt', 'lastExternalSyncAt', 'externalUpdatedAt'], (qb) => {
        if (engineIds.length > 0) {
          qb.where('engine.id IN (:...engineIds)', { engineIds });
          addTenantScopeFilter(qb, 'engine', input.tenantId);
        } else {
          qb.where('1 = 0');
        }
      }),
      this.maxEntityTimestamp(dataSource, EngineSet, 'engineSet', ['createdAt', 'updatedAt', 'lastMaterializedAt'], (qb) => {
        addTenantScopeFilter(qb, 'engineSet', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, EngineSetMaterialization, 'materialization', ['createdAt', 'updatedAt', 'lastSeenAt'], (qb) => {
        if (engineIds.length > 0) {
          qb.where('materialization.engineId IN (:...engineIds)', { engineIds });
          addTenantScopeFilter(qb, 'materialization', input.tenantId);
        } else {
          qb.where('1 = 0');
        }
      }),
      this.maxEntityTimestamp(dataSource, SsoAssignmentMapping, 'ssoAssignment', ['createdAt', 'updatedAt'], (qb) => {
        addTenantScopeFilter(qb, 'ssoAssignment', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, SsoGroupMapping, 'ssoGroupMapping', ['createdAt', 'updatedAt'], (qb) => {
        addTenantScopeFilter(qb, 'ssoGroupMapping', input.tenantId);
      }),
      this.maxEntityTimestamp(dataSource, AuthzPolicy, 'policy', ['createdAt', 'updatedAt'], (qb) => {
        addTenantScopeFilter(qb, 'policy', input.tenantId);
      }),
    ]);

    const maxTimestamp = Math.max(0, ...timestamps);
    const fingerprint = stableVersionHash(JSON.stringify({
      tenantId: normalizedTenantId,
      userId: input.userId,
      groups: groupIds,
      projects: projectIds,
      engines: engineIds,
    }));
    return `authz:${maxTimestamp}:${fingerprint}`;
  }

  private async maxEntityTimestamp(
    dataSource: DataSource,
    entity: unknown,
    alias: string,
    columns: string[],
    configure?: (qb: {
      where: (...args: any[]) => any;
      andWhere: (...args: any[]) => any;
    }) => void
  ): Promise<number> {
    try {
      const values = await Promise.all(columns.map(async (column) => {
        const qb = dataSource.getRepository(entity as any)
          .createQueryBuilder(alias)
          .select(`MAX(${alias}.${column})`, 'value');
        configure?.(qb);
        const row = await qb.getRawOne();
        const value = Number(row?.value ?? 0);
        return Number.isFinite(value) ? value : 0;
      }));
      return Math.max(0, ...values);
    } catch {
      return 0;
    }
  }

  private resolvePermissionPrincipal(context: PermissionContext): { principalType: PrincipalType; principalId: string } {
    const principalType = context.principalType ?? 'user';
    const principalId = context.principalId ?? context.userId;
    if (!principalId) {
      throw new Error('Permission checks require a principalId');
    }
    if (principalType === 'user' && context.userId && context.userId !== principalId) {
      throw new Error('userId must match principalId for user permission checks');
    }
    return { principalType, principalId };
  }

  private async addPermissionPrincipalAssignmentFilter(
    dataSource: DataSource,
    qb: { andWhere: (...args: any[]) => any },
    alias: string,
    principal: { principalType: PrincipalType; principalId: string },
    tenantId?: string | null
  ): Promise<void> {
    if (principal.principalType === 'user') {
      const groupIds = await this.getUserGroupIdsForEvaluation(dataSource, principal.principalId, tenantId);
      this.addPrincipalAssignmentFilter(qb, alias, principal.principalId, groupIds);
      return;
    }

    qb.andWhere(
      `(${alias}.principalType = :principalType AND ${alias}.principalId = :principalId)`,
      { principalType: principal.principalType, principalId: principal.principalId }
    );
  }

  private async getRoleAssignmentPermissionSources(
    principal: { principalType: PrincipalType; principalId: string },
    permission: Permission,
    resourceType?: ResourceType,
    resourceId?: string,
    tenantId?: string | null
  ): Promise<PermissionEvaluationSource[]> {
    const dataSource = await getDataSource();
    const assignmentRepo = dataSource.getRepository(RbacRoleAssignment);
    const now = Date.now();
    const runtimeResource = resourceType === 'engine_runtime_resource' && resourceId
      ? await dataSource.getRepository(RuntimeResource).findOne({ where: tenantScopedWhere({ id: resourceId, isActive: true }, tenantId) })
      : null;
    if (resourceType === 'engine_runtime_resource' && resourceId && !runtimeResource) {
      return [];
    }
    const qb = assignmentRepo.createQueryBuilder('assignment')
      .innerJoin(RbacRolePermission, 'rolePermission', 'rolePermission.roleId = assignment.roleId')
      .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
      .where('1 = 1')
      .andWhere('rolePermission.permissionId = :permission', { permission })
      .andWhere('role.isArchived = :isArchived', { isArchived: false })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now });
    await this.addPermissionPrincipalAssignmentFilter(dataSource, qb, 'assignment', principal, tenantId);
    addTenantScopeFilter(qb, 'assignment', tenantId);
    addTenantScopeFilter(qb, 'role', tenantId);

    if (resourceType === 'engine_runtime_resource' && resourceId && runtimeResource) {
      qb.andWhere(
        '((assignment.scopeType = :resourceType AND assignment.scopeId = :resourceId) OR ' +
        '(assignment.scopeType = :engineScope AND (assignment.scopeId = :engineId OR assignment.scopeId IS NULL)))',
        { resourceType, resourceId, engineScope: 'engine', engineId: runtimeResource.engineId }
      );
    } else if (resourceType && resourceId) {
      qb.andWhere(
        '((assignment.scopeType = :resourceType AND assignment.scopeId = :resourceId) OR ' +
        '(assignment.scopeType = :resourceType AND assignment.scopeId IS NULL))',
        { resourceType, resourceId }
      );
    } else if (resourceType) {
      qb.andWhere(
        '(assignment.scopeType = :resourceType AND assignment.scopeId IS NULL)',
        { resourceType }
      );
    } else {
      qb.andWhere('(assignment.scopeType = :platform AND assignment.scopeId IS NULL)', { platform: 'platform' });
    }

    const assignments = await qb.getMany();
    const directSources: PermissionEvaluationSource[] = assignments.map((assignment) => ({
      type: 'role-assignment' as const,
      assignmentId: assignment.id,
      roleId: assignment.roleId,
      principalType: assignment.principalType as PrincipalType,
      principalId: assignment.principalId!,
      source: assignment.source,
      sourceMappingId: assignment.sourceMappingId,
      sourceRef: assignment.sourceRef,
      scopeType: assignment.scopeType as ResourceType | null,
      scopeId: assignment.scopeId,
    }));

    if (resourceType === 'engine_runtime_resource' && resourceId && runtimeResource) {
      const runtimeSetQb = assignmentRepo.createQueryBuilder('assignment')
        .innerJoin(RbacRolePermission, 'rolePermission', 'rolePermission.roleId = assignment.roleId')
        .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
        .innerJoin(RuntimeResourceSetMaterialization, 'runtimeMaterialization', 'runtimeMaterialization.runtimeResourceSetId = assignment.scopeId AND runtimeMaterialization.runtimeResourceId = :resourceId', { resourceId })
        .where('rolePermission.permissionId = :permission', { permission })
        .andWhere('role.isArchived = :isArchived', { isArchived: false })
        .andWhere('role.scope = :roleScope', { roleScope: 'engine' })
        .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
        .andWhere('assignment.scopeType = :runtimeSetScope', { runtimeSetScope: 'engine_runtime_resource_set' })
        .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now });
      await this.addPermissionPrincipalAssignmentFilter(dataSource, runtimeSetQb, 'assignment', principal, tenantId);
      addTenantScopeFilter(runtimeSetQb, 'assignment', tenantId);
      addTenantScopeFilter(runtimeSetQb, 'role', tenantId);
      addTenantScopeFilter(runtimeSetQb, 'runtimeMaterialization', tenantId);

      const engineSetQb = assignmentRepo.createQueryBuilder('assignment')
        .innerJoin(RbacRolePermission, 'rolePermission', 'rolePermission.roleId = assignment.roleId')
        .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
        .innerJoin(EngineSetMaterialization, 'engineMaterialization', 'engineMaterialization.engineSetId = assignment.scopeId AND engineMaterialization.engineId = :engineId', { engineId: runtimeResource.engineId })
        .where('rolePermission.permissionId = :permission', { permission })
        .andWhere('role.isArchived = :isArchived', { isArchived: false })
        .andWhere('role.scope = :roleScope', { roleScope: 'engine' })
        .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
        .andWhere('assignment.scopeType = :engineSetScope', { engineSetScope: 'engine_set' })
        .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now });
      await this.addPermissionPrincipalAssignmentFilter(dataSource, engineSetQb, 'assignment', principal, tenantId);
      addTenantScopeFilter(engineSetQb, 'assignment', tenantId);
      addTenantScopeFilter(engineSetQb, 'role', tenantId);
      addTenantScopeFilter(engineSetQb, 'engineMaterialization', tenantId);
      const [runtimeSetAssignments, engineSetAssignments] = await Promise.all([runtimeSetQb.getMany(), engineSetQb.getMany()]);
      const inheritedSources: PermissionEvaluationSource[] = [...runtimeSetAssignments, ...engineSetAssignments].map((assignment) => ({
        type: 'role-assignment' as const, assignmentId: assignment.id, roleId: assignment.roleId,
        principalType: assignment.principalType as PrincipalType, principalId: assignment.principalId!, source: assignment.source,
        sourceMappingId: assignment.sourceMappingId, sourceRef: assignment.sourceRef,
        scopeType: assignment.scopeType as ResourceType | null, scopeId: assignment.scopeId,
      }));
      const groupLineageSources = await this.attachGroupLineage(dataSource, [...directSources, ...inheritedSources], principal, tenantId);
      return this.attachSsoMappingLineage(dataSource, groupLineageSources, tenantId);
    }

    if (resourceType !== 'engine' || !resourceId) {
      const groupLineageSources = await this.attachGroupLineage(dataSource, directSources, principal, tenantId);
      return this.attachSsoMappingLineage(dataSource, groupLineageSources, tenantId);
    }

    const engineSetQb = assignmentRepo.createQueryBuilder('assignment')
      .innerJoin(RbacRolePermission, 'rolePermission', 'rolePermission.roleId = assignment.roleId')
      .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
      .innerJoin(EngineSetMaterialization, 'materialization', 'materialization.engineSetId = assignment.scopeId AND materialization.engineId = :engineId', { engineId: resourceId })
      .where('1 = 1')
      .andWhere('rolePermission.permissionId = :permission', { permission })
      .andWhere('role.isArchived = :isArchived', { isArchived: false })
      .andWhere('role.scope = :roleScope', { roleScope: 'engine' })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('assignment.scopeType = :engineSetScopeType', { engineSetScopeType: 'engine_set' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now });
    await this.addPermissionPrincipalAssignmentFilter(dataSource, engineSetQb, 'assignment', principal, tenantId);
    addTenantScopeFilter(engineSetQb, 'assignment', tenantId);
    addTenantScopeFilter(engineSetQb, 'role', tenantId);
    addTenantScopeFilter(engineSetQb, 'materialization', tenantId);

    const engineSetAssignments = (await engineSetQb.getMany()).filter((assignment) => Boolean(assignment.scopeId));
    const engineSetIds = Array.from(new Set(engineSetAssignments.map((assignment) => assignment.scopeId).filter((id): id is string => Boolean(id))));
    const [materializations, engineSets, matchedEngines, externalRegistrations] = engineSetIds.length > 0
      ? await Promise.all([
        dataSource.getRepository(EngineSetMaterialization).find({
          where: tenantScopedWhere({ engineSetId: In(engineSetIds), engineId: resourceId }, tenantId),
        }),
        dataSource.getRepository(EngineSet).find({
          where: tenantScopedWhere({ id: In(engineSetIds), isArchived: false }, tenantId),
        }),
        dataSource.getRepository(Engine).find({
          where: tenantScopedWhere({ id: resourceId }, tenantId),
        }),
        dataSource.getRepository(ExternalEngineRegistration).find({
          where: { engineId: resourceId },
        }),
      ])
      : [[], [], [], []];
    const materializationByEngineSetId = new Map(materializations.map((materialization) => [materialization.engineSetId, materialization]));
    const engineSetById = new Map(engineSets.map((engineSet) => [engineSet.id, engineSet]));
    const matchedEngine = matchedEngines[0] || null;
    const externalRegistration = externalRegistrations[0] || null;
    const engineRegistration = matchedEngine || externalRegistration
      ? {
        engineId: resourceId,
        engineName: matchedEngine?.name ?? null,
        externalId: externalRegistration?.externalId ?? matchedEngine?.externalId ?? null,
        registrationId: externalRegistration?.id ?? null,
        registrationSource: externalRegistration?.registrationSource ?? matchedEngine?.registrationSource ?? null,
        externalSystemId: externalRegistration?.externalSystemId ?? matchedEngine?.externalSystemId ?? null,
        lifecycleStatus: externalRegistration?.lifecycleStatus ?? matchedEngine?.lifecycleStatus ?? null,
        apiClientId: externalRegistration?.apiClientId ?? null,
        lastExternalSyncAt: externalRegistration?.lastExternalSyncAt ?? matchedEngine?.lastExternalSyncAt ?? null,
        lastRegisteredAt: externalRegistration?.lastRegisteredAt ?? null,
        externalUpdatedAt: matchedEngine?.externalUpdatedAt ?? null,
      }
      : null;
    const engineSetSources: PermissionEvaluationSource[] = engineSetAssignments.map((assignment) => {
      const materialization = assignment.scopeId ? materializationByEngineSetId.get(assignment.scopeId) : null;
      const engineSet = assignment.scopeId ? engineSetById.get(assignment.scopeId) : null;
      return {
        type: 'role-assignment' as const,
        assignmentId: assignment.id,
        roleId: assignment.roleId,
        principalType: assignment.principalType as PrincipalType,
        principalId: assignment.principalId || undefined,
        source: assignment.source,
        sourceMappingId: assignment.sourceMappingId,
        sourceRef: assignment.sourceRef,
        scopeType: 'engine_set' as ResourceType,
        scopeId: assignment.scopeId,
        engineSetId: assignment.scopeId,
        engineSetKey: engineSet?.key ?? null,
        engineSetName: engineSet?.name ?? null,
        selectorFingerprint: materialization?.selectorFingerprint ?? engineSet?.selectorFingerprint ?? null,
        materializationId: materialization?.id ?? null,
        matchedEngineId: materialization?.engineId ?? resourceId,
        engineRegistration,
        matchedBy: parseJsonRecord(materialization?.matchedByJson),
        lineage: parseJsonRecord(materialization?.lineageJson),
      };
    });

    const groupLineageSources = await this.attachGroupLineage(dataSource, [...directSources, ...engineSetSources], principal, tenantId);
    return this.attachSsoMappingLineage(dataSource, groupLineageSources, tenantId);
  }

  private async attachGroupLineage(
    dataSource: DataSource,
    sources: PermissionEvaluationSource[],
    principal: { principalType: PrincipalType; principalId: string },
    tenantId?: string | null
  ): Promise<PermissionEvaluationSource[]> {
    if (principal.principalType !== 'user') return sources;
    const groupIds = Array.from(new Set(
      sources
        .filter((source) => source.principalType === 'group' && source.principalId)
        .map((source) => source.principalId as string)
    ));
    if (groupIds.length === 0) return sources;

    const now = Date.now();
    const [groups, memberships] = await Promise.all([
      dataSource.getRepository(AuthzGroup).find({
        where: tenantScopedWhere({ id: In(groupIds), isArchived: false }, tenantId),
      }),
      dataSource.getRepository(AuthzGroupMembership).find({
        where: tenantScopedWhere({ groupId: In(groupIds), userId: principal.principalId }, tenantId),
      }),
    ]);
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const membershipsByGroupId = new Map<string, AuthzGroupMembership>();
    const activeMemberships = memberships.filter((membership) => !membership.expiresAt || membership.expiresAt > now);
    activeMemberships.forEach((membership) => {
      const existing = membershipsByGroupId.get(membership.groupId);
      if (!existing || (existing.source !== 'sso' && membership.source === 'sso')) {
        membershipsByGroupId.set(membership.groupId, membership);
      }
    });
    const ssoGroupMappingIds = Array.from(new Set(
      activeMemberships
        .filter((membership) => membership.source === 'sso' && membership.sourceRef)
        .map((membership) => membership.sourceRef as string)
    ));
    const ssoGroupMappings = ssoGroupMappingIds.length > 0
      ? await dataSource.getRepository(SsoGroupMapping).find({
        where: tenantScopedWhere({ id: In(ssoGroupMappingIds) }, tenantId),
      })
      : [];
    const ssoGroupMappingById = new Map(ssoGroupMappings.map((mapping) => [mapping.id, mapping]));

    return sources.map((source) => {
      if (source.principalType !== 'group' || !source.principalId) return source;
      const group = groupById.get(source.principalId);
      const membership = membershipsByGroupId.get(source.principalId);
      const mapping = membership?.source === 'sso' && membership.sourceRef
        ? ssoGroupMappingById.get(membership.sourceRef)
        : null;
      return {
        ...source,
        groupId: source.principalId,
        groupKey: group?.key ?? null,
        groupName: group?.name ?? null,
        groupMembership: membership
          ? {
            id: membership.id,
            source: membership.source,
            sourceRef: membership.sourceRef,
            expiresAt: membership.expiresAt,
          }
          : null,
        ssoGroupMapping: mapping
          ? {
            id: mapping.id,
            providerId: mapping.providerId,
            claimType: mapping.claimType,
            claimKey: mapping.claimKey,
            claimValue: mapping.claimValue,
            claimOperator: mapping.claimOperator,
            targetGroupId: mapping.targetGroupId,
            syncMode: mapping.syncMode,
          }
          : null,
      };
    });
  }

  private async attachSsoMappingLineage(
    dataSource: DataSource,
    sources: PermissionEvaluationSource[],
    tenantId?: string | null
  ): Promise<PermissionEvaluationSource[]> {
    const mappingIds = Array.from(new Set(
      sources
        .filter((source) => source.source === 'sso')
        .map((source) => source.sourceMappingId || source.sourceRef)
        .filter((id): id is string => Boolean(id))
    ));
    if (mappingIds.length === 0) return sources;

    const mappings = await dataSource.getRepository(SsoAssignmentMapping).find({
      where: tenantScopedWhere({ id: In(mappingIds) }, tenantId),
    });
    const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));

    return sources.map((source) => {
      const mappingId = source.source === 'sso' ? source.sourceMappingId || source.sourceRef : null;
      const mapping = mappingId ? mappingById.get(mappingId) : null;
      if (!mapping) return source;
      return {
        ...source,
        ssoMapping: {
          id: mapping.id,
          providerId: mapping.providerId,
          claimType: mapping.claimType,
          claimKey: mapping.claimKey,
          claimValue: mapping.claimValue,
          claimOperator: mapping.claimOperator,
          targetSelectorType: mapping.targetSelectorType,
        },
      };
    });
  }

  async getAssignedEngineRole(userId: string, engineId: string, tenantId?: string | null): Promise<'owner' | 'delegate' | 'operator' | 'deployer' | null> {
    const dataSource = await getDataSource();
    const now = Date.now();
    const groupIds = await this.getUserGroupIdsForEvaluation(dataSource, userId, tenantId);
    const qb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
      .where('1 = 1')
      .andWhere('(assignment.scopeType = :resourceType OR assignment.resourceType = :resourceType)', { resourceType: 'engine' })
      .andWhere('(assignment.scopeId = :engineId OR assignment.resourceId = :engineId OR (assignment.scopeId IS NULL AND assignment.resourceId IS NULL))', { engineId })
      .andWhere('role.isArchived = :isArchived', { isArchived: false })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now });
    this.addPrincipalAssignmentFilter(qb, 'assignment', userId, groupIds);
    addTenantScopeFilter(qb, 'assignment', tenantId);
    addTenantScopeFilter(qb, 'role', tenantId);
    const assignments = await qb.getMany();

    const roles = assignments
      .map((assignment) => ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE[assignment.roleId])
      .filter((role): role is 'owner' | 'delegate' | 'operator' | 'deployer' => Boolean(role));

    for (const role of ENGINE_ROLE_PRECEDENCE) {
      if (roles.includes(role)) return role;
    }

    return null;
  }

  async getAssignedEngineRoles(userId: string, tenantId?: string | null): Promise<Array<{ engineId: string | null; role: 'owner' | 'delegate' | 'operator' | 'deployer' }>> {
    const dataSource = await getDataSource();
    const now = Date.now();
    const groupIds = await this.getUserGroupIdsForEvaluation(dataSource, userId, tenantId);
    const qb = dataSource.getRepository(RbacRoleAssignment)
      .createQueryBuilder('assignment')
      .innerJoin(RbacRole, 'role', 'role.id = assignment.roleId')
      .where('1 = 1')
      .andWhere('(assignment.scopeType = :resourceType OR assignment.resourceType = :resourceType)', { resourceType: 'engine' })
      .andWhere('role.isArchived = :isArchived', { isArchived: false })
      .andWhere('assignment.source != :legacySource', { legacySource: 'legacy' })
      .andWhere('(assignment.expiresAt IS NULL OR assignment.expiresAt > :now)', { now });
    this.addPrincipalAssignmentFilter(qb, 'assignment', userId, groupIds);
    addTenantScopeFilter(qb, 'assignment', tenantId);
    addTenantScopeFilter(qb, 'role', tenantId);
    const assignments = await qb.getMany();

    return assignments
      .map((assignment) => ({
        engineId: assignment.scopeId ?? assignment.resourceId,
        role: ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE[assignment.roleId],
      }))
      .filter((assignment): assignment is { engineId: string | null; role: 'owner' | 'delegate' | 'operator' | 'deployer' } => Boolean(assignment.role));
  }

  /**
   * Check if user has an explicit permission grant
   */
  async hasExplicitGrant(
    userId: string,
    permission: Permission,
    resourceType?: ResourceType,
    resourceId?: string,
    tenantId?: string | null
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);
    const now = Date.now();

    // Build query with TypeORM QueryBuilder for complex OR conditions
    const qb = grantRepo.createQueryBuilder('g')
      .where('g.userId = :userId', { userId })
      .andWhere('g.permission = :permission', { permission })
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now });
    addTenantScopeFilter(qb, 'g', tenantId);

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
      tenantId: normalizeTenantId(input.tenantId),
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
    resourceId?: string,
    tenantId?: string | null
  ): Promise<boolean> {
    const dataSource = await getDataSource();
    const grantRepo = dataSource.getRepository(PermissionGrant);

    const qb = grantRepo.createQueryBuilder()
      .delete()
      .where('userId = :userId', { userId })
      .andWhere('permission = :permission', { permission });
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (normalizedTenantId) {
      qb.andWhere('(tenantId = :tenantId OR tenantId IS NULL)', { tenantId: normalizedTenantId });
    }

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
  async getUserGrants(userId: string, tenantId?: string | null): Promise<Array<{
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
      .andWhere('(g.expiresAt IS NULL OR g.expiresAt > :now)', { now });
    addTenantScopeFilter(grants, 'g', tenantId);
    const rows = await grants.getMany();

    return rows.map((g) => ({
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
