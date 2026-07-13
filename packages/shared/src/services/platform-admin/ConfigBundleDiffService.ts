import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { configBundlePreviewService, type ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';

export type ConfigBundleDiffOperation = 'create' | 'update' | 'noop' | 'archive' | 'conflict';

export interface ConfigBundleDiffChange {
  objectType: 'role' | 'group' | 'engine' | 'engine_set' | 'runtime_resource_set' | 'identity_provider' | 'identity_mapping' | 'project_engine_target' | 'assignment';
  key: string;
  operation: ConfigBundleDiffOperation;
  reason: string;
  currentId?: string;
}

export interface ConfigBundleDiffWarning {
  id: string;
  message: string;
  acknowledgementId?: string;
}

export interface ConfigBundleDiff {
  valid: boolean;
  canonicalHash?: string;
  errors: Array<{ path: string; message: string }>;
  changes: ConfigBundleDiffChange[];
  warnings: ConfigBundleDiffWarning[];
  requiredAcknowledgements: string[];
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

function providerConfiguration(provider: any): Record<string, unknown> {
  return provider[provider.type] || {};
}

function assignmentDisplayKey(assignment: any): string {
  if (assignment.key) return assignment.key;
  const principal = assignment.principal.key || assignment.principal.id;
  const scope = assignment.scope;
  const scopeReference = scope.engineKey || scope.engineSetKey || scope.runtimeResourceSetKey || scope.resourceKey || scope.projectRef?.id || scope.projectRef?.key || 'platform';
  return `${assignment.principal.type}:${principal}:${assignment.roleKey}:${scope.type}:${scopeReference}`;
}

function broadConfigurationWarnings(files: Record<string, unknown>): ConfigBundleDiffWarning[] {
  const warnings: ConfigBundleDiffWarning[] = [];
  for (const engineSet of values(files, './engine-sets.json', 'engineSets')) {
    if (engineSet.selector.mode === 'all' || (engineSet.selector.mode === 'labels' && engineSet.selector.labelMatch === 'any')) {
      const acknowledgementId = `config.engine_set_broad:${engineSet.key}`;
      warnings.push({
        id: acknowledgementId,
        acknowledgementId,
        message: `Engine Set ${engineSet.key} uses a broad ${engineSet.selector.mode === 'all' ? 'all-engines' : 'any-label'} selector.`,
      });
    }
  }
  for (const mapping of values(files, './identity-mappings.json', 'identityMappings')) {
    if (mapping.source.operator === 'contains' || mapping.source.operator === 'exists') {
      const acknowledgementId = `config.identity_mapping_broad:${mapping.key}`;
      warnings.push({
        id: acknowledgementId,
        acknowledgementId,
        message: `Identity mapping ${mapping.key} uses the broad ${mapping.source.operator} entitlement operator.`,
      });
    }
  }
  return warnings;
}

/**
 * Produces a persisted-state diff for the currently supported config-owned
 * objects. It is intentionally read-only and must be used before apply.
 */
class ConfigBundleDiffService {
  async diff(input: ConfigBundlePreviewInput, tenantId?: string | null): Promise<ConfigBundleDiff> {
    const compilation = configBundlePreviewService.compile(input);
    if (!compilation.preview.valid || !compilation.manifest || !compilation.files || !compilation.preview.canonicalHash) {
      return { valid: false, errors: compilation.preview.errors, changes: [], warnings: [], requiredAcknowledgements: [] };
    }

    const manifest = compilation.manifest as { metadata: { key: string }; mode: string };
    const sourceRef = configBundleSourceRef(manifest.metadata.key);
    const normalizedTenantId = tenantId || null;
    const dataSource = await getDataSource();
    const [roles, groups, engines, engineSets, runtimeResourceSets, rolePermissions, identityProviders, identityMappings, projectEngineTargets, assignments, runtimeResources, projects] = await Promise.all([
      dataSource.getRepository(RbacRole).find(),
      dataSource.getRepository(AuthzGroup).find(),
      dataSource.getRepository(Engine).find(),
      dataSource.getRepository(EngineSet).find(),
      dataSource.getRepository(RuntimeResourceSet).find(),
      dataSource.getRepository(RbacRolePermission).find(),
      dataSource.getRepository(IdentityProvider).find(),
      dataSource.getRepository(IdentityEntitlementMapping).find(),
      dataSource.getRepository(ProjectEngineTarget).find(),
      dataSource.getRepository(RbacRoleAssignment).find(),
      dataSource.getRepository(RuntimeResource).find(),
      dataSource.getRepository(Project).find(),
    ]);
    const rolePermissionsByRoleId = new Map<string, string[]>();
    for (const permission of rolePermissions) {
      rolePermissionsByRoleId.set(permission.roleId, [...(rolePermissionsByRoleId.get(permission.roleId) || []), permission.permissionId]);
    }
    const tenantRoles = roles.filter((role) => (role.tenantId || null) === normalizedTenantId);
    const tenantGroups = groups.filter((group) => (group.tenantId || null) === normalizedTenantId);
    const rolesByKey = new Map(tenantRoles.map((role) => [role.key, role]));
    const groupsByKey = new Map(tenantGroups.map((group) => [group.key, group]));
    const tenantEngines = engines.filter((engine) => (engine.tenantId || null) === normalizedTenantId);
    const enginesByConfigKey = new Map(tenantEngines.filter((engine) => engine.configKey).map((engine) => [engine.configKey!, engine]));
    const tenantEngineSets = engineSets.filter((set) => (set.tenantId || null) === normalizedTenantId);
    const engineSetsByKey = new Map(tenantEngineSets.map((set) => [set.key, set]));
    const tenantRuntimeResourceSets = runtimeResourceSets.filter((set) => (set.tenantId || null) === normalizedTenantId);
    const runtimeResourceSetsByKey = new Map(tenantRuntimeResourceSets.map((set) => [set.key, set]));
    const tenantIdentityProviders = identityProviders.filter((provider) => (provider.tenantId || null) === normalizedTenantId);
    const identityProvidersByKey = new Map(tenantIdentityProviders.map((provider) => [provider.key, provider]));
    const tenantIdentityMappings = identityMappings.filter((mapping) => (mapping.tenantId || null) === normalizedTenantId);
    const identityMappingsByKey = new Map(tenantIdentityMappings.filter((mapping) => mapping.configKey).map((mapping) => [mapping.configKey!, mapping]));
    const tenantProjectEngineTargets = projectEngineTargets.filter((target) => (target.tenantId || null) === normalizedTenantId);
    const projectEngineTargetsByPair = new Map(tenantProjectEngineTargets.map((target) => [`${target.projectId}:${target.engineId}`, target]));
    const tenantProjectIds = new Set(projects.filter((project) => (project.tenantId || null) === normalizedTenantId).map((project) => project.id));
    const tenantAssignments = assignments.filter((assignment) => (assignment.tenantId || null) === normalizedTenantId);
    const assignmentsByKey = new Map(tenantAssignments.map((assignment) => [assignment.assignmentKey, assignment]));
    const tenantRuntimeResources = runtimeResources.filter((resource) => (resource.tenantId || null) === normalizedTenantId);
    const runtimeResourcesByIdentity = new Map(tenantRuntimeResources.map((resource) => [`${resource.engineId}:${resource.resourceKind}:${resource.resourceKey}:${resource.runtimeTenantId || ''}`, resource]));
    const changes: ConfigBundleDiffChange[] = [];
    const warnings = broadConfigurationWarnings(compilation.files);

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

    const desiredEngines = values(compilation.files, './engines.json', 'engines');
    const desiredEngineKeys = new Set(desiredEngines.map((engine) => engine.key));
    for (const engine of desiredEngines) {
      const existing = enginesByConfigKey.get(engine.key) || tenantEngines.find((candidate) => candidate.externalId && candidate.externalId === engine.externalId);
      if (!existing) {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'create', reason: 'No persisted engine uses this config key or external id' });
      } else if (existing.registrationSource !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'conflict', currentId: existing.id, reason: 'Existing engine is not owned by this configuration bundle' });
      } else if (
        existing.name !== engine.name || existing.baseUrl !== engine.baseUrl || existing.type !== engine.type ||
        existing.externalId !== (engine.externalId || null) || existing.labelsJson !== JSON.stringify(engine.labels || {}) ||
        existing.runtimeAccessScope !== engine.runtimeAccessScope || existing.deploymentIntegration !== engine.deploymentIntegration ||
        (existing.metadataDiscoveryEnabled !== false) !== engine.metadataDiscoveryEnabled ||
        (existing.pipelineReceiptEnabled !== false) !== engine.pipelineReceiptEnabled ||
        existing.connectionMode !== engine.connectionMode || existing.ownershipMode !== (engine.ownershipMode || 'config_locked') ||
        existing.lifecycleStatus === 'decommissioned'
      ) {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'update', currentId: existing.id, reason: 'Config-owned engine differs from desired connection, metadata, or authorization settings' });
      } else {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned engine already matches the desired state' });
      }
    }

    const desiredEngineSets = values(compilation.files, './engine-sets.json', 'engineSets');
    const desiredEngineSetKeys = new Set(desiredEngineSets.map((set) => set.key));
    for (const set of desiredEngineSets) {
      const existing = engineSetsByKey.get(set.key);
      if (!existing) changes.push({ objectType: 'engine_set', key: set.key, operation: 'create', reason: 'No persisted Engine Set uses this tenant-scoped key' });
      else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) changes.push({ objectType: 'engine_set', key: set.key, operation: 'conflict', currentId: existing.id, reason: 'Existing Engine Set is not owned by this configuration bundle' });
      else if (existing.name !== set.name || (existing.description || null) !== (set.description || null) || existing.isArchived) changes.push({ objectType: 'engine_set', key: set.key, operation: 'update', currentId: existing.id, reason: 'Config-owned Engine Set differs from desired metadata or archive state' });
      else changes.push({ objectType: 'engine_set', key: set.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned Engine Set metadata already matches the desired state' });
    }

    const desiredRuntimeResourceSets = values(compilation.files, './runtime-resource-sets.json', 'runtimeResourceSets');
    const desiredRuntimeResourceSetKeys = new Set(desiredRuntimeResourceSets.map((set) => set.key));
    for (const set of desiredRuntimeResourceSets) {
      const existing = runtimeResourceSetsByKey.get(set.key);
      const engine = enginesByConfigKey.get(set.engineRef.engineKey);
      if (!existing) {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'create', reason: 'No persisted Runtime Resource Set uses this tenant-scoped key' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'conflict', currentId: existing.id, reason: 'Existing Runtime Resource Set is not owned by this configuration bundle' });
      } else if (
        existing.name !== set.name ||
        (existing.description || null) !== (set.description || null) ||
        existing.engineId !== engine?.id ||
        existing.resourceKind !== set.resourceKind ||
        existing.selectorJson !== JSON.stringify(set.selector) ||
        existing.runtimeTenantId !== (set.runtimeTenantId || null) ||
        existing.isArchived
      ) {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'update', currentId: existing.id, reason: 'Config-owned Runtime Resource Set differs from the desired engine, selector, tenant, metadata, or archive state' });
      } else {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned Runtime Resource Set already matches the desired state' });
      }
    }

    const desiredIdentityProviders = values(compilation.files, './identity-providers.json', 'identityProviders');
    const desiredIdentityProviderKeys = new Set(desiredIdentityProviders.map((provider) => provider.key));
    for (const provider of desiredIdentityProviders) {
      const existing = identityProvidersByKey.get(provider.key);
      const configurationJson = JSON.stringify(providerConfiguration(provider));
      const syncJson = JSON.stringify(provider.sync);
      if (!existing) {
        changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'create', reason: 'No persisted identity provider uses this tenant-scoped key' });
      } else if (existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'conflict', currentId: existing.id, reason: 'Existing identity provider is not owned by this configuration bundle' });
      } else if (
        existing.protocol !== provider.type || existing.isEnabled !== provider.enabled ||
        existing.authenticationMode !== provider.authenticationMode ||
        existing.directoryTenantId !== (provider.directoryTenantId || null) ||
        existing.configurationJson !== configurationJson || existing.syncJson !== syncJson ||
        existing.ownershipMode !== (provider.ownershipMode || 'config_locked')
      ) {
        changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'update', currentId: existing.id, reason: 'Config-owned identity provider differs from the desired protocol, configuration, sync, or ownership state' });
      } else {
        changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned identity provider already matches the desired state' });
      }
    }

    const desiredIdentityMappings = values(compilation.files, './identity-mappings.json', 'identityMappings');
    const desiredIdentityMappingKeys = new Set(desiredIdentityMappings.map((mapping) => mapping.key));
    for (const mapping of desiredIdentityMappings) {
      const existing = identityMappingsByKey.get(mapping.key);
      const provider = identityProvidersByKey.get(mapping.providerKey);
      const group = groupsByKey.get(mapping.targetGroupKey);
      if (!existing) changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'create', reason: 'No persisted identity mapping uses this config key' });
      else if (existing.sourceRef !== sourceRef) changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'conflict', currentId: existing.id, reason: 'Existing identity mapping is not owned by this configuration bundle' });
      else if (
        existing.providerId !== provider?.id || existing.targetGroupId !== group?.id ||
        existing.entitlementType !== mapping.source.type || existing.externalId !== (mapping.source.externalId || null) ||
        existing.matchOperator !== mapping.source.operator || existing.syncMode !== mapping.syncMode || !existing.isActive
      ) changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'update', currentId: existing.id, reason: 'Config-owned identity mapping differs from desired provider, entitlement, target group, sync mode, or active state' });
      else changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned identity mapping already matches the desired state' });
    }

    const desiredProjectEngineTargets = values(compilation.files, './project-engine-targets.json', 'projectEngineTargets');
    const desiredProjectEngineTargetPairs = new Set<string>();
    for (const target of desiredProjectEngineTargets) {
      const projectId = target.projectRef.id;
      const engine = enginesByConfigKey.get(target.engineRef.engineKey);
      const key = target.key || `${projectId || 'unresolved-project'}:${target.engineRef.engineKey}`;
      if (!projectId || !tenantProjectIds.has(projectId) || !engine) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'conflict', reason: 'Project-engine target references an unresolved project id or configured engine' });
        continue;
      }
      const pair = `${projectId}:${engine.id}`;
      desiredProjectEngineTargetPairs.add(pair);
      const existing = projectEngineTargetsByPair.get(pair);
      if (!existing) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'create', reason: 'No persisted project-engine target uses this project and configured engine pair' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'conflict', currentId: existing.id, reason: 'Existing project-engine target is not owned by this configuration bundle' });
      } else if (
        existing.status !== target.status ||
        existing.allowManualDeploy !== target.allowManualDeploy ||
        existing.allowCiDeploy !== target.allowCiDeploy ||
        existing.allowApiDeploy !== target.allowApiDeploy ||
        existing.allowImport !== target.allowImport
      ) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'update', currentId: existing.id, reason: 'Config-owned project-engine target differs from desired status or deployment eligibility modes' });
      } else {
        changes.push({ objectType: 'project_engine_target', key, operation: 'noop', currentId: existing.id, reason: 'Config-owned project-engine target already matches the desired state' });
      }
    }

    const desiredAssignments = values(compilation.files, './assignments.json', 'assignments');
    const desiredAssignmentKeys = new Set<string>();
    for (const assignment of desiredAssignments) {
      const key = assignmentDisplayKey(assignment);
      if (assignment.principal.type !== 'group') {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', reason: 'Config apply currently supports group principals only' });
        continue;
      }
      if (!['platform', 'engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set'].includes(assignment.scope.type)) {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', reason: `Config apply does not yet support ${assignment.scope.type} assignment scopes` });
        continue;
      }
      const role = rolesByKey.get(assignment.roleKey);
      const group = groupsByKey.get(assignment.principal.key);
      let scopeId: string | null = assignment.scope.type === 'platform' ? null
        : assignment.scope.type === 'engine' ? enginesByConfigKey.get(assignment.scope.engineKey)?.id || null
        : assignment.scope.type === 'engine_set' ? engineSetsByKey.get(assignment.scope.engineSetKey)?.id || null
        : assignment.scope.type === 'engine_runtime_resource_set' ? runtimeResourceSetsByKey.get(assignment.scope.runtimeResourceSetKey)?.id || null
        : null;
      if (assignment.scope.type === 'engine_runtime_resource') {
        const engine = enginesByConfigKey.get(assignment.scope.engineKey);
        scopeId = engine
          ? runtimeResourcesByIdentity.get(`${engine.id}:${assignment.scope.resourceKind}:${assignment.scope.resourceKey}:${assignment.scope.runtimeTenantId || ''}`)?.id || null
          : null;
      }
      if (!role || !group || (assignment.scope.type !== 'platform' && !scopeId)) {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', reason: 'Assignment references an unresolved role, group, or scope' });
        continue;
      }
      const assignmentKey = canonicalRoleAssignmentKey({
        tenantId: normalizedTenantId,
        principalType: 'group',
        principalId: group.id,
        roleId: role.id,
        scopeType: assignment.scope.type,
        scopeId,
        source: CONFIG_SOURCE,
        sourceRef,
      });
      desiredAssignmentKeys.add(assignmentKey);
      const existing = assignmentsByKey.get(assignmentKey);
      if (!existing) {
        changes.push({ objectType: 'assignment', key, operation: 'create', reason: 'No persisted scoped role assignment uses this canonical config-owned identity' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', currentId: existing.id, reason: 'Existing scoped role assignment is not owned by this configuration bundle' });
      } else if (existing.expiresAt !== (assignment.expiresAt || null)) {
        changes.push({ objectType: 'assignment', key, operation: 'update', currentId: existing.id, reason: 'Config-owned scoped role assignment differs from the desired expiration' });
      } else {
        changes.push({ objectType: 'assignment', key, operation: 'noop', currentId: existing.id, reason: 'Config-owned scoped role assignment already matches the desired state' });
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
      for (const engine of tenantEngines) {
        if (engine.registrationSource === CONFIG_SOURCE && engine.sourceRef === sourceRef && engine.configKey && !desiredEngineKeys.has(engine.configKey) && engine.lifecycleStatus !== 'decommissioned') {
          changes.push({ objectType: 'engine', key: engine.configKey, operation: 'archive', currentId: engine.id, reason: 'Config-owned engine is absent from an authoritative bundle' });
        }
      }
      for (const set of tenantEngineSets) {
        if (set.source === CONFIG_SOURCE && set.sourceRef === sourceRef && !desiredEngineSetKeys.has(set.key) && !set.isArchived) changes.push({ objectType: 'engine_set', key: set.key, operation: 'archive', currentId: set.id, reason: 'Config-owned Engine Set is absent from an authoritative bundle' });
      }
      for (const set of tenantRuntimeResourceSets) {
        if (set.source === CONFIG_SOURCE && set.sourceRef === sourceRef && !desiredRuntimeResourceSetKeys.has(set.key) && !set.isArchived) {
          changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'archive', currentId: set.id, reason: 'Config-owned Runtime Resource Set is absent from an authoritative bundle' });
        }
      }
      for (const provider of tenantIdentityProviders) {
        if (provider.sourceRef === sourceRef && !desiredIdentityProviderKeys.has(provider.key) && provider.isEnabled) {
          changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'archive', currentId: provider.id, reason: 'Config-owned identity provider is absent from an authoritative bundle' });
        }
      }
      for (const mapping of tenantIdentityMappings) {
        if (mapping.sourceRef === sourceRef && mapping.configKey && !desiredIdentityMappingKeys.has(mapping.configKey) && mapping.isActive) {
          changes.push({ objectType: 'identity_mapping', key: mapping.configKey, operation: 'archive', currentId: mapping.id, reason: 'Config-owned identity mapping is absent from an authoritative bundle' });
        }
      }
      for (const target of tenantProjectEngineTargets) {
        if (target.source === CONFIG_SOURCE && target.sourceRef === sourceRef && !desiredProjectEngineTargetPairs.has(`${target.projectId}:${target.engineId}`) && target.status !== 'archived') {
          changes.push({ objectType: 'project_engine_target', key: `${target.projectId}:${target.engineId}`, operation: 'archive', currentId: target.id, reason: 'Config-owned project-engine target is absent from an authoritative bundle' });
        }
      }
      for (const assignment of tenantAssignments) {
        if (assignment.source === CONFIG_SOURCE && assignment.sourceRef === sourceRef && !desiredAssignmentKeys.has(assignment.assignmentKey)) {
          changes.push({ objectType: 'assignment', key: assignment.assignmentKey, operation: 'archive', currentId: assignment.id, reason: 'Config-owned scoped role assignment is absent from an authoritative bundle' });
        }
      }
    }

    for (const change of changes) {
      if (change.operation !== 'archive') continue;
      const acknowledgementId = `config.authoritative_archive:${change.objectType}:${change.key}`;
      warnings.push({
        id: acknowledgementId,
        acknowledgementId,
        message: `Authoritative configuration will remove or disable ${change.objectType.replace(/_/g, ' ')} ${change.key}.`,
      });
    }
    return {
      valid: true,
      canonicalHash: compilation.preview.canonicalHash,
      errors: [],
      changes,
      warnings,
      requiredAcknowledgements: warnings.flatMap((warning) => warning.acknowledgementId ? [warning.acknowledgementId] : []),
    };
  }
}

export const configBundleDiffService = new ConfigBundleDiffService();
