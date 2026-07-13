import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
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
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const bundle = {
  apiVersion: 'enterpriseglue.ai/v1alpha1',
  kind: 'EnterpriseGlueConfigBundle',
  metadata: { key: 'acme.authz', owner: 'platform' },
  tenantKey: 'acme',
  mode: 'authoritative',
  settings: {},
  imports: ['./roles.json', './groups.json'],
};

function mockDataSource(
  roles: unknown[] = [],
  groups: unknown[] = [],
  permissions: unknown[] = [],
  engines: unknown[] = [],
  identityProviders: unknown[] = [],
  identityMappings: unknown[] = [],
  projectEngineTargets: unknown[] = [],
) {
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository: (entity: unknown) => {
      if (entity === RbacRole) return { find: vi.fn().mockResolvedValue(roles) };
      if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue(groups) };
      if (entity === Engine) return { find: vi.fn().mockResolvedValue(engines) };
      if (entity === EngineSet) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === RuntimeResourceSet) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue(permissions) };
      if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue(identityProviders) };
      if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue(identityMappings) };
      if (entity === ProjectEngineTarget) return { find: vi.fn().mockResolvedValue(projectEngineTargets) };
      throw new Error('Unexpected repository');
    },
  });

}

describe('configBundleDiffService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('identifies creation and authoritative archival without mutating persisted state', async () => {
    mockDataSource([], [{
      id: 'group-stale', tenantId: 'tenant-a', key: 'group.stale', name: 'Stale', description: null,
      source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    }]);

    const result = await configBundleDiffService.diff({
      bundle,
      files: {
        './roles.json': {
          roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }],
        },
        './groups.json': {
          groups: [{ key: 'group.deployers', name: 'Deployers' }],
        },
      },
    }, 'tenant-a');

    expect(result).toMatchObject({ valid: true, canonicalHash: expect.any(String) });
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'role', key: 'custom.engine.deployer', operation: 'create' }),
      expect.objectContaining({ objectType: 'group', key: 'group.deployers', operation: 'create' }),
      expect.objectContaining({ objectType: 'group', key: 'group.stale', operation: 'archive' }),
    ]));
  });

  it('does not allow a bundle to silently take over a manual role or group', async () => {
    mockDataSource([
      { id: 'role-1', tenantId: 'tenant-a', key: 'custom.engine.deployer', source: 'manual', sourceRef: null },
    ], [
      { id: 'group-1', tenantId: 'tenant-a', key: 'group.deployers', source: 'manual', sourceRef: null },
    ]);

    const result = await configBundleDiffService.diff({
      bundle,
      files: {
        './roles.json': {
          roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }],
        },
        './groups.json': {
          groups: [{ key: 'group.deployers', name: 'Deployers' }],
        },
      },
    }, 'tenant-a');

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'role', key: 'custom.engine.deployer', operation: 'conflict', currentId: 'role-1' }),
      expect.objectContaining({ objectType: 'group', key: 'group.deployers', operation: 'conflict', currentId: 'group-1' }),
    ]));
  });

  it('includes config-owned Runtime Resource Sets in the persisted-state diff', async () => {
    mockDataSource([], [], [], [{ id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central' }]);
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './runtime-resource-sets.json'] },
      files: {
        './engines.json': {
          engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }],
        },
        './runtime-resource-sets.json': {
          runtimeResourceSets: [{
            key: 'runtime.payments', name: 'Payments processes', engineRef: { engineKey: 'engine.central' },
            resourceKind: 'process_definition', selector: { mode: 'prefix', prefix: 'payments-' },
          }],
        },
      },
    }, 'tenant-a');
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'runtime_resource_set', key: 'runtime.payments', operation: 'create' }),
    ]));
  });

  it('detects ingestion-control drift for config-owned engines', async () => {
    mockDataSource([], [], [], [{
      id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz',
      name: 'Central', baseUrl: 'https://central.example.com/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}',
      runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false,
      connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active',
    }]);
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: { './engines.json': { engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', labels: {}, auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }] } },
    }, 'tenant-a');
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'engine', key: 'engine.central', operation: 'update' }),
    ]));
  });

  it('includes config-owned identity providers in the persisted-state diff', async () => {
    mockDataSource([], [], [], [], []);
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./identity-providers.json'] },
      files: { './identity-providers.json': { identityProviders: [{
        key: 'identity.oidc.main', type: 'oidc', enabled: true, authenticationMode: 'claims_only',
        sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' },
        oidc: { issuerUrl: 'https://login.example.test', clientId: 'enterpriseglue', callbackUrl: 'https://app.example.test/callback', scopes: ['openid'] },
      }] } },
    }, 'tenant-a');
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'identity_provider', key: 'identity.oidc.main', operation: 'create' }),
    ]));
  });

  it('identifies creation for a provider-neutral identity mapping', async () => {
    mockDataSource([], [{
      id: 'group-operators', tenantId: 'tenant-a', key: 'group.operators', name: 'Operators', description: null,
      source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    }], [], [], [{
      id: 'provider-main', tenantId: 'tenant-a', key: 'identity.oidc.main', sourceRef: 'config_bundle:acme.authz',
    }]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./groups.json', './identity-mappings.json'] },
      files: {
        './groups.json': { groups: [{ key: 'group.operators', name: 'Operators' }] },
        './identity-mappings.json': { identityMappings: [{
          key: 'mapping.operators', providerKey: 'identity.oidc.main',
          source: { type: 'group', externalId: 'operations' }, targetGroupKey: 'group.operators',
        }] },
      },
    }, 'tenant-a');

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'identity_mapping', key: 'mapping.operators', operation: 'create' }),
    ]));
  });

  it('identifies no-op and update states for config-owned identity mappings', async () => {
    const group = {
      id: 'group-operators', tenantId: 'tenant-a', key: 'group.operators', name: 'Operators', description: null,
      source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    };
    const provider = { id: 'provider-main', tenantId: 'tenant-a', key: 'identity.oidc.main', sourceRef: 'config_bundle:acme.authz' };
    const matchingMapping = {
      id: 'mapping-operators', tenantId: 'tenant-a', configKey: 'mapping.operators', sourceRef: 'config_bundle:acme.authz',
      providerId: provider.id, targetGroupId: group.id, entitlementType: 'group', externalId: 'operations',
      matchOperator: 'exact', syncMode: 'authoritative', isActive: true,
    };
    const input = {
      bundle: { ...bundle, imports: ['./groups.json', './identity-mappings.json'] },
      files: {
        './groups.json': { groups: [{ key: 'group.operators', name: 'Operators' }] },
        './identity-mappings.json': { identityMappings: [{
          key: 'mapping.operators', providerKey: 'identity.oidc.main',
          source: { type: 'group', externalId: 'operations' }, targetGroupKey: 'group.operators',
        }] },
      },
    };

    mockDataSource([], [group], [], [], [provider], [matchingMapping]);
    const unchanged = await configBundleDiffService.diff(input, 'tenant-a');
    expect(unchanged.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'identity_mapping', key: 'mapping.operators', operation: 'noop', currentId: 'mapping-operators' }),
    ]));

    mockDataSource([], [group], [], [], [provider], [{ ...matchingMapping, externalId: 'different-group' }]);
    const changed = await configBundleDiffService.diff(input, 'tenant-a');
    expect(changed.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'identity_mapping', key: 'mapping.operators', operation: 'update', currentId: 'mapping-operators' }),
    ]));
  });

  it('identifies authoritative archival for omitted config-owned identity mappings', async () => {
    mockDataSource([], [], [], [], [], [{
      id: 'mapping-removed', tenantId: 'tenant-a', configKey: 'mapping.removed', sourceRef: 'config_bundle:acme.authz', isActive: true,
    }]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./identity-mappings.json'] },
      files: { './identity-mappings.json': { identityMappings: [] } },
    }, 'tenant-a');

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'identity_mapping', key: 'mapping.removed', operation: 'archive', currentId: 'mapping-removed' }),
    ]));
  });

  it('diffs config-owned project-engine targets by deployment eligibility and authoritative ownership', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    const engine = {
      id: 'engine-central', tenantId: 'tenant-a', configKey: 'engine.central', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz',
      name: 'Central', baseUrl: 'https://central.example.com/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}',
      runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false,
      connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active',
    };
    const target = {
      id: 'target-1', tenantId: 'tenant-a', projectId, engineId: engine.id, source: 'config', sourceRef: 'config_bundle:acme.authz',
      status: 'active', allowManualDeploy: false, allowCiDeploy: true, allowApiDeploy: false, allowImport: false,
    };
    const input = {
      bundle: { ...bundle, imports: ['./engines.json', './project-engine-targets.json'] },
      files: {
        './engines.json': { engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }] },
        './project-engine-targets.json': { projectEngineTargets: [{ projectRef: { id: projectId }, engineRef: { engineKey: 'engine.central' }, allowCiDeploy: true }] },
      },
    };

    mockDataSource([], [], [], [engine], [], [], [target]);
    const unchanged = await configBundleDiffService.diff(input, 'tenant-a');
    expect(unchanged.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine.central`, operation: 'noop', currentId: 'target-1' }),
    ]));

    mockDataSource([], [], [], [engine], [], [], [{ ...target, allowManualDeploy: true }]);
    const changed = await configBundleDiffService.diff(input, 'tenant-a');
    expect(changed.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine.central`, operation: 'update', currentId: 'target-1' }),
    ]));

    mockDataSource([], [], [], [engine], [], [], []);
    const created = await configBundleDiffService.diff(input, 'tenant-a');
    expect(created.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine.central`, operation: 'create' }),
    ]));

    mockDataSource([], [], [], [engine], [], [], [target]);
    const archived = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./project-engine-targets.json'] },
      files: { './project-engine-targets.json': { projectEngineTargets: [] } },
    }, 'tenant-a');
    expect(archived.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine-central`, operation: 'archive', currentId: 'target-1' }),
    ]));
  });
});
