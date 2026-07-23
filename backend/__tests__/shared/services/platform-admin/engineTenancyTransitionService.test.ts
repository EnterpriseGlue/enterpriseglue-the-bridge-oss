import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { ProjectEngineTarget } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectEngineTarget.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { DeploymentReceipt } from '@enterpriseglue/shared/infrastructure/persistence/entities/DeploymentReceipt.js';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { EngineTenancyTransitionService } from '@enterpriseglue/shared/services/platform-admin/EngineTenancyTransitionService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const service = new EngineTenancyTransitionService();

function engine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'engine-1',
    name: 'Engine 1',
    tenancyMode: 'dedicated',
    tenantId: 'tenant-default',
    tenantMappingStrategy: null,
    tenantMappingVersion: 0,
    tenantResolutionStatus: 'ready',
    runtimeAccessScope: 'engine_wide',
    registrationSource: 'user',
    ownershipMode: 'manual',
    managementMode: 'manual',
    fieldOwnershipJson: null,
    updatedAt: 10,
    ...overrides,
  };
}

function setup(input: {
  engine?: Record<string, unknown> | null;
  engines?: Array<Record<string, unknown>>;
  resources?: Array<Record<string, unknown>>;
  mappings?: Array<Record<string, unknown>>;
  counts?: Partial<Record<'assignments' | 'tenantAssignments' | 'engineSetAssignments' | 'runtimeAssignments' | 'runtimeSetAssignments' | 'engineSets' | 'targets' | 'receipts', number>>;
} = {}) {
  const currentEngine = input.engine === undefined ? engine() : input.engine;
  const engines = input.engines || (currentEngine ? [currentEngine] : []);
  const resources = input.resources || [];
  const mappings = input.mappings || [];
  const counts = {
    assignments: 0,
    tenantAssignments: 0,
    engineSetAssignments: 0,
    runtimeAssignments: 0,
    runtimeSetAssignments: 0,
    engineSets: 0,
    targets: 0,
    receipts: 0,
    ...input.counts,
  };
  let assignmentQueryIndex = 0;
  const assignmentRepo = {
    find: vi.fn().mockImplementation(async (options: any) => {
      const scopeType = options?.where?.scopeType;
      const [count, prefix] = scopeType === 'tenant'
        ? [counts.tenantAssignments, 'tenant']
        : scopeType === 'engine_set'
          ? [counts.engineSetAssignments, 'engine-set']
          : [counts.assignments, 'direct'];
      return Array.from({ length: count }, (_, index) => ({
        id: `assignment-${prefix}-${index}`,
        updatedAt: 10 + index,
      }));
    }),
    createQueryBuilder: vi.fn(() => {
      const runtimeResourceScope = assignmentQueryIndex++ % 2 === 0;
      const rowCount = runtimeResourceScope ? counts.runtimeAssignments : counts.runtimeSetAssignments;
      const builder: any = {
        innerJoin: vi.fn(() => builder),
        where: vi.fn(() => builder),
        andWhere: vi.fn(() => builder),
        getMany: vi.fn().mockResolvedValue(Array.from({ length: rowCount }, (_, index) => ({
          id: `assignment-${runtimeResourceScope ? 'resource' : 'set'}-${index}`,
          updatedAt: 20 + index,
        }))),
      };
      return builder;
    }),
  };
  const engineRepo = {
    findOne: vi.fn().mockResolvedValue(currentEngine),
    find: vi.fn().mockResolvedValue(engines),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  const resourceRepo = {
    find: vi.fn().mockResolvedValue(resources),
    update: vi.fn(),
  };
  const mappingRepo = {
    find: vi.fn().mockResolvedValue(mappings),
    update: vi.fn(),
  };
  const engineSetRepo = {
    find: vi.fn().mockResolvedValue(Array.from({ length: counts.engineSets }, (_, index) => ({
      id: `engine-set-${index}`,
      engineSetId: `set-${index}`,
      updatedAt: 30 + index,
    }))),
    delete: vi.fn(),
  };
  const targetRepo = {
    find: vi.fn().mockResolvedValue(Array.from({ length: counts.targets }, (_, index) => ({
      id: `target-${index}`,
      updatedAt: 40 + index,
    }))),
  };
  const receiptRepo = {
    find: vi.fn().mockResolvedValue(Array.from({ length: counts.receipts }, (_, index) => ({
      id: `receipt-${index}`,
      receivedAt: 50 + index,
    }))),
  };
  const execute = vi.fn();
  const materializationBuilder: any = {
    delete: vi.fn(() => materializationBuilder),
    where: vi.fn(() => materializationBuilder),
    execute,
  };
  const runtimeSetMaterializationRepo = {
    createQueryBuilder: vi.fn(() => materializationBuilder),
  };
  const store = {
    getRepository(entity: unknown) {
      if (entity === Engine) return engineRepo;
      if (entity === RuntimeResource) return resourceRepo;
      if (entity === EngineTenantMapping) return mappingRepo;
      if (entity === RbacRoleAssignment) return assignmentRepo;
      if (entity === EngineSetMaterialization) return engineSetRepo;
      if (entity === ProjectEngineTarget) return targetRepo;
      if (entity === DeploymentReceipt) return receiptRepo;
      if (entity === RuntimeResourceSetMaterialization) return runtimeSetMaterializationRepo;
      throw new Error(`Unexpected repository: ${String(entity)}`);
    },
  };
  const dataSource = {
    ...store,
    transaction: vi.fn(async (callback) => callback(store)),
  };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return {
    dataSource,
    engineRepo,
    resourceRepo,
    mappingRepo,
    engineSetRepo,
    runtimeSetMaterializationRepo,
    materializationBuilder,
  };
}

function context() {
  return {
    requestTenantId: 'tenant-default',
    principalType: 'user' as const,
    principalId: 'user-1',
  };
}

function expectCode(error: unknown, code: string, statusCode: number) {
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code, statusCode, field: 'tenancy' });
}

