import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { RbacRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRole.js';
import { RbacRolePermission } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRolePermission.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { SsoProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { configBundleApplyService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleApplyService.js';
import { configBundlePreviewService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundlePreviewService.js';

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
  const assignmentRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const projectRepo = { findOne: vi.fn().mockResolvedValue(null) };
  const targetRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), insert: vi.fn(), update: vi.fn() };
  const providerRepo = { find: vi.fn().mockResolvedValue([]) };
  const identityMappingRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null), insert: vi.fn(), update: vi.fn() };
  const auditRepo = { insert: auditInsert };
  const repositories = (entity: unknown) => {
    if (entity === RbacRole) return roleRepo;
    if (entity === AuthzGroup) return groupRepo;
    if (entity === Engine) return engineRepo;
    if (entity === EngineSet) return engineSetRepo;
    if (entity === RbacRoleAssignment) return assignmentRepo;
    if (entity === Project) return projectRepo;
    if (entity === ProjectEngineTarget) return targetRepo;
    if (entity === SsoProvider) return providerRepo;
    if (entity === IdentityEntitlementMapping) return identityMappingRepo;
    if (entity === RbacRolePermission) return permissionRepo;
    if (entity === AuditLog) return auditRepo;
    throw new Error('Unexpected repository');
  };
  const dataSource = {
    getRepository: repositories,
    transaction: vi.fn(async (callback: any) => callback({ getRepository: repositories })),
  };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return { roleInsert, groupInsert, engineInsert, permissionInsert, auditInsert, roleRepo, groupRepo, engineRepo, projectRepo, targetRepo, providerRepo, identityMappingRepo, dataSource };
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

    expect(result).toMatchObject({ canonicalHash: preview.canonicalHash, created: 2, updated: 0, archived: 0 });
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

  it('applies a config-managed engine with opaque secret references and runtime defaults', async () => {
    const { engineInsert } = setupDataSource();
    const engineBundle = { ...bundle, imports: ['./engines.json'] };
    const engineFiles = {
      './engines.json': {
        engines: [{
          key: 'engine.prod-payments', name: 'Payments', type: 'operaton', baseUrl: 'https://payments.example.com/engine-rest',
          labels: { environment: 'prod', country: 'TR' }, auth: { type: 'basic', username: 'eg-client', passwordRef: 'PAYMENTS_ENGINE_PASSWORD' },
        }],
      },
    };
    const preview = configBundlePreviewService.preview({ bundle: engineBundle, files: engineFiles });

    const result = await configBundleApplyService.apply({
      bundle: engineBundle, files: engineFiles, expectedPreviewHash: preview.canonicalHash!, tenantId: 'tenant-a', actorId: 'admin-1',
    });

    expect(result).toMatchObject({ created: 1, updated: 0, archived: 0 });
    expect(engineInsert).toHaveBeenCalledWith(expect.objectContaining({
      configKey: 'engine.prod-payments', configKeyIdentity: 'tenant-a:engine.prod-payments', registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz', passwordEnc: 'ref:PAYMENTS_ENGINE_PASSWORD', runtimeAccessScope: 'engine_wide',
      deploymentIntegration: 'enterpriseglue_proxy', connectionMode: 'direct',
    }));
  });

  it('creates a config-owned project-engine target for an existing config engine', async () => {
    const { engineRepo, projectRepo, targetRepo } = setupDataSource();
    const engine = {
      id: 'engine-1', tenantId: 'tenant-a', configKey: 'engine.prod-payments', registrationSource: 'config', sourceRef: 'config_bundle:acme.authz',
      name: 'Payments', baseUrl: 'https://payments.example.com/engine-rest', type: 'operaton', externalId: null, labelsJson: '{}',
      runtimeAccessScope: 'engine_wide', deploymentIntegration: 'enterpriseglue_proxy', connectionMode: 'direct', ownershipMode: 'config_locked', lifecycleStatus: 'active',
    };
    engineRepo.find.mockResolvedValue([engine]);
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
    providerRepo.find.mockResolvedValue([{ id: 'provider-1', tenantId: 'tenant-a', configKey: 'identity.oidc.main' }]);
    const mappingBundle = { ...bundle, imports: ['./groups.json', './identity-mappings.json'] };
    const mappingFiles = {
      './groups.json': { groups: [{ key: 'group.operators', name: 'Operators' }] },
      './identity-mappings.json': { identityMappings: [{ key: 'mapping.operators', providerKey: 'identity.oidc.main', source: { type: 'group', externalId: 'ops' }, targetGroupKey: 'group.operators' }] },
    };
    const preview = configBundlePreviewService.preview({ bundle: mappingBundle, files: mappingFiles });
    await configBundleApplyService.apply({ bundle: mappingBundle, files: mappingFiles, expectedPreviewHash: preview.canonicalHash!, tenantId: 'tenant-a', actorId: 'admin-1' });
    expect(identityMappingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'provider-1', configKey: 'mapping.operators', targetGroupId: 'group-1', sourceRef: 'config_bundle:acme.authz' }));
  });
});
