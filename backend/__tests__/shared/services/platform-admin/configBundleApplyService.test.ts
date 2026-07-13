import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';
import { configBundleSecretPreflightService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleSecretPreflightService.js';

const { materializeRuntimeResourceSet, materializeForEngine, materializeEngineSetsForEngine } = vi.hoisted(() => ({
  materializeRuntimeResourceSet: vi.fn().mockResolvedValue({ matched: 0, created: 0, updated: 0, removed: 0 }),
  materializeForEngine: vi.fn().mockResolvedValue([]),
  materializeEngineSetsForEngine: vi.fn().mockResolvedValue([]),
}));
const replayMemberships = vi.hoisted(() => vi.fn().mockResolvedValue({ scanned: 0, created: 0, removed: 0, failed: 0, truncated: false }));
vi.mock('@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js', () => ({
  runtimeResourceInventoryService: { materialize: materializeRuntimeResourceSet, materializeForEngine },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/EngineSetService.js', () => ({
  engineSetService: { materializeEngineSet: vi.fn().mockResolvedValue({}), materializeEngineSetsForEngine },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({
  ssoNormalizedIdentityService: { replayMemberships },
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
const files = {
  './roles.json': {
    roles: [{ key: 'custom.engine.deployer', name: 'Deployer', scope: 'engine', permissions: ['engine:deploy'] }],
  },
  './groups.json': {
    groups: [{ key: 'group.deployers', name: 'Deployers' }],
  },
};

function setupDataSource() {
  const configRunRows: any[] = [];
  const configRunRepo = {
    findOne: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(configRunRows.find((row) =>
      Object.entries(where).every(([key, value]) => row[key] === value)
    ) || null)),
    insert: vi.fn().mockImplementation((row) => {
      configRunRows.push({ ...row });
      return Promise.resolve({});
    }),
    update: vi.fn().mockImplementation((where, updates) => {
      const row = configRunRows.find((candidate) => candidate.id === where.id);
      if (row) Object.assign(row, updates);
      return Promise.resolve({});
    }),
  };
  const roleInsert = vi.fn().mockResolvedValue(undefined);
  const groupInsert = vi.fn().mockResolvedValue(undefined);
  const permissionInsert = vi.fn().mockResolvedValue(undefined);
  const auditInsert = vi.fn().mockResolvedValue(undefined);
  const roleRepo = { find: vi.fn().mockResolvedValue([]), insert: roleInsert, update: vi.fn() };
  const groupRepo = { find: vi.fn().mockResolvedValue([]), insert: groupInsert, update: vi.fn() };
  const permissionRepo = { find: vi.fn().mockResolvedValue([]), insert: permissionInsert, delete: vi.fn() };
  const engineInsert = vi.fn().mockResolvedValue(undefined);
  const engineRepo = { find: vi.fn().mockResolvedValue([]), insert: engineInsert, update: vi.fn() };
  const engineSetRepo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn(), update: vi.fn() };
  const runtimeResourceSetRepo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn(), update: vi.fn() };
  const runtimeResourceSetMaterializationRepo = { find: vi.fn().mockResolvedValue([]) };
  const runtimeResourceRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
  const assignmentRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const projectRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
  const targetRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), insert: vi.fn(), update: vi.fn() };
  const providerRepo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn(), update: vi.fn() };
  const identityMappingRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), insert: vi.fn(), update: vi.fn() };
  const groupMembershipRepo = { find: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(undefined) };
  const auditRepo = { insert: auditInsert };
  const repositories = (entity: unknown) => {
    if (entity === RbacRole) return roleRepo;
    if (entity === AuthzGroup) return groupRepo;
    if (entity === Engine) return engineRepo;
    if (entity === EngineSet) return engineSetRepo;
    if (entity === RuntimeResourceSet) return runtimeResourceSetRepo;
    if (entity === RuntimeResourceSetMaterialization) return runtimeResourceSetMaterializationRepo;
    if (entity === RuntimeResource) return runtimeResourceRepo;
    if (entity === RbacRoleAssignment) return assignmentRepo;
    if (entity === Project) return projectRepo;
    if (entity === ProjectEngineTarget) return targetRepo;
    if (entity === IdentityProvider) return providerRepo;
    if (entity === IdentityEntitlementMapping) return identityMappingRepo;
    if (entity === AuthzGroupMembership) return groupMembershipRepo;
    if (entity === RbacRolePermission) return permissionRepo;
    if (entity === AuditLog) return auditRepo;
    if (entity === ConfigBundleApplyRun) return configRunRepo;
    throw new Error('Unexpected repository');
  };
  const dataSource = {
    getRepository: repositories,
    transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })),
  };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return { roleInsert, groupInsert, engineInsert, permissionInsert, auditInsert, configRunRepo, roleRepo, groupRepo, engineRepo, runtimeResourceSetRepo, projectRepo, targetRepo, providerRepo, identityMappingRepo, groupMembershipRepo, dataSource };
}

