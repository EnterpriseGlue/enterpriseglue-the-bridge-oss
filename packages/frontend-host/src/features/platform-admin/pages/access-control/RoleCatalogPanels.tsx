import { InlineNotification } from '@carbon/react';
import type { PermissionCatalogEntry, RoleSummary } from '../../hooks/useAuthzApi';
import { PermissionsTable } from './PermissionsTable';
import { RolesTable } from './RolesTable';
import type { RoleScopeFilter } from './roleScopePresentation';

function CatalogLoadError({ title }: { title: string }) {
  return (
    <div role="alert" aria-live="assertive">
      <InlineNotification kind="error" title={title} lowContrast />
    </div>
  );
}

export function RoleCatalogPanel({ roles, loading, failed, onCreate, onEdit, onDuplicate, onArchive, canManage, filterRoles }: {
  roles: RoleSummary[]; loading: boolean; failed: boolean; onCreate: () => void; onEdit: (role: RoleSummary) => void; onDuplicate: (role: RoleSummary) => void; onArchive: (role: RoleSummary) => void; canManage: boolean; filterRoles: (roles: RoleSummary[], search: string, scope: RoleScopeFilter) => RoleSummary[];
}) {
  if (failed) return <CatalogLoadError title="Unable to load roles" />;
  return <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}><RolesTable roles={roles} loading={loading} onCreate={onCreate} onEdit={onEdit} onDuplicate={onDuplicate} onArchive={onArchive} canManage={canManage} filterRoles={filterRoles} /><InlineNotification kind="info" lowContrast hideCloseButton title="System roles cannot be edited" subtitle="Duplicate a system role to create a custom role. Custom roles can be edited directly." /></div>;
}

export function PermissionCatalogPanel({ permissions, loading, failed, onCreate, canManage, filterPermissions, getPermissionImplications, getPermissionRisk }: {
  permissions: PermissionCatalogEntry[]; loading: boolean; failed: boolean; onCreate: () => void; canManage: boolean; filterPermissions: (items: PermissionCatalogEntry[], quickFilter: 'all' | 'view' | 'editor' | 'operator' | 'deployment') => PermissionCatalogEntry[]; getPermissionImplications: (permission: PermissionCatalogEntry) => string[]; getPermissionRisk: (permission: PermissionCatalogEntry) => { label: string; description: string } | null | undefined;
}) {
  if (failed) return <CatalogLoadError title="Unable to load permissions" />;
  return <PermissionsTable permissions={permissions} loading={loading} onCreate={onCreate} canManage={canManage} filterPermissions={filterPermissions} getPermissionImplications={getPermissionImplications} getPermissionRisk={getPermissionRisk} />;
}
