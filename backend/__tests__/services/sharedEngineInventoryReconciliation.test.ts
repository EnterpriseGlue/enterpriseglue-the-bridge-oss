import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { getTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js';
import { reconcileSharedEngineInventory } from '../../../packages/backend-host/src/services/sharedEngineInventoryReconciliation.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js', () => ({ engineMetadataReconciliationService: { reconcileEngine: vi.fn() } }));
vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({ logger: { warn: vi.fn() } }));

function fixture() {
  const engine = { id: 'shared', tenancyMode: 'shared', tenantMappingVersion: 7, tenantMappingStrategy: 'engine_tenant_id',
    runtimeAccessScope: 'resource_aware', tenantResolutionStatus: 'ready', lastMetadataReconciledAt: null } as unknown as Engine;
  const current = structuredClone(engine);
  const mappings = ['a', 'b'].map(id => ({ id: `map-${id}`, enterpriseTenantId: id, externalTenantId: `runtime-${id}`, strategy: 'engine_tenant_id', isActive: true })) as EngineTenantMapping[];
  const tenants = ['a', 'b'].map(id => ({ id, slug: `tenant-${id}`, status: 'active' })) as Tenant[];
  const resources = ['a', 'b'].map(id => ({ id: `resource-${id}`, engineId: engine.id, tenantId: id, runtimeTenantId: `runtime-${id}`,
    tenantMappingId: `map-${id}`, tenantMappingVersion: 7, tenantResolutionStatus: 'resolved', isActive: true })) as RuntimeResource[];
  const scans: string[] = [];
  const update = vi.fn().mockImplementation(async (criteria, values) => {
    if (typeof criteria.lastMetadataReconciledAt === 'number') expect(criteria.lastMetadataReconciledAt).toBe(Number(current.lastMetadataReconciledAt));
    Object.assign(current, values); return { affected: 1 };
  });
  const resourceFind = vi.fn().mockImplementation(async ({ where }) => {
    expect(getTenantDatabaseContext()).toEqual({ tenantId: where.tenantId, tenantSlug: `tenant-${where.tenantId}` });
    expect(where).toEqual({ engineId: engine.id, tenantId: where.tenantId, isActive: true });
    scans.push(where.tenantId); return resources.filter(row => row.tenantId === where.tenantId);
  });
  const mappingFind = vi.fn().mockImplementation(async () => structuredClone(mappings));
  const repositories = (entity: unknown) => {
    if (entity === Engine) return { update, findOne: vi.fn().mockImplementation(async options => {
      expect(options.lock).toEqual({ mode: 'pessimistic_write' }); return current;
    }) };
    if (entity === EngineTenantMapping) return { find: mappingFind };
    if (entity === Tenant) return { find: vi.fn().mockImplementation(async () => structuredClone(tenants)), findOne: vi.fn().mockImplementation(async options => {
      expect(options.lock).toEqual({ mode: 'pessimistic_read' }); return tenants.find(row => row.id === options.where.id) ?? null;
    }) };
    if (entity === RuntimeResource) return { find: resourceFind };
    throw Error('Unexpected repository');
  };
  const f = { engine, current, mappings, tenants, resources, scans, update, resourceFind, mappingFind, beforeFinalize: () => {} };
  vi.mocked(getDataSource).mockResolvedValue({ getRepository: repositories, transaction: async (work: any) => {
    f.beforeFinalize(); return work({ getRepository: repositories });
  } } as any);
  vi.mocked(engineMetadataReconciliationService.reconcileEngine).mockImplementation(async (_, tenantId) => {
    expect(getTenantDatabaseContext()).toEqual({ tenantId, tenantSlug: `tenant-${tenantId}` });
    return { created: 0, updated: 1, deactivated: 0, materializedSets: 0, deployments: { created: 0, updated: 0, artifactsCreated: 0 } };
  });
  return f;
}

