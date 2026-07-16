import { InlineNotification } from '@carbon/react';
import type { PermissionCatalogEntry, RoleSummary } from '../../hooks/useAuthzApi';
import { PermissionsTable } from './PermissionsTable';
import { RolesTable } from './RolesTable';
import type { RoleScopeFilter } from './roleScopePresentation';

export function RoleCatalogPanel({ roles, loading, failed, onCreate, onEdit, onDuplicate, onArchive, canManage, filterRoles }: {
  roles: RoleSummary[]; loading: boolean; failed: boolean; onCreate: () => void; onEdit: (role: RoleSummary) => void; onDuplicate: (role: RoleSummary) => void; onArchive: (role: RoleSummary) => void; canManage: boolean; filterRoles: (roles: RoleSummary[], search: string, scope: RoleScopeFilter) => RoleSummary[];
}) {
  if (failed) return <InlineNotification kind="error" title="Unable to load roles" lowContrast />;
  return <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}><RolesTable roles={roles} loading={loading} onCreate={onCreate} onEdit={onEdit} onDuplicate={onDuplicate} onArchive={onArchive} canManage={canManage} filterRoles={filterRoles} /><InlineNotification kind="info" lowContrast hideCloseButton title="Edit one role at a time" subtitle="Use Edit for custom roles or Duplicate for system roles. The focused role editor keeps permissions scoped, avoids horizontal comparison tables, and requires acknowledgement for sensitive permissions." /></div>;
}

export function PermissionCatalogPanel({ permissions, loading, failed, onCreate, canManage, filterPermissions, getPermissionImplications, getPermissionRisk }: {
  permissions: PermissionCatalogEntry[]; loading: boolean; failed: boolean; onCreate: () => void; canManage: boolean; filterPermissions: (items: PermissionCatalogEntry[], quickFilter: 'all' | 'view' | 'editor' | 'operator' | 'deployment') => PermissionCatalogEntry[]; getPermissionImplications: (permission: PermissionCatalogEntry) => string[]; getPermissionRisk: (permission: PermissionCatalogEntry) => { label: string; description: string } | null | undefined;
}) {
  if (failed) return <InlineNotification kind="error" title="Unable to load permissions" lowContrast />;
  return <PermissionsTable permissions={permissions} loading={loading} onCreate={onCreate} canManage={canManage} filterPermissions={filterPermissions} getPermissionImplications={getPermissionImplications} getPermissionRisk={getPermissionRisk} />;
}