describe('EngineTenancyTransitionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
  });

  it('previews a fingerprinted dedicated-to-shared transition with complete effects', async () => {
    setup({
      resources: [
        { id: 'resource-1', tenantId: 'tenant-default', tenantResolutionStatus: 'resolved', tenantMappingId: null, tenantMappingVersion: 0, updatedAt: 10 },
        { id: 'resource-2', tenantId: null, tenantResolutionStatus: 'conflict', tenantMappingId: null, tenantMappingVersion: 0, updatedAt: 11 },
      ],
      counts: {
        assignments: 1,
        tenantAssignments: 2,
        engineSetAssignments: 1,
        runtimeAssignments: 2,
        runtimeSetAssignments: 3,
        engineSets: 4,
        targets: 5,
        receipts: 6,
      },
    });
    const result = await service.preview('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
    }, context());

    expect(result).toMatchObject({
      engineId: 'engine-1',
      kind: 'dedicated_to_shared',
      proposed: {
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'engine_tenant_id',
        mappingVersion: 1,
        resolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      },
      effects: {
        roleAssignments: 9,
        runtimeResources: 2,
        engineSetMemberships: 4,
        deploymentTargets: 5,
        deploymentReceipts: 6,
      },
      previewExpiresAt: 301_000,
    });
    expect(result.previewHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects missing engines, equivalent topology, expired, stale, and unacknowledged apply requests', async () => {
    setup({ engine: null });
    await expect(service.preview('missing', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
    }, context())).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    setup();
    await service.preview('engine-1', {
      tenancy: { mode: 'dedicated' },
    }, context()).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_TRANSITION_REQUIRED', 400),
    );

    setup();
    await service.apply('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      previewHash: 'a'.repeat(64),
      previewExpiresAt: 999,
      acknowledgements: [],
    }, context()).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_PREVIEW_EXPIRED', 409),
    );

    setup();
    await service.apply('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      previewHash: 'a'.repeat(64),
      previewExpiresAt: 301_000,
      acknowledgements: [],
    }, context()).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_PREVIEW_STALE', 409),
    );

    setup();
    const preview = await service.preview('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
    }, context());
    await service.apply('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: [],
    }, context()).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED', 400),
    );
  });

  it('atomically applies a dedicated-to-shared transition and invalidates materializations', async () => {
    const state = setup({
      resources: [{
        id: 'resource-1',
        tenantId: 'tenant-default',
        tenantResolutionStatus: 'resolved',
        tenantMappingId: null,
        tenantMappingVersion: 0,
        updatedAt: 10,
      }],
    });
    const preview = await service.preview('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'deployment_target' },
    }, context());
    const result = await service.apply('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'deployment_target' },
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: preview.requiredAcknowledgements,
    }, context());

    expect(result).toMatchObject({ applied: true, appliedAt: 1_000, previewHash: preview.previewHash });
    expect(state.resourceRepo.update).toHaveBeenCalledWith(
      { engineId: 'engine-1', isActive: true },
      expect.objectContaining({
        tenantId: null,
        tenantResolutionStatus: 'unmapped',
        tenantMappingVersion: 1,
        tenantResolutionDetailsJson: '{"code":"topology_transition_requires_mapping"}',
      }),
    );
    expect(state.engineRepo.update).toHaveBeenCalledWith({ id: 'engine-1', updatedAt: 10 }, expect.objectContaining({
      tenancyMode: 'shared',
      tenantId: null,
      tenantMappingStrategy: 'deployment_target',
      tenantMappingVersion: 1,
      runtimeAccessScope: 'resource_aware',
    }));
    expect(state.engineSetRepo.delete).toHaveBeenCalledWith({ engineId: 'engine-1' });
    expect(state.materializationBuilder.where).toHaveBeenCalledWith(
      'runtime_resource_id IN (:...resourceIds)',
      { resourceIds: ['resource-1'] },
    );
    expect(state.mappingRepo.update).not.toHaveBeenCalled();
  });

  it('deactivates shared mappings and resolves all inventory during shared-to-dedicated apply', async () => {
    const state = setup({
      engine: engine({
        tenancyMode: 'shared',
        tenantId: null,
        tenantMappingStrategy: 'explicit',
        tenantMappingVersion: 4,
        tenantResolutionStatus: 'ready',
        runtimeAccessScope: 'resource_aware',
      }),
      mappings: [{
        id: 'mapping-1',
        strategy: 'explicit',
        externalTenantId: 'orders',
        enterpriseTenantId: 'tenant-default',
        source: 'manual',
        sourceRef: 'manual:orders',
        isActive: true,
        updatedAt: 10,
      }],
      resources: [],
    });
    const preview = await service.preview('engine-1', {
      tenancy: { mode: 'dedicated' },
    }, context());
    const result = await service.apply('engine-1', {
      tenancy: { mode: 'dedicated' },
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: preview.requiredAcknowledgements,
    }, context());

    expect(result.transition.kind).toBe('shared_to_dedicated');
    expect(state.mappingRepo.update).toHaveBeenCalledWith(
      { engineId: 'engine-1', isActive: true },
      { isActive: false, updatedAt: 1_000 },
    );
    expect(state.resourceRepo.update).toHaveBeenCalledWith(
      { engineId: 'engine-1', isActive: true },
      expect.objectContaining({
        tenantId: 'tenant-default',
        tenantResolutionStatus: 'resolved',
        tenantMappingVersion: 0,
        tenantResolutionDetailsJson: '{"code":"dedicated_engine_tenant"}',
      }),
    );
    expect(state.runtimeSetMaterializationRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rolls back when the engine changes during optimistic apply', async () => {
    const state = setup();
    const preview = await service.preview('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
    }, context());
    state.engineRepo.update.mockResolvedValueOnce({ affected: 0 });

    await service.apply('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: preview.requiredAcknowledgements,
    }, context()).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_PREVIEW_STALE', 409),
    );
    expect(state.resourceRepo.update).not.toHaveBeenCalled();
    expect(state.engineSetRepo.delete).not.toHaveBeenCalled();
  });

  it('marks an allowed config-warn transition as manual topology drift', async () => {
    const state = setup({
      engine: engine({
        registrationSource: 'config',
        ownershipMode: 'config_warn',
        driftStatus: 'in_sync',
      }),
    });
    const preview = await service.preview('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
    }, context());

    await service.apply('engine-1', {
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      previewHash: preview.previewHash,
      previewExpiresAt: preview.previewExpiresAt,
      acknowledgements: preview.requiredAcknowledgements,
    }, context());

    expect(state.engineRepo.update).toHaveBeenCalledWith(
      { id: 'engine-1', updatedAt: 10 },
      expect.objectContaining({ driftStatus: 'manual_override' }),
    );
  });

  it('builds a complete operator classification report without changing data', async () => {
    setup({
      engines: [
        engine({ id: 'dedicated', name: 'A', tenantId: 'tenant-a' }),
        engine({ id: 'legacy', name: 'B', tenantId: null }),
        engine({ id: 'ambiguous', name: 'C', tenantId: null, runtimeAccessScope: 'resource_aware' }),
        engine({ id: 'invalid', name: 'D', tenancyMode: 'shared', tenantId: 'tenant-a', tenantMappingStrategy: null }),
      ],
    });
    const result = await service.classificationReport(' default-tenant-id ');
    expect(result).toMatchObject({
      generatedAt: 1_000,
      defaultTenantId: 'tenant-default',
      totals: {
        engines: 4,
        classified: 1,
        readyForApply: 1,
        requiresReview: 1,
        conflicts: 1,
      },
    });
    expect(result.rows.map((row) => row.status)).toEqual([
      'classified',
      'ready_for_apply',
      'requires_review',
      'conflict',
    ]);
  });
});
