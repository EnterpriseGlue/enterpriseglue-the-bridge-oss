import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
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
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { canonicalRoleAssignmentKey } from '@enterpriseglue/shared/authz/role-assignment-identity.js';
import { configBundleDiffService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleDiffService.js';

const previewStoredSnapshots = vi.hoisted(() => vi.fn());
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityEntitlementMappingService.js', () => ({
  identityEntitlementMappingService: { previewStoredSnapshots },
}));

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
  assignments: unknown[] = [],
  runtimeResources: unknown[] = [],
  projects: unknown[] = [],
  groupMemberships: unknown[] = [],
  runtimeResourceSets: unknown[] = [],
  runtimeResourceSetMaterializations: unknown[] = [],
  engineTenantMappings: unknown[] = [],
) {
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository: (entity: unknown) => {
      if (entity === RbacRole) return { find: vi.fn().mockResolvedValue(roles) };
      if (entity === AuthzGroup) return { find: vi.fn().mockResolvedValue(groups) };
      if (entity === Engine) return { find: vi.fn().mockResolvedValue(engines) };
      if (entity === EngineTenantMapping) return { find: vi.fn().mockResolvedValue(engineTenantMappings) };
      if (entity === EngineSet) return { find: vi.fn().mockResolvedValue([]) };
      if (entity === RuntimeResourceSet) return { find: vi.fn().mockResolvedValue(runtimeResourceSets) };
      if (entity === RuntimeResourceSetMaterialization) return { find: vi.fn().mockResolvedValue(runtimeResourceSetMaterializations) };
      if (entity === RbacRolePermission) return { find: vi.fn().mockResolvedValue(permissions) };
      if (entity === IdentityProvider) return { find: vi.fn().mockResolvedValue(identityProviders) };
      if (entity === IdentityEntitlementMapping) return { find: vi.fn().mockResolvedValue(identityMappings) };
      if (entity === ProjectEngineTarget) return { find: vi.fn().mockResolvedValue(projectEngineTargets) };
      if (entity === RbacRoleAssignment) return { find: vi.fn().mockResolvedValue(assignments) };
      if (entity === RuntimeResource) return { find: vi.fn().mockResolvedValue(runtimeResources) };
      if (entity === Project) return { find: vi.fn().mockResolvedValue(projects) };
      if (entity === AuthzGroupMembership) return { find: vi.fn().mockResolvedValue(groupMemberships) };
      throw new Error('Unexpected repository');
    },
  });

}

