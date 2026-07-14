import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { deploymentDiscoveryService, type DeploymentDiscoveryResult } from './DeploymentDiscoveryService.js';
import { runtimeResourceInventoryService } from './RuntimeResourceInventoryService.js';

export interface EngineMetadataReconciliationResult {
  created: number;
  updated: number;
  deactivated: number;
  materializedSets: number;
  deployments: DeploymentDiscoveryResult;
}

/** One reconciliation boundary for both scheduled and explicitly requested discovery. */
class EngineMetadataReconciliationService {
  async reconcileEngine(engineId: string, tenantId?: string | null): Promise<EngineMetadataReconciliationResult> {
    const engineRepo = (await getDataSource()).getRepository(Engine);
    const attemptedAt = Date.now();
    try {
      const runtime = await runtimeResourceInventoryService.reconcileEngine(engineId, tenantId);
      const deployments = await deploymentDiscoveryService.reconcileEngine(engineId, tenantId);
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
