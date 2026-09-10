import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { getTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { reconcileSharedEngineInventory } from '../../../packages/backend-host/src/services/sharedEngineInventoryReconciliation.js';
import {
  runScheduledRuntimeInventoryReconciliationOnce,
  startRuntimeInventoryPollerIfEnabled,
  stopRuntimeInventoryPoller,
} from '../../../packages/backend-host/src/poller/runtimeInventoryPoller.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('../../../packages/backend-host/src/services/sharedEngineInventoryReconciliation.js', () => ({ reconcileSharedEngineInventory: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js', () => ({
  engineMetadataReconciliationService: { reconcileEngine: vi.fn() },
}));

describe('runtimeInventoryPoller', () => {
  const engineRepo = { find: vi.fn() };
  const originalTenancyMode = config.tenancyMode;

  beforeEach(() => {
    vi.clearAllMocks();
    config.tenancyMode = 'single';
    vi.useFakeTimers();
    delete process.env.RUNTIME_INVENTORY_RECONCILIATION_INTERVAL_MS;
    delete process.env.RUNTIME_INVENTORY_RECONCILIATION_TENANT_IDS;
    delete process.env.RUNTIME_INVENTORY_RECONCILIATION_RUN_ON_START;
    stopRuntimeInventoryPoller();
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: () => engineRepo } as any);
    vi.mocked(engineMetadataReconciliationService.reconcileEngine).mockResolvedValue({ created: 0, updated: 1, deactivated: 0, materializedSets: 2, deployments: { created: 0, updated: 0, artifactsCreated: 0 } });
  });

  afterEach(() => {
    stopRuntimeInventoryPoller();
    config.tenancyMode = originalTenancyMode;
    vi.useRealTimers();
  });

  it('reconciles only active engines with an enabled discovery lane in the selected tenant scope', async () => {
    engineRepo.find.mockResolvedValue([
      { id: 'central-a', tenantId: 'tenant-a', runtimeAccessScope: 'resource_aware', lifecycleStatus: 'active' },
      { id: 'distributed-a', tenantId: 'tenant-a', runtimeAccessScope: 'engine_wide', lifecycleStatus: 'active', deploymentDiscoveryEnabled: false },
      { id: 'inactive-a', tenantId: 'tenant-a', runtimeAccessScope: 'resource_aware', lifecycleStatus: 'decommissioned' },
      { id: 'discovery-disabled', tenantId: 'tenant-a', runtimeAccessScope: 'resource_aware', lifecycleStatus: 'active', metadataDiscoveryEnabled: false, deploymentDiscoveryEnabled: false },
      { id: 'central-b', tenantId: 'tenant-b', runtimeAccessScope: 'resource_aware', lifecycleStatus: 'active' },
    ]);

    await expect(runScheduledRuntimeInventoryReconciliationOnce({ tenantIds: ['tenant-a'] })).resolves.toEqual([
      { engineId: 'central-a', tenantId: 'tenant-a', status: 'reconciled', created: 0, updated: 1, deactivated: 0, materializedSets: 2, deploymentsCreated: 0, deploymentsUpdated: 0, deploymentArtifactsCreated: 0 },
    ]);
    expect(engineMetadataReconciliationService.reconcileEngine).toHaveBeenCalledWith('central-a', 'tenant-a', { runtimeMetadataDiscoveryEnabled: true, deploymentDiscoveryEnabled: true });
  });

  it('only reconciles engines whose configured cadence is due', async () => {
    const now = Date.now();
    engineRepo.find.mockResolvedValue([
      { id: 'not-due', tenantId: null, runtimeAccessScope: 'resource_aware', lifecycleStatus: 'active', reconciliationIntervalSeconds: 600, lastMetadataReconciledAt: now - 30_000 },
      { id: 'due', tenantId: null, runtimeAccessScope: 'resource_aware', lifecycleStatus: 'active', deploymentDiscoveryEnabled: false, reconciliationIntervalSeconds: 60, lastMetadataReconciledAt: now - 61_000 },
    ]);

    await runScheduledRuntimeInventoryReconciliationOnce();

    expect(engineMetadataReconciliationService.reconcileEngine).toHaveBeenCalledTimes(1);
    expect(engineMetadataReconciliationService.reconcileEngine).toHaveBeenCalledWith('due', null, { runtimeMetadataDiscoveryEnabled: true, deploymentDiscoveryEnabled: false });
  });

  it('runs deployment discovery independently for an engine-wide engine', async () => {
    engineRepo.find.mockResolvedValue([
      { id: 'deployment-only', tenantId: null, runtimeAccessScope: 'engine_wide', lifecycleStatus: 'active', metadataDiscoveryEnabled: false, deploymentDiscoveryEnabled: true },
    ]);

    await runScheduledRuntimeInventoryReconciliationOnce();

    expect(engineMetadataReconciliationService.reconcileEngine).toHaveBeenCalledWith('deployment-only', null, {
      runtimeMetadataDiscoveryEnabled: false,
      deploymentDiscoveryEnabled: true,
    });
  });

  it('isolates one engine failure so the remaining inventory is reconciled', async () => {
    engineRepo.find.mockResolvedValue([
      { id: 'fails', tenantId: null, runtimeAccessScope: 'resource_aware', lifecycleStatus: null },
      { id: 'works', tenantId: null, runtimeAccessScope: 'resource_aware', lifecycleStatus: 'active' },
    ]);
    vi.mocked(engineMetadataReconciliationService.reconcileEngine)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ created: 1, updated: 0, deactivated: 0, materializedSets: 0, deployments: { created: 0, updated: 0, artifactsCreated: 0 } });

    await expect(runScheduledRuntimeInventoryReconciliationOnce()).resolves.toEqual([
      { engineId: 'fails', tenantId: null, status: 'failed' },
      { engineId: 'works', tenantId: null, status: 'reconciled', created: 1, updated: 0, deactivated: 0, materializedSets: 0, deploymentsCreated: 0, deploymentsUpdated: 0, deploymentArtifactsCreated: 0 },
    ]);
  });

  it('is disabled until an explicit positive interval is configured', async () => {
    await expect(startRuntimeInventoryPollerIfEnabled()).resolves.toBeNull();

    process.env.RUNTIME_INVENTORY_RECONCILIATION_INTERVAL_MS = '1000';
    engineRepo.find.mockResolvedValue([]);
    await expect(startRuntimeInventoryPollerIfEnabled()).resolves.not.toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(engineRepo.find).toHaveBeenCalledTimes(1);
  });

  it('delegates shared engine tenant partitioning and global status to the complete-cohort aggregate', async () => {
    config.tenancyMode = 'pooled';
    engineRepo.find.mockResolvedValue([{ id: 'shared', tenancyMode: 'shared', tenantMappingStrategy: 'engine_tenant_id', runtimeAccessScope: 'resource_aware' }]);
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => entity === Tenant ? { find: async () => [
      { id: 'a', slug: 'alpha', status: 'active' }, { id: 'b', slug: 'beta', status: 'active' }, { id: 'c', slug: 'closed', status: 'deleting' },
    ] } : entity === EngineTenantMapping ? { find: async () => ['a', 'b', 'c'].map(enterpriseTenantId => ({ enterpriseTenantId, strategy: 'engine_tenant_id' })) } : engineRepo } as any);
    vi.mocked(reconcileSharedEngineInventory).mockResolvedValue([{ engineId: 'shared', tenantId: null, status: 'failed' }]);
    await expect(runScheduledRuntimeInventoryReconciliationOnce({ tenantIds: ['a'] })).resolves.toEqual([{ engineId: 'shared', tenantId: null, status: 'failed' }]);
    expect(reconcileSharedEngineInventory).toHaveBeenCalledWith(expect.objectContaining({ id: 'shared' }), ['a']);
    expect(engineMetadataReconciliationService.reconcileEngine).not.toHaveBeenCalled();
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('reports unsupported pooled global engines failed rather than healthy empty work', async () => {
    config.tenancyMode = 'pooled';
    engineRepo.find.mockResolvedValue([{ id: 'global', tenantId: null, runtimeAccessScope: 'resource_aware' }]);
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => entity === Tenant ? { find: async () => [] } : engineRepo } as any);
    await expect(runScheduledRuntimeInventoryReconciliationOnce()).resolves.toEqual([{ engineId: 'global', tenantId: null, status: 'failed' }]);
    expect(engineMetadataReconciliationService.reconcileEngine).not.toHaveBeenCalled();
    await expect(runScheduledRuntimeInventoryReconciliationOnce({ tenantIds: [null] })).rejects.toThrow('unavailable');
  });
});
