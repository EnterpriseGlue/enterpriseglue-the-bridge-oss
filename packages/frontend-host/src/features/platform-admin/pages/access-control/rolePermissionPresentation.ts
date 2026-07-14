import type { AuthzResourceType, PermissionCatalogEntry } from '../../hooks/useAuthzApi';

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