describe('configBundleApplyService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies a hash-bound role and group bundle through one transaction with audit records', async () => {
    const { roleInsert, groupInsert, permissionInsert, auditInsert } = setupDataSource();
    const preview = configBundlePreviewService.preview({ bundle, files });

    const result = await configBundleApplyService.apply({
      bundle,
      files,
      expectedPreviewHash: preview.canonicalHash!,
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    });

    expect(result).toMatchObject({
      canonicalHash: preview.canonicalHash,
      created: 2,
      updated: 0,
      archived: 0,
      reconciliation: { status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 0 },
    });
    expect(roleInsert).toHaveBeenCalledWith(expect.objectContaining({
      key: 'custom.engine.deployer',
      roleKeyIdentity: 'tenant-a:custom.engine.deployer',
      source: 'config',
      sourceRef: 'config_bundle:acme.authz',
    }));
    expect(groupInsert).toHaveBeenCalledWith(expect.objectContaining({ key: 'group.deployers', source: 'config', sourceRef: 'config_bundle:acme.authz' }));
    expect(permissionInsert).toHaveBeenCalledWith([expect.objectContaining({ permissionId: 'engine:deploy' })]);
    expect(auditInsert).toHaveBeenCalledTimes(2);
  });

  it('requires acknowledgement before an authoritative apply archives a config-owned object', async () => {
    const { groupRepo } = setupDataSource();
    groupRepo.find.mockResolvedValue([{
      id: 'group-stale', tenantId: 'tenant-a', key: 'group.stale', name: 'Stale', description: null,
      source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false,
    }]);
    const preview = configBundlePreviewService.preview({ bundle, files });

    await expect(configBundleApplyService.apply({
      bundle,
      files,
      expectedPreviewHash: preview.canonicalHash!,
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('config.authoritative_archive:group:group.stale') });
  });

  it('rejects stale or arbitrary preview hashes before opening a transaction', async () => {
    const { dataSource } = setupDataSource();
    await expect(configBundleApplyService.apply({
      bundle,
      files,
      expectedPreviewHash: 'stale-preview',
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects an apply when a checked secret reference is no longer available', async () => {
    const { dataSource } = setupDataSource();
    const engineBundle = { ...bundle, imports: ['./engines.json'] };
    const engineFiles = {
      './engines.json': {
        engines: [{ key: 'engine.payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.test/engine-rest', auth: { type: 'bearer', tokenRef: 'PAYMENTS_ENGINE_TOKEN' } }],
      },
    };
    vi.stubEnv('PAYMENTS_ENGINE_TOKEN', 'available-only-for-preflight');
    const preview = configBundlePreviewService.preview({ bundle: engineBundle, files: engineFiles });
    const secretPreflight = configBundleSecretPreflightService.check({ bundle: engineBundle, files: engineFiles });
    vi.unstubAllEnvs();

    await expect(configBundleApplyService.apply({
      bundle: engineBundle,
      files: engineFiles,
      expectedPreviewHash: preview.canonicalHash!,
      expectedSecretPreflightHash: secretPreflight.availabilityHash!,
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('Secret reference availability changed') });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects an apply when the expected tenant scope differs from the authenticated tenant', async () => {
    const { dataSource } = setupDataSource();
    const preview = configBundlePreviewService.preview({ bundle, files });

    await expect(configBundleApplyService.apply({
      bundle,
      files,
      expectedPreviewHash: preview.canonicalHash!,
      expectedTenantScope: 'tenant-b',
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('replays a completed idempotent apply and rejects the key for different bundle input', async () => {
    const { roleInsert, configRunRepo } = setupDataSource();
    const preview = configBundlePreviewService.preview({ bundle, files });
    const input = {
      bundle,
      files,
      expectedPreviewHash: preview.canonicalHash!,
      idempotencyKey: 'config-apply-2026-07-13',
      expectedTenantScope: 'tenant-a',
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    };

    const first = await configBundleApplyService.apply(input);
    const replay = await configBundleApplyService.apply(input);

    expect(first.applyRunId).toEqual(expect.any(String));
    expect(replay).toMatchObject({ idempotent: true, applyRunId: first.applyRunId, canonicalHash: preview.canonicalHash });
    expect(replay.reconciliation).toEqual(first.reconciliation);
    expect(roleInsert).toHaveBeenCalledTimes(1);
    expect(configRunRepo.insert).toHaveBeenCalledTimes(1);

    await expect(configBundleApplyService.apply({
      ...input,
      bundle: { ...bundle, metadata: { ...bundle.metadata, key: 'acme.other' } },
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('applies a config-managed engine with opaque secret references and runtime defaults', async () => {
    const { engineInsert } = setupDataSource();
    const engineBundle = { ...bundle, imports: ['./engines.json'] };
    const engineFiles = {
      './engines.json': {
        engines: [{
          key: 'engine.prod-payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.com/engine-rest',
          labels: { environment: 'prod', country: 'TR' }, auth: { type: 'basic', username: 'eg-client', passwordRef: 'PAYMENTS_ENGINE_PASSWORD' }, metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false,
        }],
      },
    };
    const preview = configBundlePreviewService.preview({ bundle: engineBundle, files: engineFiles });

    const result = await configBundleApplyService.apply({
      bundle: engineBundle, files: engineFiles, expectedPreviewHash: preview.canonicalHash!, tenantId: 'tenant-a', actorId: 'admin-1',
    });

    expect(result).toMatchObject({
      created: 1,
      updated: 0,
      archived: 0,
      reconciliation: { status: 'completed', engineSetCount: 0, runtimeResourceSetCount: 0, engineCount: 1 },
    });
    expect(engineInsert).toHaveBeenCalledWith(expect.objectContaining({
      configKey: 'engine.prod-payments', configKeyIdentity: 'tenant-a:engine.prod-payments', registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz', passwordEnc: 'ref:PAYMENTS_ENGINE_PASSWORD', runtimeAccessScope: 'engine_wide',
      deploymentIntegration: 'enterpriseglue_proxy', metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false, connectionMode: 'direct',
    }));
    expect(materializeEngineSetsForEngine).toHaveBeenCalled();
    expect(materializeForEngine).toHaveBeenCalled();
  });

  it('creates a config-owned project-engine target for an existing config engine', async () => {
    const { engineRepo, projectRepo, targetRepo } = setupDataSource();
    const engine = {
      id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.prod-payments', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz',
      name: 'Payments', baseUrl: 'https://payments.example.com/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}',
      runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active',
    };
    engineRepo.find.mockResolvedValue([engine]);
    projectRepo.find.mockResolvedValue([{ id: '00000000-0000-4000-8000-000000000001', tenantId: 'tenant-a' }]);
    projectRepo.findOne.mockResolvedValue({ id: 'project-1', tenantId: 'tenant-a' });
    const targetBundle = { ...bundle, imports: ['./engines.json', './project-engine-targets.json'] };
    const targetFiles = {
      './engines.json': { engines: [{ key: 'engine.prod-payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.com/engine-rest', auth: { type: 'basic', username: 'eg-client', passwordRef: 'PAYMENTS_ENGINE_PASSWORD' } }] },
      './project-engine-targets.json': { projectEngineTargets: [{ projectRef: { id: '00000000-0000-4000-8000-000000000001' }, engineRef: { engineKey: 'engine.prod-payments' }, allowCiDeploy: true }] },
    };
    const preview = configBundlePreviewService.preview({ bundle: targetBundle, files: targetFiles });
    await configBundleApplyService.apply({ bundle: targetBundle, files: targetFiles, expectedPreviewHash: preview.canonicalHash!, tenantId: 'tenant-a', actorId: 'admin-1' });
    expect(targetRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', engineId: 'engine-1', source: 'config', sourceRef: 'config_bundle:acme.authz', allowCiDeploy: true }));
  });

  it('applies a provider-neutral identity mapping to an existing configured provider and group', async () => {
    const { groupRepo, providerRepo, identityMappingRepo } = setupDataSource();
    groupRepo.find.mockResolvedValue([{ id: 'group-1', tenantId: 'tenant-a', key: 'group.operators', name: 'Operators', description: null, source: 'config', sourceRef: 'config_bundle:acme.authz', isArchived: false }]);
    providerRepo.find.mockResolvedValue([{ id: 'provider-1', tenantId: 'tenant-a', key: 'identity.oidc.main' }]);
    const mappingBundle = { ...bundle, imports: ['./groups.json', './identity-mappings.json'] };
    const mappingFiles = {
      './groups.json': { groups: [{ key: 'group.operators', name: 'Operators' }] },
      './identity-mappings.json': { identityMappings: [{ key: 'mapping.operators', providerKey: 'identity.oidc.main', source: { type: 'group', externalId: 'ops' }, targetGroupKey: 'group.operators' }] },
    };
    const preview = configBundlePreviewService.preview({ bundle: mappingBundle, files: mappingFiles });
    const result = await configBundleApplyService.apply({ bundle: mappingBundle, files: mappingFiles, expectedPreviewHash: preview.canonicalHash!, tenantId: 'tenant-a', actorId: 'admin-1' });
    expect(identityMappingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'provider-1', configKey: 'mapping.operators', targetGroupId: 'group-1', sourceRef: 'config_bundle:acme.authz' }));
    expect(replayMemberships).toHaveBeenCalledWith({ tenantId: 'tenant-a', providerIds: ['provider-1'] });
    expect(result.reconciliation.identitySnapshot).toEqual({ status: 'completed', providerCount: 1, scanned: 0, created: 0, removed: 0, failed: 0 });
  });

  it('cleans only the source-owned memberships when an authoritative bundle disables an identity mapping', async () => {
    const { identityMappingRepo, groupMembershipRepo } = setupDataSource();
    identityMappingRepo.find.mockResolvedValue([{
      id: 'mapping-1', tenantId: 'tenant-a', configKey: 'mapping.removed', sourceRef: 'config_bundle:acme.authz', isActive: true,
    }]);
    const mappingBundle = { ...bundle, imports: ['./identity-mappings.json'] };
    const mappingFiles = { './identity-mappings.json': { identityMappings: [] } };
    const preview = configBundlePreviewService.preview({ bundle: mappingBundle, files: mappingFiles });

    await configBundleApplyService.apply({
      bundle: mappingBundle,
      files: mappingFiles,
      expectedPreviewHash: preview.canonicalHash!,
      acknowledgements: ['config.authoritative_archive:identity_mapping:mapping.removed'],
      tenantId: 'tenant-a',
      actorId: 'admin-1',
    });

    expect(groupMembershipRepo.delete).toHaveBeenCalledWith({ source: 'identity_provider', sourceRef: 'identity_mapping:mapping-1' });
    expect(identityMappingRepo.update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({ isActive: false }));
  });

  it('applies config-owned provider-neutral identity definitions before their mappings', async () => {
    const { providerRepo } = setupDataSource();
    const providerBundle = { ...bundle, imports: ['./identity-providers.json'] };
    const providerFiles = {
      './identity-providers.json': { identityProviders: [{
        key: 'identity.oidc.main', type: 'oidc', enabled: true, authenticationMode: 'claims_only',
        sync: { triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' },
        oidc: { issuerUrl: 'https://login.example.test', clientId: 'enterpriseglue', clientSecretRef: 'secret/entra', callbackUrl: 'https://app.example.test/callback', scopes: ['openid', 'profile'] },
      }] },
    };
    const preview = configBundlePreviewService.preview({ bundle: providerBundle, files: providerFiles });
    await configBundleApplyService.apply({ bundle: providerBundle, files: providerFiles, expectedPreviewHash: preview.canonicalHash!, tenantId: 'tenant-a', actorId: 'admin-1' });
    expect(providerRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ key: 'identity.oidc.main', protocol: 'oidc', sourceRef: 'config_bundle:acme.authz' }));
  });

  it('applies a config-owned Runtime Resource Set against a configured engine', async () => {
    const { engineRepo, runtimeResourceSetRepo } = setupDataSource();
    engineRepo.find.mockResolvedValue([{ id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.central', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz' }]);
    const runtimeBundle = { ...bundle, imports: ['./engines.json', './runtime-resource-sets.json'] };
    const runtimeFiles = {
      './engines.json': { engines: [{ key: 'engine.central', name: 'Central', type: 'operaton', baseUrl: 'https://central.example.com/engine-rest', auth: { type: 'basic', username: 'eg', passwordRef: 'CENTRAL_PASSWORD' } }] },
      './runtime-resource-sets.json': { runtimeResourceSets: [{ key: 'runtime.payments', name: 'Payments processes', engineRef: { engineKey: 'engine.central' }, resourceKind: 'process_definition', selector: { mode: 'prefix', prefix: 'payments-' } }] },
    };
    const preview = configBundlePreviewService.preview({ bundle: runtimeBundle, files: runtimeFiles });
    await configBundleApplyService.apply({ bundle: runtimeBundle, files: runtimeFiles, expectedPreviewHash: preview.canonicalHash!, tenantId: 'tenant-a', actorId: 'admin-1' });
    expect(runtimeResourceSetRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ key: 'runtime.payments', engineId: 'engine-1', resourceKind: 'process_definition', source: 'config', sourceRef: 'config_bundle:acme.authz' }));
    expect(materializeRuntimeResourceSet).toHaveBeenCalledWith(expect.any(String), 'tenant-a');
  });
});
