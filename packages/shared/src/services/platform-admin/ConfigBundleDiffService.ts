import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineBackstopGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopGroupMapping.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { PlatformSettingsSectionOwnership } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettingsSectionOwnership.js';
import type { PlatformSettingsSection } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettingsSectionOwnership.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { AdminConfigObjectOwnership, type AdminConfigObjectType } from '@enterpriseglue/shared/infrastructure/persistence/entities/AdminConfigObjectOwnership.js';
import { GitProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitProvider.js';
import { EmailSendConfig } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailSendConfig.js';
import { EmailTemplate } from '@enterpriseglue/shared/infrastructure/persistence/entities/EmailTemplate.js';
import { RbacPermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacPermission.js';
import { AuthzPolicy } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzPolicy.js';
import { ApiClient } from '@enterpriseglue/shared/infrastructure/persistence/entities/ApiClient.js';
import { ServiceAccount } from '@enterpriseglue/shared/infrastructure/persistence/entities/ServiceAccount.js';
import { ExternalEngineSystem } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineSystem.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { configBundlePreviewService, type ConfigBundlePolicyContext, type ConfigBundlePreviewInput } from './ConfigBundlePreviewService.js';
import { matchRuntimeResourceSetSelector, type RuntimeResourceSetSelector } from './RuntimeResourceInventoryService.js';
import { EnginePermissions, SystemRoleDefinitions } from './permissions.js';
import { identityEntitlementMappingService } from './IdentityEntitlementMappingService.js';
import { OSS_DEFAULT_TENANT_ID, normalizeTenantIdForPersistence } from '../../authz/tenant-scope.js';
import { engineTenancyProvisioningService } from './EngineTenancyProvisioningService.js';
import { isEngineBackstopNativeAuthorizationEngineType } from '@enterpriseglue/shared/schemas/platform-admin/engine-backstop.js';
import type { ConfigBundleContractMetadata } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';
import { hashCanonicalConfig } from './config-bundle-hash.js';
import { adminConfigKeyIdentity, adminConfigObjectLabel, adminConfigScopeKey } from './AdminConfigObjectOwnershipService.js';
import { isProductSeededEnvironmentTag } from './EnvironmentTagService.js';

export type ConfigBundleDiffOperation = 'create' | 'update' | 'noop' | 'archive' | 'conflict';

export interface ConfigBundleDiffChange {
  objectType: 'environment_tag' | 'git_provider' | 'email_configuration' | 'email_template' | 'permission' | 'authorization_policy' | 'api_client' | 'service_account' | 'external_engine_system' | 'role' | 'group' | 'engine' | 'engine_backstop_mapping' | 'engine_tenant_mapping' | 'engine_set' | 'runtime_resource_set' | 'identity_provider' | 'identity_mapping' | 'project_engine_target' | 'assignment' | 'platform_settings';
  key: string;
  operation: ConfigBundleDiffOperation;
  reason: string;
  currentId?: string;
  expectedUpdatedAt?: number;
  expectedOwnershipGeneration?: number;
  permissionChanges?: {
    additions: string[];
    removals: string[];
    effectivePermissions: string[];
  };
  affectedAssignmentCount?: number;
  runtimeResourceChanges?: {
    matchedCount: number;
    unmatchedCount: number;
    currentlyMaterialized: Array<{ resourceKind: string; resourceKey: string; runtimeTenantId: string | null }>;
    newlyMatched: Array<{ resourceKind: string; resourceKey: string; runtimeTenantId: string | null }>;
    noLongerMatched: Array<{ resourceKind: string; resourceKey: string; runtimeTenantId: string | null }>;
    unmatchedSelectors: string[];
    detailsTruncated: boolean;
  };
  identitySnapshotPreview?: {
    scanned: number;
    matches: number;
    nonMatches: number;
    failed: number;
    truncated: boolean;
    latestSnapshotAt: number | null;
    warnings: string[];
  };
}

function configEngineIdentity(tenantId: string | null, key: string): string {
  return `${tenantId || 'platform'}:${key}`;
}

function desiredDedicatedTenantId(engine: any, tenantId: string | null): string | null {
  if (engine.tenancy?.mode !== 'dedicated') return null;
  const reference = engine.tenancy.tenantRef || { type: 'request_context' };
  if (reference.type === 'request_context') return normalizeTenantIdForPersistence(tenantId) || OSS_DEFAULT_TENANT_ID;
  if (reference.type === 'default') return OSS_DEFAULT_TENANT_ID;
  if (reference.type === 'id') return normalizeTenantIdForPersistence(reference.id);
  if (reference.type === 'key' && ['default', 'tenant.default'].includes(reference.key)) return OSS_DEFAULT_TENANT_ID;
  return null;
}

function desiredEngineCredentialFields(auth: any): {
  authType: string;
  username: string | null;
  passwordEnc: string | null;
  oauthTokenUrl: string | null;
  oauthScopes: string | null;
  oauthAudience: string | null;
} {
  if (auth?.type === 'basic') {
    return {
      authType: 'basic',
      username: auth.username,
      passwordEnc: `ref:${auth.passwordRef}`,
      oauthTokenUrl: null,
      oauthScopes: null,
      oauthAudience: null,
    };
  }
  if (auth?.type === 'bearer') {
    return {
      authType: 'bearer',
      username: null,
      passwordEnc: `ref:${auth.tokenRef}`,
      oauthTokenUrl: null,
      oauthScopes: null,
      oauthAudience: null,
    };
  }
  if (auth?.type === 'oauth2-client-credentials') {
    return {
      authType: 'oauth2-client-credentials',
      username: auth.username,
      passwordEnc: `ref:${auth.passwordRef}`,
      oauthTokenUrl: auth.tokenUrl,
      oauthScopes: auth.scopes || null,
      oauthAudience: auth.audience || null,
    };
  }
  return {
    authType: 'none',
    username: null,
    passwordEnc: null,
    oauthTokenUrl: null,
    oauthScopes: null,
    oauthAudience: null,
  };
}

export interface ConfigBundleDiffWarning {
  id: string;
  message: string;
  acknowledgementId?: string;
}

export interface ConfigBundleAffectedPrincipalSummary {
  affectedGroupCount: number;
  affectedUserCount: number;
  externalIdentityMappingChangeCount: number;
}

export interface ConfigBundleDiff {
  valid: boolean;
  canonicalHash?: string;
  contract?: ConfigBundleContractMetadata;
  errors: Array<{ path: string; message: string }>;
  changes: ConfigBundleDiffChange[];
  warnings: ConfigBundleDiffWarning[];
  requiredAcknowledgements: string[];
  affectedPrincipals: ConfigBundleAffectedPrincipalSummary;
}

const CONFIG_SOURCE = 'config';
const RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT = 50;

export function configBundleSourceRef(bundleKey: string): string {
  return `config_bundle:${bundleKey}`;
}

export function configEngineTenantMappingSourceRef(bundleKey: string, mappingKey: string): string {
  return `${configBundleSourceRef(bundleKey)}:engine_tenant_mapping:${mappingKey}`;
}

export function configEngineTenantMappingSourcePrefix(bundleKey: string): string {
  return `${configBundleSourceRef(bundleKey)}:engine_tenant_mapping:`;
}

export function configEngineBackstopMappingSourceRef(bundleKey: string, mappingKey: string): string {
  return `${configBundleSourceRef(bundleKey)}:engine_backstop_mapping:${mappingKey}`;
}

export function configEngineBackstopMappingSourcePrefix(bundleKey: string): string {
  return `${configBundleSourceRef(bundleKey)}:engine_backstop_mapping:`;
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

function rolePermissionChanges(current: string[], desired: string[]): NonNullable<ConfigBundleDiffChange['permissionChanges']> {
  const currentPermissions = Array.from(new Set(current)).sort();
  const effectivePermissions = Array.from(new Set(desired)).sort();
  const currentSet = new Set(currentPermissions);
  const desiredSet = new Set(effectivePermissions);
  return {
    additions: effectivePermissions.filter((permission) => !currentSet.has(permission)),
    removals: currentPermissions.filter((permission) => !desiredSet.has(permission)),
    effectivePermissions,
  };
}

function hasPermissionChanges(changes: NonNullable<ConfigBundleDiffChange['permissionChanges']>): boolean {
  return changes.additions.length > 0 || changes.removals.length > 0;
}

function runtimeResourceReference(resource: RuntimeResource): { resourceKind: string; resourceKey: string; runtimeTenantId: string | null } {
  return { resourceKind: resource.resourceKind, resourceKey: resource.resourceKey, runtimeTenantId: resource.runtimeTenantId || null };
}

function unmatchedRuntimeResourceSelectorTerms(selector: RuntimeResourceSetSelector, matchingResources: RuntimeResource[]): string[] {
  if (selector.mode === 'keys') {
    const matchedKeys = new Set(matchingResources.map((resource) => resource.resourceKey));
    return selector.keys.filter((key) => !matchedKeys.has(key));
  }
  if (matchingResources.length > 0) return [];
  if (selector.mode === 'prefix') return [`prefix:${selector.prefix}`];
  if (selector.mode === 'labels') return [`labels:${JSON.stringify(selector.labels)} (${selector.labelMatch || 'all'})`];
  return [`project_lineage:${selector.projectRef.key || selector.projectRef.id || 'unresolved'}`];
}

function runtimeResourceChangeSummary(
  resources: RuntimeResource[],
  existingMaterializations: Array<{ runtimeResourceId: string }>,
  resourcesById: Map<string, RuntimeResource>,
  selector: RuntimeResourceSetSelector,
  runtimeTenantId: string | null | undefined,
): NonNullable<ConfigBundleDiffChange['runtimeResourceChanges']> {
  const matchingResources = resources.filter((resource) =>
    (!runtimeTenantId || resource.runtimeTenantId === runtimeTenantId)
    && Boolean(matchRuntimeResourceSetSelector(resource, selector)),
  );
  const matchingIds = new Set(matchingResources.map((resource) => resource.id));
  const existingIds = new Set(existingMaterializations.map((row) => row.runtimeResourceId));
  const currentlyMaterialized = Array.from(existingIds)
    .map((resourceId) => resourcesById.get(resourceId))
    .filter((resource): resource is RuntimeResource => Boolean(resource));
  const newlyMatched = matchingResources.filter((resource) => !existingIds.has(resource.id));
  const noLongerMatched = currentlyMaterialized.filter((resource) => !matchingIds.has(resource.id));
  const unmatchedSelectors = unmatchedRuntimeResourceSelectorTerms(selector, matchingResources);
  return {
    matchedCount: matchingResources.length,
    unmatchedCount: resources.length - matchingResources.length,
    currentlyMaterialized: currentlyMaterialized.slice(0, RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT).map(runtimeResourceReference),
    newlyMatched: newlyMatched.slice(0, RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT).map(runtimeResourceReference),
    noLongerMatched: noLongerMatched.slice(0, RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT).map(runtimeResourceReference),
    unmatchedSelectors: unmatchedSelectors.slice(0, RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT),
    detailsTruncated: currentlyMaterialized.length > RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT || newlyMatched.length > RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT || noLongerMatched.length > RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT || unmatchedSelectors.length > RUNTIME_RESOURCE_DIFF_DETAIL_LIMIT,
  };
}

function providerConfiguration(provider: any): Record<string, unknown> {
  return {
    ...(provider[provider.type] || {}),
    allowVerifiedEmailLinking: provider.allowVerifiedEmailLinking === true,
    ...(provider.authorizationAttributeKeys?.length ? { authorizationAttributeKeys: provider.authorizationAttributeKeys } : {}),
  };
}

function assignmentDisplayKey(assignment: any): string {
  if (assignment.key) return assignment.key;
  const principal = assignment.principal.key || assignment.principal.id;
  const scope = assignment.scope;
  const scopeReference = scope.engineKey || scope.engineSetKey || scope.runtimeResourceSetKey || scope.resourceKey || scope.projectRef?.id || scope.projectRef?.key || scope.type;
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

function hasExplicitGovernanceSettings(bundle: unknown): boolean {
  if (!bundle || typeof bundle !== 'object') return false;
  const value = bundle as Record<string, unknown>;
  const settings = value.apiVersion === 'enterpriseglue.ai/v1beta1' ? value.governance : value.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  const keys = value.apiVersion === 'enterpriseglue.ai/v1beta1'
    ? [
        'engineMembershipAuthority',
        'projectMembershipAuthority',
        'engineRegistrationPolicy',
        'projectEngineTargetPolicy',
        'runtimeAuthorizationAuthority',
      ]
    : [
        'engineAccessAuthority',
        'projectAccessAuthority',
        'engineOnboardingMode',
        'projectEngineTargetMode',
        'engineRuntimeAuthorizationMode',
      ];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(settings, key));
}

/**
 * Produces a persisted-state diff for the currently supported config-owned
 * objects. It is intentionally read-only and must be used before apply.
 */
class ConfigBundleDiffService {
  async diff(input: ConfigBundlePreviewInput, tenantId?: string | null, policy?: ConfigBundlePolicyContext): Promise<ConfigBundleDiff> {
    const compilation = configBundlePreviewService.compile(input, policy);
    if (!compilation.preview.valid || !compilation.manifest || !compilation.files || !compilation.preview.canonicalHash) {
      return { valid: false, ...(compilation.preview.contract ? { contract: compilation.preview.contract } : {}), errors: compilation.preview.errors, changes: [], warnings: [], requiredAcknowledgements: [], affectedPrincipals: { affectedGroupCount: 0, affectedUserCount: 0, externalIdentityMappingChangeCount: 0 } };
    }

    const manifest = compilation.manifest as {
      metadata: { key: string };
      mode: string;
      login?: {
        localPassword: 'auto' | 'enabled' | 'disabled';
        providerSelection: 'auto_redirect_single' | 'chooser' | 'progressive';
      };
      settings: {
        engineAccessAuthority: string;
        projectAccessAuthority: string;
        engineOnboardingMode: string;
        projectEngineTargetMode: string;
        engineRuntimeAuthorizationMode: string;
        ownershipMode: 'manual' | 'config_locked' | 'config_warn';
      };
    };
    const sourceRef = configBundleSourceRef(manifest.metadata.key);
    const explicitGovernanceSettings = hasExplicitGovernanceSettings(input.bundle);
    const explicitLoginPolicy = Boolean(input.bundle && typeof input.bundle === 'object' && Object.prototype.hasOwnProperty.call(input.bundle, 'login'));
    const normalizedTenantId = tenantId || null;
    const dataSource = await getDataSource();
    const explicitPlatformSettings = Boolean(compilation.files['./platform-settings.json']);
    const explicitEnvironmentTags = Boolean(compilation.files['./environment-tags.json']);
    const desiredAssignments = values(compilation.files, './assignments.json', 'assignments');
    const [roles, groups, engines, engineBackstopMappings, engineTenantMappings, engineSets, runtimeResourceSets, runtimeResourceSetMaterializations, rolePermissions, identityProviders, identityMappings, projectEngineTargets, assignments, runtimeResources, projects, groupMemberships, platformSettings, platformSettingsOwnership, environmentTags, users] = await Promise.all([
      dataSource.getRepository(RbacRole).find(),
      dataSource.getRepository(AuthzGroup).find(),
      dataSource.getRepository(Engine).find(),
      dataSource.getRepository(EngineBackstopGroupMapping).find(),
      dataSource.getRepository(EngineTenantMapping).find(),
      dataSource.getRepository(EngineSet).find(),
      dataSource.getRepository(RuntimeResourceSet).find(),
      dataSource.getRepository(RuntimeResourceSetMaterialization).find(),
      dataSource.getRepository(RbacRolePermission).find(),
      dataSource.getRepository(IdentityProvider).find(),
      dataSource.getRepository(IdentityEntitlementMapping).find(),
      dataSource.getRepository(ProjectEngineTarget).find(),
      dataSource.getRepository(RbacRoleAssignment).find(),
      dataSource.getRepository(RuntimeResource).find(),
      dataSource.getRepository(Project).find(),
      dataSource.getRepository(AuthzGroupMembership).find(),
      explicitGovernanceSettings || explicitLoginPolicy || explicitPlatformSettings
        ? dataSource.getRepository(PlatformSettings).findOneBy({ id: 'default' })
        : Promise.resolve(null),
      explicitPlatformSettings
        ? dataSource.getRepository(PlatformSettingsSectionOwnership).find({ where: { settingsId: 'default' } })
        : Promise.resolve([]),
      explicitEnvironmentTags || explicitPlatformSettings
        ? dataSource.getRepository(EnvironmentTag).find()
        : Promise.resolve([]),
      desiredAssignments.some((assignment) => assignment.principal.type === 'user')
        ? dataSource.getRepository(User).find()
        : Promise.resolve([]),
    ]);
    const hasAdminCatalogFiles = [
      './git-providers.json', './email-configurations.json', './email-templates.json',
      './permissions.json', './authorization-policies.json', './machine-principals.json',
      './external-engine-systems.json',
    ].some((path) => Boolean(compilation.files?.[path]))
      || desiredAssignments.some((assignment) => assignment.principal.type === 'api_client' || assignment.principal.type === 'service_account');
    const [adminOwnership, gitProviders, emailConfigurations, emailTemplates, customPermissions, authorizationPolicies, apiClients, serviceAccounts, externalEngineSystems] = hasAdminCatalogFiles
      ? await Promise.all([
          dataSource.getRepository(AdminConfigObjectOwnership).find(),
          dataSource.getRepository(GitProvider).find(),
          dataSource.getRepository(EmailSendConfig).find(),
          dataSource.getRepository(EmailTemplate).find(),
          dataSource.getRepository(RbacPermission).find({ where: { kind: 'custom' } }),
          dataSource.getRepository(AuthzPolicy).find(),
          dataSource.getRepository(ApiClient).find(),
          dataSource.getRepository(ServiceAccount).find(),
          dataSource.getRepository(ExternalEngineSystem).find(),
        ])
      : [[], [], [], [], [], [], [], [], []] as [
          AdminConfigObjectOwnership[], GitProvider[], EmailSendConfig[], EmailTemplate[], RbacPermission[],
          AuthzPolicy[], ApiClient[], ServiceAccount[], ExternalEngineSystem[],
        ];
    const rolePermissionsByRoleId = new Map<string, string[]>();
    for (const permission of rolePermissions) {
      rolePermissionsByRoleId.set(permission.roleId, [...(rolePermissionsByRoleId.get(permission.roleId) || []), permission.permissionId]);
    }
    const tenantRoles = roles.filter((role) => (role.tenantId || null) === normalizedTenantId);
    const tenantGroups = groups.filter((group) => (group.tenantId || null) === normalizedTenantId);
    // System roles are platform-seeded templates (tenantId null) but may be
    // assigned to groups in a tenant-scoped configuration bundle. Do not let
    // this cross tenant boundaries for custom roles: only the fixed system
    // role catalog is available as a fallback, and a tenant-local role still
    // wins if one is ever present.
    const systemRoleKeys = new Set(SystemRoleDefinitions.map((role) => role.key));
    const platformSystemRoles = roles.filter((role) => (role.tenantId || null) === null && systemRoleKeys.has(role.key));
    const rolesByKey = new Map([...platformSystemRoles, ...tenantRoles].map((role) => [role.key, role]));
    const groupsByKey = new Map(tenantGroups.map((group) => [group.key, group]));
    const tenantEngines = engines.filter((engine) =>
      (engine.tenantId || null) === normalizedTenantId
      || Boolean(engine.configKey && engine.configKeyIdentity === configEngineIdentity(normalizedTenantId, engine.configKey)));
    const enginesByConfigKey = new Map(tenantEngines
      .filter((engine) => engine.configKey && engine.lifecycleStatus !== 'decommissioned')
      .map((engine) => [engine.configKey!, engine]));
    // External engine references are supplied only by controlled migration
    // endpoints. They deliberately do not turn a UI/API-registered engine
    // into a configuration-owned one; they only let a Runtime Resource Set
    // bind to that already-existing engine.
    const externalEnginesByKey = new Map<string, Engine>();
    const invalidExternalEngineKeys = new Set<string>();
    const externalReferences = policy?.externalEngineReferences || [];
    for (const reference of externalReferences) {
      const key = reference.key?.trim();
      const engineId = reference.engineId?.trim();
      if (!key || !engineId || externalEnginesByKey.has(key) || enginesByConfigKey.has(key)) {
        if (key) invalidExternalEngineKeys.add(key);
        continue;
      }
      const engine = engines.find((candidate) => candidate.id === engineId);
      const engineTenantMatches = Boolean(engine) && (
        (engine!.tenancyMode === 'shared' && !engine!.tenantId)
        || (engine!.tenancyMode === 'dedicated' && Boolean(engine!.tenantId) && (!normalizedTenantId || engine!.tenantId === normalizedTenantId))
      );
      if (!engine || engine.lifecycleStatus === 'decommissioned' || !engineTenantMatches) {
        invalidExternalEngineKeys.add(key);
        continue;
      }
      externalEnginesByKey.set(key, engine);
    }
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
    const assignmentsById = new Map(tenantAssignments.map((assignment) => [assignment.id, assignment]));
    const assignmentCountByRoleId = new Map<string, number>();
    for (const assignment of tenantAssignments) assignmentCountByRoleId.set(assignment.roleId, (assignmentCountByRoleId.get(assignment.roleId) || 0) + 1);
    const tenantRuntimeResources = runtimeResources.filter((resource) => (resource.tenantId || null) === normalizedTenantId);
    const runtimeResourcesById = new Map(tenantRuntimeResources.map((resource) => [resource.id, resource]));
    const runtimeResourcesByIdentity = new Map(tenantRuntimeResources.map((resource) => [`${resource.engineId}:${resource.resourceKind}:${resource.resourceKey}:${resource.runtimeTenantId || ''}`, resource]));
    const runtimeResourcesByEngineAndKind = new Map<string, RuntimeResource[]>();
    for (const resource of tenantRuntimeResources) {
      if (!resource.isActive) continue;
      const key = `${resource.engineId}:${resource.resourceKind}`;
      runtimeResourcesByEngineAndKind.set(key, [...(runtimeResourcesByEngineAndKind.get(key) || []), resource]);
    }
    const runtimeResourceSetMaterializationsBySetId = new Map<string, RuntimeResourceSetMaterialization[]>();
    for (const materialization of runtimeResourceSetMaterializations) {
      if ((materialization.tenantId || null) !== normalizedTenantId) continue;
      runtimeResourceSetMaterializationsBySetId.set(materialization.runtimeResourceSetId, [...(runtimeResourceSetMaterializationsBySetId.get(materialization.runtimeResourceSetId) || []), materialization]);
    }
    const tenantGroupMemberships = groupMemberships.filter((membership) => (membership.tenantId || null) === normalizedTenantId);
    const changes: ConfigBundleDiffChange[] = [];
    const warnings = broadConfigurationWarnings(compilation.files);
    const desiredSettings = manifest.settings;
    const pristineGovernanceSeed = Boolean(platformSettings)
      && !platformSettings!.updatedById
      && !platformSettings!.accessGovernanceSourceRef
      && platformSettings!.engineAccessAuthority === 'manual'
      && platformSettings!.projectAccessAuthority === 'manual'
      && platformSettings!.engineOnboardingMode === 'manual_allowed'
      && platformSettings!.projectEngineTargetMode === 'manual_allowed'
      && platformSettings!.engineRuntimeAuthorizationMode === 'enterpriseglue_authoritative';
    if (explicitGovernanceSettings && !platformSettings) {
      changes.push({
        objectType: 'platform_settings',
        key: 'access-governance',
        operation: 'create',
        reason: 'Platform governance settings have not been persisted yet',
      });
    } else if (explicitGovernanceSettings && platformSettings!.accessGovernanceSourceRef && platformSettings!.accessGovernanceSourceRef !== sourceRef) {
      changes.push({
        objectType: 'platform_settings',
        key: 'access-governance',
        operation: 'conflict',
        currentId: platformSettings!.id,
        reason: 'Platform governance settings are owned by another configuration bundle',
      });
    } else if (explicitGovernanceSettings && (
      platformSettings!.engineAccessAuthority !== desiredSettings.engineAccessAuthority
      || platformSettings!.projectAccessAuthority !== desiredSettings.projectAccessAuthority
      || platformSettings!.engineOnboardingMode !== desiredSettings.engineOnboardingMode
      || platformSettings!.projectEngineTargetMode !== desiredSettings.projectEngineTargetMode
      || platformSettings!.engineRuntimeAuthorizationMode !== desiredSettings.engineRuntimeAuthorizationMode
      || platformSettings!.accessGovernanceSourceRef !== sourceRef
      || (platformSettings!.accessGovernanceOwnershipMode || 'manual') !== desiredSettings.ownershipMode
      || platformSettings!.accessGovernanceDriftStatus !== 'in_sync'
    )) {
      changes.push({
        objectType: 'platform_settings',
        key: 'access-governance',
        operation: 'update',
        currentId: platformSettings!.id,
        expectedUpdatedAt: Number(platformSettings!.updatedAt),
        reason: platformSettings!.accessGovernanceSourceRef
          ? 'Config-owned platform governance settings differ from the desired state'
          : pristineGovernanceSeed
            ? 'Product-seeded platform governance settings will be configured by this bundle'
          : 'Persisted platform governance settings will be adopted by this configuration bundle',
      });
    } else if (explicitGovernanceSettings) {
      changes.push({
        objectType: 'platform_settings',
        key: 'access-governance',
        operation: 'noop',
        currentId: platformSettings!.id,
        reason: 'Config-owned platform governance settings already match the desired state',
      });
    }
    if (explicitLoginPolicy && manifest.login) {
      const loginPolicyMatches = platformSettings
        && platformSettings.localPasswordLoginMode === manifest.login.localPassword
        && platformSettings.ssoProviderSelectionMode === manifest.login.providerSelection;
      changes.push({
        objectType: 'platform_settings',
        key: 'login-policy',
        operation: !platformSettings ? 'create' : loginPolicyMatches ? 'noop' : 'update',
        ...(platformSettings ? { currentId: platformSettings.id } : {}),
        ...(platformSettings ? { expectedUpdatedAt: Number(platformSettings.updatedAt) } : {}),
        reason: !platformSettings
          ? 'Platform login policy has not been persisted yet'
          : loginPolicyMatches
            ? 'Platform login policy already matches the desired state'
            : 'Platform login policy differs from the desired ordinary-user sign-in behavior',
      });
    }

    const desiredEnvironmentTags = values(compilation.files, './environment-tags.json', 'environmentTags');
    const desiredEnvironmentTagKeys = new Set(desiredEnvironmentTags.map((tag) => tag.key));
    const configScopeKey = adminConfigScopeKey(normalizedTenantId);
    const environmentTagsByKey = new Map(environmentTags.filter((tag) => tag.configKey).map((tag) => [tag.configKey!, tag]));
    const environmentTagsByName = new Map(environmentTags.map((tag) => [tag.name.toLowerCase(), tag]));
    for (const desired of desiredEnvironmentTags) {
      const current = environmentTagsByKey.get(desired.key) || environmentTagsByName.get(desired.name.toLowerCase());
      if (current?.sourceRef && (current.sourceRef !== sourceRef || current.configScopeKey !== configScopeKey)) {
        changes.push({
          objectType: 'environment_tag', key: desired.key, operation: 'conflict', currentId: current.id,
          reason: 'Environment tag is owned by another configuration bundle',
        });
        continue;
      }
      const matches = current
        && current.name === desired.name
        && current.color === desired.color
        && current.manualDeployAllowed === desired.manualDeployAllowed
        && current.sortOrder === desired.sortOrder
        && current.isDefault === desired.isDefault
        && current.configKey === desired.key
        && current.sourceRef === sourceRef
        && current.configScopeKey === configScopeKey
        && current.ownershipMode === desired.ownershipMode
        && current.driftStatus === 'in_sync';
      changes.push({
        objectType: 'environment_tag',
        key: desired.key,
        operation: !current ? 'create' : matches ? 'noop' : 'update',
        ...(current ? { currentId: current.id } : {}),
        ...(current ? {
          expectedUpdatedAt: Number(current.updatedAt),
          expectedOwnershipGeneration: Number(current.configGeneration || 0),
        } : {}),
        reason: !current
          ? 'Environment tag does not exist'
          : matches
            ? 'Config-owned environment tag already matches the desired state'
            : current.sourceRef
              ? 'Config-owned environment tag differs from the desired state'
              : isProductSeededEnvironmentTag(current)
                ? 'Product-seeded environment tag will be configured by this bundle'
              : 'Existing environment tag will be adopted by stable key and name',
      });
    }
    if (manifest.mode === 'authoritative' && explicitEnvironmentTags) {
      for (const current of environmentTags.filter((tag) =>
        tag.sourceRef === sourceRef
        && tag.configScopeKey === configScopeKey
        && tag.configKey
        && !desiredEnvironmentTagKeys.has(tag.configKey))) {
        changes.push({
          objectType: 'environment_tag', key: current.configKey!, operation: 'archive', currentId: current.id,
          expectedUpdatedAt: Number(current.updatedAt),
          expectedOwnershipGeneration: Number(current.configGeneration || 0),
          reason: 'Config-owned environment tag is absent from the authoritative bundle',
        });
      }
    }

    const desiredPlatformFile = compilation.files['./platform-settings.json'] as {
      platformSettings?: Record<string, any> & { ownershipMode: 'manual' | 'config_locked' | 'config_warn' };
    } | undefined;
    const desiredPlatformSettings = desiredPlatformFile?.platformSettings;
    if (desiredPlatformSettings) {
      const ownershipBySection = new Map(platformSettingsOwnership.map((entry) => [entry.section, entry]));
      const sectionValues: Array<{ section: PlatformSettingsSection; desired: unknown; current: unknown }> = [];
      if (desiredPlatformSettings.general) {
        const desiredDefaultKey = desiredPlatformSettings.general.defaultEnvironmentTagKey;
        const configuredDefault = desiredDefaultKey
          ? environmentTagsByKey.get(desiredDefaultKey)
            || environmentTagsByName.get(desiredEnvironmentTags.find((tag) => tag.key === desiredDefaultKey)?.name?.toLowerCase() || '')
          : null;
        sectionValues.push({
          section: 'general',
          desired: {
            defaultEnvironmentTagId: desiredDefaultKey ? configuredDefault?.id || `config-key:${desiredDefaultKey}` : null,
            emailPlatformName: desiredPlatformSettings.general.emailPlatformName,
          },
          current: {
            defaultEnvironmentTagId: desiredDefaultKey && !configuredDefault
              ? platformSettings?.defaultEnvironmentTagId ? `current-id:${platformSettings.defaultEnvironmentTagId}` : null
              : platformSettings?.defaultEnvironmentTagId || null,
            emailPlatformName: platformSettings?.emailPlatformName || 'EnterpriseGlue',
          },
        });
      }
      if (desiredPlatformSettings.gitSync) sectionValues.push({
        section: 'git_sync',
        desired: desiredPlatformSettings.gitSync,
        current: {
          pushEnabled: platformSettings?.syncPushEnabled ?? true,
          pullEnabled: platformSettings?.syncPullEnabled ?? false,
          bothEnabled: platformSettings?.syncBothEnabled ?? false,
          projectTokenSharingEnabled: platformSettings?.gitProjectTokenSharingEnabled ?? false,
        },
      });
      if (desiredPlatformSettings.deployment) sectionValues.push({
        section: 'deployment',
        desired: desiredPlatformSettings.deployment,
        current: {
          defaultDeployRoles: (() => { try { return JSON.parse(platformSettings?.defaultDeployRoles || '[]'); } catch { return []; } })(),
          credentiallessCustomerSidecarsEnabled: platformSettings?.credentiallessCustomerSidecarsEnabled ?? false,
        },
      });
      if (desiredPlatformSettings.invitations) sectionValues.push({
        section: 'invitations',
        desired: desiredPlatformSettings.invitations,
        current: {
          allowAllDomains: platformSettings?.inviteAllowAllDomains ?? true,
          allowedDomains: (() => { try { return JSON.parse(platformSettings?.inviteAllowedDomains || '[]'); } catch { return []; } })(),
        },
      });
      if (desiredPlatformSettings.pii) sectionValues.push({
        section: 'pii',
        desired: desiredPlatformSettings.pii,
        current: {
          regexEnabled: platformSettings?.piiRegexEnabled ?? false,
          externalProviderEnabled: platformSettings?.piiExternalProviderEnabled ?? false,
          externalProviderType: platformSettings?.piiExternalProviderType || null,
          externalProviderEndpoint: platformSettings?.piiExternalProviderEndpoint || null,
          externalProviderAuthHeader: platformSettings?.piiExternalProviderAuthHeader || null,
          externalProviderAuthTokenRef: String(platformSettings?.piiExternalProviderAuthToken || '').startsWith('ref:')
            ? String(platformSettings?.piiExternalProviderAuthToken).slice(4)
            : null,
          externalProviderProjectId: platformSettings?.piiExternalProviderProjectId || null,
          externalProviderRegion: platformSettings?.piiExternalProviderRegion || null,
          redactionStyle: platformSettings?.piiRedactionStyle || '<TYPE>',
          scopes: (() => { try { return JSON.parse(platformSettings?.piiScopes || '[]'); } catch { return []; } })(),
          maxPayloadSizeBytes: Number(platformSettings?.piiMaxPayloadSizeBytes ?? 262144),
        },
      });
      if (desiredPlatformSettings.branding) sectionValues.push({
        section: 'branding',
        desired: desiredPlatformSettings.branding,
        current: {
          logoUrl: platformSettings?.logoUrl || null,
          loginLogoUrl: platformSettings?.loginLogoUrl || null,
          loginTitleVerticalOffset: platformSettings?.loginTitleVerticalOffset ?? 0,
          loginTitleColor: platformSettings?.loginTitleColor || null,
          logoTitle: platformSettings?.logoTitle || null,
          logoScale: platformSettings?.logoScale ?? 100,
          titleFontUrl: platformSettings?.titleFontUrl || null,
          titleFontWeight: platformSettings?.titleFontWeight || '600',
          titleFontSize: platformSettings?.titleFontSize ?? 14,
          titleVerticalOffset: platformSettings?.titleVerticalOffset ?? 0,
          menuAccentColor: platformSettings?.menuAccentColor || null,
          faviconUrl: platformSettings?.faviconUrl || null,
        },
      });
      for (const section of sectionValues) {
        const ownership = ownershipBySection.get(section.section);
        if (ownership?.sourceRef && (
          ownership.sourceRef !== sourceRef
          || (ownership.scopeKey || 'platform') !== adminConfigScopeKey(normalizedTenantId)
        )) {
          changes.push({
            objectType: 'platform_settings', key: section.section, operation: 'conflict', currentId: platformSettings?.id,
            reason: `Platform ${section.section} settings are owned by another configuration bundle`,
          });
          continue;
        }
        const valuesMatch = JSON.stringify(section.current) === JSON.stringify(section.desired);
        const seededDefaults: Record<PlatformSettingsSection, unknown> = {
          general: { defaultEnvironmentTagId: null, emailPlatformName: 'EnterpriseGlue' },
          git_sync: { pushEnabled: true, pullEnabled: false, bothEnabled: false, projectTokenSharingEnabled: false },
          deployment: { defaultDeployRoles: ['owner', 'delegate', 'operator'], credentiallessCustomerSidecarsEnabled: false },
          invitations: { allowAllDomains: true, allowedDomains: [] },
          pii: {
            regexEnabled: false, externalProviderEnabled: false, externalProviderType: null,
            externalProviderEndpoint: null, externalProviderAuthHeader: null, externalProviderAuthTokenRef: null,
            externalProviderProjectId: null, externalProviderRegion: null, redactionStyle: '<TYPE>',
            scopes: ['processDetails', 'history', 'logs', 'errors', 'audit'],
            maxPayloadSizeBytes: 262144,
          },
          branding: {
            logoUrl: null, loginLogoUrl: null, loginTitleVerticalOffset: 0, loginTitleColor: null,
            logoTitle: null, logoScale: 100, titleFontUrl: null, titleFontWeight: '600', titleFontSize: 14,
            titleVerticalOffset: 0, menuAccentColor: null, faviconUrl: null,
          },
          login: null,
          governance: null,
        };
        const pristineSectionSeed = Boolean(platformSettings)
          && !platformSettings!.updatedById
          && !ownership
          && JSON.stringify(section.current) === JSON.stringify(seededDefaults[section.section]);
        const ownershipMatches = ownership?.sourceRef === sourceRef
          && ownership.ownershipMode === desiredPlatformSettings.ownershipMode
          && ownership.driftStatus === 'in_sync';
        changes.push({
          objectType: 'platform_settings',
          key: section.section,
          operation: !platformSettings ? 'create' : valuesMatch && ownershipMatches ? 'noop' : 'update',
          ...(platformSettings ? { currentId: platformSettings.id } : {}),
          ...(platformSettings ? { expectedUpdatedAt: Number(platformSettings.updatedAt) } : {}),
          ...(ownership ? { expectedOwnershipGeneration: Number(ownership.generation || 0) } : {}),
          reason: !platformSettings
            ? `Platform ${section.section} settings have not been persisted yet`
            : valuesMatch && ownershipMatches
              ? `Config-owned platform ${section.section} settings already match the desired state`
              : ownership?.sourceRef
                ? `Config-owned platform ${section.section} settings differ from the desired state`
                : pristineSectionSeed
                  ? `Product-seeded platform ${section.section} settings will be configured by this bundle`
                : `Persisted platform ${section.section} settings will be adopted by this configuration bundle`,
        });
      }
    }

    const machinePrincipals = values(compilation.files, './machine-principals.json', 'machinePrincipals');
    const catalogFamilies: Array<{
      path: string;
      property: string;
      objectType: AdminConfigObjectType;
      desired: any[];
      current: Array<{ id: string }>;
      naturalMatch: (row: any, desired: any) => boolean;
    }> = [
      {
        path: './git-providers.json', property: 'gitProviders', objectType: 'git_provider',
        desired: values(compilation.files, './git-providers.json', 'gitProviders'), current: gitProviders,
        naturalMatch: (row, desired) => (row.tenantId || null) === normalizedTenantId && row.name.toLowerCase() === desired.name.toLowerCase(),
      },
      {
        path: './email-configurations.json', property: 'emailConfigurations', objectType: 'email_configuration',
        desired: values(compilation.files, './email-configurations.json', 'emailConfigurations'), current: emailConfigurations,
        naturalMatch: (row, desired) => row.name.toLowerCase() === desired.name.toLowerCase(),
      },
      {
        path: './email-templates.json', property: 'emailTemplates', objectType: 'email_template',
        desired: values(compilation.files, './email-templates.json', 'emailTemplates'), current: emailTemplates,
        naturalMatch: (row, desired) => row.type === desired.type,
      },
      {
        path: './permissions.json', property: 'permissions', objectType: 'permission',
        desired: values(compilation.files, './permissions.json', 'permissions'), current: customPermissions,
        naturalMatch: (row, desired) => row.key === desired.key,
      },
      {
        path: './authorization-policies.json', property: 'authorizationPolicies', objectType: 'authorization_policy',
        desired: values(compilation.files, './authorization-policies.json', 'authorizationPolicies'), current: authorizationPolicies,
        naturalMatch: (row, desired) => (row.tenantId || null) === normalizedTenantId && row.name.toLowerCase() === desired.name.toLowerCase(),
      },
      {
        path: './machine-principals.json', property: 'machinePrincipals', objectType: 'api_client',
        desired: machinePrincipals.filter((principal) => principal.kind === 'api_client'), current: apiClients,
        naturalMatch: (row, desired) => row.name.toLowerCase() === desired.name.toLowerCase(),
      },
      {
        path: './machine-principals.json', property: 'machinePrincipals', objectType: 'service_account',
        desired: machinePrincipals.filter((principal) => principal.kind === 'service_account'), current: serviceAccounts,
        naturalMatch: (row, desired) => row.name.toLowerCase() === desired.name.toLowerCase(),
      },
      {
        path: './external-engine-systems.json', property: 'externalEngineSystems', objectType: 'external_engine_system',
        desired: values(compilation.files, './external-engine-systems.json', 'externalEngineSystems'), current: externalEngineSystems,
        naturalMatch: (row, desired) => (row.tenantId || null) === normalizedTenantId && row.key === desired.key,
      },
    ];
    const scopedAdminOwnership = adminOwnership.filter((ownership) =>
      ownership.scopeKey === adminConfigScopeKey(normalizedTenantId));
    const ownershipByKeyIdentity = new Map(scopedAdminOwnership.map((ownership) => [ownership.keyIdentity, ownership]));
    for (const family of catalogFamilies) {
      if (!compilation.files[family.path]) continue;
      const desiredKeys = new Set(family.desired.map((entry) => entry.key));
      for (const desired of family.desired) {
        const keyIdentity = adminConfigKeyIdentity(family.objectType, normalizedTenantId, desired.key);
        const ownership = ownershipByKeyIdentity.get(keyIdentity);
        if (ownership?.sourceRef && ownership.sourceRef !== sourceRef) {
          changes.push({
            objectType: family.objectType,
            key: desired.key,
            operation: 'conflict',
            currentId: ownership.objectId,
            reason: `${adminConfigObjectLabel(family.objectType)} is owned by another configuration bundle`,
          });
          continue;
        }
        const current = ownership
          ? family.current.find((candidate) => candidate.id === ownership.objectId)
          : family.current.find((candidate) => family.naturalMatch(candidate, desired));
        if (ownership && !current) {
          changes.push({
            objectType: family.objectType,
            key: desired.key,
            operation: 'conflict',
            currentId: ownership.objectId,
            reason: 'Configuration ownership exists but the persisted object is missing',
          });
          continue;
        }
        const desiredHash = hashCanonicalConfig({ kind: family.objectType, key: desired.key, value: desired });
        const inSync = current && ownership?.sourceRef === sourceRef && ownership.active
          && ownership.sourceHash === desiredHash && ownership.driftStatus === 'in_sync'
          && ownership.ownershipMode === desired.ownershipMode;
        changes.push({
          objectType: family.objectType,
          key: desired.key,
          operation: !current ? 'create' : inSync ? 'noop' : 'update',
          ...(current ? { currentId: current.id } : {}),
          ...(current ? { expectedUpdatedAt: Number((current as { updatedAt?: unknown }).updatedAt) } : {}),
          ...(ownership ? { expectedOwnershipGeneration: Number(ownership.generation || 0) } : {}),
          reason: !current
            ? `${adminConfigObjectLabel(family.objectType)} does not exist`
            : inSync
              ? `Config-owned ${adminConfigObjectLabel(family.objectType)} already matches the desired state`
              : ownership
                ? `Config-owned ${adminConfigObjectLabel(family.objectType)} differs from the desired state`
                : `Existing ${adminConfigObjectLabel(family.objectType)} will be adopted by this configuration bundle`,
        });
      }
      if (manifest.mode === 'authoritative') {
        for (const ownership of scopedAdminOwnership.filter((candidate) =>
          candidate.active
          && candidate.objectType === family.objectType
          && candidate.sourceRef === sourceRef
          && candidate.scopeKey === (normalizedTenantId || 'platform')
          && !desiredKeys.has(candidate.configKey))) {
          changes.push({
            objectType: family.objectType,
            key: ownership.configKey,
            operation: 'archive',
            currentId: ownership.objectId,
            expectedOwnershipGeneration: Number(ownership.generation || 0),
            expectedUpdatedAt: Number((family.current.find((candidate) => candidate.id === ownership.objectId) as { updatedAt?: unknown } | undefined)?.updatedAt || 0),
            reason: `Config-owned ${adminConfigObjectLabel(family.objectType)} is absent from the authoritative bundle`,
          });
        }
      }
    }
    const desiredAssignmentGroupIds = new Map<string, string>();
    const desiredIdentityMappingGroupIds = new Map<string, string>();

    const desiredRoles = values(compilation.files, './roles.json', 'roles');
    const desiredRoleKeys = new Set(desiredRoles.map((role) => role.key));
    const desiredGroups = values(compilation.files, './groups.json', 'groups');
    const desiredGroupKeys = new Set(desiredGroups.map((group) => group.key));
    const desiredEngines = values(compilation.files, './engines.json', 'engines');
    const desiredEngineKeys = new Set(desiredEngines.map((engine) => engine.key));
    const desiredEngineByKey = new Map(desiredEngines.map((engine) => [engine.key, engine]));
    const desiredEngineBackstopMappings = values(compilation.files, './engine-backstop-mappings.json', 'engineBackstopMappings');
    const desiredEngineBackstopMappingKeys = new Set(desiredEngineBackstopMappings.map((mapping) => mapping.key));
    const desiredEngineTenantMappings = values(compilation.files, './engine-tenant-mappings.json', 'engineTenantMappings');
    const desiredEngineTenantMappingKeys = new Set(desiredEngineTenantMappings.map((mapping) => mapping.key));
    const desiredEngineSets = values(compilation.files, './engine-sets.json', 'engineSets');
    const desiredEngineSetKeys = new Set(desiredEngineSets.map((set) => set.key));
    const desiredRuntimeResourceSets = values(compilation.files, './runtime-resource-sets.json', 'runtimeResourceSets');
    const desiredRuntimeResourceSetKeys = new Set(desiredRuntimeResourceSets.map((set) => set.key));
    const desiredIdentityProviders = values(compilation.files, './identity-providers.json', 'identityProviders');
    const desiredIdentityProviderKeys = new Set(desiredIdentityProviders.map((provider) => provider.key));
    for (const role of desiredRoles) {
      const existing = rolesByKey.get(role.key);
      const permissions = compilation.preview.expandedRolePermissions?.[role.key] || role.permissions || [];
      const permissionChanges = rolePermissionChanges(existing ? rolePermissionsByRoleId.get(existing.id) || [] : [], permissions);
      const affectedAssignmentCount = existing ? assignmentCountByRoleId.get(existing.id) || 0 : 0;
      if (!existing) {
        changes.push({ objectType: 'role', key: role.key, operation: 'create', reason: 'No persisted role uses this tenant-scoped key', permissionChanges, affectedAssignmentCount });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'role', key: role.key, operation: 'conflict', currentId: existing.id, reason: 'Existing role is not owned by this configuration bundle' });
      } else if (
        existing.name !== role.name ||
        (existing.description || null) !== (role.description || null) ||
        existing.scope !== role.scope ||
        existing.isArchived ||
        (existing.ownershipMode || 'config_locked') !== (role.ownershipMode || 'config_locked') ||
        !samePermissions(rolePermissionsByRoleId.get(existing.id) || [], permissions)
      ) {
        changes.push({ objectType: 'role', key: role.key, operation: 'update', currentId: existing.id, reason: 'Config-owned role differs from the desired name, scope, description, ownership mode, archive state, or permissions', ...(hasPermissionChanges(permissionChanges) ? { permissionChanges } : {}), affectedAssignmentCount });
      } else {
        changes.push({ objectType: 'role', key: role.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned role already matches the desired state' });
      }
    }

    for (const group of desiredGroups) {
      const existing = groupsByKey.get(group.key);
      if (!existing) {
        changes.push({ objectType: 'group', key: group.key, operation: 'create', reason: 'No persisted group uses this tenant-scoped key' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'group', key: group.key, operation: 'conflict', currentId: existing.id, reason: 'Existing group is not owned by this configuration bundle' });
      } else if (
        existing.name !== group.name ||
        (existing.description || null) !== (group.description || null) ||
        existing.isArchived ||
        (existing.ownershipMode || 'config_locked') !== (group.ownershipMode || 'config_locked')
      ) {
        changes.push({ objectType: 'group', key: group.key, operation: 'update', currentId: existing.id, reason: 'Config-owned group differs from the desired name, description, ownership mode, or archive state' });
      } else {
        changes.push({ objectType: 'group', key: group.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned group already matches the desired state' });
      }
    }

    for (const engine of desiredEngines) {
      const existing = enginesByConfigKey.get(engine.key) || tenantEngines.find(
        (candidate) =>
          candidate.lifecycleStatus !== 'decommissioned'
          && candidate.externalId
          && candidate.externalId === engine.externalId,
      );
      const desiredTenancyMode = engine.tenancy?.mode || 'dedicated';
      const desiredTenantId = desiredDedicatedTenantId(engine, normalizedTenantId);
      const desiredCredentials = desiredEngineCredentialFields(engine.auth);
      if (!existing) {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'create', reason: 'No persisted engine uses this config key or external id' });
      } else if (existing.registrationSource !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'conflict', currentId: existing.id, reason: 'Existing engine is not owned by this configuration bundle' });
      } else if (
        (existing.tenancyMode || 'dedicated') !== desiredTenancyMode
        || (
          desiredTenancyMode === 'shared'
          && existing.tenantMappingStrategy !== engine.tenancy.mappingStrategy
        )
        || (
          desiredTenancyMode === 'dedicated'
          && desiredTenantId !== null
          && normalizeTenantIdForPersistence(existing.tenantId) !== null
          && normalizeTenantIdForPersistence(existing.tenantId) !== desiredTenantId
        )
      ) {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'conflict', currentId: existing.id, reason: 'Engine tenancy changes require the dedicated topology transition workflow' });
      } else if (
        existing.name !== engine.name || existing.baseUrl !== engine.baseUrl || existing.type !== engine.type ||
        existing.externalId !== (engine.externalId || null) || existing.labelsJson !== JSON.stringify(engine.labels || {}) ||
        existing.runtimeAccessScope !== engine.runtimeAccessScope || existing.deploymentIntegration !== engine.deploymentIntegration ||
        (existing.metadataDiscoveryEnabled !== false) !== engine.metadataDiscoveryEnabled ||
        (existing.deploymentDiscoveryEnabled !== false) !== engine.deploymentDiscoveryEnabled ||
        Number(existing.reconciliationIntervalSeconds || 300) !== engine.reconciliationIntervalSeconds ||
        (existing.pipelineReceiptEnabled !== false) !== engine.pipelineReceiptEnabled ||
        existing.connectionMode !== engine.connectionMode || existing.ownershipMode !== (engine.ownershipMode || 'config_locked') ||
        (existing.authType || 'none') !== desiredCredentials.authType ||
        (existing.username || null) !== desiredCredentials.username ||
        (existing.passwordEnc || null) !== desiredCredentials.passwordEnc ||
        (existing.oauthTokenUrl || null) !== desiredCredentials.oauthTokenUrl ||
        (existing.oauthScopes || null) !== desiredCredentials.oauthScopes ||
        (existing.oauthAudience || null) !== desiredCredentials.oauthAudience
      ) {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'update', currentId: existing.id, reason: 'Config-owned engine differs from desired connection, metadata, or authorization settings' });
      } else {
        changes.push({ objectType: 'engine', key: engine.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned engine already matches the desired state' });
      }
    }

    for (const mapping of desiredEngineBackstopMappings) {
      const desiredEngine = desiredEngineByKey.get(mapping.engineRef.engineKey);
      const engine = enginesByConfigKey.get(mapping.engineRef.engineKey);
      const group = groupsByKey.get(mapping.groupRef.groupKey);
      const mappingSourceRef = configEngineBackstopMappingSourceRef(manifest.metadata.key, mapping.key);
      const sourceRows = engineBackstopMappings.filter((row) => row.source === CONFIG_SOURCE && row.sourceRef === mappingSourceRef);
      const sourceRow = sourceRows[0];
      const identityRow = engine && group
        ? engineBackstopMappings.find((row) => row.engineId === engine.id && row.authzGroupId === group.id)
        : undefined;
      const existing = sourceRow || identityRow;

      if (!desiredEngine || !isEngineBackstopNativeAuthorizationEngineType(desiredEngine.type)) {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: existing?.id,
          reason: 'Mirrored backstop mapping references an unresolved or unsupported Camunda 7 or Operaton configured engine',
        });
        continue;
      }
      if (sourceRows.length > 1) {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: sourceRow?.id,
          reason: 'More than one persisted backstop mapping is associated with this stable config key',
        });
        continue;
      }
      if (sourceRow && identityRow && sourceRow.id !== identityRow.id) {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: identityRow.id,
          reason: 'The desired EnterpriseGlue group is already associated with another native mapping',
        });
        continue;
      }
      if (identityRow && (identityRow.source !== CONFIG_SOURCE || identityRow.sourceRef !== mappingSourceRef)) {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: identityRow.id,
          reason: 'The desired EnterpriseGlue group mapping is owned by another source',
        });
        continue;
      }
      if (!existing && !mapping.isActive) {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'noop',
          reason: 'Inactive backstop mapping is absent and already has no effect',
        });
      } else if (!existing) {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'create',
          reason: 'No persisted backstop mapping uses this config key or EnterpriseGlue group identity',
        });
      } else if (
        existing.engineId !== engine?.id
        || existing.authzGroupId !== group?.id
        || existing.nativeGroupSecretRef !== mapping.nativeGroupIdRef
        || existing.ownershipMode !== mapping.ownershipMode
        || existing.isActive !== mapping.isActive
      ) {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'update',
          currentId: existing.id,
          reason: 'Config-owned backstop mapping differs from the desired engine, group, secret reference, ownership, or active state',
        });
      } else {
        changes.push({
          objectType: 'engine_backstop_mapping',
          key: mapping.key,
          operation: 'noop',
          currentId: existing.id,
          reason: 'Config-owned backstop mapping already matches the desired state',
        });
      }
    }

    for (const mapping of desiredEngineTenantMappings) {
      const desiredEngine = desiredEngineByKey.get(mapping.engineRef.engineKey);
      const engine = enginesByConfigKey.get(mapping.engineRef.engineKey);
      const mappingSourceRef = configEngineTenantMappingSourceRef(manifest.metadata.key, mapping.key);
      const sourceRows = engineTenantMappings.filter((row) =>
        row.source === CONFIG_SOURCE && row.sourceRef === mappingSourceRef);
      const sourceRow = sourceRows[0];
      const identityRow = engine
        ? engineTenantMappings.find((row) =>
          row.engineId === engine.id
          && row.strategy === mapping.strategy
          && row.externalTenantId === mapping.externalTenantId)
        : undefined;
      const existing = sourceRow || identityRow;

      if (!desiredEngine || desiredEngine.tenancy?.mode !== 'shared') {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: existing?.id,
          reason: 'Engine tenant mapping references an unresolved or non-shared configured engine',
        });
        continue;
      }
      if (desiredEngine.tenancy.mappingStrategy !== mapping.strategy) {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: existing?.id,
          reason: 'Engine tenant mapping strategy does not match the configured shared engine',
        });
        continue;
      }
      if (sourceRows.length > 1) {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: sourceRow?.id,
          reason: 'More than one persisted mapping is associated with this stable config key',
        });
        continue;
      }
      if (sourceRow && identityRow && sourceRow.id !== identityRow.id) {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: identityRow.id,
          reason: 'The desired engine tenant identity is already owned by another mapping row',
        });
        continue;
      }
      if (identityRow && (identityRow.source !== CONFIG_SOURCE || identityRow.sourceRef !== mappingSourceRef)) {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: identityRow.id,
          reason: 'The desired engine tenant identity is owned by another source',
        });
        continue;
      }

      let enterpriseTenantId: string;
      try {
        const resolution = await engineTenancyProvisioningService.resolveForCreate({
          tenancy: { mode: 'dedicated', tenantRef: mapping.tenantRef },
          requestTenantId: normalizedTenantId,
          principalType: policy?.tenantReferencePrincipalType || 'system',
          principalId: policy?.tenantReferencePrincipalId || null,
          resolver: policy?.tenantReferenceResolver,
        });
        enterpriseTenantId = resolution.tenantId!;
      } catch {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'conflict',
          currentId: existing?.id,
          reason: 'Engine tenant mapping references a tenant that cannot be resolved or authorized',
        });
        continue;
      }

      if (!existing && !mapping.active) {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'noop',
          reason: 'Inactive mapping is absent and already has no effect',
        });
      } else if (!existing) {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'create',
          reason: 'No persisted engine tenant mapping uses this config key or engine tenant identity',
        });
      } else if (
        existing.engineId !== engine?.id
        || existing.enterpriseTenantId !== enterpriseTenantId
        || existing.tenantReferenceJson !== JSON.stringify(mapping.tenantRef)
        || existing.externalTenantId !== mapping.externalTenantId
        || existing.strategy !== mapping.strategy
        || existing.ownershipMode !== mapping.ownershipMode
        || existing.isActive !== mapping.active
      ) {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'update',
          currentId: existing.id,
          reason: 'Config-owned engine tenant mapping differs from the desired engine, tenant, strategy, identity, ownership, or active state',
        });
      } else {
        changes.push({
          objectType: 'engine_tenant_mapping',
          key: mapping.key,
          operation: 'noop',
          currentId: existing.id,
          reason: 'Config-owned engine tenant mapping already matches the desired state',
        });
      }
    }

    for (const set of desiredEngineSets) {
      const existing = engineSetsByKey.get(set.key);
      if (!existing) changes.push({ objectType: 'engine_set', key: set.key, operation: 'create', reason: 'No persisted Engine Set uses this tenant-scoped key' });
      else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) changes.push({ objectType: 'engine_set', key: set.key, operation: 'conflict', currentId: existing.id, reason: 'Existing Engine Set is not owned by this configuration bundle' });
      else if (existing.name !== set.name || (existing.description || null) !== (set.description || null) || existing.isArchived || (existing.ownershipMode || 'config_locked') !== (set.ownershipMode || 'config_locked')) changes.push({ objectType: 'engine_set', key: set.key, operation: 'update', currentId: existing.id, reason: 'Config-owned Engine Set differs from desired metadata, ownership mode, or archive state' });
      else changes.push({ objectType: 'engine_set', key: set.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned Engine Set metadata already matches the desired state' });
    }

    for (const set of desiredRuntimeResourceSets) {
      const existing = runtimeResourceSetsByKey.get(set.key);
      const engine = enginesByConfigKey.get(set.engineRef.engineKey) || externalEnginesByKey.get(set.engineRef.engineKey);
      const runtimeResourceChanges = engine
        ? runtimeResourceChangeSummary(
          runtimeResourcesByEngineAndKind.get(`${engine.id}:${set.resourceKind}`) || [],
          existing ? runtimeResourceSetMaterializationsBySetId.get(existing.id) || [] : [],
          runtimeResourcesById,
          set.selector as RuntimeResourceSetSelector,
          set.runtimeTenantId,
        )
        : undefined;
      const stagedConfiguredEngine = desiredEngineByKey.has(set.engineRef.engineKey);
      if (!engine && !stagedConfiguredEngine) {
        changes.push({
          objectType: 'runtime_resource_set',
          key: set.key,
          operation: 'conflict',
          currentId: existing?.id,
          reason: invalidExternalEngineKeys.has(set.engineRef.engineKey)
            ? 'Runtime Resource Set references an invalid or inaccessible existing-engine migration reference'
            : 'Runtime Resource Set references an unresolved configured engine',
        });
      } else if (!existing) {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'create', reason: 'No persisted Runtime Resource Set uses this tenant-scoped key', ...(runtimeResourceChanges ? { runtimeResourceChanges } : {}) });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'conflict', currentId: existing.id, reason: 'Existing Runtime Resource Set is not owned by this configuration bundle' });
      } else if (
        existing.name !== set.name ||
        (existing.description || null) !== (set.description || null) ||
        existing.engineId !== engine?.id ||
        existing.resourceKind !== set.resourceKind ||
        existing.selectorJson !== JSON.stringify(set.selector) ||
        existing.runtimeTenantId !== (set.runtimeTenantId || null) ||
        (existing.ownershipMode || 'config_locked') !== (set.ownershipMode || 'config_locked') ||
        existing.isArchived
      ) {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'update', currentId: existing.id, reason: 'Config-owned Runtime Resource Set differs from the desired engine, selector, tenant, ownership mode, metadata, or archive state', ...(runtimeResourceChanges ? { runtimeResourceChanges } : {}) });
      } else {
        changes.push({ objectType: 'runtime_resource_set', key: set.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned Runtime Resource Set already matches the desired state' });
      }
    }

    for (const provider of desiredIdentityProviders) {
      const existing = identityProvidersByKey.get(provider.key);
      const configurationJson = JSON.stringify(providerConfiguration(provider));
      const syncJson = JSON.stringify(provider.sync);
      const loginDomainsJson = JSON.stringify(provider.loginDomains);
      if (!existing) {
        changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'create', reason: 'No persisted identity provider uses this tenant-scoped key' });
      } else if (existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'conflict', currentId: existing.id, reason: 'Existing identity provider is not owned by this configuration bundle' });
      } else if (
        existing.protocol !== provider.type || existing.isEnabled !== provider.enabled ||
        (existing.displayName || existing.key) !== (provider.displayName || provider.key) ||
        existing.organization !== (provider.organization || null) ||
        Number(existing.displayOrder || 0) !== provider.displayOrder ||
        Boolean(existing.isPreferred) !== provider.preferred ||
        existing.loginDomainsJson !== loginDomainsJson ||
        existing.authenticationMode !== provider.authenticationMode ||
        existing.directoryTenantId !== (provider.directoryTenantId || null) ||
        existing.configurationJson !== configurationJson || existing.syncJson !== syncJson ||
        existing.ownershipMode !== (provider.ownershipMode || 'config_locked')
      ) {
        changes.push({ objectType: 'identity_provider', key: provider.key, operation: 'update', currentId: existing.id, reason: 'Config-owned identity provider differs from the desired login presentation, protocol, configuration, sync, or ownership state' });
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
      const stagedProvider = !provider && desiredIdentityProviderKeys.has(mapping.providerKey);
      const stagedGroup = !group && desiredGroupKeys.has(mapping.targetGroupKey);
      if (group) desiredIdentityMappingGroupIds.set(mapping.key, group.id);
      if (!provider && !stagedProvider) {
        changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'conflict', reason: 'Identity mapping references an unresolved identity provider' });
      } else if (!group && !stagedGroup) {
        changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'conflict', reason: 'Identity mapping references an unresolved group' });
      } else if (!existing) {
        changes.push({
          objectType: 'identity_mapping',
          key: mapping.key,
          operation: 'create',
          reason: stagedProvider || stagedGroup
            ? 'Identity mapping references a provider or group that will be created by this configuration bundle'
            : 'No persisted identity mapping uses this config key',
        });
      }
      else if (existing.sourceRef !== sourceRef) changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'conflict', currentId: existing.id, reason: 'Existing identity mapping is not owned by this configuration bundle' });
      else if (
        (provider ? existing.providerId !== provider.id : stagedProvider) ||
        (group ? existing.targetGroupId !== group.id : stagedGroup) ||
        existing.entitlementType !== mapping.source.type || existing.externalId !== (mapping.source.externalId || null) ||
        existing.matchOperator !== mapping.source.operator || existing.syncMode !== mapping.syncMode ||
        (existing.ownershipMode || (existing.sourceRef ? 'config_locked' : 'manual')) !== (mapping.ownershipMode || 'config_locked') || !existing.isActive
      ) changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'update', currentId: existing.id, reason: 'Config-owned identity mapping differs from desired provider, entitlement, target group, sync mode, or active state' });
      else changes.push({ objectType: 'identity_mapping', key: mapping.key, operation: 'noop', currentId: existing.id, reason: 'Config-owned identity mapping already matches the desired state' });
      const change = changes[changes.length - 1];
      if (change?.objectType === 'identity_mapping' && change.key === mapping.key && change.operation !== 'conflict' && provider) {
        try {
          change.identitySnapshotPreview = await identityEntitlementMappingService.previewStoredSnapshots({
            providerKey: mapping.providerKey,
            entitlementType: mapping.source.type,
            externalId: mapping.source.externalId || null,
            matchOperator: mapping.source.operator,
          }, normalizedTenantId);
        } catch {
          // Snapshot availability is diagnostic only; diff and apply remain independent of it.
        }
      }
    }

    const desiredProjectEngineTargets = values(compilation.files, './project-engine-targets.json', 'projectEngineTargets');
    const desiredProjectEngineTargetPairs = new Set<string>();
    for (const target of desiredProjectEngineTargets) {
      const projectId = target.projectRef.id;
      const engine = enginesByConfigKey.get(target.engineRef.engineKey);
      const stagedEngine = !engine && desiredEngineKeys.has(target.engineRef.engineKey);
      const key = target.key || `${projectId || 'unresolved-project'}:${target.engineRef.engineKey}`;
      if (!projectId || !tenantProjectIds.has(projectId)) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'conflict', reason: 'Project-engine target references an unresolved project id' });
        continue;
      }
      if (!engine && !stagedEngine) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'conflict', reason: 'Project-engine target references an unresolved configured engine' });
        continue;
      }
      if (stagedEngine) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'create', reason: 'Project-engine target references an engine that will be created by this configuration bundle' });
        continue;
      }
      if (!engine) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'conflict', reason: 'Project-engine target references an unresolved configured engine' });
        continue;
      }
      const pair = `${projectId}:${engine.id}`;
      desiredProjectEngineTargetPairs.add(pair);
      const existing = projectEngineTargetsByPair.get(pair);
      if (!existing) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'create', reason: 'No persisted project-engine target uses this project and configured engine pair' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        if (target.transferOwnership) {
          changes.push({ objectType: 'project_engine_target', key, operation: 'update', currentId: existing.id, reason: `Transfer ownership from ${existing.source}${existing.sourceRef ? ` (${existing.sourceRef})` : ''} to this configuration bundle: ${target.transferOwnership.reason}` });
        } else {
          changes.push({ objectType: 'project_engine_target', key, operation: 'conflict', currentId: existing.id, reason: 'ownership_conflict: existing project-engine target is not owned by this configuration bundle; add transferOwnership with a reviewable reason to transfer it' });
        }
      } else if (target.transferOwnership) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'conflict', currentId: existing.id, reason: 'transferOwnership is valid only when replacing a target owned by another source' });
      } else if (
        existing.status !== target.status ||
        existing.allowManualDeploy !== target.allowManualDeploy ||
        existing.allowCiDeploy !== target.allowCiDeploy ||
        existing.allowApiDeploy !== target.allowApiDeploy ||
        existing.allowImport !== target.allowImport ||
        (existing.ownershipMode || 'config_locked') !== (target.ownershipMode || 'config_locked')
      ) {
        changes.push({ objectType: 'project_engine_target', key, operation: 'update', currentId: existing.id, reason: 'Config-owned project-engine target differs from desired status, ownership mode, or deployment eligibility modes' });
      } else {
        changes.push({ objectType: 'project_engine_target', key, operation: 'noop', currentId: existing.id, reason: 'Config-owned project-engine target already matches the desired state' });
      }
    }

    const desiredAssignmentKeys = new Set<string>();
    for (const assignment of desiredAssignments) {
      const key = assignmentDisplayKey(assignment);
      if (!['platform', 'tenant', 'engine', 'engine_set', 'engine_runtime_resource', 'engine_runtime_resource_set'].includes(assignment.scope.type)) {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', reason: `Config apply does not yet support ${assignment.scope.type} assignment scopes` });
        continue;
      }
      const role = rolesByKey.get(assignment.roleKey);
      const stagedRole = !role && desiredRoleKeys.has(assignment.roleKey);
      let principalId: string | null = null;
      let stagedPrincipal = false;
      if (assignment.principal.type === 'group') {
        const group = groupsByKey.get(assignment.principal.key);
        principalId = group?.id || null;
        stagedPrincipal = !group && desiredGroupKeys.has(assignment.principal.key);
      } else if (assignment.principal.type === 'user') {
        principalId = users.find((user) => user.id === assignment.principal.id && user.isActive)?.id || null;
      } else {
        const objectType = assignment.principal.type;
        if (assignment.principal.key) {
          const ownership = ownershipByKeyIdentity.get(adminConfigKeyIdentity(objectType, normalizedTenantId, assignment.principal.key));
          const rows = objectType === 'api_client' ? apiClients : serviceAccounts;
          principalId = ownership?.active && rows.some((row) => row.id === ownership.objectId) ? ownership.objectId : null;
          stagedPrincipal = !principalId && machinePrincipals.some((principal) => principal.kind === objectType && principal.key === assignment.principal.key);
        } else if (assignment.principal.id) {
          const rows = objectType === 'api_client' ? apiClients : serviceAccounts;
          principalId = rows.find((row) => row.id === assignment.principal.id && row.isActive)?.id || null;
        }
      }
      let scopeId: string | null = assignment.scope.type === 'platform' ? null
        : assignment.scope.type === 'tenant' ? normalizedTenantId
        : assignment.scope.type === 'engine' ? enginesByConfigKey.get(assignment.scope.engineKey)?.id || null
        : assignment.scope.type === 'engine_set' ? engineSetsByKey.get(assignment.scope.engineSetKey)?.id || null
        : assignment.scope.type === 'engine_runtime_resource_set' ? runtimeResourceSetsByKey.get(assignment.scope.runtimeResourceSetKey)?.id || null
        : null;
      const stagedScope = (assignment.scope.type === 'engine' && !scopeId && desiredEngineKeys.has(assignment.scope.engineKey))
        || (assignment.scope.type === 'engine_set' && !scopeId && desiredEngineSetKeys.has(assignment.scope.engineSetKey))
        || (assignment.scope.type === 'engine_runtime_resource_set' && !scopeId && desiredRuntimeResourceSetKeys.has(assignment.scope.runtimeResourceSetKey));
      if (assignment.scope.type === 'engine_runtime_resource') {
        const engine = enginesByConfigKey.get(assignment.scope.engineKey);
        scopeId = engine
          ? runtimeResourcesByIdentity.get(`${engine.id}:${assignment.scope.resourceKind}:${assignment.scope.resourceKey}:${assignment.scope.runtimeTenantId || ''}`)?.id || null
          : null;
      }
      if ((!role && !stagedRole) || (!principalId && !stagedPrincipal) || (assignment.scope.type !== 'platform' && !scopeId && !stagedScope)) {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', reason: 'Assignment references an unresolved role, principal, or scope' });
        continue;
      }
      if (stagedRole || stagedPrincipal || stagedScope) {
        changes.push({ objectType: 'assignment', key, operation: 'create', reason: 'Scoped role assignment references an object that will be created by this configuration bundle' });
        continue;
      }
      if (!role || !principalId) {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', reason: 'Assignment references an unresolved role or principal' });
        continue;
      }
      const assignmentKey = canonicalRoleAssignmentKey({
        tenantId: normalizedTenantId,
        principalType: assignment.principal.type,
        principalId,
        roleId: role.id,
        scopeType: assignment.scope.type,
        scopeId,
        source: CONFIG_SOURCE,
        sourceRef,
      });
      if (assignment.principal.type === 'group') desiredAssignmentGroupIds.set(key, principalId);
      desiredAssignmentKeys.add(assignmentKey);
      const existing = assignmentsByKey.get(assignmentKey);
      if (!existing) {
        changes.push({ objectType: 'assignment', key, operation: 'create', reason: 'No persisted scoped role assignment uses this canonical config-owned identity' });
      } else if (existing.source !== CONFIG_SOURCE || existing.sourceRef !== sourceRef) {
        changes.push({ objectType: 'assignment', key, operation: 'conflict', currentId: existing.id, reason: 'Existing scoped role assignment is not owned by this configuration bundle' });
      } else if (existing.expiresAt !== (assignment.expiresAt || null) || (existing.ownershipMode || 'config_locked') !== (assignment.ownershipMode || 'config_locked')) {
        changes.push({ objectType: 'assignment', key, operation: 'update', currentId: existing.id, reason: 'Config-owned scoped role assignment differs from the desired expiration or ownership mode' });
      } else {
        changes.push({ objectType: 'assignment', key, operation: 'noop', currentId: existing.id, reason: 'Config-owned scoped role assignment already matches the desired state' });
      }
    }

    const rolePermissionsByKey = new Map<string, string[]>();
    for (const role of tenantRoles) rolePermissionsByKey.set(role.key, rolePermissionsByRoleId.get(role.id) || []);
    for (const role of SystemRoleDefinitions) rolePermissionsByKey.set(role.key, role.permissions);
    for (const role of desiredRoles) rolePermissionsByKey.set(role.key, compilation.preview.expandedRolePermissions?.[role.key] || role.permissions || []);
    const runtimeSetEngineKeyByKey = new Map(desiredRuntimeResourceSets.map((set) => [set.key, set.engineRef.engineKey]));
    for (const engine of desiredEngines.filter((candidate) => candidate.deploymentIntegration === 'direct_engine')) {
      warnings.push({
        id: `config.direct_engine_lineage:${engine.key}`,
        message: `Direct-engine integration for ${engine.key} can discover runtime deployments but cannot establish project/file lineage without a validated pipeline receipt.`,
      });
      if (!engine.pipelineReceiptEnabled) {
        warnings.push({
          id: `config.direct_engine_lineage_receipts_disabled:${engine.key}`,
          message: `Pipeline receipts are disabled for direct-engine integration ${engine.key}; discovered deployments will remain inventory-only without project/file lineage.`,
        });
      }
    }
    for (const set of desiredRuntimeResourceSets) {
      const engine = desiredEngineByKey.get(set.engineRef.engineKey) || enginesByConfigKey.get(set.engineRef.engineKey);
      if (engine?.runtimeAccessScope === 'engine_wide') {
        warnings.push({
          id: `config.runtime_resource_set_engine_wide:${set.key}`,
          message: `Runtime Resource Set ${set.key} is attached to engine-wide engine ${set.engineRef.engineKey}; engine-scoped access can bypass this narrower selector.`,
        });
      }
    }
    for (const broadAssignment of desiredAssignments.filter((assignment) => assignment.principal.type === 'group' && assignment.scope.type === 'engine')) {
      for (const narrowAssignment of desiredAssignments.filter((assignment) => assignment.principal.type === 'group' && assignment.scope.type === 'engine_runtime_resource_set')) {
        if (
          broadAssignment.principal.key === narrowAssignment.principal.key &&
          broadAssignment.roleKey === narrowAssignment.roleKey &&
          broadAssignment.scope.engineKey === runtimeSetEngineKeyByKey.get(narrowAssignment.scope.runtimeResourceSetKey)
        ) {
          warnings.push({
            id: `config.runtime_grant_shadow:${broadAssignment.principal.key}:${broadAssignment.roleKey}:${broadAssignment.scope.engineKey}:${narrowAssignment.scope.runtimeResourceSetKey}`,
            message: `Engine-wide assignment for group ${broadAssignment.principal.key} and role ${broadAssignment.roleKey} can shadow its narrower Runtime Resource Set assignment ${narrowAssignment.scope.runtimeResourceSetKey}.`,
          });
        }
      }
    }
    for (const target of desiredProjectEngineTargets.filter((candidate) => !candidate.allowManualDeploy && (candidate.allowCiDeploy || candidate.allowApiDeploy))) {
      for (const assignment of desiredAssignments.filter((candidate) => candidate.principal.type === 'group' && candidate.scope.type === 'engine' && candidate.scope.engineKey === target.engineRef.engineKey)) {
        if ((rolePermissionsByKey.get(assignment.roleKey) || []).includes(EnginePermissions.DEPLOY)) {
          warnings.push({
            id: `config.pipeline_target_human_deployer:${target.key || target.projectRef.id}:${assignment.principal.key}:${assignment.roleKey}`,
            message: `Pipeline-only target ${target.key || target.engineRef.engineKey} has a group deployment assignment for ${assignment.principal.key}; manual deployment remains disabled but this role can deploy where another target permits it.`,
          });
        }
      }
    }

    if (manifest.mode === 'authoritative') {
      for (const role of tenantRoles) {
        if (role.source === CONFIG_SOURCE && role.sourceRef === sourceRef && !desiredRoleKeys.has(role.key) && !role.isArchived) {
          changes.push({ objectType: 'role', key: role.key, operation: 'archive', currentId: role.id, reason: 'Config-owned role is absent from an authoritative bundle', permissionChanges: rolePermissionChanges(rolePermissionsByRoleId.get(role.id) || [], []), affectedAssignmentCount: assignmentCountByRoleId.get(role.id) || 0 });
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
      const mappingSourcePrefix = configEngineTenantMappingSourcePrefix(manifest.metadata.key);
      for (const mapping of engineTenantMappings) {
        if (
          mapping.source === CONFIG_SOURCE
          && mapping.sourceRef.startsWith(mappingSourcePrefix)
          && !desiredEngineTenantMappingKeys.has(mapping.sourceRef.slice(mappingSourcePrefix.length))
          && mapping.isActive
        ) {
          changes.push({
            objectType: 'engine_tenant_mapping',
            key: mapping.sourceRef.slice(mappingSourcePrefix.length),
            operation: 'archive',
            currentId: mapping.id,
            reason: 'Config-owned engine tenant mapping is absent from an authoritative bundle',
          });
        }
      }
      const backstopMappingSourcePrefix = configEngineBackstopMappingSourcePrefix(manifest.metadata.key);
      for (const mapping of engineBackstopMappings) {
        if (
          mapping.source === CONFIG_SOURCE
          && mapping.sourceRef.startsWith(backstopMappingSourcePrefix)
          && !desiredEngineBackstopMappingKeys.has(mapping.sourceRef.slice(backstopMappingSourcePrefix.length))
          && mapping.isActive
        ) {
          changes.push({
            objectType: 'engine_backstop_mapping',
            key: mapping.sourceRef.slice(backstopMappingSourcePrefix.length),
            operation: 'archive',
            currentId: mapping.id,
            reason: 'Config-owned backstop mapping is absent from an authoritative bundle',
          });
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
      if (!change.reason.toLowerCase().includes('will be adopted')) continue;
      const acknowledgementId = `config.ownership_adoption:${change.objectType}:${change.key}`;
      warnings.push({
        id: acknowledgementId,
        acknowledgementId,
        message: `Configuration will adopt the existing ${change.objectType.replace(/_/g, ' ')} ${change.key}; future changes will follow its declared ownership mode.`,
      });
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
    const affectedGroupIds = new Set<string>();
    for (const change of changes) {
      if (change.operation === 'noop' || change.operation === 'conflict') continue;
      if (change.objectType === 'group' && change.currentId) affectedGroupIds.add(change.currentId);
      if (change.objectType === 'assignment') {
        const existing = change.currentId ? assignmentsById.get(change.currentId) : undefined;
        if (existing?.principalType === 'group' && existing.principalId) affectedGroupIds.add(existing.principalId);
        const desiredGroupId = desiredAssignmentGroupIds.get(change.key);
        if (desiredGroupId) affectedGroupIds.add(desiredGroupId);
      }
      if (change.objectType === 'identity_mapping') {
        const existing = change.currentId ? tenantIdentityMappings.find((mapping) => mapping.id === change.currentId) : undefined;
        if (existing) affectedGroupIds.add(existing.targetGroupId);
        const desiredGroupId = desiredIdentityMappingGroupIds.get(change.key);
        if (desiredGroupId) affectedGroupIds.add(desiredGroupId);
      }
      if (change.objectType === 'engine_backstop_mapping') {
        const existing = change.currentId ? engineBackstopMappings.find((mapping) => mapping.id === change.currentId) : undefined;
        if (existing) affectedGroupIds.add(existing.authzGroupId);
        const desired = desiredEngineBackstopMappings.find((mapping) => mapping.key === change.key);
        const desiredGroup = desired ? groupsByKey.get(desired.groupRef.groupKey) : undefined;
        if (desiredGroup) affectedGroupIds.add(desiredGroup.id);
      }
      if (change.objectType === 'role' && change.currentId) {
        for (const assignment of tenantAssignments) {
          if (assignment.roleId === change.currentId && assignment.principalType === 'group' && assignment.principalId) affectedGroupIds.add(assignment.principalId);
        }
      }
    }
    const affectedUserIds = new Set(tenantGroupMemberships.filter((membership) => affectedGroupIds.has(membership.groupId)).map((membership) => membership.userId));
    const affectedPrincipals = {
      affectedGroupCount: affectedGroupIds.size,
      affectedUserCount: affectedUserIds.size,
      externalIdentityMappingChangeCount: changes.filter((change) => change.objectType === 'identity_mapping' && change.operation !== 'noop' && change.operation !== 'conflict').length,
    };
    return {
      valid: true,
      canonicalHash: compilation.preview.canonicalHash,
      contract: compilation.preview.contract,
      errors: [],
      changes,
      warnings,
      requiredAcknowledgements: warnings.flatMap((warning) => warning.acknowledgementId ? [warning.acknowledgementId] : []),
      affectedPrincipals,
    };
  }
}

export const configBundleDiffService = new ConfigBundleDiffService();
