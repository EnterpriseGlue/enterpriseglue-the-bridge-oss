import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
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
  const engineRepo = {
    findOne: vi.fn().mockResolvedValue({
      id: 'engine-1',
      tenantId: 'tenant-a',
      tenancyMode: 'dedicated',
      tenantMappingStrategy: null,
      tenantMappingVersion: 0,
    }),
    update: vi.fn(),
  };
  const mappingRepo = { find: vi.fn().mockResolvedValue([]) };
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository(entity: unknown) {
      if (entity === RuntimeResource) return resourceRepo;
      if (entity === RuntimeResourceSet) return setRepo;
      if (entity === RuntimeResourceSetMaterialization) return materializationRepo;
      if (entity === Engine) return engineRepo;
      if (entity === EngineTenantMapping) return mappingRepo;
      throw new Error('Unexpected repository');
    },
  });
  return { resourceRepo, setRepo, materializationRepo, engineRepo, mappingRepo };
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
      engineId: 'engine-1',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      tenantMappingId: null,
      tenantMappingVersion: 0,
      tenantResolutionDetailsJson: '{"code":"dedicated_engine_tenant"}',
      runtimeTenantId: '',
      resourceKey: 'payments-order',
      labelsJson: '{"domain":"payments"}',
      lineageJson: '{"projectId":"project-1"}',
    }));
  });

  it('materializes a prefix selector and removes stale members without granting access itself', async () => {
    const { resourceRepo, setRepo, materializationRepo } = setup();
    setRepo.findOne.mockResolvedValue({ id: 'set-1', tenantId: 'tenant-a', engineId: 'engine-1', resourceKind: 'process_definition', selectorJson: JSON.stringify({ mode: 'prefix', prefix: 'payments-' }), isArchived: false });
    resourceRepo.find.mockResolvedValue([
      { id: 'resource-1', engineId: 'engine-1', tenantId: 'tenant-a', tenantResolutionStatus: 'resolved', resourceKind: 'process_definition', resourceKey: 'payments-order', labelsJson: '{}', source: 'engine_discovery', sourceRef: null },
      { id: 'resource-2', engineId: 'engine-1', tenantId: 'tenant-a', tenantResolutionStatus: 'resolved', resourceKind: 'process_definition', resourceKey: 'hr-onboard', labelsJson: '{}', source: 'engine_discovery', sourceRef: null },
    ]);
    materializationRepo.find.mockResolvedValue([{ id: 'old-row', runtimeResourceId: 'stale-resource' }]);

    const result = await runtimeResourceInventoryService.materialize('set-1', 'tenant-a');

    expect(result).toMatchObject({ runtimeResourceSetId: 'set-1', matched: 1, created: 1, removed: 1 });
    expect(materializationRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ runtimeResourceSetId: 'set-1', runtimeResourceId: 'resource-1' }));
    expect(materializationRepo.delete).toHaveBeenCalled();
  });

  it('materializes only matching runtime tenants for a tenant-constrained set', async () => {
    const { resourceRepo, setRepo, materializationRepo } = setup();
    setRepo.findOne.mockResolvedValue({
      id: 'set-1', tenantId: 'tenant-a', engineId: 'engine-1', resourceKind: 'process_definition',
      selectorJson: JSON.stringify({ mode: 'prefix', prefix: 'payments-' }), runtimeTenantId: 'runtime-payments', isArchived: false,
    });
    resourceRepo.find.mockResolvedValue([
      { id: 'payments-tenant', engineId: 'engine-1', tenantId: 'tenant-a', tenantResolutionStatus: 'resolved', resourceKind: 'process_definition', resourceKey: 'payments-order', runtimeTenantId: 'runtime-payments', labelsJson: '{}', source: 'engine_discovery', sourceRef: null },
      { id: 'risk-tenant', engineId: 'engine-1', tenantId: 'tenant-a', tenantResolutionStatus: 'resolved', resourceKind: 'process_definition', resourceKey: 'payments-risk', runtimeTenantId: 'runtime-risk', labelsJson: '{}', source: 'engine_discovery', sourceRef: null },
    ]);

    const result = await runtimeResourceInventoryService.materialize('set-1', 'tenant-a');

    expect(result).toMatchObject({ matched: 1, created: 1, removed: 0 });
    expect(materializationRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ runtimeResourceId: 'payments-tenant' }));
    expect(materializationRepo.insert).not.toHaveBeenCalledWith(expect.objectContaining({ runtimeResourceId: 'risk-tenant' }));
  });

  it('fails closed when a caller requests a set from another tenant', async () => {
    const { setRepo } = setup();
    setRepo.findOne.mockResolvedValue({ id: 'set-1', tenantId: 'tenant-a', isArchived: false });
    await expect(runtimeResourceInventoryService.materialize('set-1', 'tenant-b')).rejects.toThrow('Runtime Resource Set not found');
  });

  it('resolves shared runtime observations through the current mapping version', async () => {
    const { resourceRepo, engineRepo, mappingRepo } = setup();
    engineRepo.findOne.mockResolvedValue({
      id: 'engine-1',
      tenantId: null,
      tenancyMode: 'shared',
      tenantMappingStrategy: 'engine_tenant_id',
      tenantMappingVersion: 4,
    });
    mappingRepo.find.mockResolvedValue([{
      id: 'mapping-1',
      engineId: 'engine-1',
      externalTenantId: 'runtime-a',
      enterpriseTenantId: 'tenant-a',
      strategy: 'engine_tenant_id',
      isActive: true,
    }]);

    await runtimeResourceInventoryService.observe('engine-1', null, [{
      resourceKind: 'process_definition',
      resourceKey: 'payments-order',
      runtimeTenantId: 'runtime-a',
    }]);

    expect(resourceRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      tenantMappingId: 'mapping-1',
      tenantMappingVersion: 4,
      tenantResolutionDetailsJson: '{"code":"shared_engine_mapping"}',
    }));
    expect(engineRepo.update).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      tenantResolutionStatus: 'ready',
      lastTenantReconciledAt: expect.any(Number),
    }));
  });

  it('quarantines unmapped and conflicting shared runtime observations', async () => {
    const { resourceRepo, engineRepo, mappingRepo } = setup();
    engineRepo.findOne.mockResolvedValue({
      id: 'engine-1',
      tenantId: null,
      tenancyMode: 'shared',
      tenantMappingStrategy: 'explicit',
      tenantMappingVersion: 2,
    });
    mappingRepo.find.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'mapping-1', externalTenantId: 'runtime-a', enterpriseTenantId: 'tenant-a', strategy: 'explicit' },
      { id: 'mapping-2', externalTenantId: 'runtime-a', enterpriseTenantId: 'tenant-b', strategy: 'explicit' },
    ]);

    await runtimeResourceInventoryService.observe('engine-1', null, [{
      resourceKind: 'process_definition', resourceKey: 'unmapped', runtimeTenantId: 'runtime-a',
    }]);
    expect(resourceRepo.insert).toHaveBeenLastCalledWith(expect.objectContaining({
      tenantId: null,
      tenantResolutionStatus: 'unmapped',
      tenantMappingId: null,
      tenantResolutionDetailsJson: '{"code":"tenant_mapping_not_found"}',
    }));

    await runtimeResourceInventoryService.observe('engine-1', null, [{
      resourceKind: 'process_definition', resourceKey: 'conflict', runtimeTenantId: 'runtime-a',
    }]);
    expect(resourceRepo.insert).toHaveBeenLastCalledWith(expect.objectContaining({
      tenantId: null,
      tenantResolutionStatus: 'conflict',
      tenantMappingId: null,
      tenantResolutionDetailsJson: '{"code":"multiple_active_mappings"}',
    }));
  });

  it('never materializes unresolved or cross-tenant runtime resources', async () => {
    const { resourceRepo, setRepo, materializationRepo } = setup();
    setRepo.findOne.mockResolvedValue({
      id: 'set-1',
      tenantId: 'tenant-a',
      engineId: 'engine-1',
      resourceKind: 'process_definition',
      selectorJson: JSON.stringify({ mode: 'prefix', prefix: 'payments-' }),
      isArchived: false,
    });
    resourceRepo.find.mockResolvedValue([
      { id: 'allowed', tenantId: 'tenant-a', tenantResolutionStatus: 'resolved', resourceKey: 'payments-a', labelsJson: '{}' },
      { id: 'unmapped', tenantId: null, tenantResolutionStatus: 'unmapped', resourceKey: 'payments-b', labelsJson: '{}' },
      { id: 'other', tenantId: 'tenant-b', tenantResolutionStatus: 'resolved', resourceKey: 'payments-c', labelsJson: '{}' },
    ]);

    const result = await runtimeResourceInventoryService.materialize('set-1', 'tenant-a');

    expect(result.matched).toBe(1);
    expect(materializationRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ runtimeResourceId: 'allowed' }));
    expect(materializationRepo.insert).not.toHaveBeenCalledWith(expect.objectContaining({ runtimeResourceId: 'unmapped' }));
    expect(materializationRepo.insert).not.toHaveBeenCalledWith(expect.objectContaining({ runtimeResourceId: 'other' }));
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
      expect.objectContaining({ resourceKind: 'process_definition', resourceKey: 'payments-order', runtimeTenantId: 'runtime-a', deploymentId: 'deployment-1' }),
      expect.objectContaining({ resourceKind: 'decision_definition', resourceKey: 'payments-risk' }),
    ]));
    expect(materializeForEngine).toHaveBeenCalledWith('engine-1', 'tenant-a');
  });

  it('persists every discovered artifact with its stable runtime and deployment identity', async () => {
    const { resourceRepo } = setup();
    camundaGet.mockResolvedValue([{
      id: 'process-1', key: 'payments-order', version: 2, tenantId: 'runtime-payments', deploymentId: 'deployment-1',
    }]);
    getDecisionDefinitions.mockResolvedValue([{
      id: 'decision-1', key: 'payments-risk', version: 3, tenantId: 'runtime-risk', deploymentId: 'deployment-1',
    }]);
    vi.spyOn(runtimeResourceInventoryService, 'materializeForEngine').mockResolvedValue([]);

    await runtimeResourceInventoryService.reconcileEngine('engine-1', 'tenant-a');

    expect(resourceRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1',
      resourceKind: 'process_definition',
      resourceKey: 'payments-order',
      engineResourceId: 'process-1',
      runtimeTenantId: 'runtime-payments',
      deploymentId: 'deployment-1',
      version: 2,
      source: 'engine_discovery',
      observedAt: expect.any(Number),
    }));
    expect(resourceRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1',
      resourceKind: 'decision_definition',
      resourceKey: 'payments-risk',
      engineResourceId: 'decision-1',
      runtimeTenantId: 'runtime-risk',
      deploymentId: 'deployment-1',
      version: 3,
      source: 'engine_discovery',
      observedAt: expect.any(Number),
    }));
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
