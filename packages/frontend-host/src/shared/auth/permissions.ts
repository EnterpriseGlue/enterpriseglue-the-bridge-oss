import type { CurrentUserPermissions } from '../types/auth';

export const PlatformPermission = {
  PROJECT_CREATE: 'project:create',
  ENGINE_CREATE: 'platform:engine:create',
  ENGINE_REGISTRATION_MANAGE: 'platform:engine-registration:manage',
  USER_MANAGE: 'platform:user:manage',
  USER_VIEW: 'platform:user:view',
  USERS_VIEW: 'platform:users:view',
  USERS_CREATE: 'platform:users:create',
  USERS_UPDATE: 'platform:users:update',
  USERS_DEACTIVATE: 'platform:users:deactivate',
  USERS_DELETE: 'platform:users:delete',
  USERS_PERMANENT_DELETE: 'platform:users:permanent-delete',
  USERS_UNLOCK: 'platform:users:unlock',
  SETTINGS_MANAGE: 'platform:settings:manage',
  AUDIT_VIEW: 'platform:audit:view',
  AUDIT_UNREDACTED_VIEW: 'platform:audit:unredacted-view',
  GIT_PROVIDER_MANAGE: 'platform:git-provider:manage',
  AUTHZ_ROLES_VIEW: 'platform:authz:roles:view',
  AUTHZ_ROLES_MANAGE: 'platform:authz:roles:manage',
  AUTHZ_CHECK: 'platform:authz:check',
  CONFIG_BUNDLES_VIEW: 'platform:config-bundles:view',
  CONFIG_BUNDLES_PREVIEW: 'platform:config-bundles:preview',
  CONFIG_BUNDLES_APPLY: 'platform:config-bundles:apply',
  CONFIG_BUNDLES_EXPORT: 'platform:config-bundles:export',
  SSO_ASSIGNMENTS_VIEW: 'platform:sso-assignments:view',
  SSO_ASSIGNMENTS_MANAGE: 'platform:sso-assignments:manage',
  SSO_PROVIDERS_VIEW: 'platform:sso-providers:view',
  SSO_PROVIDERS_MANAGE: 'platform:sso-providers:manage',
  PROJECT_ENGINE_TARGETS_VIEW: 'platform:project-engine-targets:view',
  PROJECT_ENGINE_TARGETS_MANAGE: 'platform:project-engine-targets:manage',
} as const;

export const EnginePermission = {
  ENGINE_EDIT: 'engine:edit',
  ENGINE_DELETE: 'engine:delete',
  ENGINE_ACTIVATE: 'engine:activate',
  SECRETS_VIEW: 'engine:secrets:view',
  SECRETS_MANAGE: 'engine:secrets:manage',
  ENVIRONMENT_SET: 'engine:environment:set',
  ENVIRONMENT_LOCK: 'engine:environment:lock',
  DELEGATE_MANAGE: 'engine:delegate:manage',
  OWNERSHIP_TRANSFER: 'engine:ownership:transfer',
  MEMBERS_MANAGE: 'engine:members:manage',
  MEMBERS_VIEW: 'engine:members:view',
  MEMBERS_LOOKUP: 'engine:members:lookup',
  MEMBERS_INVITE: 'engine:members:invite',
  MEMBERS_ADD: 'engine:members:add',
  MEMBERS_UPDATE_ROLE: 'engine:members:update-role',
  MEMBERS_REMOVE: 'engine:members:remove',
  PROJECT_ACCESS_VIEW: 'engine:project-access:view',
  PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
  PROJECT_ACCESS_DENY: 'engine:project-access:deny',
  PROJECT_ACCESS_REVOKE: 'engine:project-access:revoke',
  DEPLOY: 'engine:deploy',
  DEPLOY_VIEW: 'engine:deploy:view',
  PROCESS_START: 'engine:process:start',
  PROCESS_CANCEL: 'engine:process:cancel',
  PROCESS_MODIFY: 'engine:process:modify',
  INSTANCE_VIEW: 'engine:instance:view',
  INSTANCE_DELETE: 'engine:instance:delete',
  INSTANCE_RETRY: 'engine:instance:retry',
  VARIABLES_METADATA_VIEW: 'engine:variables:metadata:view',
  VARIABLES_VALUE_VIEW: 'engine:variables:value:view',
  VARIABLES_EDIT: 'engine:variables:edit',
} as const;

