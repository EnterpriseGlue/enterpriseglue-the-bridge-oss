import { In, IsNull, Like } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineBackstopGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopGroupMapping.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityProvisioningDirectory } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvisioningDirectory.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { PlatformSettingsSectionOwnership } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettingsSectionOwnership.js';
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
import { OSS_DEFAULT_TENANT_ID, normalizeTenantIdForPersistence } from '../../authz/tenant-scope.js';
import { EngineTenantReferenceSchema } from '../../schemas/mission-control/engine.js';
import {
  configBundleContractMetadataForApiVersion,
  ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1,
  type ConfigBundleContractMetadata,
} from '../../schemas/platform-admin/config-bundle.js';
import { normalizeIdentityProviderSyncForMandatoryLogin } from '../../schemas/platform-admin/identity.js';
import { parseAdminConfigSecretReferences } from './AdminConfigObjectOwnershipService.js';
import { adminConfigScopeKey } from './AdminConfigObjectOwnershipService.js';

function json(value: string | null | undefined): Record<string, unknown> {
  try { const parsed = value ? JSON.parse(value) : {}; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

function jsonArray(value: string | null | undefined): unknown[] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function exportedTenantReference(
  mapping: EngineTenantMapping,
  bundleTenantId: string | null,
) {
  try {
    const parsed = EngineTenantReferenceSchema.safeParse(
      mapping.tenantReferenceJson ? JSON.parse(mapping.tenantReferenceJson) : null,
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Legacy or corrupted reference metadata falls back to the resolved ID.
  }
  const normalizedBundleTenantId = normalizeTenantIdForPersistence(bundleTenantId) || OSS_DEFAULT_TENANT_ID;
  if (mapping.enterpriseTenantId === normalizedBundleTenantId) return { type: 'request_context' as const };
  if (mapping.enterpriseTenantId === OSS_DEFAULT_TENANT_ID) return { type: 'default' as const };
  return { type: 'id' as const, id: mapping.enterpriseTenantId };
}

class ConfigBundleExportService {
  async exportBundle(input: { bundleKey: string; tenantId?: string | null; tenantKey?: string }): Promise<{ bundle: Record<string, unknown>; files: Record<string, unknown>; contract: ConfigBundleContractMetadata }> {
    const dataSource = await getDataSource();
    const tenantId = input.tenantId || null;
    const sourceRef = `config_bundle:${input.bundleKey}`;
    const backstopMappingSourcePrefix = `${sourceRef}:engine_backstop_mapping:`;
    const mappingSourcePrefix = `${sourceRef}:engine_tenant_mapping:`;
    const where = { sourceRef, ...(tenantId ? { tenantId } : { tenantId: IsNull() }) };
    const engineScopePrefix = `${tenantId || 'platform'}:`;
    const [roles, groups, engines, engineBackstopMappings, engineTenantMappings, engineSets, runtimeResourceSets, assignments, projectEngineTargets, identityProviders, identityProvisioningDirectories, identityMappings, runtimeResources, platformSettings, platformSettingsOwnership, environmentTags, adminOwnership] = await Promise.all([
      dataSource.getRepository(RbacRole).find({ where: { ...where, isArchived: false } }),
      dataSource.getRepository(AuthzGroup).find({ where: { ...where, isArchived: false } }),
      dataSource.getRepository(Engine).find({
        where: [
          { sourceRef, lifecycleStatus: 'active', tenantId: tenantId || IsNull() },
          { sourceRef, lifecycleStatus: 'active', configKeyIdentity: Like(`${engineScopePrefix}%`) },
        ],
      }),
      dataSource.getRepository(EngineBackstopGroupMapping).find({
        where: {
          source: 'config',
          sourceRef: Like(`${backstopMappingSourcePrefix}%`),
          isActive: true,
          ...(tenantId ? { tenantId } : { tenantId: IsNull() }),
        },
      }),
      dataSource.getRepository(EngineTenantMapping).find({
        where: {
          source: 'config',
          sourceRef: Like(`${mappingSourcePrefix}%`),
          isActive: true,
          enterpriseTenantId: tenantId || OSS_DEFAULT_TENANT_ID,
        },
      }),
      dataSource.getRepository(EngineSet).find({ where: { ...where, source: 'config', isArchived: false } }),
      dataSource.getRepository(RuntimeResourceSet).find({ where: { ...where, source: 'config', isArchived: false } }),
      dataSource.getRepository(RbacRoleAssignment).find({ where: { ...where, source: 'config' } }),
      dataSource.getRepository(ProjectEngineTarget).find({ where: { ...where, source: 'config' } }),
      dataSource.getRepository(IdentityProvider).find({ where }),
      typeof dataSource.hasMetadata === 'function' && dataSource.hasMetadata(IdentityProvisioningDirectory)
        ? dataSource.getRepository(IdentityProvisioningDirectory).find({ where })
        : Promise.resolve([]),
      dataSource.getRepository(IdentityEntitlementMapping).find({ where: { ...where, isActive: true } }),
      dataSource.getRepository(RuntimeResource).find({ where: tenantId ? { tenantId } : { tenantId: IsNull() } }),
      dataSource.getRepository(PlatformSettings).findOneBy({ id: 'default' }),
      dataSource.getRepository(PlatformSettingsSectionOwnership).find({
        where: { settingsId: 'default', sourceRef, scopeKey: adminConfigScopeKey(tenantId) },
      }),
      dataSource.getRepository(EnvironmentTag).find({
        where: { sourceRef, configScopeKey: adminConfigScopeKey(tenantId) },
      }),
      dataSource.getRepository(AdminConfigObjectOwnership).find({
        where: { sourceRef, scopeKey: adminConfigScopeKey(tenantId) },
      }),
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

    const ownershipByType = new Map<AdminConfigObjectType, AdminConfigObjectOwnership[]>();
    for (const ownership of adminOwnership) {
      ownershipByType.set(ownership.objectType, [...(ownershipByType.get(ownership.objectType) || []), ownership]);
    }
    const history = (type: AdminConfigObjectType): AdminConfigObjectOwnership[] => ownershipByType.get(type) || [];
    const activeOwnership = (type: AdminConfigObjectType): AdminConfigObjectOwnership[] => history(type).filter((ownership) => ownership.active);
    const ids = (type: AdminConfigObjectType): string[] => activeOwnership(type).map((ownership) => ownership.objectId);
    const [gitProviders, emailConfigurations, emailTemplates, customPermissions, authorizationPolicies, apiClients, serviceAccounts, externalEngineSystems] = await Promise.all([
      ids('git_provider').length ? dataSource.getRepository(GitProvider).find({ where: { id: In(ids('git_provider')) } }) : Promise.resolve([]),
      ids('email_configuration').length ? dataSource.getRepository(EmailSendConfig).find({ where: { id: In(ids('email_configuration')) } }) : Promise.resolve([]),
      ids('email_template').length ? dataSource.getRepository(EmailTemplate).find({ where: { id: In(ids('email_template')) } }) : Promise.resolve([]),
      ids('permission').length ? dataSource.getRepository(RbacPermission).find({ where: { id: In(ids('permission')) } }) : Promise.resolve([]),
      ids('authorization_policy').length ? dataSource.getRepository(AuthzPolicy).find({ where: { id: In(ids('authorization_policy')) } }) : Promise.resolve([]),
      ids('api_client').length ? dataSource.getRepository(ApiClient).find({ where: { id: In(ids('api_client')) } }) : Promise.resolve([]),
      ids('service_account').length ? dataSource.getRepository(ServiceAccount).find({ where: { id: In(ids('service_account')) } }) : Promise.resolve([]),
      ids('external_engine_system').length ? dataSource.getRepository(ExternalEngineSystem).find({ where: { id: In(ids('external_engine_system')) } }) : Promise.resolve([]),
    ]);

    const files: Record<string, unknown> = {};
    const owned = (type: AdminConfigObjectType): AdminConfigObjectOwnership[] =>
      [...activeOwnership(type)].sort((left, right) => left.configKey.localeCompare(right.configKey));
    const rowById = <T extends { id: string }>(rows: T[], ownership: AdminConfigObjectOwnership, label: string): T => {
      const row = rows.find((candidate) => candidate.id === ownership.objectId);
      if (!row) throw new Error(`Cannot export ${label} ${ownership.configKey}: the persisted object is missing`);
      return row;
    };

    if (history('git_provider').length) {
      files['./git-providers.json'] = {
        gitProviders: owned('git_provider').map((ownership) => {
          const provider = rowById(gitProviders, ownership, 'Git provider');
          const references = parseAdminConfigSecretReferences(ownership.secretReferencesJson);
          if (provider.supportsOAuth && !references.oauthClientSecretRef) {
            throw new Error(`Cannot export Git provider ${ownership.configKey}: its OAuth client secret reference is missing`);
          }
          return {
            key: ownership.configKey,
            name: provider.name,
            type: provider.type,
            baseUrl: provider.baseUrl,
            apiUrl: provider.apiUrl,
            oauth: provider.supportsOAuth ? {
              clientId: provider.oauthClientId,
              clientSecretRef: references.oauthClientSecretRef,
              scopes: provider.oauthScopes,
              authorizationUrl: provider.oauthAuthUrl,
              tokenUrl: provider.oauthTokenUrl,
            } : null,
            supportsPat: provider.supportsPAT,
            active: provider.isActive,
            displayOrder: provider.displayOrder,
            ownershipMode: ownership.ownershipMode,
          };
        }),
      };
    }
    if (history('email_configuration').length) {
      files['./email-configurations.json'] = {
        emailConfigurations: owned('email_configuration').map((ownership) => {
          const configuration = rowById(emailConfigurations, ownership, 'email configuration');
          const credentialRef = parseAdminConfigSecretReferences(ownership.secretReferencesJson).credentialRef;
          if (!credentialRef) throw new Error(`Cannot export email configuration ${ownership.configKey}: its credential reference is missing`);
          return {
            key: ownership.configKey,
            name: configuration.name,
            provider: configuration.provider,
            credentialRef,
            fromName: configuration.fromName,
            fromEmail: configuration.fromEmail,
            replyTo: configuration.replyTo,
            smtp: configuration.provider === 'smtp' ? {
              host: configuration.smtpHost,
              port: configuration.smtpPort,
              secure: configuration.smtpSecure,
              user: configuration.smtpUser,
            } : null,
            enabled: configuration.enabled,
            isDefault: configuration.isDefault,
            ownershipMode: ownership.ownershipMode,
          };
        }),
      };
    }
    if (history('email_template').length) {
      files['./email-templates.json'] = {
        emailTemplates: owned('email_template').map((ownership) => {
          const template = rowById(emailTemplates, ownership, 'email template');
          return {
            key: ownership.configKey,
            type: template.type,
            name: template.name,
            subject: template.subject,
            htmlTemplate: template.htmlTemplate,
            textTemplate: template.textTemplate,
            variables: jsonArray(template.variables),
            active: template.isActive,
            ownershipMode: ownership.ownershipMode,
          };
        }),
      };
    }
    if (history('permission').length) {
      files['./permissions.json'] = {
        permissions: owned('permission').map((ownership) => {
          const permission = rowById(customPermissions, ownership, 'permission');
          return {
            key: permission.key,
            scope: permission.scope,
            category: permission.category,
            label: permission.label,
            description: permission.description,
            ownershipMode: ownership.ownershipMode,
          };
        }),
      };
    }
    if (history('authorization_policy').length) {
      files['./authorization-policies.json'] = {
        authorizationPolicies: owned('authorization_policy').map((ownership) => {
          const policy = rowById(authorizationPolicies, ownership, 'authorization policy');
          return {
            key: ownership.configKey,
            name: policy.name,
            description: policy.description,
            effect: policy.effect,
            priority: policy.priority,
            resourceType: policy.resourceType,
            action: policy.action,
            conditions: json(policy.conditions),
            active: policy.isActive,
            ownershipMode: ownership.ownershipMode,
          };
        }),
      };
    }
    const machinePrincipals = [
      ...owned('api_client').map((ownership) => {
        const client = rowById(apiClients, ownership, 'API client');
        const tokenRef = parseAdminConfigSecretReferences(ownership.secretReferencesJson).tokenRef;
        if (!tokenRef) throw new Error(`Cannot export API client ${ownership.configKey}: its token reference is missing`);
        return {
          kind: 'api_client',
          key: ownership.configKey,
          name: client.name,
          tokenRef,
          scopes: jsonArray(client.scopesJson),
          active: client.isActive,
          ownershipMode: ownership.ownershipMode,
        };
      }),
      ...owned('service_account').map((ownership) => {
        const account = rowById(serviceAccounts, ownership, 'service account');
        const tokenRef = parseAdminConfigSecretReferences(ownership.secretReferencesJson).tokenRef;
        if (!tokenRef) throw new Error(`Cannot export service account ${ownership.configKey}: its token reference is missing`);
        return {
          kind: 'service_account',
          key: ownership.configKey,
          name: account.name,
          description: account.description,
          tokenRef,
          scopes: jsonArray(account.scopesJson),
          active: account.isActive,
          ownershipMode: ownership.ownershipMode,
        };
      }),
    ].sort((left, right) => left.key.localeCompare(right.key));
    if (history('api_client').length || history('service_account').length) files['./machine-principals.json'] = { machinePrincipals };
    if (history('external_engine_system').length) {
      files['./external-engine-systems.json'] = {
        externalEngineSystems: owned('external_engine_system').map((ownership) => {
          const system = rowById(externalEngineSystems, ownership, 'external engine system');
          return {
            key: system.key,
            name: system.name,
            description: system.description,
            defaultManagementMode: system.defaultManagementMode,
            defaultFieldOwnership: json(system.defaultFieldOwnershipJson),
            active: system.isActive,
            ownershipMode: ownership.ownershipMode,
          };
        }),
      };
    }
    if (environmentTags.length) {
      files['./environment-tags.json'] = {
        environmentTags: [...environmentTags]
          .filter((tag): tag is EnvironmentTag & { configKey: string } => Boolean(tag.configKey))
          .sort((left, right) => left.configKey.localeCompare(right.configKey))
          .map((tag) => ({
            key: tag.configKey,
            name: tag.name,
            color: tag.color,
            manualDeployAllowed: tag.manualDeployAllowed,
            sortOrder: tag.sortOrder,
            isDefault: tag.isDefault,
            ownershipMode: tag.ownershipMode || 'config_locked',
          })),
      };
    }
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
        const tenancy = engine.tenancyMode === 'shared'
          ? {
              mode: 'shared',
              mappingStrategy: engine.tenantMappingStrategy,
              unmappedPolicy: 'deny',
            }
          : {
              mode: 'dedicated',
              tenantRef: engine.tenantId
                ? { type: 'id', id: engine.tenantId }
                : { type: 'request_context' },
            };
        return { key: engine.configKey, name: engine.name, baseUrl: engine.baseUrl, type: engine.type, externalId: engine.externalId || undefined, labels: json(engine.labelsJson), auth, version: engine.version || undefined, runtimeAccessScope: engine.runtimeAccessScope, tenancy, deploymentIntegration: engine.deploymentIntegration, metadataDiscoveryEnabled: engine.metadataDiscoveryEnabled !== false, deploymentDiscoveryEnabled: engine.deploymentDiscoveryEnabled !== false, reconciliationIntervalSeconds: Number(engine.reconciliationIntervalSeconds || 300), pipelineReceiptEnabled: engine.pipelineReceiptEnabled !== false, connectionMode: engine.connectionMode, ownershipMode: engine.ownershipMode };
      }) };
    if (engineSets.length) files['./engine-sets.json'] = { engineSets: sortedByKey(engineSets).map((set) => ({ key: set.key, name: set.name, description: set.description || undefined, selector: json(set.selectorJson), ownershipMode: set.ownershipMode || 'config_locked' })) };

    const engineKeyById = new Map(engines.filter((engine) => engine.configKey).map((engine) => [engine.id, engine.configKey!]));
    const groupKeyById = new Map(groups.map((group) => [group.id, group.key]));
    if (engineBackstopMappings.length) {
      files['./engine-backstop-mappings.json'] = {
        engineBackstopMappings: [...engineBackstopMappings]
          .map((mapping) => ({ mapping, key: mapping.sourceRef.slice(backstopMappingSourcePrefix.length) }))
          .sort((left, right) => left.key.localeCompare(right.key))
          .map(({ mapping, key }) => {
            const engineKey = engineKeyById.get(mapping.engineId);
            const groupKey = groupKeyById.get(mapping.authzGroupId);
            if (!engineKey || !groupKey) {
              throw new Error(`Cannot export backstop mapping ${key}: its engine or authorization group is not config-owned by this bundle`);
            }
            if (!mapping.nativeGroupSecretRef) {
              throw new Error(`Cannot export backstop mapping ${key}: replace its native group value with a secret reference before export`);
            }
            return {
              key,
              engineRef: { engineKey },
              groupRef: { groupKey },
              nativeGroupIdRef: mapping.nativeGroupSecretRef,
              isActive: mapping.isActive,
              ownershipMode: mapping.ownershipMode,
            };
          }),
      };
    }
    if (engineTenantMappings.length) {
      files['./engine-tenant-mappings.json'] = {
        engineTenantMappings: [...engineTenantMappings]
          .map((mapping) => ({
            mapping,
            key: mapping.sourceRef.slice(mappingSourcePrefix.length),
          }))
          .sort((left, right) => left.key.localeCompare(right.key))
          .map(({ mapping, key }) => {
            const engineKey = engineKeyById.get(mapping.engineId);
            if (!engineKey) {
              throw new Error(`Cannot export engine tenant mapping ${key}: its engine is not config-owned by this bundle`);
            }
            return {
              key,
              engineRef: { engineKey },
              externalTenantId: mapping.externalTenantId,
              tenantRef: exportedTenantReference(mapping, tenantId),
              strategy: mapping.strategy,
              active: true,
              ownershipMode: mapping.ownershipMode,
            };
          }),
      };
    }
    if (runtimeResourceSets.length) files['./runtime-resource-sets.json'] = { runtimeResourceSets: sortedByKey(runtimeResourceSets).map((set) => {
      const engineKey = engineKeyById.get(set.engineId);
      if (!engineKey) throw new Error(`Cannot export Runtime Resource Set ${set.key}: its engine is not config-owned by this bundle`);
      return { key: set.key, name: set.name, description: set.description || undefined, engineRef: { engineKey }, resourceKind: set.resourceKind, selector: json(set.selectorJson), runtimeTenantId: set.runtimeTenantId || undefined, ownershipMode: set.ownershipMode || 'config_locked' };
    }) };

    const providerKeyById = new Map([...referenceProviders, ...identityProviders].map((provider) => [provider.id, provider.key]));
    if (identityProviders.length) files['./identity-providers.json'] = { identityProviders: sortedByKey(identityProviders).map((provider) => {
      const { allowVerifiedEmailLinking, authorizationAttributeKeys, ...protocolConfiguration } = json(provider.configurationJson);
      assertProviderConfigurationContainsOnlyReferences(protocolConfiguration, `identity provider ${provider.key}`);
      return {
        key: provider.key,
        displayName: provider.displayName || provider.key,
        ...(provider.organization ? { organization: provider.organization } : {}),
        displayOrder: provider.displayOrder || 0,
        preferred: Boolean(provider.isPreferred),
        loginDomains: jsonArray(provider.loginDomainsJson),
        type: provider.protocol,
        enabled: provider.isEnabled,
        authenticationMode: provider.authenticationMode,
        allowVerifiedEmailLinking: allowVerifiedEmailLinking === true,
        ...(Array.isArray(authorizationAttributeKeys) && authorizationAttributeKeys.length > 0 ? { authorizationAttributeKeys } : {}),
        directoryTenantId: provider.directoryTenantId || undefined,
        sync: normalizeIdentityProviderSyncForMandatoryLogin(json(provider.syncJson)),
        [provider.protocol]: protocolConfiguration,
        ownershipMode: provider.ownershipMode,
      };
    }) };

    const activeProvisioningDirectories = identityProvisioningDirectories.filter((directory) => directory.status !== 'archived');
    if (activeProvisioningDirectories.length) {
      files['./identity-provisioning-directories.json'] = {
        identityProvisioningDirectories: sortedByKey(activeProvisioningDirectories).map((directory) => {
          if (directory.status === 'active' && !directory.credentialSecretRef) {
            throw new Error(`Cannot export provisioning directory ${directory.key}: its credential secret reference is missing`);
          }
          return {
            key: directory.key,
            displayName: directory.displayName,
            ...(directory.description ? { description: directory.description } : {}),
            ...(directory.identityProviderKey ? { identityProviderKey: directory.identityProviderKey } : {}),
            enabled: directory.status === 'active',
            authoritative: true,
            ...(directory.credentialSecretRef ? { credentialSecretRef: directory.credentialSecretRef } : {}),
            ownershipMode: directory.ownershipMode === 'manual' ? 'config_locked' : directory.ownershipMode,
          };
        }),
      };
    }

    if (identityMappings.length) files['./identity-mappings.json'] = { identityMappings: sortedByKey(identityMappings.filter((mapping) => Boolean(mapping.configKey)).map((mapping) => ({ ...mapping, key: mapping.configKey! }))).map((mapping) => {
      const providerKey = providerKeyById.get(mapping.providerId);
      const targetGroupKey = groupKeyById.get(mapping.targetGroupId);
      if (!providerKey || !targetGroupKey) throw new Error(`Cannot export identity mapping ${mapping.key}: its provider or group is not config-owned by this bundle`);
      if (mapping.entitlementType === 'scope') throw new Error(`Cannot export identity mapping ${mapping.key}: OAuth scopes cannot grant human access; retire or replace this legacy mapping first`);
      return { key: mapping.key, providerKey, source: { type: mapping.entitlementType, externalId: mapping.externalId || undefined, operator: mapping.matchOperator }, targetGroupKey, syncMode: mapping.syncMode, ownershipMode: mapping.ownershipMode || 'config_locked' };
    }) };

    const roleKeyById = new Map([...referenceRoles, ...roles].map((role) => [role.id, role.key]));
    const apiClientKeyById = new Map(activeOwnership('api_client').map((ownership) => [ownership.objectId, ownership.configKey]));
    const serviceAccountKeyById = new Map(activeOwnership('service_account').map((ownership) => [ownership.objectId, ownership.configKey]));
    const engineSetKeyById = new Map(engineSets.map((set) => [set.id, set.key]));
    const runtimeResourceSetKeyById = new Map(runtimeResourceSets.map((set) => [set.id, set.key]));
    const runtimeResourceById = new Map(runtimeResources.map((resource) => [resource.id, resource]));
    if (assignments.length) files['./assignments.json'] = { assignments: assignments.map((assignment) => {
      const roleKey = roleKeyById.get(assignment.roleId);
      if (!roleKey) throw new Error(`Cannot export scoped role assignment ${assignment.id}: its role is unresolved`);
      let principal: Record<string, string>;
      if (assignment.principalType === 'group') {
        const groupKey = groupKeyById.get(assignment.principalId);
        if (!groupKey) throw new Error(`Cannot export scoped role assignment ${assignment.id}: its group is not config-owned by this bundle`);
        principal = { type: 'group', key: groupKey };
      } else if (assignment.principalType === 'user') {
        principal = { type: 'user', id: assignment.principalId };
      } else if (assignment.principalType === 'api_client') {
        const key = apiClientKeyById.get(assignment.principalId);
        principal = key ? { type: 'api_client', key } : { type: 'api_client', id: assignment.principalId };
      } else if (assignment.principalType === 'service_account') {
        const key = serviceAccountKeyById.get(assignment.principalId);
        principal = key ? { type: 'service_account', key } : { type: 'service_account', id: assignment.principalId };
      } else {
        throw new Error(`Cannot export scoped role assignment ${assignment.id}: unsupported principal type ${assignment.principalType}`);
      }
      let scope: Record<string, unknown>;
      if (assignment.scopeType === 'platform') scope = { type: 'platform' };
      else if (assignment.scopeType === 'tenant' && assignment.scopeId === tenantId) scope = { type: 'tenant' };
      else if (assignment.scopeType === 'engine' && assignment.scopeId && engineKeyById.get(assignment.scopeId)) scope = { type: 'engine', engineKey: engineKeyById.get(assignment.scopeId) };
      else if (assignment.scopeType === 'engine_set' && assignment.scopeId && engineSetKeyById.get(assignment.scopeId)) scope = { type: 'engine_set', engineSetKey: engineSetKeyById.get(assignment.scopeId) };
      else if (assignment.scopeType === 'engine_runtime_resource_set' && assignment.scopeId && runtimeResourceSetKeyById.get(assignment.scopeId)) scope = { type: 'engine_runtime_resource_set', runtimeResourceSetKey: runtimeResourceSetKeyById.get(assignment.scopeId) };
      else if (assignment.scopeType === 'engine_runtime_resource' && assignment.scopeId) {
        const resource = runtimeResourceById.get(assignment.scopeId);
        const engineKey = resource ? engineKeyById.get(resource.engineId) : null;
        if (!resource || !engineKey) throw new Error(`Cannot export scoped role assignment ${assignment.id}: its runtime resource is unresolved`);
        scope = { type: 'engine_runtime_resource', engineKey, resourceKind: resource.resourceKind, resourceKey: resource.resourceKey, runtimeTenantId: resource.runtimeTenantId || undefined };
      } else throw new Error(`Cannot export scoped role assignment ${assignment.id}: unsupported or unresolved ${assignment.scopeType} scope`);
      return { principal, roleKey, scope, expiresAt: assignment.expiresAt || undefined, ownershipMode: assignment.ownershipMode || 'config_locked' };
    }) };

    if (projectEngineTargets.length) files['./project-engine-targets.json'] = { projectEngineTargets: projectEngineTargets.filter((target) => target.status !== 'archived').map((target) => {
      const engineKey = engineKeyById.get(target.engineId);
      if (!engineKey) throw new Error(`Cannot export project-engine target ${target.id}: its engine is not config-owned by this bundle`);
      return { projectRef: { id: target.projectId }, engineRef: { engineKey }, status: target.status, allowManualDeploy: target.allowManualDeploy, allowCiDeploy: target.allowCiDeploy, allowApiDeploy: target.allowApiDeploy, allowImport: target.allowImport, ownershipMode: target.ownershipMode || 'config_locked' };
    }) };
    if (platformSettings && platformSettingsOwnership.length > 0) {
      const sectionNames = new Set(platformSettingsOwnership.map((ownership) => ownership.section));
      const ownershipModes = [...new Set(platformSettingsOwnership.map((ownership) => ownership.ownershipMode))];
      if (ownershipModes.length !== 1) {
        throw new Error('Cannot export platform settings: sections owned by one bundle have different ownership modes');
      }
      const defaultEnvironmentTag = platformSettings.defaultEnvironmentTagId
        ? environmentTags.find((tag) => tag.id === platformSettings.defaultEnvironmentTagId)
        : null;
      if (sectionNames.has('general') && platformSettings.defaultEnvironmentTagId && !defaultEnvironmentTag?.configKey) {
        throw new Error('Cannot export platform settings: the default environment tag is not config-owned by this bundle');
      }
      const piiTokenRef = externalReference(platformSettings.piiExternalProviderAuthToken);
      if (sectionNames.has('pii') && platformSettings.piiExternalProviderAuthToken && !piiTokenRef) {
        throw new Error('Cannot export platform settings: the PII provider token must be an external secret reference');
      }
      files['./platform-settings.json'] = {
        platformSettings: {
          ...(sectionNames.has('general') ? { general: {
            defaultEnvironmentTagKey: defaultEnvironmentTag?.configKey || null,
            emailPlatformName: platformSettings.emailPlatformName || 'EnterpriseGlue',
          } } : {}),
          ...(sectionNames.has('git_sync') ? { gitSync: {
            pushEnabled: platformSettings.syncPushEnabled,
            pullEnabled: platformSettings.syncPullEnabled,
            bothEnabled: platformSettings.syncBothEnabled,
            projectTokenSharingEnabled: platformSettings.gitProjectTokenSharingEnabled,
          } } : {}),
          ...(sectionNames.has('deployment') ? { deployment: {
            defaultDeployRoles: jsonArray(platformSettings.defaultDeployRoles),
            credentiallessCustomerSidecarsEnabled: platformSettings.credentiallessCustomerSidecarsEnabled,
          } } : {}),
          ...(sectionNames.has('invitations') ? { invitations: {
            allowAllDomains: platformSettings.inviteAllowAllDomains,
            allowedDomains: jsonArray(platformSettings.inviteAllowedDomains),
          } } : {}),
          ...(sectionNames.has('pii') ? { pii: {
            regexEnabled: platformSettings.piiRegexEnabled,
            externalProviderEnabled: platformSettings.piiExternalProviderEnabled,
            externalProviderType: platformSettings.piiExternalProviderType,
            externalProviderEndpoint: platformSettings.piiExternalProviderEndpoint,
            externalProviderAuthHeader: platformSettings.piiExternalProviderAuthHeader,
            externalProviderAuthTokenRef: piiTokenRef,
            externalProviderProjectId: platformSettings.piiExternalProviderProjectId,
            externalProviderRegion: platformSettings.piiExternalProviderRegion,
            redactionStyle: platformSettings.piiRedactionStyle,
            scopes: jsonArray(platformSettings.piiScopes),
            maxPayloadSizeBytes: Number(platformSettings.piiMaxPayloadSizeBytes),
          } } : {}),
          ...(sectionNames.has('branding') ? { branding: {
            logoUrl: platformSettings.logoUrl,
            loginLogoUrl: platformSettings.loginLogoUrl,
            loginTitleVerticalOffset: platformSettings.loginTitleVerticalOffset,
            loginTitleColor: platformSettings.loginTitleColor,
            logoTitle: platformSettings.logoTitle,
            logoScale: platformSettings.logoScale,
            titleFontUrl: platformSettings.titleFontUrl,
            titleFontWeight: platformSettings.titleFontWeight,
            titleFontSize: platformSettings.titleFontSize,
            titleVerticalOffset: platformSettings.titleVerticalOffset,
            menuAccentColor: platformSettings.menuAccentColor,
            faviconUrl: platformSettings.faviconUrl,
          } } : {}),
          ownershipMode: ownershipModes[0],
        },
      };
    }
    const imports = Object.keys(files);
    const governance = platformSettings?.accessGovernanceSourceRef === sourceRef
      ? {
          engineMembershipAuthority: platformSettings.engineAccessAuthority || 'manual',
          projectMembershipAuthority: platformSettings.projectAccessAuthority || 'manual',
          engineRegistrationPolicy: platformSettings.engineOnboardingMode || 'manual_allowed',
          projectEngineTargetPolicy: platformSettings.projectEngineTargetMode || 'manual_allowed',
          runtimeAuthorizationAuthority: platformSettings.engineRuntimeAuthorizationMode || 'enterpriseglue_authoritative',
          governanceSettingsOwnership: platformSettings.accessGovernanceOwnershipMode || 'config_locked',
        }
      : undefined;
    return withoutUndefined({
      bundle: {
        apiVersion: ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1,
        kind: 'EnterpriseGlueConfigBundle',
        metadata: { key: input.bundleKey, owner: 'platform' },
        tenantKey: input.tenantKey || 'default',
        mode: 'authoritative',
        ...(governance ? { governance } : {}),
        ...(platformSettings ? {
          login: {
            localPassword: platformSettings.localPasswordLoginMode || 'auto',
            providerSelection: platformSettings.ssoProviderSelectionMode || 'auto_redirect_single',
          },
        } : {}),
        imports,
      },
      files,
      contract: configBundleContractMetadataForApiVersion(ENTERPRISEGLUE_CONFIG_API_VERSION_V1BETA1),
    }) as { bundle: Record<string, unknown>; files: Record<string, unknown>; contract: ConfigBundleContractMetadata };
  }
}

export const configBundleExportService = new ConfigBundleExportService();
