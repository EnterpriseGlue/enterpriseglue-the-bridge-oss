import { describe, expect, it, vi, type Mock } from 'vitest';
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
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
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
        if ([RbacRole, AuthzGroup, RbacRolePermission, EngineSet, RuntimeResourceSet, RuntimeResource, RbacRoleAssignment, ProjectEngineTarget, IdentityProvider, IdentityEntitlementMapping].includes(entity as any)) return { find: vi.fn().mockResolvedValue([]) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({ bundleKey: 'acme.authz' });
    expect(result.files['./engines.json']).toEqual({ engines: [expect.objectContaining({
      key: 'engine.prod', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false,
      auth: { type: 'basic', username: 'eg', passwordRef: 'PROD_ENGINE_PASSWORD' },
    })] });
    expect(JSON.stringify(result.files)).not.toContain('ref:PROD_ENGINE_PASSWORD');
  });

  it('exports all apply-supported config families with stable references', async () => {
    const configRole = { id: 'role-config', tenantId: null, key: 'custom.engine.reader', name: 'Reader', description: null, scope: 'engine', sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const systemRole = { id: 'role-system', tenantId: null, key: 'system.platform.user', name: 'Platform User', description: null, scope: 'platform', sourceRef: null, isArchived: false };
    const group = { id: 'group-1', tenantId: null, key: 'group.operators', name: 'Operators', description: null, sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const engine = { id: 'engine-1', tenantId: null, configKey: 'engine.central', name: 'Central', baseUrl: 'https://central.example.test/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}', authType: 'basic', username: 'eg', passwordEnc: 'ref:CENTRAL_PASSWORD', oauthTokenUrl: null, oauthScopes: null, oauthAudience: null, version: null, runtimeAccessScope: 'resource_aware', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: true, pipelineReceiptEnabled: true, connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active', sourceRef: 'config_bundle:acme.authz' };
    const engineSet = { id: 'engine-set-1', tenantId: null, key: 'engines.central', name: 'Central engines', description: null, selectorJson: '{"mode":"engine_ids","engineKeys":["engine.central"]}', source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const runtimeResourceSet = { id: 'runtime-set-1', tenantId: null, key: 'runtime.payments', name: 'Payments', description: null, engineId: 'engine-1', resourceKind: 'process_definition', selectorJson: '{"mode":"prefix","prefix":"payments-"}', runtimeTenantId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false };
    const configProvider = { id: 'provider-config', tenantId: null, key: 'identity.oidc.config', protocol: 'oidc', isEnabled: true, authenticationMode: 'claims_only', directoryTenantId: null, configurationJson: '{"issuerUrl":"https://issuer.example.test","clientId":"enterpriseglue","callbackUrl":"https://app.example.test/callback","scopes":["openid"],"allowVerifiedEmailLinking":true}', syncJson: '{"triggers":["login"],"requiredForLogin":true,"incompleteEntitlements":"fail_closed"}', ownershipMode: 'config_locked', sourceRef: 'config_bundle:acme.authz' };
    const externalProvider = { id: 'provider-external', tenantId: null, key: 'identity.ldap.external', protocol: 'ldap', isEnabled: true, authenticationMode: 'direct', directoryTenantId: null, configurationJson: '{}', syncJson: '{}', ownershipMode: 'manual', sourceRef: null };
    const identityMapping = { id: 'mapping-1', tenantId: null, configKey: 'mapping.operators', providerId: 'provider-external', targetGroupId: 'group-1', entitlementType: 'group', externalId: 'operations', matchOperator: 'exact', syncMode: 'authoritative', isActive: true, sourceRef: 'config_bundle:acme.authz' };
    const assignment = { id: 'assignment-1', tenantId: null, assignmentKey: 'assignment-key', principalType: 'group', principalId: 'group-1', roleId: 'role-system', scopeType: 'platform', scopeId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', expiresAt: null };
    const target = { id: 'target-1', tenantId: null, projectId: '00000000-0000-4000-8000-000000000001', engineId: 'engine-1', status: 'active', source: 'config', sourceRef: 'config_bundle:acme.authz', allowManualDeploy: false, allowCiDeploy: true, allowApiDeploy: false, allowImport: false };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === RbacRole) return { find: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where?.sourceRef ? [configRole] : [configRole, systemRole])) };
        if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue([group]) };
        if (entity === Engine) return { find: vi.fn().mockResolvedValue([engine]) };
        if (entity === EngineSet) return { find: vi.fn().mockResolvedValue([engineSet]) };
        if (entity === RuntimeResourceSet) return { find: vi.fn().mockResolvedValue([runtimeResourceSet]) };
        if (entity === RuntimeResource) return { find: vi.fn().mockResolvedValue([]) };
        if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue([{ roleId: 'role-config', permissionId: 'engine:deploy' }]) };
        if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue([assignment]) };
        if (entity === ProjectEngineTarget) return { find: vi.fn().mockResolvedValue([target]) };
        if (entity === IdentityProvider) return { find: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where?.sourceRef ? [configProvider] : [configProvider, externalProvider])) };
        if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue([identityMapping]) };
        throw new Error('Unexpected repository');
      },
    });

    const result = await configBundleExportService.exportBundle({ bundleKey: 'acme.authz' });

    expect(result.files).toMatchObject({
      './engine-sets.json': { engineSets: [expect.objectContaining({ key: 'engines.central', selector: { mode: 'engine_ids', engineKeys: ['engine.central'] } })] },
      './runtime-resource-sets.json': { runtimeResourceSets: [expect.objectContaining({ key: 'runtime.payments', engineRef: { engineKey: 'engine.central' } })] },
      './identity-providers.json': { identityProviders: [expect.objectContaining({ key: 'identity.oidc.config', type: 'oidc' })] },
      './identity-mappings.json': { identityMappings: [expect.objectContaining({ key: 'mapping.operators', providerKey: 'identity.ldap.external', targetGroupKey: 'group.operators' })] },
      './assignments.json': { assignments: [expect.objectContaining({ roleKey: 'system.platform.user', principal: { type: 'group', key: 'group.operators' }, scope: { type: 'platform' } })] },
      './project-engine-targets.json': { projectEngineTargets: [expect.objectContaining({ projectRef: { id: target.projectId }, engineRef: { engineKey: 'engine.central' }, allowCiDeploy: true })] },
    });
    const preview = configBundlePreviewService.preview(result);
    expect(preview.errors).toEqual([]);
    expect(preview).toMatchObject({ valid: true });
    const exportedProvider = (result.files['./identity-providers.json'] as any).identityProviders[0];
    expect(exportedProvider.allowVerifiedEmailLinking).toBe(true);
    expect(exportedProvider.oidc.allowVerifiedEmailLinking).toBeUndefined();
  });
});