describe('complete shared engine inventory aggregate', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('publishes readiness only after both tenant work and locked canonical scoped inventory succeed', async () => {
    const f = fixture();
    const result = await reconcileSharedEngineInventory(f.engine);
    expect(result).toHaveLength(2); expect(result.every(row => row.status === 'reconciled')).toBe(true);
    expect(f.scans).toEqual(['a', 'b']);
    expect(f.update.mock.calls[0][1]).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
    expect(f.current).toMatchObject({ tenantResolutionStatus: 'ready', lastMetadataReconciliationStatus: 'succeeded' });
    expect(f.current.lastTenantReconciledAt).toBeGreaterThan(0);
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('a tenant subset invalidates readiness and never substitutes a partial result for the full cohort', async () => {
    const f = fixture(); const result = await reconcileSharedEngineInventory(f.engine, ['a']);
    expect(result.map(row => [row.tenantId, row.status])).toEqual([['a', 'reconciled'], [null, 'failed']]);
    expect(f.scans).toEqual([]); expect(f.current).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
  });

  it('a later tenant success cannot hide the earlier tenant failure', async () => {
    const f = fixture(); vi.mocked(engineMetadataReconciliationService.reconcileEngine).mockRejectedValueOnce(Error('first tenant unavailable'));
    const result = await reconcileSharedEngineInventory(f.engine);
    expect(result.map(row => [row.tenantId, row.status])).toEqual([['a', 'failed'], ['b', 'reconciled'], [null, 'failed']]);
    expect(f.current.lastMetadataReconciliationStatus).toBe('failed'); expect(f.current.tenantResolutionStatus).toBe('incomplete');
  });

  for (const [name, change] of [
    ['mapping version', (f: ReturnType<typeof fixture>) => { f.current.tenantMappingVersion++; }],
    ['mapping strategy', (f: ReturnType<typeof fixture>) => { f.current.tenantMappingStrategy = 'explicit'; }],
    ['discovery policy', (f: ReturnType<typeof fixture>) => { f.current.metadataDiscoveryEnabled = false; }],
    ['engine lifecycle', (f: ReturnType<typeof fixture>) => { f.current.lifecycleStatus = 'decommissioned'; }],
    ['mapping rows', (f: ReturnType<typeof fixture>) => { f.mappings[0].externalTenantId = 'changed'; }],
    ['tenant status', (f: ReturnType<typeof fixture>) => { f.tenants[0].status = 'suspended'; }],
    ['tenant slug', (f: ReturnType<typeof fixture>) => { f.tenants[0].slug = 'renamed'; }],
    ['attempt marker', (f: ReturnType<typeof fixture>) => { f.current.lastMetadataReconciledAt = Number(f.current.lastMetadataReconciledAt) + 1; }],
  ] as const) it(`does not publish ready after ${name} changes`, async () => {
    const f = fixture(); f.beforeFinalize = () => change(f);
    const result = await reconcileSharedEngineInventory(f.engine);
    expect(result[result.length - 1]).toMatchObject({ tenantId: null, status: 'failed' });
    expect(f.update.mock.calls.some(([, values]) => values.tenantResolutionStatus === 'ready')).toBe(false);
  });

  it('stale persisted mapping versions cannot establish readiness', async () => {
    const f = fixture(); f.resources[1].tenantMappingVersion = 6;
    await reconcileSharedEngineInventory(f.engine); expect(f.current.tenantResolutionStatus).toBe('incomplete');
    expect(f.scans).toEqual(['a', 'b']);
  });

  it('conflicting real inventory remains conflict instead of healthy zero', async () => {
    const f = fixture(); f.resources[1].tenantResolutionStatus = 'conflict';
    await reconcileSharedEngineInventory(f.engine); expect(f.current.tenantResolutionStatus).toBe('conflict');
    expect(f.current.lastMetadataReconciliationStatus).toBe('failed');
  });

  it('missing canonical tenants block the whole aggregate', async () => {
    const f = fixture(); f.tenants.pop();
    const result = await reconcileSharedEngineInventory(f.engine);
    expect(result.map(row => [row.tenantId, row.status])).toEqual([['a', 'reconciled'], ['b', 'failed'], [null, 'failed']]);
    expect(f.current.tenantResolutionStatus).toBe('incomplete');
  });

  it('deployment-only discovery cannot invent runtime readiness', async () => {
    const f = fixture(); f.engine.metadataDiscoveryEnabled = false; f.current.metadataDiscoveryEnabled = false;
    await reconcileSharedEngineInventory(f.engine);
    expect(f.current).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'succeeded' });
    expect(f.scans).toEqual([]);
  });

  it('a lost initial CAS performs no tenant work or final update', async () => {
    const f = fixture(); f.update.mockResolvedValueOnce({ affected: 0 });
    await expect(reconcileSharedEngineInventory(f.engine)).rejects.toThrow('snapshot changed');
    expect(engineMetadataReconciliationService.reconcileEngine).not.toHaveBeenCalled(); expect(f.update).toHaveBeenCalledTimes(1);
  });

  it('a scoped persistence failure leaves the conservative start status', async () => {
    const f = fixture(); f.resourceFind.mockRejectedValueOnce(Error('database unavailable'));
    await expect(reconcileSharedEngineInventory(f.engine)).rejects.toThrow('database unavailable');
    expect(f.current).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
  });

  it('an initial mapping scan failure invalidates the prior ready marker', async () => {
    const f = fixture(); f.mappingFind.mockRejectedValueOnce(Error('catalogue unavailable'));
    await expect(reconcileSharedEngineInventory(f.engine)).rejects.toThrow('catalogue unavailable');
    expect(f.current).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
    expect(engineMetadataReconciliationService.reconcileEngine).not.toHaveBeenCalled();
  });

  it('an empty mapping cohort is incomplete, not vacuously ready', async () => {
    const f = fixture(); f.mappings.length = 0;
    await expect(reconcileSharedEngineInventory(f.engine)).resolves.toEqual([{ engineId: 'shared', tenantId: null, status: 'failed' }]);
    expect(f.current.tenantResolutionStatus).toBe('incomplete'); expect(f.scans).toEqual([]);
  });

  it('failed final CAS cannot produce a successful aggregate receipt', async () => {
    const f = fixture(); f.beforeFinalize = () => { f.update.mockResolvedValueOnce({ affected: 0 }); };
    const result = await reconcileSharedEngineInventory(f.engine);
    expect(result[result.length - 1]).toMatchObject({ tenantId: null, status: 'failed' });
    expect(f.current.tenantResolutionStatus).toBe('incomplete');
  });
});
