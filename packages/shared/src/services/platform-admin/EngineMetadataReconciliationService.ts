import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { deploymentDiscoveryService, type DeploymentDiscoveryResult } from './DeploymentDiscoveryService.js';
import { runtimeResourceInventoryService } from './RuntimeResourceInventoryService.js';

export interface EngineMetadataReconciliationResult {
  created: number;
  updated: number;
  deactivated: number;
  materializedSets: number;
  runtimeSkipped?: boolean;
  deployments: DeploymentDiscoveryResult;
}

/** One reconciliation boundary for both scheduled and explicitly requested discovery. */
class EngineMetadataReconciliationService {
  async reconcileEngine(engineId: string, tenantId?: string | null, options: { runtimeMetadataDiscoveryEnabled?: boolean; deploymentDiscoveryEnabled?: boolean } = {}): Promise<EngineMetadataReconciliationResult> {
    const engineRepo = (await getDataSource()).getRepository(Engine);
    const deploymentDiscoveryEnabled = options.deploymentDiscoveryEnabled === undefined
      ? (await engineRepo.findOne({ where: { id: engineId } }))?.deploymentDiscoveryEnabled !== false
      : options.deploymentDiscoveryEnabled;
    const attemptedAt = Date.now();
    try {
      const runtime = options.runtimeMetadataDiscoveryEnabled === false
        ? { created: 0, updated: 0, deactivated: 0, materializedSets: 0, runtimeSkipped: true }
        : await runtimeResourceInventoryService.reconcileEngine(engineId, tenantId);
      const deployments = !deploymentDiscoveryEnabled
        ? { created: 0, updated: 0, artifactsCreated: 0, skipped: true }
        : await deploymentDiscoveryService.reconcileEngine(engineId, tenantId);
      await engineRepo.update({ id: engineId }, {
        lastMetadataReconciledAt: attemptedAt,
        lastMetadataReconciliationStatus: 'succeeded',
      });
      return { ...runtime, deployments };
    } catch (error) {
      try {
        await engineRepo.update({ id: engineId }, {
          lastMetadataReconciledAt: attemptedAt,
          lastMetadataReconciliationStatus: 'failed',
        });
      } catch {
        // Preserve the engine/discovery failure as the actionable error.
      }
      throw error;
    }
  }
}

export const engineMetadataReconciliationService = new EngineMetadataReconciliationService();
