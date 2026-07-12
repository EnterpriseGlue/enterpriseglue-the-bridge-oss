import { type EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { configBundleDiffService, type ConfigBundleDiffChange } from './ConfigBundleDiffService.js';
import { configBundlePreviewService, type ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';

export interface ConfigBundleApplyInput extends ConfigBundlePreviewInput {
  expectedPreviewHash: string;
  tenantId?: string | null;
  actorId: string;
}

export interface ConfigBundleApplyResult {
  canonicalHash: string;
  created: number;
  updated: number;
  archived: number;
  changes: ConfigBundleDiffChange[];
}

function entries(files: Record<string, unknown>, path: string, property: string): any[] {
  const file = files[path] as Record<string, unknown> | undefined;
  return Array.isArray(file?.[property]) ? file[property] as any[] : [];
}

function canonicalRoleKeyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

function fail(message: string, statusCode: number): never {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  throw error;
}

async function writeAudit(manager: EntityManager, input: {
  tenantId: string | null;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await manager.getRepository(AuditLog).insert({
    id: generateId(),
    tenantId: input.tenantId,
    userId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    ipAddress: null,
    userAgent: null,
    details: JSON.stringify(input.details),
    createdAt: Date.now(),
  });
}

/**
 * Applies the first config-managed vertical. The bundle compiler and diff are
 * shared with the API/UI, and unsupported object families fail instead of
 * being silently ignored.
 */
class ConfigBundleApplyService {
  async apply(input: ConfigBundleApplyInput): Promise<ConfigBundleApplyResult> {
    const compilation = configBundlePreviewService.compile(input);
    if (!compilation.preview.valid || !compilation.manifest || !compilation.files || !compilation.preview.canonicalHash) {
      return fail('Configuration bundle is invalid', 422);
    }
    const manifest = compilation.manifest as { metadata: { key: string }; mode: string };
    if (manifest.mode === 'preview_only') {
      return fail('A preview_only bundle cannot be applied', 422);
    }
    if (input.expectedPreviewHash !== compilation.preview.canonicalHash) {
      return fail('Preview hash does not match the submitted configuration bundle', 409);
    }
    const unsupported = Object.keys(compilation.files).filter((path) => path !== './roles.json' && path !== './groups.json');
    if (unsupported.length > 0) {
      return fail(`Config apply does not yet support: ${unsupported.join(', ')}`, 422);
    }

    const tenantId = input.tenantId || null;
    const diff = await configBundleDiffService.diff(input, tenantId);
    if (!diff.valid || !diff.canonicalHash) return fail('Configuration bundle diff is invalid', 422);
    const conflicts = diff.changes.filter((change) => change.operation === 'conflict');
    if (conflicts.length > 0) {
      return fail(`Config apply conflicts with manually owned objects: ${conflicts.map((change) => `${change.objectType}:${change.key}`).join(', ')}`, 409);
    }

    const desiredRoles = new Map(entries(compilation.files, './roles.json', 'roles').map((role) => [role.key, role]));
    const desiredGroups = new Map(entries(compilation.files, './groups.json', 'groups').map((group) => [group.key, group]));
    const now = Date.now();
    let created = 0;
    let updated = 0;
    let archived = 0;

    const dataSource = await getDataSource();
    await dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(RbacRole);
      const groupRepo = manager.getRepository(AuthzGroup);
      const rolePermissionRepo = manager.getRepository(RbacRolePermission);

      for (const change of diff.changes) {
        if (change.operation === 'noop' || change.operation === 'conflict') continue;
        if (change.objectType === 'role') {
          const desired = desiredRoles.get(change.key);
          if (change.operation === 'create' && desired) {
            const roleId = generateId();
            await roleRepo.insert({
              id: roleId,
              tenantId,
              key: desired.key,
              roleKeyIdentity: canonicalRoleKeyIdentity(tenantId, desired.key),
              name: desired.name,
              description: desired.description || null,
              scope: desired.scope,
              kind: 'custom',
              isEditable: true,
              isAssignable: true,
              isArchived: false,
              source: 'config',
              sourceRef: `config_bundle:${manifest.metadata.key}`,
              createdById: input.actorId,
              createdAt: now,
              updatedAt: now,
            });
            const permissions = compilation.preview.expandedRolePermissions?.[desired.key] || desired.permissions || [];
            if (permissions.length > 0) {
              await rolePermissionRepo.insert(permissions.map((permissionId: string) => ({
                id: `${roleId}:${permissionId}`,
                roleId,
                permissionId,
                createdAt: now,
              })));
            }
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.role.create', resourceType: 'role', resourceId: roleId, details: { bundleKey: manifest.metadata.key, roleKey: desired.key, canonicalHash: diff.canonicalHash } });
            created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            await roleRepo.update({ id: change.currentId }, {
              name: desired.name,
              description: desired.description || null,
              scope: desired.scope,
              isArchived: false,
              isAssignable: true,
              updatedAt: now,
            });
            await rolePermissionRepo.delete({ roleId: change.currentId });
            const permissions = compilation.preview.expandedRolePermissions?.[desired.key] || desired.permissions || [];
            if (permissions.length > 0) {
              await rolePermissionRepo.insert(permissions.map((permissionId: string) => ({
                id: `${change.currentId}:${permissionId}`,
                roleId: change.currentId,
                permissionId,
                createdAt: now,
              })));
            }
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.role.update', resourceType: 'role', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, roleKey: desired.key, canonicalHash: diff.canonicalHash } });
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            await roleRepo.update({ id: change.currentId }, { isArchived: true, isAssignable: false, updatedAt: now });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.role.archive', resourceType: 'role', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, roleKey: change.key, canonicalHash: diff.canonicalHash } });
            archived += 1;
          }
        }

        if (change.objectType === 'group') {
          const desired = desiredGroups.get(change.key);
          if (change.operation === 'create' && desired) {
            const groupId = generateId();
            await groupRepo.insert({
              id: groupId,
              tenantId,
              key: desired.key,
              name: desired.name,
              description: desired.description || null,
              source: 'config',
              sourceRef: `config_bundle:${manifest.metadata.key}`,
              isSystem: false,
              isArchived: false,
              createdById: input.actorId,
              createdAt: now,
              updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.group.create', resourceType: 'authz_group', resourceId: groupId, details: { bundleKey: manifest.metadata.key, groupKey: desired.key, canonicalHash: diff.canonicalHash } });
            created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            await groupRepo.update({ id: change.currentId }, { name: desired.name, description: desired.description || null, isArchived: false, updatedAt: now });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.group.update', resourceType: 'authz_group', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, groupKey: desired.key, canonicalHash: diff.canonicalHash } });
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            await groupRepo.update({ id: change.currentId }, { isArchived: true, updatedAt: now });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.group.archive', resourceType: 'authz_group', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, groupKey: change.key, canonicalHash: diff.canonicalHash } });
            archived += 1;
          }
        }
      }
    });

    return { canonicalHash: diff.canonicalHash, created, updated, archived, changes: diff.changes };
  }
}

export const configBundleApplyService = new ConfigBundleApplyService();
