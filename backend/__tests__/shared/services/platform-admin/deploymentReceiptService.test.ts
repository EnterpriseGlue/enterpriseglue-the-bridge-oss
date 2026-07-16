import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { DeploymentReceipt } from '@enterpriseglue/shared/infrastructure/persistence/entities/DeploymentReceipt.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeploymentArtifact.js';
import { deploymentReceiptService } from '@enterpriseglue/shared/services/platform-admin/DeploymentReceiptService.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

function setup(existing: Record<string, unknown> | null = null) {
  const receiptRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(existing), insert: vi.fn().mockResolvedValue(undefined) };
  const deploymentRepo = { findOne: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) };
  const artifactRepo = { find: vi.fn().mockResolvedValue([]), insert: vi.fn().mockResolvedValue(undefined) };
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository(entity: unknown) {
      if (entity === DeploymentReceipt) return receiptRepo;
      if (entity === EngineDeployment) return deploymentRepo;
      if (entity === EngineDeploymentArtifact) return artifactRepo;
      throw new Error('Unexpected repository');
    },
  });
  return { receiptRepo, deploymentRepo, artifactRepo };
}

describe('deploymentReceiptService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(runtimeResourceInventoryService, 'observe').mockResolvedValue({ created: 1, updated: 0 });
    vi.spyOn(runtimeResourceInventoryService, 'materializeForEngine').mockResolvedValue([]);
  });

  it('persists a sanitized receipt and reports its runtime resources', async () => {
    const { receiptRepo, deploymentRepo, artifactRepo } = setup();

    const result = await deploymentReceiptService.record({
      tenantId: 'tenant-a', engineId: 'engine-1', source: 'api_client', sourcePrincipalId: 'client-1',
      idempotencyKey: 'release-001', projectId: 'project-1', engineDeploymentId: 'deployment-1',
      artifacts: [{ resourceKind: 'process_definition', resourceKey: 'payments-order', version: 2 }],
      lineage: { pipelineRunId: 'run-1', commitSha: 'abc123' },
    });

    expect(result).toMatchObject({ idempotent: false, inventory: { created: 1, updated: 0 } });
    expect(receiptRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', idempotencyKey: 'release-001', source: 'api_client',
      lineageJson: expect.stringContaining('pipelineRunId'),
    }));
    expect(deploymentRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1', projectId: 'project-1', camundaDeploymentId: 'deployment-1',
      ingestionSource: 'pipeline_receipt', lineageQuality: 'reported', reportingPrincipalId: 'client-1',
    }));
    expect(artifactRepo.insert).toHaveBeenCalledWith([expect.objectContaining({
      artifactKind: 'process', artifactKey: 'payments-order', artifactVersion: 2,
    })]);
    expect(runtimeResourceInventoryService.observe).toHaveBeenCalledWith('engine-1', 'tenant-a', [expect.objectContaining({
      resourceKind: 'process_definition', resourceKey: 'payments-order', deploymentId: 'deployment-1', projectId: 'project-1', source: 'deployment_receipt',
    })]);
    expect(runtimeResourceInventoryService.materializeForEngine).toHaveBeenCalledWith('engine-1', 'tenant-a');
  });

  it('returns an idempotent response without changing inventory for an existing matching receipt', async () => {
    setup({ id: 'receipt-1', projectId: 'project-1', engineId: 'engine-1', engineDeploymentId: 'deployment-1' });

    await expect(deploymentReceiptService.record({
      engineId: 'engine-1', source: 'service_account', sourcePrincipalId: 'service-1',
      idempotencyKey: 'release-001', projectId: 'project-1', engineDeploymentId: 'deployment-1',
      artifacts: [{ resourceKind: 'process_definition', resourceKey: 'payments-order' }],
    })).resolves.toEqual({ receiptId: 'receipt-1', idempotent: true, inventory: { created: 0, updated: 0 }, materializedResourceSets: 0 });
    expect(runtimeResourceInventoryService.observe).not.toHaveBeenCalled();
  });

  it('lists only the sanitized receipt lineage for an engine', async () => {
    const { receiptRepo } = setup();
    receiptRepo.find.mockResolvedValue([{
      id: 'receipt-1', projectId: 'project-1', engineId: 'engine-1', engineDeploymentId: 'deployment-1', source: 'api_client', receivedAt: 123,
      lineageJson: JSON.stringify({ source: 'api_client', sourcePrincipalId: 'client-1', pipelineRunId: 'run-1', ignoredSecret: 'must-not-leak' }),
    }]);

    await expect(deploymentReceiptService.listForEngine('engine-1', 'tenant-a')).resolves.toEqual([{
      id: 'receipt-1', projectId: 'project-1', engineId: 'engine-1', engineDeploymentId: 'deployment-1', source: 'api_client', receivedAt: 123,
      lineage: { source: 'api_client', sourcePrincipalId: 'client-1', pipelineRunId: 'run-1' },
    }]);
    expect(receiptRepo.find).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('enriches an existing complete proxy deployment without downgrading its lineage quality', async () => {
    const { deploymentRepo, artifactRepo } = setup();
    deploymentRepo.findOne.mockResolvedValue({
      id: 'history-1', projectId: 'project-1', gitCommitSha: 'proxy-sha', resourceCount: 1,
      lineageQuality: 'complete', lineageJson: JSON.stringify({ source: 'enterpriseglue_proxy' }),
    });
    artifactRepo.find.mockResolvedValue([{
      artifactKind: 'process', artifactKey: 'payments-order', artifactVersion: 1, tenantId: null,
    }]);

    await deploymentReceiptService.record({
      engineId: 'engine-1', source: 'service_account', sourcePrincipalId: 'release-1',
      idempotencyKey: 'release-002', projectId: 'project-1', engineDeploymentId: 'deployment-1',
      artifacts: [
        { resourceKind: 'process_definition', resourceKey: 'payments-order', version: 1 },
        { resourceKind: 'decision_definition', resourceKey: 'credit-check', version: 3, runtimeTenantId: 'tenant-a' },
      ],
      lineage: { pipelineRunId: 'run-2', commitSha: 'receipt-sha' },
    });

    expect(deploymentRepo.update).toHaveBeenCalledWith('history-1', expect.objectContaining({
      lineageQuality: 'complete', reportingPrincipalId: 'release-1', resourceCount: 2,
      lineageJson: expect.stringContaining('run-2'),
    }));
    expect(artifactRepo.insert).toHaveBeenCalledWith([expect.objectContaining({
      engineDeploymentId: 'history-1', artifactKind: 'decision', artifactKey: 'credit-check', artifactVersion: 3,
    })]);
  });
});
