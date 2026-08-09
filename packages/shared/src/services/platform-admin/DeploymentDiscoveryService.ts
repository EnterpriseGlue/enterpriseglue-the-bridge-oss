import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { getDeployments } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import type { Deployment } from '@enterpriseglue/shared/types/bpmn-engine-api.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { DeploymentDiscoveryResultSchema, type DeploymentDiscoveryResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

export type { DeploymentDiscoveryResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

/** Records engine-observed deployment metadata without ever guessing project/file lineage. */
class DeploymentDiscoveryService {
  async reconcileEngine(engineId: string, tenantId?: string | null): Promise<DeploymentDiscoveryResult> {
    const [deployments, dataSource] = await Promise.all([getDeployments<Deployment[]>(engineId), getDataSource()]);
    const deploymentRepo = dataSource.getRepository(EngineDeployment);
    const artifactRepo = dataSource.getRepository(EngineDeploymentArtifact);
    const resourceRepo = dataSource.getRepository(RuntimeResource);
    const existing = await deploymentRepo.find({ where: { engineId } });
    const byExternalId = new Map(existing.filter((row) => row.camundaDeploymentId).map((row) => [row.camundaDeploymentId!, row]));
    const runtimeResources = await resourceRepo.find({ where: { engineId, isActive: true } });
    const now = Date.now();
    let created = 0;
    let updated = 0;
    let artifactsCreated = 0;

    for (const deployment of deployments || []) {
      if (!deployment?.id) continue;
      const prior = byExternalId.get(deployment.id);
      const historyId = prior?.id || generateId();
      if (prior) {
        await deploymentRepo.update(prior.id, {
          camundaDeploymentName: deployment.name || prior.camundaDeploymentName,
          camundaDeploymentTime: deployment.deploymentTime || prior.camundaDeploymentTime,
          reconciledAt: now,
          updatedAt: now,
        });
        updated += 1;
      } else {
        await deploymentRepo.insert({
          id: historyId, projectId: null, engineId, engineName: null, environmentTag: null, engineBaseUrl: null,
          gitDeploymentId: null, gitCommitSha: null, gitCommitMessage: null,
          camundaDeploymentId: deployment.id, camundaDeploymentName: deployment.name || null, camundaDeploymentTime: deployment.deploymentTime || null,
          deployedBy: 'engine_discovery', deployedAt: now, enableDuplicateFiltering: false, deployChangedOnly: false,
          resourceCount: 0, status: 'success', errorMessage: null, rawResponse: null,
          ingestionSource: 'engine_discovery', lineageQuality: 'discovered', reportingPrincipalId: null, reconciledAt: now,
          lineageJson: JSON.stringify({ source: 'engine_discovery', ...(deployment.source ? { engineSource: deployment.source } : {}) }), createdAt: now, updatedAt: now,
        });
        created += 1;
      }

      const resources = runtimeResources.filter((resource) => resource.deploymentId === deployment.id && (resource.tenantId || null) === (tenantId || null));
      if (!resources.length) continue;
      const artifactRows = await artifactRepo.find({ where: { engineDeploymentId: historyId } });
      const keys = new Set(artifactRows.map((row) => `${row.artifactKind}|${row.artifactKey}|${row.artifactVersion}|${row.tenantId || ''}`));
      const additions = resources.filter((resource) => !keys.has(`${resource.resourceKind === 'process_definition' ? 'process' : 'decision'}|${resource.resourceKey}|${resource.version || 0}|${resource.runtimeTenantId || ''}`))
        .map((resource) => ({
          id: generateId(), engineDeploymentId: historyId, projectId: null, engineId, fileId: null, fileType: null, fileName: null,
          fileUpdatedAt: null, fileContentHash: null, fileGitCommitId: null, fileGitCommitMessage: null,
          resourceName: resource.resourceKey, artifactKind: resource.resourceKind === 'process_definition' ? 'process' : 'decision',
          artifactId: resource.engineResourceId || resource.resourceKey, artifactKey: resource.resourceKey, artifactVersion: resource.version || 0,
          tenantId: resource.runtimeTenantId || null, createdAt: now,
        }));
      if (additions.length) { await artifactRepo.insert(additions); artifactsCreated += additions.length; }
    }
    return DeploymentDiscoveryResultSchema.parse({ created, updated, artifactsCreated });
  }
}

export const deploymentDiscoveryService = new DeploymentDiscoveryService();
