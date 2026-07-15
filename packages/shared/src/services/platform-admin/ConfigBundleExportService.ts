import { In, IsNull } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';

function json(value: string | null | undefined): Record<string, unknown> {
  try { const parsed = value ? JSON.parse(value) : {}; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

function externalReference(value: string | null | undefined): string | null {
  return value?.startsWith('ref:') ? value.slice(4) : null;
}

const resolvedSecretKey = /(?:secret|password|private.?key|certificate|token|api.?key|credential)$/i;

/** Export is a trust boundary for rows created before secret-reference validation existed. */
function assertProviderConfigurationContainsOnlyReferences(value: unknown, path = 'configuration'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertProviderConfigurationContainsOnlyReferences(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (resolvedSecretKey.test(key) && !/ref$/i.test(key)) {
      throw new Error(`Cannot export identity provider configuration: ${childPath} must be an external secret reference`);
    }
    assertProviderConfigurationContainsOnlyReferences(child, childPath);
  }
}

function sortedByKey<T extends { key: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.key.localeCompare(right.key));
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => child === undefined ? [] : [[key, withoutUndefined(child)]]));
  }
  return value;
}

class ConfigBundleExportService {
  async exportBundle(input: { bundleKey: string; tenantId?: string | null; tenantKey?: string }): Promise<{ bundle: Record<string, unknown>; files: Record<string, unknown> }> {
    const dataSource = await getDataSource();
    const tenantId = input.tenantId || null;
    const sourceRef = `config_bundle:${input.bundleKey}`;
    const where = { sourceRef, ...(tenantId ? { tenantId } : { tenantId: IsNull() }) };
    const [roles, groups, engines, engineSets, runtimeResourceSets, assignments, projectEngineTargets, identityProviders, identityMappings, runtimeResources] = await Promise.all([
      dataSource.getRepository(RbacRole).find({ where: { ...where, isArchived: false } }),
      dataSource.getRepository(AuthzGroup).find({ where: { ...where, isArchived: false } }),
      dataSource.getRepository(Engine).find({ where: { ...where, lifecycleStatus: 'active' } }),
      dataSource.getRepository(EngineSet).find({ where: { ...where, source: 'config', isArchived: false } }),
      dataSource.getRepository(RuntimeResourceSet).find({ where: { ...where, source: 'config', isArchived: false } }),
      dataSource.getRepository(RbacRoleAssignment).find({ where: { ...where, source: 'config' } }),
      dataSource.getRepository(ProjectEngineTarget).find({ where: { ...where, source: 'config' } }),
      dataSource.getRepository(IdentityProvider).find({ where }),
      dataSource.getRepository(IdentityEntitlementMapping).find({ where: { ...where, isActive: true } }),
      dataSource.getRepository(RuntimeResource).find({ where: tenantId ? { tenantId } : { tenantId: IsNull() } }),
    ]);
    const permissions = roles.length
      ? await dataSource.getRepository(RbacRolePermission).find({ where: { roleId: In(roles.map((role) => role.id)) } })
      : [];
    const tenantWhere = tenantId ? { tenantId } : { tenantId: IsNull() };
    const [referenceRoles, referenceProviders] = await Promise.all([
      assignments.length ? dataSource.getRepository(RbacRole).find({ where: tenantWhere }) : Promise.resolve([]),
      identityMappings.length ? dataSource.getRepository(IdentityProvider).find({ where: tenantWhere }) : Promise.resolve([]),
    ]);
    const permissionIdsByRole = new Map<string, string[]>();
    for (const permission of permissions) permissionIdsByRole.set(permission.roleId, [...(permissionIdsByRole.get(permission.roleId) || []), permission.permissionId]);

    const files: Record<string, unknown> = {};
    if (roles.length) files['./roles.json'] = { roles: sortedByKey(roles).map((role) => ({ key: role.key, name: role.name, description: role.description || undefined, scope: role.scope, permissions: [...(permissionIdsByRole.get(role.id) || [])].sort(), ownershipMode: role.ownershipMode || 'config_locked' })) };
    if (groups.length) files['./groups.json'] = { groups: sortedByKey(groups).map((group) => ({ key: group.key, name: group.name, description: group.description || undefined, ownershipMode: group.ownershipMode || 'config_locked' })) };
    if (engines.length) files['./engines.json'] = { engines: [...engines]
      .filter((engine): engine is Engine & { configKey: string } => Boolean(engine.configKey))
      .sort((left, right) => left.configKey.localeCompare(right.configKey))
      .map((engine) => {
        const credentialRef = externalReference(engine.passwordEnc)
        if (engine.passwordEnc && !credentialRef) {
          throw new Error(`Cannot export engine ${engine.configKey}: credentials must be replaced with a secret reference before export`)
        }
        const auth = engine.authType === 'basic'
          ? { type: 'basic', username: engine.username || '', passwordRef: credentialRef || undefined }
          : engine.authType === 'bearer'
            ? { type: 'bearer', tokenRef: credentialRef || undefined }
            : engine.authType === 'oauth2-client-credentials'
              ? { type: 'oauth2-client-credentials', username: engine.username || '', passwordRef: credentialRef || undefined, tokenUrl: engine.oauthTokenUrl || '', scopes: engine.oauthScopes || undefined, audience: engine.oauthAudience || undefined }
              : { type: 'none' };
        return { key: engine.configKey, name: engine.name, baseUrl: engine.baseUrl, type: engine.type, externalId: engine.externalId || undefined, labels: json(engine.labelsJson), auth, version: engine.version || undefined, runtimeAccessScope: engine.runtimeAccessScope, deploymentIntegration: engine.deploymentIntegration, metadataDiscoveryEnabled: engine.metadataDiscoveryEnabled !== false, deploymentDiscoveryEnabled: engine.deploymentDiscoveryEnabled !== false, reconciliationIntervalSeconds: Number(engine.reconciliationIntervalSeconds || 300), pipelineReceiptEnabled: engine.pipelineReceiptEnabled !== false, connectionMode: engine.connectionMode, ownershipMode: engine.ownershipMode };
      }) };
    if (engineSets.length) files['./engine-sets.json'] = { engineSets: sortedByKey(engineSets).map((set) => ({ key: set.key, name: set.name, description: set.description || undefined, selector: json(set.selectorJson), ownershipMode: set.ownershipMode || 'config_locked' })) };

    const engineKeyById = new Map(engines.filter((engine) => engine.configKey).map((engine) => [engine.id, engine.configKey!]));
    if (runtimeResourceSets.length) files['./runtime-resource-sets.json'] = { runtimeResourceSets: sortedByKey(runtimeResourceSets).map((set) => {
      const engineKey = engineKeyById.get(set.engineId);
      if (!engineKey) throw new Error(`Cannot export Runtime Resource Set ${set.key}: its engine is not config-owned by this bundle`);
      return { key: set.key, name: set.name, description: set.description || undefined, engineRef: { engineKey }, resourceKind: set.resourceKind, selector: json(set.selectorJson), runtimeTenantId: set.runtimeTenantId || undefined, ownershipMode: 'config_locked' };
    }) };

    const providerKeyById = new Map([...referenceProviders, ...identityProviders].map((provider) => [provider.id, provider.key]));
    if (identityProviders.length) files['./identity-providers.json'] = { identityProviders: sortedByKey(identityProviders).map((provider) => {
      const { allowVerifiedEmailLinking, authorizationAttributeKeys, ...protocolConfiguration } = json(provider.configurationJson);
      assertProviderConfigurationContainsOnlyReferences(protocolConfiguration, `identity provider ${provider.key}`);
      return {
        key: provider.key,
        type: provider.protocol,
        enabled: provider.isEnabled,
        authenticationMode: provider.authenticationMode,
        allowVerifiedEmailLinking: allowVerifiedEmailLinking === true,
        ...(Array.isArray(authorizationAttributeKeys) && authorizationAttributeKeys.length > 0 ? { authorizationAttributeKeys } : {}),
        directoryTenantId: provider.directoryTenantId || undefined,
        sync: json(provider.syncJson),
        [provider.protocol]: protocolConfiguration,
        ownershipMode: provider.ownershipMode,
      };
    }) };

    const groupKeyById = new Map(groups.map((group) => [group.id, group.key]));
    if (identityMappings.length) files['./identity-mappings.json'] = { identityMappings: sortedByKey(identityMappings.filter((mapping) => Boolean(mapping.configKey)).map((mapping) => ({ ...mapping, key: mapping.configKey! }))).map((mapping) => {
      const providerKey = providerKeyById.get(mapping.providerId);
      const targetGroupKey = groupKeyById.get(mapping.targetGroupId);
      if (!providerKey || !targetGroupKey) throw new Error(`Cannot export identity mapping ${mapping.key}: its provider or group is not config-owned by this bundle`);
      if (mapping.entitlementType === 'scope') throw new Error(`Cannot export identity mapping ${mapping.key}: OAuth scopes cannot grant human access; retire or replace this legacy mapping first`);
      return { key: mapping.key, providerKey, source: { type: mapping.entitlementType, externalId: mapping.externalId || undefined, operator: mapping.matchOperator }, targetGroupKey, syncMode: mapping.syncMode, ownershipMode: 'config_locked' };
    }) };

    const roleKeyById = new Map([...referenceRoles, ...roles].map((role) => [role.id, role.key]));
    const engineSetKeyById = new Map(engineSets.map((set) => [set.id, set.key]));
    const runtimeResourceSetKeyById = new Map(runtimeResourceSets.map((set) => [set.id, set.key]));
    const runtimeResourceById = new Map(runtimeResources.map((resource) => [resource.id, resource]));
    if (assignments.length) files['./assignments.json'] = { assignments: assignments.map((assignment) => {
      const roleKey = roleKeyById.get(assignment.roleId);
      const groupKey = assignment.principalType === 'group' && assignment.principalId ? groupKeyById.get(assignment.principalId) : null;
      if (!roleKey || !groupKey) throw new Error(`Cannot export scoped role assignment ${assignment.id}: its role or group is not config-owned by this bundle`);
      let scope: Record<string, unknown>;
      if (assignment.scopeType === 'platform') scope = { type: 'platform' };
      else if (assignment.scopeType === 'engine' && assignment.scopeId && engineKeyById.get(assignment.scopeId)) scope = { type: 'engine', engineKey: engineKeyById.get(assignment.scopeId) };
      else if (assignment.scopeType === 'engine_set' && assignment.scopeId && engineSetKeyById.get(assignment.scopeId)) scope = { type: 'engine_set', engineSetKey: engineSetKeyById.get(assignment.scopeId) };
      else if (assignment.scopeType === 'engine_runtime_resource_set' && assignment.scopeId && runtimeResourceSetKeyById.get(assignment.scopeId)) scope = { type: 'engine_runtime_resource_set', runtimeResourceSetKey: runtimeResourceSetKeyById.get(assignment.scopeId) };
      else if (assignment.scopeType === 'engine_runtime_resource' && assignment.scopeId) {
        const resource = runtimeResourceById.get(assignment.scopeId);
        const engineKey = resource ? engineKeyById.get(resource.engineId) : null;
        if (!resource || !engineKey) throw new Error(`Cannot export scoped role assignment ${assignment.id}: its runtime resource is unresolved`);
        scope = { type: 'engine_runtime_resource', engineKey, resourceKind: resource.resourceKind, resourceKey: resource.resourceKey, runtimeTenantId: resource.runtimeTenantId || undefined };
      } else throw new Error(`Cannot export scoped role assignment ${assignment.id}: unsupported or unresolved ${assignment.scopeType} scope`);
      return { principal: { type: 'group', key: groupKey }, roleKey, scope, expiresAt: assignment.expiresAt || undefined, ownershipMode: assignment.ownershipMode || 'config_locked' };
    }) };

    if (projectEngineTargets.length) files['./project-engine-targets.json'] = { projectEngineTargets: projectEngineTargets.filter((target) => target.status !== 'archived').map((target) => {
      const engineKey = engineKeyById.get(target.engineId);
      if (!engineKey) throw new Error(`Cannot export project-engine target ${target.id}: its engine is not config-owned by this bundle`);
      return { projectRef: { id: target.projectId }, engineRef: { engineKey }, status: target.status, allowManualDeploy: target.allowManualDeploy, allowCiDeploy: target.allowCiDeploy, allowApiDeploy: target.allowApiDeploy, allowImport: target.allowImport, ownershipMode: target.ownershipMode || 'config_locked' };
    }) };
    const imports = Object.keys(files);
    return withoutUndefined({
      bundle: { apiVersion: 'enterpriseglue.ai/v1alpha1', kind: 'EnterpriseGlueConfigBundle', metadata: { key: input.bundleKey, owner: 'platform' }, tenantKey: input.tenantKey || 'default', mode: 'authoritative', settings: {}, imports },
      files,
    }) as { bundle: Record<string, unknown>; files: Record<string, unknown> };
  }
}

export const configBundleExportService = new ConfigBundleExportService();
