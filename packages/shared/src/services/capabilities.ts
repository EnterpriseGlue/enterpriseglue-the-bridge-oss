import { permissionService, PlatformPermissions, ProjectPermissions, EnginePermissions } from './platform-admin/permissions.js';
import { engineService } from './platform-admin/EngineService.js';
import type { UserCapabilities } from '@enterpriseglue/shared/contracts/auth';

export interface BuildUserCapabilitiesInput {
  userId: string;
  tenantId?: string | null;
  /**
   * Retained only for response and caller compatibility. Authorization is
   * resolved from canonical assignments and explicit grants.
   */
  platformRole?: string | null;
}

export async function buildUserCapabilities({
  userId,
  tenantId,
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
    permissionService.hasPermission(PlatformPermissions.USER_MANAGE, { userId, tenantId }),
    permissionService.hasPermission(PlatformPermissions.AUDIT_VIEW, { userId, tenantId }),
    permissionService.hasPermission(PlatformPermissions.SETTINGS_MANAGE, { userId, tenantId }),
    permissionService.hasPermission(ProjectPermissions.PROJECT_SETTINGS, { userId, tenantId }),
    permissionService.hasPermission(ProjectPermissions.MEMBERS_MANAGE, { userId, tenantId }),
    permissionService.hasPermission(EnginePermissions.ENGINE_EDIT, { userId, tenantId }),
    permissionService.hasPermission(EnginePermissions.MEMBERS_MANAGE, { userId, tenantId }),
    engineService.getUserEngines(userId, tenantId),
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