export const ProjectPermission = {
  PROJECT_DELETE: 'project:delete',
  PROJECT_SETTINGS: 'project:settings:manage',
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
  FILES_CREATE: 'project:files:create',
  FILES_EDIT: 'project:files:edit',
  FILES_DELETE: 'project:files:delete',
  FILES_VIEW: 'project:files:view',
  VERSIONS_CREATE: 'project:versions:create',
  VERSIONS_RESTORE: 'project:versions:restore',
  GIT_PUSH: 'project:git:push',
  GIT_PULL: 'project:git:pull',
  GIT_CONNECT: 'project:git:connect',
  DEPLOY: 'project:deploy',
  DEPLOYMENT_TARGETS_VIEW: 'project:deployment-targets:view',
  DEPLOYMENT_TARGETS_MANAGE: 'project:deployment-targets:manage',
} as const;

export const ADMIN_NAV_PLATFORM_PERMISSIONS = [
  PlatformPermission.USER_MANAGE,
  PlatformPermission.USER_VIEW,
  PlatformPermission.USERS_VIEW,
  PlatformPermission.USERS_CREATE,
  PlatformPermission.USERS_UPDATE,
  PlatformPermission.USERS_DEACTIVATE,
  PlatformPermission.USERS_DELETE,
  PlatformPermission.USERS_PERMANENT_DELETE,
  PlatformPermission.USERS_UNLOCK,
  PlatformPermission.SETTINGS_MANAGE,
  PlatformPermission.AUDIT_VIEW,
  PlatformPermission.GIT_PROVIDER_MANAGE,
  PlatformPermission.AUTHZ_ROLES_VIEW,
  PlatformPermission.AUTHZ_ROLES_MANAGE,
  PlatformPermission.CONFIG_BUNDLES_VIEW,
  PlatformPermission.CONFIG_BUNDLES_PREVIEW,
  PlatformPermission.CONFIG_BUNDLES_APPLY,
  PlatformPermission.CONFIG_BUNDLES_EXPORT,
  PlatformPermission.SSO_ASSIGNMENTS_VIEW,
  PlatformPermission.SSO_ASSIGNMENTS_MANAGE,
  PlatformPermission.SSO_PROVIDERS_VIEW,
  PlatformPermission.SSO_PROVIDERS_MANAGE,
  PlatformPermission.ENGINE_REGISTRATION_MANAGE,
];

export const ACCESS_CONTROL_PLATFORM_PERMISSIONS = [
  PlatformPermission.AUTHZ_ROLES_VIEW,
  PlatformPermission.AUTHZ_ROLES_MANAGE,
  PlatformPermission.CONFIG_BUNDLES_VIEW,
  PlatformPermission.CONFIG_BUNDLES_PREVIEW,
  PlatformPermission.CONFIG_BUNDLES_APPLY,
  PlatformPermission.CONFIG_BUNDLES_EXPORT,
  PlatformPermission.SSO_ASSIGNMENTS_VIEW,
  PlatformPermission.SSO_ASSIGNMENTS_MANAGE,
  PlatformPermission.SSO_PROVIDERS_VIEW,
  PlatformPermission.SSO_PROVIDERS_MANAGE,
  PlatformPermission.ENGINE_REGISTRATION_MANAGE,
];

