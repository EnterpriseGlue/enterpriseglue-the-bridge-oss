import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { DeploymentReceipt } from '@enterpriseglue/shared/infrastructure/persistence/entities/DeploymentReceipt.js';
import { deploymentReceiptService } from '@enterpriseglue/shared/services/platform-admin/DeploymentReceiptService.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

function setup(existing: Record<string, unknown> | null = null) {
  const receiptRepo = { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(existing), insert: vi.fn().mockResolvedValue(undefined) };
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository(entity: unknown) {
      if (entity === DeploymentReceipt) return receiptRepo;
      throw new Error('Unexpected repository');
    },
  });
  return receiptRepo;
}

describe('deploymentReceiptService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(runtimeResourceInventoryService, 'observe').mockResolvedValue({ created: 1, updated: 0 });
    vi.spyOn(runtimeResourceInventoryService, 'materializeForEngine').mockResolvedValue([]);
  });

  it('persists a sanitized receipt and reports its runtime resources', async () => {
    const repo = setup();

    const result = await deploymentReceiptService.record({
      tenantId: 'tenant-a', engineId: 'engine-1', source: 'api_client', sourcePrincipalId: 'client-1',
      idempotencyKey: 'release-001', projectId: 'project-1', engineDeploymentId: 'deployment-1',
      artifacts: [{ resourceKind: 'process_definition', resourceKey: 'payments-order', version: 2 }],
      lineage: { pipelineRunId: 'run-1', commitSha: 'abc123' },
    });

    expect(result).toMatchObject({ idempotent: false, inventory: { created: 1, updated: 0 } });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', idempotencyKey: 'release-001', source: 'api_client',
      lineageJson: expect.stringContaining('pipelineRunId'),
    }));
    expect(runtimeResourceInventoryService.observe).toHaveBeenCalledWith('engine-1', 'tenant-a', [expect.objectContaining({
      resourceKind: 'process_definition', resourceKey: 'payments-order', deploymentId: 'deployment-1', projectId: 'project-1', source: 'deployment_receipt',
    })]);
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
    const repo = setup();
    repo.find.mockResolvedValue([{
      id: 'receipt-1', projectId: 'project-1', engineId: 'engine-1', engineDeploymentId: 'deployment-1', source: 'api_client', receivedAt: 123,
      lineageJson: JSON.stringify({ source: 'api_client', sourcePrincipalId: 'client-1', pipelineRunId: 'run-1', ignoredSecret: 'must-not-leak' }),
    }]);

    await expect(deploymentReceiptService.listForEngine('engine-1', 'tenant-a')).resolves.toEqual([{
      id: 'receipt-1', projectId: 'project-1', engineId: 'engine-1', engineDeploymentId: 'deployment-1', source: 'api_client', receivedAt: 123,
      lineage: { source: 'api_client', sourcePrincipalId: 'client-1', pipelineRunId: 'run-1' },
    }]);
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
