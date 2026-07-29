import { describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineBackstopGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopGroupMapping.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js';
import { configBundleExportService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleExportService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('configBundleExportService', () => {
  it('exports engine ingestion controls and only secret references', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([{
          id: 'engine-1', configKey: 'engine.prod', name: 'Production', baseUrl: 'https://engine.example.test/engine-rest', type: 'operaton', externalId: null,
          labelsJson: '{"environment":"prod"}', authType: 'basic', username: 'eg', passwordEnc: 'ref:PROD_ENGINE_PASSWORD', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
          version: null, runtimeAccessScope: 'engine_wide', deploymentIntegration: 'direct_engine', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false, connectionMode: 'direct', ownershipMode: 'config_locked',
        }]) };
        if ([RbacRole, AuthzGroup, RbacRolePermission, EngineBackstopGroupMapping, EngineTenantMapping, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget, IdentityProvider, IdentityEntitlementMapping].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({ bundleKey: 'acme.authz' });
    expect(result.files['./engines.json']).toEqual({ engines: [expect.objectContaining({
      key: 'engine.prod', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false,
      auth: { type: 'basic', username: 'eg', passwordRef: 'PROD_ENGINE_PASSWORD' },
    })] });
    expect(result.bundle).not.toHaveProperty('settings');
    expect(JSON.stringify(result.files)).not.toContain('ref:PROD_ENGINE_PASSWORD');
  });

  it('refuses to export stored engine credentials that are not secret references', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([{
          id: 'engine-1', configKey: 'engine.sidecar', name: 'Sidecar', baseUrl: 'https://sidecar.example.test/engine-rest', type: 'ion', externalId: null,
          labelsJson: '{}', authType: 'basic', username: 'eg', passwordEnc: 'v2:encrypted-downstream-token', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null,
          version: null, runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: true, pipelineReceiptEnabled: true, connectionMode: 'customer_sidecar', ownershipMode: 'config_locked',
        }]) };
        if ([RbacRole, AuthzGroup, RbacRolePermission, EngineBackstopGroupMapping, EngineTenantMapping, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget, IdentityProvider, IdentityEntitlementMapping].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(configBundleExportService.exportBundle({ bundleKey: 'acme.authz' }))
      .rejects.toThrow('credentials must be replaced with a secret reference before export');
  });

  it('exports shared topology by config management scope even when engine tenant is null', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([{
          id: 'engine-1',
          tenantId: null,
          configKey: 'engine.central',
          configKeyIdentity: 'tenant-a:engine.central',
          name: 'Central',
          baseUrl: 'https://central.example.test/engine-rest',
          type: 'operaton',
          externalId: null,
          labelsJson: '{}',
          authType: 'basic',
          username: 'eg',
          passwordEnc: 'ref:CENTRAL_PASSWORD',
          oauthTokenUrl: null,
          oauthScopes: null,
          oauthAudience: null,
          version: null,
          runtimeAccessScope: 'resource_aware',
          tenancyMode: 'shared',
          tenantMappingStrategy: 'engine_tenant_id',
          deploymentIntegration: 'enterpriseglue_proxy',
          metadataDiscoveryEnabled: true,
          deploymentDiscoveryEnabled: true,
          reconciliationIntervalSeconds: 300,
          pipelineReceiptEnabled: true,
          connectionMode: 'direct',
          ownershipMode: 'config_locked',
          lifecycleStatus: 'active',
          sourceRef: 'config_bundle:acme.authz',
        }]) };
        if (entity === EngineTenantMapping) return { find: vi.fn().mockResolvedValue([{
          id: 'mapping-1',
          engineId: 'engine-1',
          externalTenantId: 'bravo',
          enterpriseTenantId: 'tenant-b',
          tenantReferenceJson: '{"type":"key","key":"tenant.bravo"}',
          strategy: 'engine_tenant_id',
          source: 'config',
          sourceRef: 'config_bundle:acme.authz:engine_tenant_mapping:engine-tenant-mapping.central-bravo',
          ownershipMode: 'config_locked',
          isActive: true,
        }]) };
        if ([RbacRole, AuthzGroup, RbacRolePermission, EngineBackstopGroupMapping, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget, IdentityProvider, IdentityEntitlementMapping].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({
      bundleKey: 'acme.authz',
      tenantId: 'tenant-a',
    });
    expect(result.files['./engines.json']).toEqual({
      engines: [expect.objectContaining({
        key: 'engine.central',
        runtimeAccessScope: 'resource_aware',
        tenancy: {
          mode: 'shared',
          mappingStrategy: 'engine_tenant_id',
          unmappedPolicy: 'deny',
        },
      })],
    });
    expect(result.files['./engine-tenant-mappings.json']).toEqual({
      engineTenantMappings: [expect.objectContaining({
        key: 'engine-tenant-mapping.central-bravo',
        engineRef: { engineKey: 'engine.central' },
        tenantRef: { type: 'key', key: 'tenant.bravo' },
      })],
    });
    expect(configBundlePreviewService.preview(result)).toMatchObject({ valid: true, errors: [] });
  });

  it('exports a backstop mapping with its opaque secret reference and never the native group value', async () => {
    const nativeGroupValue = 'camunda-operators-must-not-export';
    const engine = {
      id: 'engine-camunda', tenantId: null, configKey: 'engine.camunda', configKeyIdentity: 'platform:engine.camunda',
      name: 'Camunda', baseUrl: 'https://camunda.example.test/engine-rest', type: 'camunda7', externalId: null,
      labelsJson: '{}', authType: 'basic', username: 'eg', passwordEnc: 'ref:CAMUNDA_PASSWORD', oauthTokenUrl: null,
      oauthScopes: null, oauthAudience: null, version: null, runtimeAccessScope: 'engine_wide', tenancyMode: 'dedicated',
      tenantMappingStrategy: null, deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: true,
      deploymentDiscoveryEnabled: true, reconciliationIntervalSeconds: 300, pipelineReceiptEnabled: true, connectionMode: 'direct',
      ownershipMode: 'config_locked', lifecycleStatus: 'active', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz',
    };
    const group = { id: 'group-operators', tenantId: null, key: 'group.operators', name: 'Operators', source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const mapping = {
      id: 'backstop-mapping-1', tenantId: null, engineId: engine.id, authzGroupId: group.id,
      encryptedNativeGroupId: `encrypted:${nativeGroupValue}`, nativeGroupReference: 'camunda-group-opaque', source: 'config',
      sourceRef: 'config_bundle:acme.authz:engine_backstop_mapping:engine-backstop-mapping.camunda-operators',
      nativeGroupSecretRef: 'CAMUNDA_OPERATORS_GROUP', ownershipMode: 'config_warn', isActive: true,
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([engine]) };
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([group]) };
        if (entity === EngineBackstopGroupMapping) return { find: vi.fn().mockResolvedValue([mapping]) };
        if ([RbacRole, RbacRolePermission, EngineTenantMapping, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget, IdentityProvider, IdentityEntitlementMapping].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({ bundleKey: 'acme.authz' });
    expect(result.files['./engine-backstop-mappings.json']).toEqual({
      engineBackstopMappings: [{
        key: 'engine-backstop-mapping.camunda-operators',
        engineRef: { engineKey: 'engine.camunda' },
        groupRef: { groupKey: 'group.operators' },
        nativeGroupIdRef: 'CAMUNDA_OPERATORS_GROUP',
        isActive: true,
        ownershipMode: 'config_warn',
      }],
    });
    expect(JSON.stringify(result)).not.toContain(nativeGroupValue);
    expect(configBundlePreviewService.preview(result)).toMatchObject({ valid: true, errors: [] });
  });

  it('refuses to export a provider row containing a resolved legacy credential', async () => {
    const rawClientSecret = 'must-not-leak-provider-client-secret';
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue([{
          id: 'provider-1', key: 'identity.oidc.legacy', protocol: 'oidc', isEnabled: true, authenticationMode: 'direct', directoryTenantId: null,
          configurationJson: JSON.stringify({ issuerUrl: 'https://issuer.example.test', clientId: 'enterpriseglue', clientSecret: rawClientSecret, nested: { apiKey: rawClientSecret } }), syncJson: '{}', ownershipMode: 'config_locked', sourceRef: 'config_bundle:acme.authz',
        }]) };
        if ([RbacRole, AuthzGroup, RbacRolePermission, Engine, EngineBackstopGroupMapping, EngineTenantMapping, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget, IdentityEntitlementMapping].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(configBundleExportService.exportBundle({ bundleKey: 'acme.authz' }))
      .rejects.toThrow('identity provider identity.oidc.legacy.clientSecret must be an external secret reference');
    await expect(configBundleExportService.exportBundle({ bundleKey: 'acme.authz' }))
      .rejects.not.toThrow(rawClientSecret);
  });

  it('round-trips every UI-supported engine auth mode and operational labels', async () => {
    const common = {
      tenantId: null, externalId: null, version: null, runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy',
      metadataDiscoveryEnabled: true, deploymentDiscoveryEnabled: true, reconciliationIntervalSeconds: 300, pipelineReceiptEnabled: true,
      ownershipMode: 'config_locked', lifecycleStatus: 'active', sourceRef: 'config_bundle:acme.authz',
    };
    const engines = [
      { ...common, id: 'engine-basic', configKey: 'engine.basic', name: 'Basic', baseUrl: 'https://basic.example.test/engine-rest', type: 'operaton', labelsJson: '{"environment":"prod"}', authType: 'basic', username: 'engine-user', passwordEnc: 'ref:ENGINE_BASIC_PASSWORD', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null, connectionMode: 'direct' },
      { ...common, id: 'engine-bearer', configKey: 'engine.bearer', name: 'Bearer', baseUrl: 'https://bearer.example.test/engine-rest', type: 'camunda7', labelsJson: '{"region":"eu"}', authType: 'bearer', username: null, passwordEnc: 'ref:ENGINE_BEARER_TOKEN', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null, connectionMode: 'direct' },
      { ...common, id: 'engine-none', configKey: 'engine.none', name: 'Sidecar', baseUrl: 'https://sidecar.example.test/engine-rest', type: 'ion', labelsJson: '{"businessUnit":"payments"}', authType: 'none', username: null, passwordEnc: null, oauthTokenUrl: null, oauthScopes: null, oauthAudience: null, connectionMode: 'customer_sidecar' },
      { ...common, id: 'engine-oauth', configKey: 'engine.oauth', name: 'OAuth', baseUrl: 'https://oauth.example.test/engine-rest', type: 'ion', labelsJson: '{"customer_segment":"enterprise"}', authType: 'oauth2-client-credentials', username: 'engine-client', passwordEnc: 'ref:ENGINE_OAUTH_SECRET', oauthTokenUrl: 'https://identity.example.test/oauth/token', oauthScopes: 'engine.read engine.write', oauthAudience: 'engine-api', connectionMode: 'direct' },
    ];
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === Engine) return { find: vi.fn().mockResolvedValue(engines) };
        if ([RbacRole, AuthzGroup, RbacRolePermission, EngineBackstopGroupMapping, EngineTenantMapping, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget, IdentityProvider, IdentityEntitlementMapping].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({ bundleKey: 'acme.authz' });
    const exported = (result.files['./engines.json'] as any).engines;
    expect(exported).toEqual([
      expect.objectContaining({ key: 'engine.basic', labels: { environment: 'prod' }, auth: { type: 'basic', username: 'engine-user', passwordRef: 'ENGINE_BASIC_PASSWORD' } }),
      expect.objectContaining({ key: 'engine.bearer', labels: { region: 'eu' }, auth: { type: 'bearer', tokenRef: 'ENGINE_BEARER_TOKEN' } }),
      expect.objectContaining({ key: 'engine.none', labels: { businessUnit: 'payments' }, connectionMode: 'customer_sidecar', auth: { type: 'none' } }),
      expect.objectContaining({ key: 'engine.oauth', labels: { customer_segment: 'enterprise' }, auth: { type: 'oauth2-client-credentials', username: 'engine-client', passwordRef: 'ENGINE_OAUTH_SECRET', tokenUrl: 'https://identity.example.test/oauth/token', scopes: 'engine.read engine.write', audience: 'engine-api' } }),
    ]);
    expect(configBundlePreviewService.preview(result, { credentiallessCustomerSidecarsEnabled: true })).toMatchObject({ valid: true, errors: [] });
  });

  it('refuses to export legacy scope mappings as a human-access configuration bundle', async () => {
    const legacyScopeMapping = { id: 'mapping-scope', tenantId: null, configKey: 'mapping.scope', providerId: 'provider-1', targetGroupId: 'group-1', entitlementType: 'scope', externalId: 'engines.read', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, sourceRef: 'config_bundle:acme.authz' };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([{ id: 'group-1', key: 'group.operators' }]) };
        if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue([{ id: 'provider-1', key: 'identity.oidc.main' }]) };
        if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue([legacyScopeMapping]) };
        if ([RbacRole, RbacRolePermission, Engine, EngineBackstopGroupMapping, EngineTenantMapping, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    await expect(configBundleExportService.exportBundle({ bundleKey: 'acme.authz' })).rejects.toThrow('OAuth scopes cannot grant human access');
  });

  it('exports all apply-supported config families with stable references', async () => {
    const configRole = { id: 'role-config', tenantId: null, key: 'custom.engine.reader', name: 'Reader', description: null, scope: 'engine', source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const systemRole = { id: 'role-system', tenantId: null, key: 'system.platform.user', name: 'Platform User', description: null, scope: 'platform', sourceRef: null, isArchived: false };
    const group = { id: 'group-1', tenantId: null, key: 'group.operators', name: 'Operators', description: null, source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const engine = { id: 'engine-1', tenantId: null, configKey: 'engine.central', name: 'Central', baseUrl: 'https://central.example.test/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}', authType: 'basic', username: 'eg', passwordEnc: 'ref:CENTRAL_PASSWORD', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null, version: null, runtimeAccessScope: 'resource_aware', tenancyMode: 'shared', tenantMappingStrategy: 'engine_tenant_id', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: true, deploymentDiscoveryEnabled: true, reconciliationIntervalSeconds: 300, pipelineReceiptEnabled: true, connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz' };
    const engineTenantMapping = { id: 'engine-mapping-1', engineId: engine.id, externalTenantId: 'default', enterpriseTenantId: 'tenant-default', tenantReferenceJson: '{"type":"request_context"}', strategy: 'engine_tenant_id', source: 'config', sourceRef: 'config_bundle:acme.authz:engine_tenant_mapping:engine-tenant-mapping.central-default', ownershipMode: 'config_locked', sourceHash: 'hash', lastAppliedAt: 1, isActive: true, createdAt: 1, updatedAt: 1 };
    const engineSet = { id: 'engine-set-1', tenantId: null, key: 'engines.central', name: 'Central engines', description: null, selectorJson: '{"mode":"engine_ids","engineKeys":["engine.central"]}', source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const runtimeResourceSet = { id: 'runtime-set-1', tenantId: null, key: 'runtime.payments', name: 'Payments', description: null, engineId: 'engine-1', resourceKind: 'process_definition', selectorJson: '{"mode":"prefix","prefix":"payments-"}', runtimeTenantId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_warn', isArchived: false };
    const configProvider = { id: 'provider-config', tenantId: null, key: 'identity.oidc.config', protocol: 'oidc', isEnabled: true, authenticationMode: 'claims_only', directoryTenantId: null, configurationJson: '{"issuerUrl":"https://issuer.example.test","clientId":"enterpriseglue","callbackUrl":"https://app.example.test/callback","scopes":["openid"],"allowVerifiedEmailLinking":true}', syncJson: '{"triggers":["login"],"requiredForLogin":true,"incompleteEntitlements":"fail_closed","connectorCapability":"claim_only","scheduled":false}', ownershipMode: 'config_locked', sourceRef: 'config_bundle:acme.authz' };
    const externalProvider = { id: 'provider-external', tenantId: null, key: 'identity.ldap.external', protocol: 'ldap', isEnabled: true, authenticationMode: 'direct', directoryTenantId: null, configurationJson: '{}', syncJson: '{}', ownershipMode: 'manual', sourceRef: null };
    const identityMapping = { id: 'mapping-1', tenantId: null, configKey: 'mapping.operators', providerId: 'provider-external', targetGroupId: 'group-1', entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, sourceRef: 'config_bundle:acme.authz' };
    const assignment = { id: 'assignment-1', tenantId: null, assignmentKey: canonicalRoleAssignmentKey({ tenantId: null, principalType: 'group', principalId: 'group-1', roleId: 'role-system', scopeType: 'platform', scopeId: null, source: 'config', sourceRef: 'config_bundle:acme.authz' }), principalType: 'group', principalId: 'group-1', roleId: 'role-system', scopeType: 'platform', scopeId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', expiresAt: null };
    const target = { id: 'target-1', tenantId: null, projectId: '00000000-0000-4000-8000-000000000001', engineId: 'engine-1', status: 'active', source: 'config', sourceRef: 'config_bundle:acme.authz', allowManualDeploy: false, allowCiDeploy: true, allowApiDeploy: false, allowImport: false };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === RbacRole) return { find: vi.fn().mockImplementation(({ where }: any = {}) => Promise.resolve(where?.sourceRef ? [configRole] : [configRole, systemRole])) };
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([group]) };
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([engine]) };
        if (entity === EngineBackstopGroupMapping) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === EngineTenantMapping) return { find: vi.fn().mockResolvedValue([engineTenantMapping]) };
        if (entity === EngineSet) return { find: vi.fn().mockResolvedValue([engineSet]) };
        if (entity === RuntimeResourceSet) return { find: vi.fn().mockResolvedValue([runtimeResourceSet]) };
        if ([RuntimeResource, RuntimeResourceSetMaterialization, AuthzGroupMembership].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === Project) return { find: vi.fn().mockResolvedValue([{ id: target.projectId, tenantId: null }]) };
        if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue([{ roleId: 'role-config', permissionId: 'engine:deploy' }]) };
        if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue([assignment]) };
        if (entity === ProjectEngineTarget) return { find: vi.fn().mockResolvedValue([target]) };
        if (entity === IdentityProvider) return { find: vi.fn().mockImplementation(({ where }: any = {}) => Promise.resolve(where?.sourceRef ? [configProvider] : [configProvider, externalProvider])) };
        if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue([identityMapping]) };
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue({
          id: 'default',
          engineAccessAuthority: 'manual',
          projectAccessAuthority: 'manual',
          engineOnboardingMode: 'manual_allowed',
          projectEngineTargetMode: 'manual_allowed',
          engineRuntimeAuthorizationMode: 'enterpriseglue_authoritative',
          accessGovernanceSourceRef: 'config_bundle:acme.authz',
          accessGovernanceOwnershipMode: 'config_locked',
          accessGovernanceDriftStatus: 'in_sync',
        }) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({ bundleKey: 'acme.authz' });

    expect(result.bundle).toMatchObject({ apiVersion: 'enterpriseglue.ai/v1beta1' });
    expect(result.bundle.governance).toEqual({
      engineMembershipAuthority: 'manual',
      projectMembershipAuthority: 'manual',
      engineRegistrationPolicy: 'manual_allowed',
      projectEngineTargetPolicy: 'manual_allowed',
      runtimeAuthorizationAuthority: 'enterpriseglue_authoritative',
      governanceSettingsOwnership: 'config_locked',
    });
    expect(result.contract).toEqual({
      inputApiVersion: 'enterpriseglue.ai/v1beta1',
      normalizedApiVersion: 'enterpriseglue.ai/v1beta1',
      warnings: [],
    });
    expect(result.files).toMatchObject({
      './engine-sets.json': { engineSets: [expect.objectContaining({ key: 'engines.central', selector: { mode: 'engine_ids', engineKeys: ['engine.central'] } })] },
      './engine-tenant-mappings.json': { engineTenantMappings: [expect.objectContaining({ key: 'engine-tenant-mapping.central-default', engineRef: { engineKey: 'engine.central' }, tenantRef: { type: 'request_context' } })] },
      './runtime-resource-sets.json': { runtimeResourceSets: [expect.objectContaining({ key: 'runtime.payments', engineRef: { engineKey: 'engine.central' }, ownershipMode: 'config_warn' })] },
      './identity-providers.json': { identityProviders: [expect.objectContaining({ key: 'identity.oidc.config', type: 'oidc' })] },
      './identity-mappings.json': { identityMappings: [expect.objectContaining({ key: 'mapping.operators', providerKey: 'identity.ldap.external', targetGroupKey: 'group.operators' })] },
      './assignments.json': { assignments: [expect.objectContaining({ roleKey: 'system.platform.user', principal: { type: 'group', key: 'group.operators' }, scope: { type: 'platform' } })] },
      './project-engine-targets.json': { projectEngineTargets: [expect.objectContaining({ projectRef: { id: target.projectId }, engineRef: { engineKey: 'engine.central' }, allowCiDeploy: true })] },
    });
    const preview = configBundlePreviewService.preview(result);
    expect(preview.errors).toEqual([]);
    expect(preview).toMatchObject({ valid: true });
    const diff = await configBundleDiffService.diff(result);
    expect(diff).toMatchObject({ valid: true, errors: [] });
    expect(diff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'role', key: 'custom.engine.reader', operation: 'noop' }),
      expect.objectContaining({ objectType: 'group', key: 'group.operators', operation: 'noop' }),
      expect.objectContaining({ objectType: 'engine', key: 'engine.central', operation: 'noop' }),
      expect.objectContaining({ objectType: 'engine_tenant_mapping', key: 'engine-tenant-mapping.central-default', operation: 'noop' }),
      expect.objectContaining({ objectType: 'engine_set', key: 'engines.central', operation: 'noop' }),
      expect.objectContaining({ objectType: 'runtime_resource_set', key: 'runtime.payments', operation: 'noop' }),
      expect.objectContaining({ objectType: 'identity_provider', key: 'identity.oidc.config', operation: 'noop' }),
      expect.objectContaining({ objectType: 'identity_mapping', key: 'mapping.operators', operation: 'noop' }),
      expect.objectContaining({ objectType: 'assignment', operation: 'noop' }),
      expect.objectContaining({ objectType: 'project_engine_target', key: '00000000-0000-4000-8000-000000000001:engine.central', operation: 'noop' }),
    ]));
    expect(diff.changes.every((change) => change.operation === 'noop')).toBe(true);
    const exportedProvider = (result.files['./identity-providers.json'] as any).identityProviders[0];
    expect(exportedProvider.allowVerifiedEmailLinking).toBe(true);
    expect(exportedProvider.oidc.allowVerifiedEmailLinking).toBeUndefined();
  });

  it('exports tenant roles and assignments against the bundle tenant without a raw tenant reference', async () => {
    const role = {
      id: 'role-tenant', tenantId: 'tenant-a', key: 'custom.tenant.runtime-viewer',
      name: 'Tenant runtime viewer', description: null, scope: 'tenant',
      source: 'config', sourceRef: 'config_bundle:acme.authz',
      ownershipMode: 'config_locked', isArchived: false,
    };
    const group = {
      id: 'group-tenant', tenantId: 'tenant-a', key: 'group.tenant-viewers',
      name: 'Tenant viewers', description: null, source: 'config',
      sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_locked', isArchived: false,
    };
    const assignment = {
      id: 'assignment-tenant', tenantId: 'tenant-a', principalType: 'group',
      principalId: group.id, roleId: role.id, scopeType: 'tenant', scopeId: 'tenant-a',
      source: 'config', sourceRef: 'config_bundle:acme.authz',
      ownershipMode: 'config_locked', expiresAt: null,
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === RbacRole) return { find: vi.fn().mockResolvedValue([role]) };
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([group]) };
        if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue([{ roleId: role.id, permissionId: 'engine:instance:view' }]) };
        if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue([assignment]) };
        if ([Engine, EngineBackstopGroupMapping, EngineTenantMapping, EngineSet, RuntimeResourceSet, RuntimeResource, ProjectEngineTarget, IdentityProvider, IdentityEntitlementMapping].includes(entity as any)) {
          return { find: vi.fn().mockResolvedValue([]) };
        }
        if (entity === PlatformSettings) return { findOneBy: vi.fn().mockResolvedValue(null) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({
      bundleKey: 'acme.authz',
      tenantId: 'tenant-a',
      tenantKey: 'acme',
    });

    expect(result.files).toMatchObject({
      './roles.json': {
        roles: [expect.objectContaining({ key: role.key, scope: 'tenant', permissions: ['engine:instance:view'] })],
      },
      './assignments.json': {
        assignments: [expect.objectContaining({
          principal: { type: 'group', key: group.key },
          roleKey: role.key,
          scope: { type: 'tenant' },
        })],
      },
    });
    expect(configBundlePreviewService.preview(result)).toMatchObject({ valid: true, errors: [] });
  });
});
