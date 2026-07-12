import { type EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { engineSetService } from './EngineSetService.js';
import { resolveConfigEngineSetSelector } from './config-engine-set-selector.js';
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

function canonicalEngineKeyIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

function engineCredentialFields(auth: any): Record<string, string | null> {
  if (auth.type === 'basic') return { authType: 'basic', username: auth.username, passwordEnc: `ref:${auth.passwordRef}`, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null };
  if (auth.type === 'bearer') return { authType: 'bearer', username: null, passwordEnc: `ref:${auth.tokenRef}`, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null };
  if (auth.type === 'oauth2-client-credentials') return { authType: 'oauth2-client-credentials', username: auth.username, passwordEnc: `ref:${auth.passwordRef}`, oauthTokenUrl: auth.tokenUrl, oauthScopes: auth.scopes || null, oauthAudience: auth.audience || null };
  return { authType: 'none', username: null, passwordEnc: null, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null };
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
    const unsupported = Object.keys(compilation.files).filter((path) => !['./roles.json', './groups.json', './engines.json', './engine-sets.json', './assignments.json'].includes(path));
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
    const desiredEngines = new Map(entries(compilation.files, './engines.json', 'engines').map((engine) => [engine.key, engine]));
    const desiredEngineSets = new Map(entries(compilation.files, './engine-sets.json', 'engineSets').map((set) => [set.key, set]));
    const desiredAssignments = entries(compilation.files, './assignments.json', 'assignments');
    const materializeIds: string[] = [];
    const now = Date.now();
    let created = 0;
    let updated = 0;
    let archived = 0;

    const dataSource = await getDataSource();
    await dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(RbacRole);
      const groupRepo = manager.getRepository(AuthzGroup);
      const engineRepo = manager.getRepository(Engine);
      const engineSetRepo = manager.getRepository(EngineSet);
      const assignmentRepo = manager.getRepository(RbacRoleAssignment);
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

        if (change.objectType === 'engine') {
          const desired = desiredEngines.get(change.key);
          if (change.operation === 'create' && desired) {
            const engineId = generateId();
            await engineRepo.insert({
              id: engineId, tenantId, name: desired.name, baseUrl: desired.baseUrl, type: desired.type,
              externalId: desired.externalId || null, labelsJson: JSON.stringify(desired.labels || {}),
              registrationSource: 'config', sourceRef: `config_bundle:${manifest.metadata.key}`,
              configKey: desired.key, configKeyIdentity: canonicalEngineKeyIdentity(tenantId, desired.key),
              sourceHash: diff.canonicalHash, lastAppliedAt: now, ownershipMode: desired.ownershipMode || 'config_locked',
              managementMode: 'hybrid', fieldOwnershipJson: null, driftStatus: 'in_sync', lifecycleStatus: 'active',
              lastExternalSyncAt: null, capabilitiesJson: null, capabilityStatus: null, externalUpdatedAt: null,
              ...engineCredentialFields(desired.auth), version: desired.version || null, ownerId: null, delegateId: null,
              environmentTagId: desired.environmentTagId || null, environmentLocked: false,
              runtimeAccessScope: desired.runtimeAccessScope, deploymentIntegration: desired.deploymentIntegration, connectionMode: desired.connectionMode,
              createdAt: now, updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.engine.create', resourceType: 'engine', resourceId: engineId, details: { bundleKey: manifest.metadata.key, engineKey: desired.key, canonicalHash: diff.canonicalHash } });
            created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            await engineRepo.update({ id: change.currentId }, {
              name: desired.name, baseUrl: desired.baseUrl, type: desired.type, externalId: desired.externalId || null,
              labelsJson: JSON.stringify(desired.labels || {}), sourceHash: diff.canonicalHash, lastAppliedAt: now,
              ownershipMode: desired.ownershipMode || 'config_locked', lifecycleStatus: 'active', driftStatus: 'in_sync',
              ...engineCredentialFields(desired.auth), version: desired.version || null, environmentTagId: desired.environmentTagId || null,
              runtimeAccessScope: desired.runtimeAccessScope, deploymentIntegration: desired.deploymentIntegration, connectionMode: desired.connectionMode, updatedAt: now,
            });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.engine.update', resourceType: 'engine', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, engineKey: desired.key, canonicalHash: diff.canonicalHash } });
            updated += 1;
          } else if (change.operation === 'archive' && change.currentId) {
            await engineRepo.update({ id: change.currentId }, { lifecycleStatus: 'decommissioned', driftStatus: 'decommissioned', lastAppliedAt: now, updatedAt: now });
            await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.engine.decommission', resourceType: 'engine', resourceId: change.currentId, details: { bundleKey: manifest.metadata.key, engineKey: change.key, canonicalHash: diff.canonicalHash } });
            archived += 1;
          }
        }
        if (change.objectType === 'engine_set') {
          const desired = desiredEngineSets.get(change.key);
          const engineRows = await engineRepo.find();
          const keyToId = new Map(engineRows.filter((engine) => engine.configKey).map((engine) => [engine.configKey!, engine.id]));
          if (change.operation === 'create' && desired) {
            const id = generateId();
            const selector = resolveConfigEngineSetSelector(desired.selector, keyToId);
            await engineSetRepo.insert({ id, tenantId, key: desired.key, name: desired.name, description: desired.description || null, selectorJson: JSON.stringify(selector), selectorFingerprint: '', source: 'config', sourceRef: `config_bundle:${manifest.metadata.key}`, isArchived: false, createdById: input.actorId, lastMaterializedAt: null, materializationStatus: 'pending', materializationError: null, createdAt: now, updatedAt: now });
            materializeIds.push(id); created += 1;
          } else if (change.operation === 'update' && desired && change.currentId) {
            const selector = resolveConfigEngineSetSelector(desired.selector, keyToId);
            await engineSetRepo.update({ id: change.currentId }, { name: desired.name, description: desired.description || null, selectorJson: JSON.stringify(selector), isArchived: false, materializationStatus: 'pending', updatedAt: now });
            materializeIds.push(change.currentId); updated += 1;
          } else if (change.operation === 'archive' && change.currentId) { await engineSetRepo.update({ id: change.currentId }, { isArchived: true, materializationStatus: 'archived', updatedAt: now }); archived += 1; }
        }
      }

      // Resolve references after staged role/group/engine/Engine Set writes.
      const [roles, groups, engines, engineSets] = await Promise.all([
        roleRepo.find(), groupRepo.find(), engineRepo.find(), engineSetRepo.find(),
      ]);
      const roleByKey = new Map(roles.map((role) => [role.key, role]));
      const groupByKey = new Map(groups.map((group) => [group.key, group]));
      const engineByKey = new Map(engines.filter((engine) => engine.configKey).map((engine) => [engine.configKey!, engine]));
      const engineSetByKey = new Map(engineSets.map((set) => [set.key, set]));
      const sourceRef = `config_bundle:${manifest.metadata.key}`;
      const desiredKeys = new Set<string>();
      for (const assignment of desiredAssignments) {
        if (assignment.principal.type !== 'group') fail('Config apply currently supports group principals only', 422);
        if (!['platform', 'engine', 'engine_set'].includes(assignment.scope.type)) fail(`Config apply does not yet support ${assignment.scope.type} assignment scopes`, 422);
        const role = roleByKey.get(assignment.roleKey);
        const group = groupByKey.get(assignment.principal.key);
        if (!role || !group) fail(`Config assignment references an unresolved role or group: ${assignment.roleKey}`, 422);
        const scopeId = assignment.scope.type === 'platform' ? null
          : assignment.scope.type === 'engine' ? engineByKey.get(assignment.scope.engineKey)?.id
          : engineSetByKey.get(assignment.scope.engineSetKey)?.id;
        if (assignment.scope.type !== 'platform' && !scopeId) fail('Config assignment references an unresolved scope', 422);
        const assignmentKey = canonicalRoleAssignmentKey({ tenantId, principalType: 'group', principalId: group.id, roleId: role.id, scopeType: assignment.scope.type, scopeId, source: 'config', sourceRef });
        desiredKeys.add(assignmentKey);
        const existing = await assignmentRepo.findOne({ where: { assignmentKey } });
        if (!existing) {
          const assignmentId = generateId();
          await assignmentRepo.insert({ id: assignmentId, tenantId, userId: null, principalType: 'group', principalId: group.id, assignmentKey, roleId: role.id, resourceType: null, resourceId: null, scopeType: assignment.scope.type, scopeId: scopeId || null, source: 'config', sourceMappingId: null, sourceRef, expiresAt: assignment.expiresAt || null, lastSeenAt: now, createdById: input.actorId, createdAt: now, updatedAt: now });
          await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.assignment.create', resourceType: 'role_assignment', resourceId: assignmentId, details: { bundleKey: manifest.metadata.key, roleKey: assignment.roleKey, principalGroupKey: assignment.principal.key, scopeType: assignment.scope.type, canonicalHash: diff.canonicalHash } });
          created += 1;
        } else if (existing.expiresAt !== (assignment.expiresAt || null)) {
          await assignmentRepo.update({ id: existing.id }, { expiresAt: assignment.expiresAt || null, lastSeenAt: now, updatedAt: now });
          updated += 1;
        }
      }
      if (manifest.mode === 'authoritative') {
        const existing = await assignmentRepo.find({ where: { source: 'config', sourceRef } });
        const staleIds = existing.filter((assignment) => !desiredKeys.has(assignment.assignmentKey)).map((assignment) => assignment.id);
        if (staleIds.length > 0) {
          await assignmentRepo.delete(staleIds);
          for (const id of staleIds) await writeAudit(manager, { tenantId, actorId: input.actorId, action: 'authz.config_bundle.assignment.delete', resourceType: 'role_assignment', resourceId: id, details: { bundleKey: manifest.metadata.key, canonicalHash: diff.canonicalHash } });
          archived += staleIds.length;
        }
      }
    });
    for (const id of materializeIds) await engineSetService.materializeEngineSet(id, tenantId);

    return { canonicalHash: diff.canonicalHash, created, updated, archived, changes: diff.changes };
  }
}

export const configBundleApplyService = new ConfigBundleApplyService();
