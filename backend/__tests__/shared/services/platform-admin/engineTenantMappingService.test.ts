import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { EngineTenantMappingService } from '@enterpriseglue/shared/services/platform-admin/EngineTenantMappingService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const service = new EngineTenantMappingService();

function sharedEngine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'engine-1',
    externalId: 'central-1',
    tenancyMode: 'shared',
    tenantId: null,
    tenantMappingStrategy: 'engine_tenant_id',
    tenantMappingVersion: 2,
    tenantResolutionStatus: 'incomplete',
    lastTenantReconciledAt: null,
    updatedAt: 1,
    ...overrides,
  };
}

function setup(input: {
  engine?: Record<string, unknown> | null;
  lockedEngine?: Record<string, unknown> | null;
  mappings?: Array<Record<string, unknown>>;
  resources?: Array<Record<string, unknown>>;
} = {}) {
  const engine = input.engine === undefined ? sharedEngine() : input.engine;
  const lockedEngine = input.lockedEngine === undefined ? engine : input.lockedEngine;
  const mappings = [...(input.mappings || [])];
  const resources = [...(input.resources || [])];
  const engineFindOne = vi.fn()
    .mockResolvedValueOnce(engine)
    .mockResolvedValue(lockedEngine);
  const engineRepo = { findOne: engineFindOne, update: vi.fn() };
  const mappingRepo = {
    find: vi.fn().mockImplementation(async () => [...mappings]),
    insert: vi.fn().mockImplementation(async (row) => mappings.push(row)),
    update: vi.fn(),
  };
  const resourceRepo = {
    find: vi.fn().mockImplementation(async () => resources),
    update: vi.fn(),
  };
  const store = {
    getRepository(entity: unknown) {
      if (entity === Engine) return engineRepo;
      if (entity === EngineTenantMapping) return mappingRepo;
      if (entity === RuntimeResource) return resourceRepo;
      throw new Error('Unexpected repository');
    },
  };
  const dataSource = {
    ...store,
    transaction: vi.fn(async (callback) => callback(store)),
  };
  (getDataSource as unknown as Mock).mockResolvedValue(dataSource);
  return { dataSource, engineRepo, mappingRepo, resourceRepo, mappings, resources };
}

function request(
  mappings: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    expectedMappingVersion: 2,
    mappings,
    ...overrides,
  } as any;
}

function mapping(externalTenantId: string, overrides: Record<string, unknown> = {}) {
  return {
    externalTenantId,
    tenantRef: { type: 'default' },
    strategy: 'engine_tenant_id',
    sourceRef: `source:${externalTenantId}`,
    active: true,
    ...overrides,
  };
}

function expectCode(error: unknown, code: string, statusCode: number) {
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code, statusCode, field: 'mappings' });
}

