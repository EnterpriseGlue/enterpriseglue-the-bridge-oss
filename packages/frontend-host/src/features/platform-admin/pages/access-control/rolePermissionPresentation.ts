import type { AuthzResourceType, PermissionCatalogEntry } from '../../hooks/useAuthzApi';
import { getPermissionRiskForKey } from '../../../../shared/auth/permissionRisk';

export type PermissionQuickFilter = 'all' | 'view' | 'editor' | 'operator' | 'deployment';

export interface RolePermissionGroup {
  id: string;
  label: string;
  scope: AuthzResourceType;
  permissions: PermissionCatalogEntry[];
}

export function groupPermissionsForRoleMatrix(permissions: PermissionCatalogEntry[]): RolePermissionGroup[] {
  const groups = new Map<string, RolePermissionGroup>();

  permissions.forEach((permission) => {
    const category = permission.category || 'General';
    const id = `${permission.scope}:${category}`;
    const existing = groups.get(id);
    if (existing) {
      existing.permissions.push(permission);
      return;
    }
    groups.set(id, {
      id,
      label: category,
      scope: permission.scope,
      permissions: [permission],
    });
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    permissions: group.permissions.sort((left, right) => left.label.localeCompare(right.label)),
  }));
}

export function getPermissionRisk(permission: PermissionCatalogEntry) {
  return getPermissionRiskForKey(permission.key);
}

export function getPermissionImplications(permission: PermissionCatalogEntry): string[] {
  const key = permission.key;
  const implications: string[] = [];

  if (key.startsWith('project:files:') && key !== 'project:files:view') implications.push('project:files:view');
  if (key.startsWith('project:members:') && key !== 'project:members:view') implications.push('project:members:view');
  if (key === 'project:versions:create' || key === 'project:versions:restore') implications.push('project:files:view');
  if (key.startsWith('engine:members:') && key !== 'engine:members:view') implications.push('engine:members:view');
  if (key.startsWith('engine:instance:') && key !== 'engine:instance:view') implications.push('engine:instance:view');
  if (key.startsWith('engine:process:')) implications.push('engine:instance:view');
  if (key === 'engine:deploy') implications.push('engine:deploy:view');

  return Array.from(new Set(implications));
}

function permissionMatchesQuickFilter(permission: PermissionCatalogEntry, filter: PermissionQuickFilter) {
  const key = permission.key;
  if (filter === 'all') return true;
  if (filter === 'view') return key.endsWith(':view') || key.includes(':view') || key === 'platform:audit:view';
  if (filter === 'editor') {
    return key.includes(':create') || key.includes(':edit') || key.includes(':update') || key.includes(':restore') || key.includes(':push') || key.includes(':pull') || key.includes(':connect');
  }
  if (filter === 'operator') {
    return key.startsWith('engine:process:') || key.startsWith('engine:instance:') || key === 'engine:activate' || key === 'engine:variables:edit';
  }
  return key.includes(':deploy') || key === 'project:deploy' || key === 'engine:deploy' || key === 'engine:deploy:view';
}

export function filterPermissions(permissions: PermissionCatalogEntry[], quickFilter: PermissionQuickFilter) {
  return permissions.filter((permission) => permissionMatchesQuickFilter(permission, quickFilter));
}
