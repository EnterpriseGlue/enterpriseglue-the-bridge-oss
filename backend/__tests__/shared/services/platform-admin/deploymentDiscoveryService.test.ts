import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { getDeployments } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { deploymentDiscoveryService } from '@enterpriseglue/shared/services/platform-admin/DeploymentDiscoveryService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({ getDeployments: vi.fn() }));

function setup() {
  const deploymentRepo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn(), update: vi.fn() };
  const artifactRepo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn() };
  const resourceRepo = { find: vi.fn().mockResolvedValue([]) };
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository(entity: unknown) {
      if (entity === EngineDeployment) return deploymentRepo;
      if (entity === EngineDeploymentArtifact) return artifactRepo;
      if (entity === RuntimeResource) return resourceRepo;
      throw new Error('Unexpected repository');
    },
  });
  return { deploymentRepo, artifactRepo, resourceRepo };
}

describe('deploymentDiscoveryService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates discovered history and nullable-project artifacts from runtime deployment ids', async () => {
    const { deploymentRepo, artifactRepo, resourceRepo } = setup();
    vi.mocked(getDeployments).mockResolvedValue([{ id: 'camunda-1', name: 'payment release', deploymentTime: '2026-07-13T10:00:00.000Z' }]);
    resourceRepo.find.mockResolvedValue([{ resourceKind: 'process_definition', resourceKey: 'payment-order', engineResourceId: 'process:1', version: 2, runtimeTenantId: '', deploymentId: 'camunda-1', tenantId: 'tenant-a' }]);

    const result = await deploymentDiscoveryService.reconcileEngine('engine-1', 'tenant-a');

    expect(result).toEqual({ created: 1, updated: 0, artifactsCreated: 1 });
    expect(deploymentRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1', projectId: null, camundaDeploymentId: 'camunda-1', ingestionSource: 'engine_discovery', lineageQuality: 'discovered',
    }));
    expect(artifactRepo.insert).toHaveBeenCalledWith([expect.objectContaining({
      projectId: null, artifactKind: 'process', artifactKey: 'payment-order', artifactVersion: 2,
    })]);
  });

  it('updates known deployment metadata without replacing its stronger lineage', async () => {
    const { deploymentRepo } = setup();
    deploymentRepo.find.mockResolvedValue([{ id: 'history-1', camundaDeploymentId: 'camunda-1', camundaDeploymentName: 'old', camundaDeploymentTime: null }]);
    vi.mocked(getDeployments).mockResolvedValue([{ id: 'camunda-1', name: 'new', deploymentTime: '2026-07-13T10:00:00.000Z' }]);

    await expect(deploymentDiscoveryService.reconcileEngine('engine-1', 'tenant-a')).resolves.toEqual({ created: 0, updated: 1, artifactsCreated: 0 });
    expect(deploymentRepo.update).toHaveBeenCalledWith('history-1', expect.objectContaining({ camundaDeploymentName: 'new' }));
    expect(deploymentRepo.insert).not.toHaveBeenCalled();
  });

  it('does not duplicate discovered history or artifacts when a deployment is replayed', async () => {
    const { deploymentRepo, artifactRepo, resourceRepo } = setup();
    deploymentRepo.find.mockResolvedValue([{
      id: 'history-1', camundaDeploymentId: 'camunda-1', camundaDeploymentName: 'payment release',
      camundaDeploymentTime: '2026-07-13T10:00:00.000Z', lineageQuality: 'discovered',
    }]);
    artifactRepo.find.mockResolvedValue([{
      engineDeploymentId: 'history-1', artifactKind: 'process', artifactKey: 'payment-order', artifactVersion: 2, tenantId: null,
    }]);
    vi.mocked(getDeployments).mockResolvedValue([{ id: 'camunda-1', name: 'payment release', deploymentTime: '2026-07-13T10:00:00.000Z' }]);
    resourceRepo.find.mockResolvedValue([{
      resourceKind: 'process_definition', resourceKey: 'payment-order', engineResourceId: 'process:1', version: 2,
      runtimeTenantId: '', deploymentId: 'camunda-1', tenantId: 'tenant-a',
    }]);

    await expect(deploymentDiscoveryService.reconcileEngine('engine-1', 'tenant-a')).resolves.toEqual({
      created: 0, updated: 1, artifactsCreated: 0,
    });
    expect(deploymentRepo.insert).not.toHaveBeenCalled();
    expect(artifactRepo.insert).not.toHaveBeenCalled();
  });
});