describe('EngineTenantMappingService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists shared mappings in stable order and rejects missing or dedicated engines', async () => {
    const rows = [{ id: 'mapping-1' }];
    const state = setup({ mappings: rows });
    await expect(service.list('engine-1')).resolves.toEqual(rows);
    expect(state.mappingRepo.find).toHaveBeenCalledWith({
      where: { engineId: 'engine-1' },
      order: { strategy: 'ASC', externalTenantId: 'ASC', source: 'ASC', sourceRef: 'ASC' },
    });

    setup({ engine: null });
    await expect(service.list('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    setup({ engine: sharedEngine({ tenancyMode: 'dedicated' }) });
    await service.list('engine-1').then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_CONFLICT', 400),
    );
  });

  it('returns sanitized aggregate diagnostics', async () => {
    setup({
      engine: sharedEngine({
        tenantMappingVersion: 5,
        tenantResolutionStatus: 'conflict',
        lastTenantReconciledAt: '100',
      }),
      resources: [
        { tenantResolutionStatus: 'resolved' },
        { tenantResolutionStatus: 'unmapped' },
        { tenantResolutionStatus: 'conflict' },
      ],
    });

    await expect(service.getDiagnostics('engine-1')).resolves.toEqual({
      mode: 'shared',
      tenantId: null,
      mappingStrategy: 'engine_tenant_id',
      mappingVersion: 5,
      resolutionStatus: 'conflict',
      lastReconciledAt: 100,
      mappedResourceCount: 1,
      unmappedResourceCount: 1,
      conflictingResourceCount: 1,
    });

    setup({
      engine: sharedEngine({
        tenantMappingVersion: undefined,
        lastTenantReconciledAt: null,
      }),
    });
    await expect(service.getDiagnostics('engine-1')).resolves.toMatchObject({
      mappingVersion: 0,
      lastReconciledAt: null,
    });

    setup({ engine: null });
    await expect(service.getDiagnostics('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
  });

  it('dry-runs an atomic mapping and runtime resolution without database writes', async () => {
    const state = setup({
      resources: [{
        id: 'resource-1',
        runtimeTenantId: 'runtime-a',
        projectId: null,
        tenantResolutionStatus: 'unmapped',
      }],
    });

    const result = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')], { dryRun: true }),
      requestTenantId: 'tenant-default',
      principalType: 'user',
      principalId: 'user-1',
      source: 'manual',
      ownershipMode: 'manual',
    });

    expect(result).toMatchObject({
      dryRun: true,
      mappingVersion: 3,
      created: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      diagnostics: {
        resolutionStatus: 'ready',
        mappedResourceCount: 1,
        unmappedResourceCount: 0,
      },
    });
    expect(state.mappingRepo.insert).not.toHaveBeenCalled();
    expect(state.resourceRepo.update).not.toHaveBeenCalled();
    expect(state.engineRepo.update).not.toHaveBeenCalled();
    expect(state.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('atomically creates a mapping, resolves inventory, advances version, and records readiness', async () => {
    const state = setup({
      resources: [{
        id: 'resource-1',
        runtimeTenantId: 'runtime-a',
        projectId: null,
        tenantResolutionStatus: 'unmapped',
      }],
    });

    const result = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')]),
      requestTenantId: null,
      principalType: 'api_client',
      principalId: 'client-1',
      source: 'external',
      ownershipMode: 'external_managed',
    });

    expect(result).toMatchObject({
      dryRun: false,
      mappingVersion: 3,
      created: 1,
      diagnostics: { resolutionStatus: 'ready', mappedResourceCount: 1 },
    });
    expect(state.mappingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1',
      externalTenantId: 'runtime-a',
      enterpriseTenantId: 'tenant-default',
      tenantReferenceJson: '{"type":"default"}',
      source: 'external',
      ownershipMode: 'external_managed',
      isActive: true,
    }));
    expect(state.resourceRepo.update).toHaveBeenCalledWith({ id: 'resource-1' }, expect.objectContaining({
      tenantId: 'tenant-default',
      tenantResolutionStatus: 'resolved',
      tenantMappingVersion: 3,
      tenantResolutionDetailsJson: '{"code":"shared_engine_mapping"}',
    }));
    expect(state.engineRepo.update).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      tenantMappingVersion: 3,
      tenantResolutionStatus: 'ready',
      lastTenantReconciledAt: expect.any(Number),
    }));
  });

  it('updates, deactivates, and no-ops source-owned mappings deterministically', async () => {
    const existing = {
      id: 'mapping-1',
      engineId: 'engine-1',
      externalTenantId: 'runtime-a',
      enterpriseTenantId: 'tenant-default',
      tenantReferenceJson: '{"type":"default"}',
      strategy: 'engine_tenant_id',
      source: 'manual',
      sourceRef: 'source:runtime-a',
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const state = setup({ mappings: [existing] });

    const noop = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    });
    expect(noop).toMatchObject({ mappingVersion: 2, unchanged: 1 });
    expect(state.engineRepo.update).not.toHaveBeenCalled();

    const deactivated = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a', { active: false })]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    });
    expect(deactivated).toMatchObject({ mappingVersion: 3, deactivated: 1 });
    expect(state.mappingRepo.update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({
      isActive: false,
    }));

    setup();
    const absent = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-missing', { active: false })]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    });
    expect(absent).toMatchObject({ mappingVersion: 2, unchanged: 1 });
  });

  it('resolves deployment-target resources from project lineage', async () => {
    const state = setup({
      engine: sharedEngine({ tenantMappingStrategy: 'deployment_target' }),
      lockedEngine: sharedEngine({ tenantMappingStrategy: 'deployment_target' }),
      resources: [{ id: 'resource-1', projectId: 'project-a', runtimeTenantId: '', tenantResolutionStatus: 'unmapped' }],
    });
    const result = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('project-a', { strategy: 'deployment_target' })]),
      principalType: 'system',
      source: 'config',
      ownershipMode: 'config_locked',
    });
    expect(result.diagnostics.mappedResourceCount).toBe(1);
    expect(state.resourceRepo.update).toHaveBeenCalledWith({ id: 'resource-1' }, expect.objectContaining({
      tenantResolutionStatus: 'resolved',
    }));

    setup({
      engine: sharedEngine({ tenantMappingStrategy: 'deployment_target' }),
      lockedEngine: sharedEngine({ tenantMappingStrategy: 'deployment_target' }),
      resources: [{ id: 'resource-without-project', projectId: null, runtimeTenantId: null }],
    });
    await expect(service.upsert({
      engineId: 'engine-1',
      request: request([mapping('', { strategy: 'deployment_target' })], { dryRun: true }),
      principalType: 'system',
      source: 'config',
      ownershipMode: 'config_locked',
    })).resolves.toMatchObject({
      diagnostics: { mappedResourceCount: 1 },
    });
  });

  it('normalizes legacy zero values and writes mixed create/no-op batches atomically', async () => {
    const state = setup({
      engine: sharedEngine({ externalId: null, tenantMappingVersion: undefined }),
      lockedEngine: sharedEngine({ externalId: null, tenantMappingVersion: undefined }),
      resources: [{ id: 'resource-without-runtime-tenant', runtimeTenantId: null, projectId: null }],
    });

    const result = await service.upsert({
      engineId: 'engine-1',
      request: request([
        mapping(''),
        mapping('inactive-absent', { active: false }),
      ], { expectedMappingVersion: 0 }),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    });

    expect(result).toMatchObject({
      externalId: '',
      mappingVersion: 1,
      created: 1,
      unchanged: 1,
      diagnostics: { mappedResourceCount: 1 },
    });
    expect(result.results[1]).toMatchObject({ status: 'noop', mappingId: null });
    expect(state.mappingRepo.insert).toHaveBeenCalledTimes(1);
    expect(state.mappingRepo.update).not.toHaveBeenCalled();
  });

  it('rejects stale versions, invalid strategies, duplicate batches, and source ownership conflicts', async () => {
    setup();
    await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')], { expectedMappingVersion: 1 }),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANT_MAPPING_VERSION_CONFLICT', 409),
    );

    setup();
    await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a', { strategy: 'explicit' })]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_CONFLICT', 400),
    );

    setup();
    await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a'), mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_CONFLICT', 400),
    );

    setup({
      mappings: [{
        id: 'mapping-1',
        engineId: 'engine-1',
        externalTenantId: 'runtime-a',
        enterpriseTenantId: 'tenant-default',
        tenantReferenceJson: '{"type":"default"}',
        strategy: 'engine_tenant_id',
        source: 'config',
        sourceRef: 'config:runtime-a',
        ownershipMode: 'config_locked',
        isActive: true,
      }],
    });
    await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_CONFLICT', 409),
    );
  });

  it('detects a concurrent mapping-version change inside the transaction', async () => {
    setup({
      lockedEngine: sharedEngine({ tenantMappingVersion: 3 }),
    });
    await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANT_MAPPING_VERSION_CONFLICT', 409),
    );

    setup({ lockedEngine: null });
    await expect(service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  it('rejects an upsert for a missing engine and mismatched identity/source rows', async () => {
    setup({ engine: null });
    await expect(service.upsert({
      engineId: 'missing',
      request: request([mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    setup({ engine: sharedEngine({ tenancyMode: 'dedicated', tenantMappingStrategy: null }) });
    await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_CONFLICT', 400),
    );

    setup({
      mappings: [
        {
          id: 'mapping-identity',
          engineId: 'engine-1',
          externalTenantId: 'runtime-a',
          enterpriseTenantId: 'tenant-default',
          tenantReferenceJson: '{"type":"default"}',
          strategy: 'engine_tenant_id',
          source: 'manual',
          sourceRef: 'source:other',
          ownershipMode: 'manual',
          isActive: true,
        },
        {
          id: 'mapping-source',
          engineId: 'engine-1',
          externalTenantId: 'runtime-b',
          enterpriseTenantId: 'tenant-default',
          tenantReferenceJson: '{"type":"default"}',
          strategy: 'engine_tenant_id',
          source: 'manual',
          sourceRef: 'source:runtime-a',
          ownershipMode: 'manual',
          isActive: true,
        },
      ],
    });
    await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_CONFLICT', 409),
    );
  });

  it('updates a mapping tenant through an authorized resolver and quarantines duplicate legacy matches', async () => {
    const existing = {
      id: 'mapping-1',
      engineId: 'engine-1',
      externalTenantId: 'runtime-a',
      enterpriseTenantId: 'tenant-default',
      tenantReferenceJson: '{"type":"default"}',
      strategy: 'engine_tenant_id',
      source: 'manual',
      sourceRef: 'source:runtime-a',
      ownershipMode: 'manual',
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    const updatedState = setup({ mappings: [existing] });
    const updated = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a', {
        tenantRef: { type: 'key', key: 'tenant.team-b' },
      })]),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
      resolver: {
        resolve: vi.fn().mockResolvedValue({
          tenantId: 'tenant-b',
          tenantKey: 'tenant.team-b',
          authorized: true,
        }),
      },
    });
    expect(updated).toMatchObject({ mappingVersion: 3, updated: 1 });
    expect(updatedState.mappingRepo.update).toHaveBeenCalledWith({ id: 'mapping-1' }, expect.objectContaining({
      enterpriseTenantId: 'tenant-b',
      isActive: true,
    }));

    const conflictState = setup({
      mappings: [
        { ...existing, id: 'mapping-1' },
        { ...existing, id: 'mapping-2', sourceRef: 'source:duplicate' },
      ],
      resources: [{ id: 'resource-1', runtimeTenantId: 'runtime-a', projectId: null }],
    });
    const conflict = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-missing', { active: false })], { dryRun: true }),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    });
    expect(conflict.diagnostics).toMatchObject({
      resolutionStatus: 'conflict',
      conflictingResourceCount: 1,
    });
    expect(conflictState.resourceRepo.update).not.toHaveBeenCalled();

    setup({
      resources: [{ id: 'resource-unmapped', runtimeTenantId: 'runtime-z', projectId: null }],
    });
    const unmapped = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a')], { dryRun: true }),
      principalType: 'user',
      source: 'manual',
      ownershipMode: 'manual',
    });
    expect(unmapped.diagnostics).toMatchObject({
      resolutionStatus: 'incomplete',
      mappedResourceCount: 0,
      unmappedResourceCount: 1,
      conflictingResourceCount: 0,
    });
  });

  it('allows a manual config-warning override while preserving config ownership', async () => {
    const state = setup({
      mappings: [{
        id: 'mapping-config-warn',
        engineId: 'engine-1',
        externalTenantId: 'runtime-a',
        enterpriseTenantId: 'tenant-default',
        tenantReferenceJson: '{"type":"default"}',
        strategy: 'engine_tenant_id',
        source: 'config',
        sourceRef: 'config_bundle:acme:engine_tenant_mapping:engine-tenant-mapping.runtime-a',
        ownershipMode: 'config_warn',
        sourceHash: 'applied-hash',
        lastAppliedAt: 10,
        isActive: true,
        createdAt: 1,
        updatedAt: 1,
      }],
    });

    const result = await service.upsert({
      engineId: 'engine-1',
      request: request([mapping('runtime-a', {
        sourceRef: 'manual:operator-override',
        active: false,
      })]),
      principalType: 'user',
      principalId: 'admin-1',
      source: 'manual',
      ownershipMode: 'manual',
    });

    expect(result).toMatchObject({ deactivated: 1, mappingVersion: 3 });
    expect(state.mappingRepo.update).toHaveBeenCalledWith(
      { id: 'mapping-config-warn' },
      expect.objectContaining({
        source: 'config',
        sourceRef: 'config_bundle:acme:engine_tenant_mapping:engine-tenant-mapping.runtime-a',
        ownershipMode: 'config_warn',
        sourceHash: 'applied-hash',
        tenantReferenceJson: '{"type":"default"}',
        isActive: false,
      }),
    );
  });

  it('reconciles config-written mappings inside the caller transaction', async () => {
    const existing = {
      id: 'mapping-1',
      engineId: 'engine-1',
      externalTenantId: 'runtime-a',
      enterpriseTenantId: 'tenant-a',
      tenantReferenceJson: '{"type":"id","id":"tenant-a"}',
      strategy: 'engine_tenant_id',
      source: 'config',
      sourceRef: 'config:runtime-a',
      ownershipMode: 'config_locked',
      isActive: true,
    };
    const state = setup({
      mappings: [existing],
      resources: [{
        id: 'resource-resolved',
        runtimeTenantId: 'runtime-a',
        projectId: null,
      }, {
        id: 'resource-unmapped',
        runtimeTenantId: 'runtime-b',
        projectId: null,
      }],
    });

    const result = await service.reconcileInStore('engine-1', state.dataSource as any);

    expect(result).toMatchObject({
      mappingVersion: 3,
      resolutionStatus: 'incomplete',
      mappedResourceCount: 1,
      unmappedResourceCount: 1,
      conflictingResourceCount: 0,
    });
    expect(state.resourceRepo.update).toHaveBeenCalledWith(
      { id: 'resource-resolved' },
      expect.objectContaining({
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
        tenantMappingId: 'mapping-1',
        tenantMappingVersion: 3,
      }),
    );
    expect(state.resourceRepo.update).toHaveBeenCalledWith(
      { id: 'resource-unmapped' },
      expect.objectContaining({
        tenantId: null,
        tenantResolutionStatus: 'unmapped',
        tenantMappingId: null,
        tenantMappingVersion: 3,
      }),
    );
    expect(state.engineRepo.update).toHaveBeenCalledWith(
      { id: 'engine-1' },
      expect.objectContaining({
        tenantMappingVersion: 3,
        tenantResolutionStatus: 'incomplete',
        lastTenantReconciledAt: expect.any(Number),
      }),
    );

    const noVersionAdvance = setup({
      engine: sharedEngine({ tenantMappingVersion: undefined }),
      mappings: [existing],
      resources: [],
    });
    await expect(service.reconcileInStore(
      'engine-1',
      noVersionAdvance.dataSource as any,
      false,
    )).resolves.toMatchObject({
      mappingVersion: 0,
      resolutionStatus: 'ready',
    });

    const conflictState = setup({
      mappings: [
        existing,
        { ...existing, id: 'mapping-2', sourceRef: 'config:duplicate' },
      ],
      resources: [{
        id: 'resource-conflict',
        runtimeTenantId: 'runtime-a',
        projectId: null,
      }],
    });
    await expect(service.reconcileInStore(
      'engine-1',
      conflictState.dataSource as any,
    )).resolves.toMatchObject({
      resolutionStatus: 'conflict',
      conflictingResourceCount: 1,
    });
    expect(conflictState.resourceRepo.update).toHaveBeenCalledWith(
      { id: 'resource-conflict' },
      expect.objectContaining({
        tenantId: null,
        tenantResolutionStatus: 'conflict',
        tenantMappingId: null,
      }),
    );
  });

  it('fails closed when transactional reconciliation cannot use a shared engine', async () => {
    const missing = setup({ engine: null });
    await expect(service.reconcileInStore('missing', missing.dataSource as any))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    const dedicated = setup({
      engine: sharedEngine({ tenancyMode: 'dedicated', tenantMappingStrategy: null }),
    });
    await service.reconcileInStore('engine-1', dedicated.dataSource as any).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectCode(error, 'ENGINE_TENANCY_CONFLICT', 400),
    );
  });
});
