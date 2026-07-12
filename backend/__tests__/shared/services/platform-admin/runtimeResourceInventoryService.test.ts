import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
const { camundaGet, getDecisionDefinitions } = vi.hoisted(() => ({ camundaGet: vi.fn(), getDecisionDefinitions: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({ camundaGet, getDecisionDefinitions }));

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
  afterEach(() => vi.restoreAllMocks());

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

  it('reconciles process and decision definitions then refreshes engine resource sets', async () => {
    setup();
    camundaGet.mockResolvedValue([{ id: 'process-1', key: 'payments-order', version: 2, tenantId: 'runtime-a', deploymentId: 'deployment-1' }]);
    getDecisionDefinitions.mockResolvedValue([{ id: 'decision-1', key: 'payments-risk', version: 1 }]);
    const observe = vi.spyOn(runtimeResourceInventoryService, 'observe').mockResolvedValue({ created: 2, updated: 0 });
    const materializeForEngine = vi.spyOn(runtimeResourceInventoryService, 'materializeForEngine').mockResolvedValue([]);

    const result = await runtimeResourceInventoryService.reconcileEngine('engine-1', 'tenant-a');

    expect(result).toEqual({ created: 2, updated: 0, deactivated: 0, materializedSets: 0 });
    expect(observe).toHaveBeenCalledWith('engine-1', 'tenant-a', expect.arrayContaining([
      expect.objectContaining({ resourceKind: 'process_definition', resourceKey: 'payments-order', runtimeTenantId: 'runtime-a' }),
      expect.objectContaining({ resourceKind: 'decision_definition', resourceKey: 'payments-risk' }),
    ]));
    expect(materializeForEngine).toHaveBeenCalledWith('engine-1', 'tenant-a');
  });

  it('keeps receipt project lineage when a later engine discovery refreshes the same resource', async () => {
    const { resourceRepo } = setup();
    resourceRepo.findOne.mockResolvedValue({
      id: 'resource-1', engineResourceId: 'old-definition', deploymentId: 'deployment-1',
      projectId: 'project-1', fileId: 'file-1', version: 1, labelsJson: '{"domain":"payments"}',
      lineageJson: '{"receiptId":"receipt-1"}', source: 'deployment_receipt', sourceRef: 'receipt-1',
    });

    await runtimeResourceInventoryService.observe('engine-1', 'tenant-a', [{
      resourceKind: 'process_definition', resourceKey: 'payments-order', engineResourceId: 'definition-2', version: 2,
    }]);

    expect(resourceRepo.update).toHaveBeenCalledWith({ id: 'resource-1' }, expect.objectContaining({
      engineResourceId: 'definition-2', version: 2, projectId: 'project-1', fileId: 'file-1',
      source: 'deployment_receipt', sourceRef: 'receipt-1',
      lineageJson: '{"receiptId":"receipt-1"}', labelsJson: '{"domain":"payments"}',
    }));
  });

  it('deactivates only runtime resources absent from a successful reconciliation', async () => {
    const { resourceRepo } = setup();
    camundaGet.mockResolvedValue([{ id: 'process-1', key: 'payments-order', version: 2 }]);
    getDecisionDefinitions.mockResolvedValue([]);
    vi.spyOn(runtimeResourceInventoryService, 'materializeForEngine').mockResolvedValue([]);
    resourceRepo.find.mockResolvedValue([
      { id: 'present', tenantId: 'tenant-a', resourceKind: 'process_definition', resourceKey: 'payments-order', runtimeTenantId: '', isActive: true },
      { id: 'stale', tenantId: 'tenant-a', resourceKind: 'decision_definition', resourceKey: 'legacy-decision', runtimeTenantId: '', isActive: true },
      { id: 'other-tenant', tenantId: 'tenant-b', resourceKind: 'process_definition', resourceKey: 'not-ours', runtimeTenantId: '', isActive: true },
    ]);

    const result = await runtimeResourceInventoryService.reconcileEngine('engine-1', 'tenant-a');

    expect(result.deactivated).toBe(1);
    expect(resourceRepo.update).toHaveBeenCalledWith({ id: 'stale' }, expect.objectContaining({ isActive: false }));
    expect(resourceRepo.update).not.toHaveBeenCalledWith({ id: 'other-tenant' }, expect.anything());
  });
});
