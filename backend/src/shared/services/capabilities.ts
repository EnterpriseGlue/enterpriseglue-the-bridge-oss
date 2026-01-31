import { getDataSource } from '@shared/db/data-source.js';
import { Engine } from '@shared/db/entities/Engine.js';
import { EngineMember } from '@shared/db/entities/EngineMember.js';
import { ENGINE_VIEW_ROLES } from '@shared/constants/roles.js';
import { permissionService, PlatformPermissions } from './platform-admin/permissions.js';
import type { UserCapabilities } from '@enterpriseglue/contracts/auth';
import type { EngineRole } from '@shared/constants/roles.js';

export interface BuildUserCapabilitiesInput {
  userId: string;
  platformRole?: string | null;
}

export async function buildUserCapabilities({
  userId,
  platformRole,
}: BuildUserCapabilitiesInput): Promise<UserCapabilities> {
  const normalizedPlatformRole = platformRole || 'user';

  const [
    canManageUsers,
    canViewAuditLogs,
    canManagePlatformSettings,
  ] = await Promise.all([
    permissionService.hasPermission(PlatformPermissions.USER_MANAGE, { userId, platformRole: normalizedPlatformRole }),
    permissionService.hasPermission(PlatformPermissions.AUDIT_VIEW, { userId, platformRole: normalizedPlatformRole }),
    permissionService.hasPermission(PlatformPermissions.SETTINGS_MANAGE, { userId, platformRole: normalizedPlatformRole }),
  ]);

  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const engineMemberRepo = dataSource.getRepository(EngineMember);

  const [ownedEngines, delegatedEngines, engineMembers] = await Promise.all([
    engineRepo.find({ where: { ownerId: userId }, select: ['id'] }),
    engineRepo.find({ where: { delegateId: userId }, select: ['id'] }),
    engineMemberRepo.find({ where: { userId }, select: ['role'] }),
  ]);

  const hasMissionControlRole =
    ownedEngines.length > 0 ||
    delegatedEngines.length > 0 ||
    engineMembers.some((member) => ENGINE_VIEW_ROLES.includes(member.role as EngineRole));

  const canViewMissionControl = hasMissionControlRole;
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
  };
}
