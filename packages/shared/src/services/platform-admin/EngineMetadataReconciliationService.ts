import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { deploymentDiscoveryService } from './DeploymentDiscoveryService.js';
import { runtimeResourceInventoryService } from './RuntimeResourceInventoryService.js';
import { EngineMetadataReconciliationResultSchema, type EngineMetadataReconciliationResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

export type { EngineMetadataReconciliationResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

/** One reconciliation boundary for both scheduled and explicitly requested discovery. */
class EngineMetadataReconciliationService {
  async reconcileEngine(engineId: string, tenantId?: string | null, options: { runtimeMetadataDiscoveryEnabled?: boolean; deploymentDiscoveryEnabled?: boolean } = {}): Promise<EngineMetadataReconciliationResult> {
    const engineRepo = (await getDataSource()).getRepository(Engine);
    const engine = await engineRepo.findOne({ where: { id: engineId } });
    const sharedPooled = config.tenancyMode === 'pooled' && engine?.tenancyMode === 'shared';
    const deploymentDiscoveryEnabled = options.deploymentDiscoveryEnabled === undefined
      ? engine?.deploymentDiscoveryEnabled !== false
      : options.deploymentDiscoveryEnabled;
    const attemptedAt = Date.now();
    try {
      const runtime = options.runtimeMetadataDiscoveryEnabled === false
        ? { created: 0, updated: 0, deactivated: 0, materializedSets: 0, runtimeSkipped: true }
        : await runtimeResourceInventoryService.reconcileEngine(engineId, tenantId);
      const deployments = !deploymentDiscoveryEnabled
        ? { created: 0, updated: 0, artifactsCreated: 0, skipped: true }
        : await deploymentDiscoveryService.reconcileEngine(engineId, tenantId);
      // A tenant's success cannot publish engine-wide shared readiness. The
      // scheduled complete-cohort aggregate owns those diagnostics in pooled mode.
      if (!sharedPooled) await engineRepo.update({ id: engineId }, {
        lastMetadataReconciledAt: attemptedAt,
        lastMetadataReconciliationStatus: 'succeeded',
      });
      return EngineMetadataReconciliationResultSchema.parse({ ...runtime, deployments });
    } catch (error) {
      try {
        if (!sharedPooled) await engineRepo.update({ id: engineId }, {
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