export const PLATFORM_SETTINGS_HUB_PLATFORM_PERMISSIONS = [
  PlatformPermission.SETTINGS_MANAGE,
  PlatformPermission.AUDIT_VIEW,
  PlatformPermission.GIT_PROVIDER_MANAGE,
  PlatformPermission.AUTHZ_ROLES_VIEW,
  PlatformPermission.AUTHZ_ROLES_MANAGE,
  PlatformPermission.CONFIG_BUNDLES_VIEW,
  PlatformPermission.CONFIG_BUNDLES_PREVIEW,
  PlatformPermission.CONFIG_BUNDLES_APPLY,
  PlatformPermission.CONFIG_BUNDLES_EXPORT,
  PlatformPermission.SSO_ASSIGNMENTS_VIEW,
  PlatformPermission.SSO_ASSIGNMENTS_MANAGE,
  PlatformPermission.ENGINE_REGISTRATION_MANAGE,
];

export const ENGINES_NAV_PLATFORM_PERMISSIONS = [
  PlatformPermission.ENGINE_CREATE,
];

export const ENGINES_NAV_ENGINE_PERMISSIONS = [
  EnginePermission.ENGINE_EDIT,
  EnginePermission.ENGINE_DELETE,
  EnginePermission.ENVIRONMENT_SET,
  EnginePermission.ENVIRONMENT_LOCK,
  EnginePermission.SECRETS_VIEW,
  EnginePermission.SECRETS_MANAGE,
  EnginePermission.DELEGATE_MANAGE,
  EnginePermission.OWNERSHIP_TRANSFER,
  EnginePermission.MEMBERS_MANAGE,
  EnginePermission.MEMBERS_VIEW,
  EnginePermission.MEMBERS_LOOKUP,
  EnginePermission.MEMBERS_INVITE,
  EnginePermission.MEMBERS_ADD,
  EnginePermission.MEMBERS_UPDATE_ROLE,
  EnginePermission.MEMBERS_REMOVE,
  EnginePermission.PROJECT_ACCESS_VIEW,
  EnginePermission.PROJECT_ACCESS_APPROVE,
  EnginePermission.PROJECT_ACCESS_DENY,
  EnginePermission.PROJECT_ACCESS_REVOKE,
  EnginePermission.INSTANCE_VIEW,
];

export const MISSION_CONTROL_NAV_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
];

export const MISSION_CONTROL_PROCESSES_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
];

export const MISSION_CONTROL_DECISIONS_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
];

export const MISSION_CONTROL_BATCHES_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
];

export const MISSION_CONTROL_BATCH_DELETE_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
  EnginePermission.INSTANCE_DELETE,
];

export const MISSION_CONTROL_BATCH_SUSPEND_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
  EnginePermission.PROCESS_MODIFY,
];

export const MISSION_CONTROL_BATCH_RETRY_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
  EnginePermission.INSTANCE_RETRY,
];

export const MISSION_CONTROL_MIGRATION_ENGINE_PERMISSIONS = [
  EnginePermission.INSTANCE_VIEW,
  EnginePermission.PROCESS_MODIFY,
];

export const STARBASE_NAV_PLATFORM_PERMISSIONS = [
  PlatformPermission.PROJECT_CREATE,
];

export function hasAnyProjectResourcePermission(snapshot: CurrentUserPermissions | null | undefined): boolean {
  return Boolean(snapshot?.projects?.some((project) => project.permissions.length > 0));
}

export function hasAnyVisibleProjectPermission(snapshot: CurrentUserPermissions | null | undefined): boolean {
  return Boolean(snapshot?.projects?.some((project) => project.permissions.includes(ProjectPermission.FILES_VIEW)));
}

export const USER_MANAGEMENT_PLATFORM_PERMISSIONS = [
  PlatformPermission.USER_MANAGE,
  PlatformPermission.USER_VIEW,
  PlatformPermission.USERS_VIEW,
  PlatformPermission.USERS_CREATE,
  PlatformPermission.USERS_UPDATE,
  PlatformPermission.USERS_DEACTIVATE,
  PlatformPermission.USERS_DELETE,
  PlatformPermission.USERS_PERMANENT_DELETE,
  PlatformPermission.USERS_UNLOCK,
];

