import { permissionService, PlatformPermissions, ProjectPermissions, EnginePermissions } from './platform-admin/permissions.js';
import { engineService } from './platform-admin/EngineService.js';
import type { UserCapabilities } from '@enterpriseglue/shared/contracts/auth';

export interface BuildUserCapabilitiesInput {
  userId: string;
  /**
   * Retained only for response and caller compatibility. Authorization is
   * resolved from canonical assignments and explicit grants.
   */
  platformRole?: string | null;
}

export async function buildUserCapabilities({
  userId,
}: BuildUserCapabilitiesInput): Promise<UserCapabilities> {
  const [
    canManageUsers,
    canViewAuditLogs,
    canManagePlatformSettings,
    canManageProject,
    canInviteProjectMembers,
    canManageEngine,
    canInviteEngineMembers,
    visibleEngines,
  ] = await Promise.all([
    permissionService.hasPermission(PlatformPermissions.USER_MANAGE, { userId }),
    permissionService.hasPermission(PlatformPermissions.AUDIT_VIEW, { userId }),
    permissionService.hasPermission(PlatformPermissions.SETTINGS_MANAGE, { userId }),
    permissionService.hasPermission(ProjectPermissions.PROJECT_SETTINGS, { userId }),
    permissionService.hasPermission(ProjectPermissions.MEMBERS_MANAGE, { userId }),
    permissionService.hasPermission(EnginePermissions.ENGINE_EDIT, { userId }),
    permissionService.hasPermission(EnginePermissions.MEMBERS_MANAGE, { userId }),
    engineService.getUserEngines(userId),
  ]);

  const canViewMissionControl = visibleEngines.length > 0;
  const canViewAdminMenu = canManageUsers || canViewAuditLogs || canManagePlatformSettings;
  const canAccessAdminRoutes = canViewAdminMenu;
  const canManageTenants = canManagePlatformSettings;

  return {
    canViewAdminMenu,
    canAccessAdminRoutes,
    canManageUsers,
    canViewAuditLogs,
    canManagePlatformSettings,
    canViewMissionControl,
    canManageTenants,
    canManagePlatformEmail: canManagePlatformSettings,
    canManageSsoProviders: canManagePlatformSettings,
    canManagePlatformBranding: canManagePlatformSettings,
    canManageTenantDomains: false,
    canManageTenantUsers: false,
    canManageTenantBranding: false,
    canManageTenantEmailTemplates: false,
    canViewTenantAudit: false,
    canManageTenantSso: false,
    canManageProject,
    canManageEngine,
    canInviteProjectMembers,
    canInviteEngineMembers,
  };
}