describe('configBundleDiffService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not echo a rejected plaintext credential in persisted-state diff errors', async () => {
    const plaintext = 'diff-secret-must-not-leak';
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.test/engine-rest',
            auth: { type: 'basic', username: 'enterpriseglue', password: plaintext },
          }],
        },
      },
    }, 'tenant-a');

    expect(result).toMatchObject({ valid: false, changes: [] });
    expect(JSON.stringify(result)).not.toContain(plaintext);
  });

  it('requires the transition workflow for config-managed topology changes', async () => {
    mockDataSource([], [], [], [{
      id: 'engine-1',
      tenantId: 'tenant-a',
      tenancyMode: 'dedicated',
      tenantMappingStrategy: null,
      configKey: 'engine.central',
      configKeyIdentity: 'tenant-a:engine.central',
      registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz',
    }]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.central',
            name: 'Central',
            type: 'operaton',
            baseUrl: 'https://central.example.com/engine-rest',
            auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' },
            runtimeAccessScope: 'resource_aware',
            tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
          }],
        },
      },
    }, 'tenant-a');

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'engine',
      key: 'engine.central',
      operation: 'conflict',
      reason: expect.stringContaining('transition workflow'),
    }));
  });

  it('detects an opaque engine credential-reference rotation', async () => {
    mockDataSource([], [], [], [{
      id: 'engine-1',
      tenantId: 'tenant-a',
      tenancyMode: 'dedicated',
      tenantMappingStrategy: null,
      configKey: 'engine.central',
      configKeyIdentity: 'tenant-a:engine.central',
      registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz',
      name: 'Central',
      baseUrl: 'https://central.example.com/engine-rest',
      type: 'operaton',
      externalId: null,
      labelsJson: '{}',
      authType: 'basic',
      username: 'eg',
      passwordEnc: 'ref:CENTRAL_PASSWORD_OLD',
      oauthTokenUrl: null,
      oauthScopes: null,
      oauthAudience: null,
      runtimeAccessScope: 'engine_wide',
      deploymentIntegration: 'enterpriseglue_proxy',
      metadataDiscoveryEnabled: true,
      deploymentDiscoveryEnabled: true,
      reconciliationIntervalSeconds: 300,
      pipelineReceiptEnabled: true,
      connectionMode: 'direct',
      ownershipMode: 'config_locked',
      lifecycleStatus: 'active',
    }]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.central',
            name: 'Central',
            type: 'operaton',
            baseUrl: 'https://central.example.com/engine-rest',
            auth: {
              type: 'basic',
              username: 'eg',
              passwordRef: 'CENTRAL_PASSWORD_ROTATED',
            },
          }],
        },
      },
    }, 'tenant-a');

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectType: 'engine',
        key: 'engine.central',
        operation: 'update',
        currentId: 'engine-1',
      }),
    ]));
  });

  it('diffs config-owned shared-engine tenant mappings with authorized tenant-key resolution', async () => {
    mockDataSource([], [], [], [{
      id: 'engine-1',
      tenantId: null,
      tenancyMode: 'shared',
      tenantMappingStrategy: 'engine_tenant_id',
      configKey: 'engine.central',
      configKeyIdentity: 'tenant-a:engine.central',
      registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz',
    }]);
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        tenantId: 'tenant-b',
        tenantKey: 'tenant.bravo',
        authorized: true,
      }),
    };

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './engine-tenant-mappings.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.central',
            name: 'Central',
            type: 'operaton',
            baseUrl: 'https://central.example.test/engine-rest',
            auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' },
            runtimeAccessScope: 'resource_aware',
            tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
          }],
        },
        './engine-tenant-mappings.json': {
          engineTenantMappings: [{
            key: 'engine-tenant-mapping.central-bravo',
            engineRef: { engineKey: 'engine.central' },
            externalTenantId: 'bravo',
            tenantRef: { type: 'key', key: 'tenant.bravo' },
            strategy: 'engine_tenant_id',
          }],
        },
      },
    }, 'tenant-a', {
      credentiallessCustomerSidecarsEnabled: false,
      tenantReferenceResolver: resolver,
      tenantReferencePrincipalType: 'user',
      tenantReferencePrincipalId: 'admin-1',
    });

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'engine_tenant_mapping',
      key: 'engine-tenant-mapping.central-bravo',
      operation: 'create',
    }));
    expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({
      reference: { type: 'key', key: 'tenant.bravo' },
      requestTenantId: 'tenant-a',
      principalType: 'user',
      principalId: 'admin-1',
    }));
  });

  it('refuses to take over a manual shared-engine tenant identity', async () => {
    const engine = {
      id: 'engine-1',
      tenantId: null,
      tenancyMode: 'shared',
      tenantMappingStrategy: 'engine_tenant_id',
      configKey: 'engine.central',
      configKeyIdentity: 'tenant-a:engine.central',
      registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz',
    };
    mockDataSource(
      [], [], [], [engine], [], [], [], [], [], [], [], [], [], [{
        id: 'manual-mapping',
        engineId: 'engine-1',
        externalTenantId: 'acme',
        enterpriseTenantId: 'tenant-a',
        strategy: 'engine_tenant_id',
        source: 'manual',
        sourceRef: 'manual:acme',
        ownershipMode: 'manual',
        isActive: true,
      }],
    );

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './engine-tenant-mappings.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.central',
            name: 'Central',
            type: 'operaton',
            baseUrl: 'https://central.example.test/engine-rest',
            auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' },
            runtimeAccessScope: 'resource_aware',
            tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
          }],
        },
        './engine-tenant-mappings.json': {
          engineTenantMappings: [{
            key: 'engine-tenant-mapping.central-acme',
            engineRef: { engineKey: 'engine.central' },
            externalTenantId: 'acme',
            tenantRef: { type: 'request_context' },
            strategy: 'engine_tenant_id',
          }],
        },
      },
    }, 'tenant-a');

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'engine_tenant_mapping',
      operation: 'conflict',
      currentId: 'manual-mapping',
      reason: expect.stringContaining('owned by another source'),
    }));
  });

  it('archives only omitted mapping rows owned by the authoritative bundle', async () => {
    const engine = {
      id: 'engine-1',
      tenantId: null,
      tenancyMode: 'shared',
      tenantMappingStrategy: 'engine_tenant_id',
      configKey: 'engine.central',
      configKeyIdentity: 'tenant-a:engine.central',
      registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz',
    };
    mockDataSource(
      [], [], [], [engine], [], [], [], [], [], [], [], [], [], [{
        id: 'stale-config-mapping',
        engineId: 'engine-1',
        externalTenantId: 'stale',
        enterpriseTenantId: 'tenant-a',
        strategy: 'engine_tenant_id',
        source: 'config',
        sourceRef: 'config_bundle:acme.authz:engine_tenant_mapping:engine-tenant-mapping.stale',
        ownershipMode: 'config_locked',
        isActive: true,
      }, {
        id: 'external-mapping',
        engineId: 'engine-1',
        externalTenantId: 'external',
        enterpriseTenantId: 'tenant-a',
        strategy: 'engine_tenant_id',
        source: 'external',
        sourceRef: 'external:tenant-a',
        ownershipMode: 'external_managed',
        isActive: true,
      }],
    );

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './engine-tenant-mappings.json'] },
      files: {
        './engines.json': {
          engines: [{
            key: 'engine.central',
            name: 'Central',
            type: 'operaton',
            baseUrl: 'https://central.example.test/engine-rest',
            auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' },
            runtimeAccessScope: 'resource_aware',
            tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
          }],
        },
        './engine-tenant-mappings.json': { engineTenantMappings: [] },
      },
    }, 'tenant-a');

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'engine_tenant_mapping',
      key: 'engine-tenant-mapping.stale',
      operation: 'archive',
      currentId: 'stale-config-mapping',
    }));
    expect(result.changes).not.toContainEqual(expect.objectContaining({ currentId: 'external-mapping' }));
    expect(result.requiredAcknowledgements).toContain(
      'config.authoritative_archive:engine_tenant_mapping:engine-tenant-mapping.stale',
    );
  });

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

  it('detects role and group ownership-mode changes as updates', async () => {
    mockDataSource([
      {
        id: 'role-1', tenantId: 'tenant-a', key: 'custom.engine.deployer', name: 'Deployer', description: null,
        scope: 'engine', source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_locked', isArchived: false,
      },
    ], [
      {
        id: 'group-1', tenantId: 'tenant-a', key: 'group.deployers', name: 'Deployers', description: null,
        source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_locked', isArchived: false,
      },
    ], [{ roleId: 'role-1', permissionId: 'engine:instance:view' }]);

    const result = await configBundleDiffService.diff({
      bundle,
      files: {
        './roles.json': {
          roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:instance:view'], ownershipMode: 'config_warn' }],
        },
        './groups.json': {
          groups: [{ key: 'group.deployers', name: 'Deployers', ownershipMode: 'config_warn' }],
        },
      },
    }, 'tenant-a');

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'role', key: 'custom.engine.deployer', operation: 'update' }),
      expect.objectContaining({ objectType: 'group', key: 'group.deployers', operation: 'update' }),
    ]));
  });

  it('reports expanded role permission additions, removals, and affected assignments', async () => {
    mockDataSource([
      { id: 'role-1', tenantId: 'tenant-a', key: 'custom.engine.deployer', name: 'Deployer', description: null, scope: 'engine', isArchived: false, source: 'config', sourceRef: 'config_bundle:acme.authz' },
    ], [], [
      { roleId: 'role-1', permissionId: 'engine:view' },
    ], [], [], [], [], [
      { id: 'assignment-1', tenantId: 'tenant-a', roleId: 'role-1' },
      { id: 'assignment-2', tenantId: 'tenant-a', roleId: 'role-1' },
    ]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./roles.json'] },
      files: {
        './roles.json': {
          roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }],
        },
      },
    }, 'tenant-a');

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'role', key: 'custom.engine.deployer', operation: 'update', affectedAssignmentCount: 2,
      permissionChanges: { additions: ['engine:deploy'], removals: ['engine:view'], effectivePermissions: ['engine:deploy'] },
    }));
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

  it('detects a Runtime Resource Set ownership-mode change', async () => {
    mockDataSource([], [], [], [
      { id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz' },
    ], [], [], [], [], [], [], [], [
      { id: 'runtime-set-1', tenantId: 'tenant-a', key: 'runtime.payments', name: 'Payments processes', description: null, engineId: 'engine-1', resourceKind: 'process_definition', selectorJson: JSON.stringify({ mode: 'prefix', prefix: 'payments-' }), runtimeTenantId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', ownershipMode: 'config_locked', isArchived: false },
    ]);
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './runtime-resource-sets.json'] },
      files: {
        './engines.json': { engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }] },
        './runtime-resource-sets.json': { runtimeResourceSets: [{ key: 'runtime.payments', name: 'Payments processes', engineRef: { engineKey: 'engine.central' }, resourceKind: 'process_definition', selector: { mode: 'prefix', prefix: 'payments-' }, ownershipMode: 'config_warn' }] },
      },
    }, 'tenant-a');
    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'runtime_resource_set', key: 'runtime.payments', operation: 'update',
      reason: expect.stringContaining('ownership mode'),
    }));
  });

  it('reports runtime resources entering and leaving a changed selector', async () => {
    mockDataSource([], [], [], [{
      id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz',
      name: 'Central', baseUrl: 'https://central.example.com/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}', runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: true, pipelineReceiptEnabled: true, connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active',
    }], [], [], [], [], [
      { id: 'resource-orders', tenantId: 'tenant-a', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'orders-v1', runtimeTenantId: 'runtime-orders', isActive: true, labelsJson: '{}' },
      { id: 'resource-payments', tenantId: 'tenant-a', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'payments-v1', runtimeTenantId: 'runtime-payments', isActive: true, labelsJson: '{}' },
    ], [], [], [{
      id: 'set-1', tenantId: 'tenant-a', key: 'runtime.payments', name: 'Payments processes', description: null, engineId: 'engine-1', resourceKind: 'process_definition', selectorJson: JSON.stringify({ mode: 'prefix', prefix: 'payments-' }), runtimeTenantId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    }], [{ tenantId: 'tenant-a', runtimeResourceSetId: 'set-1', runtimeResourceId: 'resource-payments' }]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './runtime-resource-sets.json'] },
      files: {
        './engines.json': { engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }] },
        './runtime-resource-sets.json': { runtimeResourceSets: [{ key: 'runtime.payments', name: 'Payments processes', engineRef: { engineKey: 'engine.central' }, resourceKind: 'process_definition', selector: { mode: 'prefix', prefix: 'orders-' }, runtimeTenantId: 'runtime-orders' }] },
      },
    }, 'tenant-a');

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'runtime_resource_set', key: 'runtime.payments', operation: 'update',
      runtimeResourceChanges: {
        matchedCount: 1, unmatchedCount: 1, detailsTruncated: false,
        currentlyMaterialized: [{ resourceKind: 'process_definition', resourceKey: 'payments-v1', runtimeTenantId: 'runtime-payments' }],
        newlyMatched: [{ resourceKind: 'process_definition', resourceKey: 'orders-v1', runtimeTenantId: 'runtime-orders' }],
        noLongerMatched: [{ resourceKind: 'process_definition', resourceKey: 'payments-v1', runtimeTenantId: 'runtime-payments' }],
        unmatchedSelectors: [],
      },
    }));
  });

  it('reports unmaterialized key selector terms in the runtime-set preview', async () => {
    mockDataSource([], [], [], [{
      id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz',
      name: 'Central', baseUrl: 'https://central.example.com/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}', runtimeAccessScope: 'resource_aware', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: true, pipelineReceiptEnabled: true, connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active',
    }], [], [], [], [], [
      { id: 'resource-orders', tenantId: 'tenant-a', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'orders-v1', runtimeTenantId: '', isActive: true, labelsJson: '{}' },
    ]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json', './runtime-resource-sets.json'] },
      files: {
        './engines.json': { engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' }, runtimeAccessScope: 'resource_aware' }] },
        './runtime-resource-sets.json': { runtimeResourceSets: [{ key: 'runtime.orders', name: 'Orders processes', engineRef: { engineKey: 'engine.central' }, resourceKind: 'process_definition', selector: { mode: 'keys', keys: ['orders-v1', 'payments-v1'] } }] },
      },
    }, 'tenant-a');

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'runtime_resource_set', key: 'runtime.orders', operation: 'create',
      runtimeResourceChanges: expect.objectContaining({
        currentlyMaterialized: [],
        newlyMatched: [{ resourceKind: 'process_definition', resourceKey: 'orders-v1', runtimeTenantId: null }],
        unmatchedSelectors: ['payments-v1'],
      }),
    }));
  });

  it('warns when engine-wide access can bypass narrow runtime and pipeline-only deployment boundaries', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    mockDataSource([
      { id: 'role-1', tenantId: 'tenant-a', key: 'custom.engine.deployer', name: 'Deployer', description: null, scope: 'engine', source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false },
    ], [
      { id: 'group-1', tenantId: 'tenant-a', key: 'group.deployers', name: 'Deployers', description: null, source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false },
    ], [{ roleId: 'role-1', permissionId: 'engine:deploy' }], [{
      id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz', name: 'Central', baseUrl: 'https://central.example.com/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}', runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: true, pipelineReceiptEnabled: true, connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active',
    }], [], [], [], [], [], [{ id: projectId, tenantId: 'tenant-a' }], [], [{
      id: 'runtime-set-1', tenantId: 'tenant-a', key: 'runtime.payments', name: 'Payments', description: null, engineId: 'engine-1', resourceKind: 'process_definition', selectorJson: JSON.stringify({ mode: 'prefix', prefix: 'payments-' }), runtimeTenantId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    }]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./roles.json', './groups.json', './engines.json', './runtime-resource-sets.json', './assignments.json', './project-engine-targets.json'] },
      files: {
        './roles.json': { roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }] },
        './groups.json': { groups: [{ key: 'group.deployers', name: 'Deployers' }] },
        './engines.json': { engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }] },
        './runtime-resource-sets.json': { runtimeResourceSets: [{ key: 'runtime.payments', name: 'Payments', engineRef: { engineKey: 'engine.central' }, resourceKind: 'process_definition', selector: { mode: 'prefix', prefix: 'payments-' } }] },
        './assignments.json': { assignments: [
          { key: 'assignment.engine', principal: { type: 'group', key: 'group.deployers' }, roleKey: 'custom.engine.deployer', scope: { type: 'engine', engineKey: 'engine.central' } },
          { key: 'assignment.runtime', principal: { type: 'group', key: 'group.deployers' }, roleKey: 'custom.engine.deployer', scope: { type: 'engine_runtime_resource_set', runtimeResourceSetKey: 'runtime.payments' } },
        ] },
        './project-engine-targets.json': { projectEngineTargets: [{ key: 'target.pipeline', projectRef: { id: projectId }, engineRef: { engineKey: 'engine.central' }, allowCiDeploy: true }] },
      },
    }, 'tenant-a');

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'config.runtime_resource_set_engine_wide:runtime.payments' }),
      expect.objectContaining({ id: expect.stringContaining('config.runtime_grant_shadow:group.deployers') }),
      expect.objectContaining({ id: expect.stringContaining('config.pipeline_target_human_deployer:target.pipeline') }),
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

  it('warns that direct-engine deployment discovery needs receipts for project and file lineage', async () => {
    mockDataSource();
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engines.json'] },
      files: { './engines.json': { engines: [{
        key: 'engine.direct', name: 'Direct', type: 'operaton', baseUrl: 'https://engine.example.test/rest',
        auth: { type: 'basic', username: 'eg', passwordRef: 'DIRECT_PASSWORD' }, deploymentIntegration: 'direct_engine', pipelineReceiptEnabled: false,
      }] } },
    }, 'tenant-a');

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'config.direct_engine_lineage:engine.direct' }),
      expect.objectContaining({ id: 'config.direct_engine_lineage_receipts_disabled:engine.direct' }),
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
    previewStoredSnapshots.mockResolvedValueOnce({ scanned: 4, matches: 3, nonMatches: 1, failed: 0, truncated: false, latestSnapshotAt: 123, warnings: ['stored_snapshots_only'] });
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
      expect.objectContaining({ objectType: 'identity_mapping', key: 'mapping.operators', operation: 'create', identitySnapshotPreview: { scanned: 4, matches: 3, nonMatches: 1, failed: 0, truncated: false, latestSnapshotAt: 123, warnings: ['stored_snapshots_only'] } }),
    ]));
    expect(previewStoredSnapshots).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'identity.oidc.main', externalId: 'operations' }), 'tenant-a');
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
    expect(result.requiredAcknowledgements).toContain('config.authoritative_archive:identity_mapping:mapping.removed');
  });

  it('requires acknowledgement for broad Engine Set selectors and identity mappings', async () => {
    mockDataSource();
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./engine-sets.json', './groups.json', './identity-mappings.json'] },
      files: {
        './engine-sets.json': { engineSets: [{ key: 'engines.all', name: 'All engines', selector: { mode: 'all' } }] },
        './groups.json': { groups: [{ key: 'group.everyone', name: 'Everyone' }] },
        './identity-mappings.json': { identityMappings: [{ key: 'mapping.default-access', providerKey: 'identity.external', source: { type: 'attribute', operator: 'exists' }, targetGroupKey: 'group.everyone' }] },
      },
    }, 'tenant-a');

    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ acknowledgementId: 'config.engine_set_broad:engines.all' }),
      expect.objectContaining({ acknowledgementId: 'config.identity_mapping_broad:mapping.default-access' }),
    ]));
    expect(result.requiredAcknowledgements).toContain('config.engine_set_broad:engines.all');
    expect(result.requiredAcknowledgements).toContain('config.identity_mapping_broad:mapping.default-access');
  });

  it('summarizes affected current group members without returning identity details', async () => {
    const group = {
      id: 'group-operators', tenantId: 'tenant-a', key: 'group.operators', name: 'Operators', description: null,
      source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    };
    mockDataSource([], [group], [], [], [], [], [], [], [], [], [{ tenantId: 'tenant-a', groupId: group.id, userId: 'user-1' }, { tenantId: 'tenant-a', groupId: group.id, userId: 'user-2' }]);

    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./groups.json'] },
      files: { './groups.json': { groups: [] } },
    }, 'tenant-a');

    expect(result.affectedPrincipals).toEqual({
      affectedGroupCount: 1,
      affectedUserCount: 2,
      externalIdentityMappingChangeCount: 0,
    });
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

    const project = { id: projectId, tenantId: 'tenant-a' };
    mockDataSource([], [], [], [engine], [], [], [target], [], [], [project]);
    const unchanged = await configBundleDiffService.diff(input, 'tenant-a');
    expect(unchanged.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine.central`, operation: 'noop', currentId: 'target-1' }),
    ]));

    mockDataSource([], [], [], [engine], [], [], [{ ...target, allowManualDeploy: true }], [], [], [project]);
    const changed = await configBundleDiffService.diff(input, 'tenant-a');
    expect(changed.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine.central`, operation: 'update', currentId: 'target-1' }),
    ]));

    mockDataSource([], [], [], [engine], [], [], [], [], [], [project]);
    const created = await configBundleDiffService.diff(input, 'tenant-a');
    expect(created.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine.central`, operation: 'create' }),
    ]));

    mockDataSource([], [], [], [engine], [], [], [target], [], [], [project]);
    const archived = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./project-engine-targets.json'] },
      files: { './project-engine-targets.json': { projectEngineTargets: [] } },
    }, 'tenant-a');
    expect(archived.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine-central`, operation: 'archive', currentId: 'target-1' }),
    ]));

    mockDataSource([], [], [], [engine]);
    const unresolvedProject = await configBundleDiffService.diff(input, 'tenant-a');
    expect(unresolvedProject.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', key: `${projectId}:engine.central`, operation: 'conflict', reason: expect.stringContaining('unresolved project id') }),
    ]));
  });

  it('requires an explicit reviewed instruction before a bundle takes ownership of a target', async () => {
    const projectId = '00000000-0000-4000-8000-000000000002';
    const engine = { id: 'engine-manual', tenantId: 'tenant-a', configKey: 'engine.manual', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz', name: 'Managed engine', baseUrl: 'https://engine.example.test/rest', type: 'operaton', externalId: null, labelsJson: '{}', runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false, connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active' };
    const target = { id: 'target-manual', tenantId: 'tenant-a', projectId, engineId: engine.id, source: 'manual', sourceRef: null, status: 'active', allowManualDeploy: true, allowCiDeploy: false, allowApiDeploy: false, allowImport: true };
    const baseInput = {
      bundle: { ...bundle, imports: ['./engines.json', './project-engine-targets.json'] },
      files: {
        './engines.json': { engines: [{ key: 'engine.manual', name: 'Managed engine', type: 'operaton', baseUrl: 'https://engine.example.test/rest', auth: { type: 'basic', username: 'eg', passwordRef: 'ENGINE_PASSWORD' } }] },
        './project-engine-targets.json': { projectEngineTargets: [{ projectRef: { id: projectId }, engineRef: { engineKey: 'engine.manual' }, allowCiDeploy: true }] },
      },
    };
    mockDataSource([], [], [], [engine], [], [], [target], [], [], [{ id: projectId, tenantId: 'tenant-a' }]);
    const blocked = await configBundleDiffService.diff(baseInput, 'tenant-a');
    expect(blocked.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', operation: 'conflict', reason: expect.stringContaining('ownership_conflict') }),
    ]));

    const transferInput = {
      ...baseInput,
      files: { ...baseInput.files, './project-engine-targets.json': { projectEngineTargets: [{ projectRef: { id: projectId }, engineRef: { engineKey: 'engine.manual' }, allowCiDeploy: true, transferOwnership: { reason: 'Move deployment eligibility into reviewed configuration.' } }] } },
    };
    const transferred = await configBundleDiffService.diff(transferInput, 'tenant-a');
    expect(transferred.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'project_engine_target', operation: 'update', currentId: 'target-manual', reason: expect.stringContaining('Transfer ownership') }),
    ]));
  });

  it('diffs supported config-owned group assignments by canonical identity and expiration', async () => {
    const role = { id: 'role-operator', tenantId: 'tenant-a', key: 'system.engine.operator', source: 'system', sourceRef: null };
    const group = {
      id: 'group-operators', tenantId: 'tenant-a', key: 'group.operators', name: 'Operators', description: null,
      source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    };
    const assignmentKey = canonicalRoleAssignmentKey({
      tenantId: 'tenant-a', principalType: 'group', principalId: group.id, roleId: role.id,
      scopeType: 'platform', scopeId: null, source: 'config', sourceRef: 'config_bundle:acme.authz',
    });
    const assignment = {
      id: 'assignment-1', tenantId: 'tenant-a', assignmentKey, principalType: 'group', principalId: group.id,
      roleId: role.id, scopeType: 'platform', scopeId: null, source: 'config', sourceRef: 'config_bundle:acme.authz', expiresAt: null,
    };
    const input = {
      bundle: { ...bundle, imports: ['./groups.json', './assignments.json'] },
      files: {
        './groups.json': { groups: [{ key: 'group.operators', name: 'Operators' }] },
        './assignments.json': { assignments: [{ key: 'assignment.operators', principal: { type: 'group', key: 'group.operators' }, roleKey: 'system.engine.operator', scope: { type: 'platform' } }] },
      },
    };

    mockDataSource([role], [group], [], [], [], [], [], [assignment]);
    const unchanged = await configBundleDiffService.diff(input, 'tenant-a');
    expect(unchanged.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'assignment', key: 'assignment.operators', operation: 'noop', currentId: 'assignment-1' }),
    ]));

    const expiresAt = 1_900_000_000_000;
    mockDataSource([role], [group], [], [], [], [], [], [{ ...assignment, expiresAt }]);
    const changed = await configBundleDiffService.diff(input, 'tenant-a');
    expect(changed.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'assignment', key: 'assignment.operators', operation: 'update', currentId: 'assignment-1' }),
    ]));

    mockDataSource([role], [group]);
    const created = await configBundleDiffService.diff(input, 'tenant-a');
    expect(created.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'assignment', key: 'assignment.operators', operation: 'create' }),
    ]));

    mockDataSource([role], [group], [], [], [], [], [], [assignment]);
    const archived = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./assignments.json'] },
      files: { './assignments.json': { assignments: [] } },
    }, 'tenant-a');
    expect(archived.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'assignment', key: assignmentKey, operation: 'archive', currentId: 'assignment-1' }),
    ]));
  });

  it('resolves dependent references declared in the same bundle as staged creates', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    mockDataSource([], [], [], [], [], [], [], [], [], [{ id: projectId, tenantId: 'tenant-a' }]);

    const result = await configBundleDiffService.diff({
      bundle: {
        ...bundle,
        imports: [
          './roles.json', './groups.json', './engines.json', './engine-sets.json', './runtime-resource-sets.json',
          './assignments.json', './identity-providers.json', './identity-mappings.json', './project-engine-targets.json',
        ],
      },
      files: {
        './roles.json': { roles: [
          { key: 'custom.engine.viewer', name: 'Engine viewer', scope: 'engine', permissions: ['engine:instance:view'] },
          { key: 'custom.tenant.runtime-viewer', name: 'Tenant runtime viewer', scope: 'tenant', permissions: ['engine:instance:view'] },
        ] },
        './groups.json': { groups: [{ key: 'group.operations', name: 'Operations' }] },
        './engines.json': { engines: [{ key: 'engine.payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.test/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'PAYMENTS_PASSWORD' } }] },
        './engine-sets.json': { engineSets: [{ key: 'engines.payments', name: 'Payments engines', selector: { mode: 'engine_ids', engineKeys: ['engine.payments'] } }] },
        './runtime-resource-sets.json': { runtimeResourceSets: [{ key: 'runtime.payments', name: 'Payments processes', engineRef: { engineKey: 'engine.payments' }, resourceKind: 'process_definition', selector: { mode: 'prefix', prefix: 'payments-' } }] },
        './assignments.json': { assignments: [
          { key: 'assignment.tenant', principal: { type: 'group', key: 'group.operations' }, roleKey: 'custom.tenant.runtime-viewer', scope: { type: 'tenant' } },
          { key: 'assignment.engine', principal: { type: 'group', key: 'group.operations' }, roleKey: 'custom.engine.viewer', scope: { type: 'engine', engineKey: 'engine.payments' } },
          { key: 'assignment.engine-set', principal: { type: 'group', key: 'group.operations' }, roleKey: 'custom.engine.viewer', scope: { type: 'engine_set', engineSetKey: 'engines.payments' } },
          { key: 'assignment.runtime-set', principal: { type: 'group', key: 'group.operations' }, roleKey: 'custom.engine.viewer', scope: { type: 'engine_runtime_resource_set', runtimeResourceSetKey: 'runtime.payments' } },
        ] },
        './identity-providers.json': { identityProviders: [{
          key: 'identity.oidc.main', type: 'oidc', enabled: true, authenticationMode: 'claims_only',
          sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' },
          oidc: { issuerUrl: 'https://login.example.test', clientId: 'enterpriseglue', callbackUrl: 'https://app.example.test/callback', scopes: ['openid'] },
        }] },
        './identity-mappings.json': { identityMappings: [{ key: 'mapping.operations', providerKey: 'identity.oidc.main', source: { type: 'group', externalId: 'operations' }, targetGroupKey: 'group.operations' }] },
        './project-engine-targets.json': { projectEngineTargets: [{ key: 'target.payments', projectRef: { id: projectId }, engineRef: { engineKey: 'engine.payments' }, allowManualDeploy: true }] },
      },
    }, 'tenant-a');

    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result.changes.filter((change) => change.operation === 'conflict')).toEqual([]);
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'runtime_resource_set', key: 'runtime.payments', operation: 'create' }),
      expect.objectContaining({ objectType: 'identity_mapping', key: 'mapping.operations', operation: 'create', reason: expect.stringContaining('will be created') }),
      expect.objectContaining({ objectType: 'project_engine_target', key: 'target.payments', operation: 'create', reason: expect.stringContaining('will be created') }),
      expect.objectContaining({ objectType: 'assignment', key: 'assignment.tenant', operation: 'create', reason: expect.stringContaining('will be created') }),
      expect.objectContaining({ objectType: 'assignment', key: 'assignment.engine', operation: 'create', reason: expect.stringContaining('will be created') }),
      expect.objectContaining({ objectType: 'assignment', key: 'assignment.engine-set', operation: 'create', reason: expect.stringContaining('will be created') }),
      expect.objectContaining({ objectType: 'assignment', key: 'assignment.runtime-set', operation: 'create', reason: expect.stringContaining('will be created') }),
    ]));
  });

  it('fails closed when an identity mapping references no persisted or staged provider', async () => {
    mockDataSource();
    const result = await configBundleDiffService.diff({
      bundle: { ...bundle, imports: ['./groups.json', './identity-mappings.json'] },
      files: {
        './groups.json': { groups: [{ key: 'group.operations', name: 'Operations' }] },
        './identity-mappings.json': { identityMappings: [{ key: 'mapping.operations', providerKey: 'identity.oidc.missing', source: { type: 'group', externalId: 'operations' }, targetGroupKey: 'group.operations' }] },
      },
    }, 'tenant-a');

    expect(result.changes).toContainEqual(expect.objectContaining({
      objectType: 'identity_mapping', key: 'mapping.operations', operation: 'conflict', reason: expect.stringContaining('unresolved identity provider'),
    }));
  });
});