export function hasPlatformPermission(snapshot: CurrentUserPermissions | null | undefined, permission: string): boolean {
  return Boolean(snapshot?.platform?.includes(permission));
}

export function hasAnyPlatformPermission(snapshot: CurrentUserPermissions | null | undefined, permissions: string[]): boolean {
  return permissions.some((permission) => hasPlatformPermission(snapshot, permission));
}

export function hasProjectPermission(
  snapshot: CurrentUserPermissions | null | undefined,
  projectId: string | null | undefined,
  permission: string
): boolean {
  if (!projectId) return false;
  const project = snapshot?.projects?.find((entry) => entry.resourceId === projectId);
  return Boolean(project?.permissions?.includes(permission));
}

export function hasAnyProjectPermission(
  snapshot: CurrentUserPermissions | null | undefined,
  projectId: string | null | undefined,
  permissions: string[]
): boolean {
  return permissions.some((permission) => hasProjectPermission(snapshot, projectId, permission));
}

export function hasAnyEnginePermission(snapshot: CurrentUserPermissions | null | undefined, permissions: string[]): boolean {
  return Boolean(snapshot?.engines?.some((engine) =>
    permissions.some((permission) => engine.permissions.includes(permission))
  ));
}

export function hasAnyEngineWithAllPermissions(snapshot: CurrentUserPermissions | null | undefined, permissions: string[]): boolean {
  if (permissions.length === 0) return false;
  return Boolean(snapshot?.engines?.some((engine) =>
    permissions.every((permission) => engine.permissions.includes(permission))
  ));
}

export function hasEnginePermission(
  snapshot: CurrentUserPermissions | null | undefined,
  engineId: string | null | undefined,
  permission: string
): boolean {
  if (!engineId) return false;
  const engine = snapshot?.engines?.find((entry) => entry.resourceId === engineId);
  return Boolean(engine?.permissions?.includes(permission));
}

export function hasAnyScopedEnginePermission(
  snapshot: CurrentUserPermissions | null | undefined,
  engineId: string | null | undefined,
  permissions: string[]
): boolean {
  return permissions.some((permission) => hasEnginePermission(snapshot, engineId, permission));
}

export function hasMissionControlUiAccess(
  snapshot: CurrentUserPermissions | null | undefined,
  _user?: unknown
): boolean {
  return hasAnyEnginePermission(snapshot, MISSION_CONTROL_NAV_ENGINE_PERMISSIONS);
}

export function hasMissionControlSectionAccess(
  snapshot: CurrentUserPermissions | null | undefined,
  _user: unknown,
  permissions: string[]
): boolean {
  return hasAnyEngineWithAllPermissions(snapshot, permissions);
}

export function hasEnginesUiAccess(
  snapshot: CurrentUserPermissions | null | undefined,
  _user?: unknown
): boolean {
  return hasAnyPlatformPermission(snapshot, ENGINES_NAV_PLATFORM_PERMISSIONS) ||
    hasAnyEnginePermission(snapshot, ENGINES_NAV_ENGINE_PERMISSIONS);
}

export function hasStarbaseUiAccess(
  snapshot: CurrentUserPermissions | null | undefined,
  _user?: unknown
): boolean {
  return hasAnyPlatformPermission(snapshot, STARBASE_NAV_PLATFORM_PERMISSIONS) ||
    hasAnyVisibleProjectPermission(snapshot) ||
    hasAnyProjectResourcePermission(snapshot);
}

export function hasAdminRouteAccess(
  snapshot: CurrentUserPermissions | null | undefined,
  _user?: unknown,
  requiredPlatformPermissions?: string[]
): boolean {
  return requiredPlatformPermissions?.length
    ? hasAnyPlatformPermission(snapshot, requiredPlatformPermissions)
    : hasAnyPlatformPermission(snapshot, ADMIN_NAV_PLATFORM_PERMISSIONS);
}
