import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

function setup() {
  const resourceRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), update: vi.fn(), find: vi.fn().mockResolvedValue([]) };
  const setRepo = { findOne: vi.fn().mockResolvedValue(null) };
  const materializationRepo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository(entity: unknown) {
      if (entity === RuntimeResource) return resourceRepo;
      if (entity === RuntimeResourceSet) return setRepo;
      if (entity === RuntimeResourceSetMaterialization) return materializationRepo;
      throw new Error('Unexpected repository');
    },
  });
  return { resourceRepo, setRepo, materializationRepo };
}

describe('runtimeResourceInventoryService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists only sanitized runtime metadata and normalizes no runtime tenant to an empty key', async () => {
    const { resourceRepo } = setup();
    const result = await runtimeResourceInventoryService.observe('engine-1', 'tenant-a', [{
      resourceKind: 'process_definition', resourceKey: 'payments-order', engineResourceId: 'definition-1', version: 3,
      labels: { domain: 'payments' }, lineage: { projectId: 'project-1' },
    }]);
    expect(result).toEqual({ created: 1, updated: 0 });
    expect(resourceRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1', tenantId: 'tenant-a', runtimeTenantId: '', resourceKey: 'payments-order', labelsJson: '{"domain":"payments"}', lineageJson: '{"projectId":"project-1"}',
    }));
  });

  it('materializes a prefix selector and removes stale members without granting access itself', async () => {
    const { resourceRepo, setRepo, materializationRepo } = setup();
    setRepo.findOne.mockResolvedValue({ id: 'set-1', tenantId: 'tenant-a', engineId: 'engine-1', resourceKind: 'process_definition', selectorJson: JSON.stringify({ mode: 'prefix', prefix: 'payments-' }), isArchived: false });
    resourceRepo.find.mockResolvedValue([
      { id: 'resource-1', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'payments-order', labelsJson: '{}', source: 'engine_discovery', sourceRef: null },
      { id: 'resource-2', engineId: 'engine-1', resourceKind: 'process_definition', resourceKey: 'hr-onboard', labelsJson: '{}', source: 'engine_discovery', sourceRef: null },
    ]);
    materializationRepo.find.mockResolvedValue([{ id: 'old-row', runtimeResourceId: 'stale-resource' }]);

    const result = await runtimeResourceInventoryService.materialize('set-1', 'tenant-a');

    expect(result).toMatchObject({ runtimeResourceSetId: 'set-1', matched: 1, created: 1, removed: 1 });
    expect(materializationRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ runtimeResourceSetId: 'set-1', runtimeResourceId: 'resource-1' }));
    expect(materializationRepo.delete).toHaveBeenCalled();
  });

  it('fails closed when a caller requests a set from another tenant', async () => {
    const { setRepo } = setup();
    setRepo.findOne.mockResolvedValue({ id: 'set-1', tenantId: 'tenant-a', isArchived: false });
    await expect(runtimeResourceInventoryService.materialize('set-1', 'tenant-b')).rejects.toThrow('Runtime Resource Set not found');
  });
});
