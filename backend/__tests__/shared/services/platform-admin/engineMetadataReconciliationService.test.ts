import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';
import { deploymentDiscoveryService } from '@enterpriseglue/shared/services/platform-admin/DeploymentDiscoveryService.js';
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js', () => ({
  runtimeResourceInventoryService: { reconcileEngine: vi.fn() },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/DeploymentDiscoveryService.js', () => ({
  deploymentDiscoveryService: { reconcileEngine: vi.fn() },
}));

describe('EngineMetadataReconciliationService', () => {
  const update = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ id: 'engine-1', deploymentDiscoveryEnabled: true }), update }) } as any);
    vi.mocked(runtimeResourceInventoryService.reconcileEngine).mockResolvedValue({ created: 1, updated: 2, deactivated: 3, materializedSets: 4 });
    vi.mocked(deploymentDiscoveryService.reconcileEngine).mockResolvedValue({ created: 5, updated: 6, artifactsCreated: 7 });
  });

  it('records successful reconciliation diagnostics', async () => {
    const result = await engineMetadataReconciliationService.reconcileEngine('engine-1', 'tenant-a');

    expect(result).toEqual({ created: 1, updated: 2, deactivated: 3, materializedSets: 4, deployments: { created: 5, updated: 6, artifactsCreated: 7 } });
    expect(update).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      lastMetadataReconciledAt: expect.any(Number),
      lastMetadataReconciliationStatus: 'succeeded',
    }));
  });

  it('records failed attempts and preserves the original error', async () => {
    const error = new Error('engine unavailable');
    vi.mocked(runtimeResourceInventoryService.reconcileEngine).mockRejectedValue(error);

    await expect(engineMetadataReconciliationService.reconcileEngine('engine-1', null)).rejects.toBe(error);
    expect(deploymentDiscoveryService.reconcileEngine).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ id: 'engine-1' }, expect.objectContaining({
      lastMetadataReconciliationStatus: 'failed',
    }));
  });

  it('skips deployment ingestion when the engine disables it', async () => {
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ id: 'engine-1', deploymentDiscoveryEnabled: false }), update }) } as any);

    await expect(engineMetadataReconciliationService.reconcileEngine('engine-1', null)).resolves.toEqual(expect.objectContaining({
      deployments: { created: 0, updated: 0, artifactsCreated: 0, skipped: true },
    }));
    expect(deploymentDiscoveryService.reconcileEngine).not.toHaveBeenCalled();
  });

  it('can run deployment discovery without runtime metadata ingestion', async () => {
    await expect(engineMetadataReconciliationService.reconcileEngine('engine-1', null, {
      runtimeMetadataDiscoveryEnabled: false,
      deploymentDiscoveryEnabled: true,
    })).resolves.toEqual(expect.objectContaining({ runtimeSkipped: true, deployments: { created: 5, updated: 6, artifactsCreated: 7 } }));
    expect(runtimeResourceInventoryService.reconcileEngine).not.toHaveBeenCalled();
    expect(deploymentDiscoveryService.reconcileEngine).toHaveBeenCalledWith('engine-1', null);
  });
});
