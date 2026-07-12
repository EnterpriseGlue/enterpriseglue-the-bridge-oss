import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { configBundlePreviewService, type ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';

export type ConfigBundleDiffOperation = 'create' | 'update' | 'noop' | 'archive' | 'conflict';

export interface ConfigBundleDiffChange {
  objectType: 'role' | 'group';
  key: string;
  operation: ConfigBundleDiffOperation;
  reason: string;
  currentId?: string;
}

export interface ConfigBundleDiff {
  valid: boolean;
  canonicalHash?: string;
  errors: Array<{ path: string; message: string }>;
  changes: ConfigBundleDiffChange[];
}

const CONFIG_SOURCE = 'config';

export function configBundleSourceRef(bundleKey: string): string {
  return `config_bundle:${bundleKey}`;
}

function values(files: Record<string, unknown>, path: string, key: string): any[] {
  const file = files[path] as Record<string, unknown> | undefined;
  return Array.isArray(file?.[key]) ? file[key] as any[] : [];
}

function samePermissions(left: string[], right: string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

/**
 * Produces a persisted-state diff for the currently supported config-owned
 * objects. It is intentionally read-only and must be used before apply.
 */
class ConfigBundleDiffService {
  async diff(input: ConfigBundlePreviewInput, tenantId?: string | null): Promise<ConfigBundleDiff> {
    const compilation = configBundlePreviewService.compile(input);
    if (!compilation.preview.valid || !compilation.manifest || !compilation.files || !compilation.preview.canonicalHash) {
      return { valid: false, errors: compilation.preview.errors, changes: [] };
    }

    const manifest = compilation.manifest as { metadata: { key: string }; mode: string };
    const sourceRef = configBundleSourceRef(manifest.metadata.key);
    const normalizedTenantId = tenantId || null;
    const dataSource = await getDataSource();
    const [roles, groups, rolePermissions] = await Promise.all([
      dataSource.getRepository(RbacRole).find(),
      dataSource.getRepository(AuthzGroup).find(),
      dataSource.getRepository(RbacRolePermission).find(),
    ]);
    const rolePermissionsByRoleId = new Map<string, string[]>();
    for (const permission of rolePermissions) {
      rolePermissionsByRoleId.set(permission.roleId, [...(rolePermissionsByRoleId.get(permission.roleId) || []), permission.permissionId]);
    }
    const tenantRoles = roles.filter((role) => (role.tenantId || null) === normalizedTenantId);
    const tenantGroups = groups.filter((group) => (group.tenantId || null) === normalizedTenantId);
    const rolesByKey = new Map(tenantRoles.map((role) => [role.key, role]));
    const groupsByKey = new Map(tenantGroups.map((group) => [group.key, group]));
    const changes: ConfigBundleDiffChange[] = [];

    const desiredRoles = values(compilation.files, './roles.json', 'roles');
    const desiredRoleKeys = new Set(desiredRoles.map((role) => role.key));
    for (const role of desiredRoles) {
      const existing = rolesByKey.get(role.key);
      const permissions = compilation.preview.expandedRolePermissions?.[role.key] || role.permissions || [];
      if (!existing) {
        changes.push({ objectType: 'role', key: role.key, operation: 'create', reason: 'No persisted role uses this tenant-scoped key' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'role', key: role.key, operation: 'conflict', currentId: existing.id, reason: 'Existing role is not owned by this configuration bundle' });
      } else if (
        existing.name !== role.name ||
        (existing.description || null) !== (role.description || null) ||
        existing.scope !== role.scope ||
        existing.isArchived ||
        !samePermissions(rolePermissionsByRoleId.get(existing.id) || [], permissions)
      ) {
        changes.push({ objectType: 'role', key: role.key, operation: 'update', currentId: existing.id, reason: 'Config-owned role differs from the desired name, scope, description, archive state, or permissions' });
      } else {
        changes.push({ objectType: 'role', key: role.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned role already matches the desired state' });
      }
    }

    const desiredGroups = values(compilation.files, './groups.json', 'groups');
    const desiredGroupKeys = new Set(desiredGroups.map((group) => group.key));
    for (const group of desiredGroups) {
      const existing = groupsByKey.get(group.key);
      if (!existing) {
        changes.push({ objectType: 'group', key: group.key, operation: 'create', reason: 'No persisted group uses this tenant-scoped key' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'group', key: group.key, operation: 'conflict', currentId: existing.id, reason: 'Existing group is not owned by this configuration bundle' });
      } else if (existing.name !== group.name || (existing.description || null) !== (group.description || null) || existing.isArchived) {
        changes.push({ objectType: 'group', key: group.key, operation: 'update', currentId: existing.id, reason: 'Config-owned group differs from the desired name, description, or archive state' });
      } else {
        changes.push({ objectType: 'group', key: group.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned group already matches the desired state' });
      }
    }

    if (manifest.mode === 'authoritative') {
      for (const role of tenantRoles) {
        if (role.source === CONFIG_SOURCE && role.sourceRef === sourceRef && !desiredRoleKeys.has(role.key) && !role.isArchived) {
          changes.push({ objectType: 'role', key: role.key, operation: 'archive', currentId: role.id, reason: 'Config-owned role is absent from an authoritative bundle' });
        }
      }
      for (const group of tenantGroups) {
        if (group.source === CONFIG_SOURCE && group.sourceRef === sourceRef && !desiredGroupKeys.has(group.key) && !group.isArchived) {
          changes.push({ objectType: 'group', key: group.key, operation: 'archive', currentId: group.id, reason: 'Config-owned group is absent from an authoritative bundle' });
        }
      }
    }

    return { valid: true, canonicalHash: compilation.preview.canonicalHash, errors: [], changes };
  }
}

export const configBundleDiffService = new ConfigBundleDiffService();
