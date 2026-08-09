import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { configBundleRuntimeReconciliationTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js';

const materializeEngineSet = vi.hoisted(() => vi.fn());
const materializeEngineSetsForEngine = vi.hoisted(() => vi.fn());
const materializeRuntimeResourceSet = vi.hoisted(() => vi.fn());
const materializeForEngine = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/EngineSetService.js', () => ({
  engineSetService: { materializeEngineSet, materializeEngineSetsForEngine },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js', () => ({
  runtimeResourceInventoryService: { materialize: materializeRuntimeResourceSet, materializeForEngine },
}));

describe('configBundleRuntimeReconciliationTaskService', () => {
  const update = vi.fn();
  const find = vi.fn();
  const findOne = vi.fn();
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    update.mockResolvedValue({ affected: 1 });
    find.mockResolvedValue([]);
    findOne.mockResolvedValue(null);
    insert.mockResolvedValue({});
    materializeEngineSet.mockResolvedValue({});
    materializeEngineSetsForEngine.mockResolvedValue([]);
    materializeRuntimeResourceSet.mockResolvedValue({});
    materializeForEngine.mockResolvedValue([]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ update, find, findOne, insert }),
    });
  });

  it('persists one normalized runtime continuation task for an apply run', async () => {
    const task = await configBundleRuntimeReconciliationTaskService.enqueue({
      tenantId: 'tenant-a', applyRunId: 'apply-run-1',
      engineSetIds: ['set-2', 'set-1', 'set-1'], runtimeResourceSetIds: ['runtime-1'], engineIds: ['engine-1'],
    });

    expect(task).toMatchObject({ applyRunId: 'apply-run-1', status: 'queued' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      applyRunId: 'apply-run-1', tenantId: 'tenant-a', engineSetIdsJson: '["set-1","set-2"]', runtimeResourceSetIdsJson: '["runtime-1"]', engineIdsJson: '["engine-1"]',
    }));
  });

  it('runs a claimed task and records completed apply-run reconciliation', async () => {
    find.mockResolvedValueOnce([{
      id: 'runtime-task-1', tenantId: 'tenant-a', applyRunId: 'apply-run-1', status: 'queued',
      engineSetIdsJson: '["set-1"]', runtimeResourceSetIdsJson: '["runtime-1"]', engineIdsJson: '["engine-1"]',
      attempts: 0, nextAttemptAt: null, lastError: null,
    }]);
    findOne.mockResolvedValueOnce({ id: 'apply-run-1', resultJson: JSON.stringify({ reconciliation: { status: 'completed' } }) });

    await expect(configBundleRuntimeReconciliationTaskService.runNext()).resolves.toMatchObject({
      taskId: 'runtime-task-1', status: 'completed', engineSetCount: 1, runtimeResourceSetCount: 1, engineCount: 1,
    });
    expect(materializeEngineSet).toHaveBeenCalledWith('set-1', 'tenant-a');
    expect(materializeRuntimeResourceSet).toHaveBeenCalledWith('runtime-1', 'tenant-a');
    expect(materializeEngineSetsForEngine).toHaveBeenCalledWith('engine-1', 'tenant-a');
    expect(materializeForEngine).toHaveBeenCalledWith('engine-1', 'tenant-a');
    expect(update).toHaveBeenLastCalledWith({ id: 'apply-run-1' }, expect.objectContaining({
      resultJson: expect.stringContaining('"status":"completed"'),
    }));
  });

  it('retries materialization errors and records a failed receipt state', async () => {
    find.mockResolvedValueOnce([{
      id: 'runtime-task-2', tenantId: null, applyRunId: 'apply-run-2', status: 'queued',
      engineSetIdsJson: '["set-1"]', runtimeResourceSetIdsJson: '[]', engineIdsJson: '[]',
      attempts: 1, nextAttemptAt: null, lastError: null,
    }]);
    materializeEngineSet.mockRejectedValueOnce(new Error('env://ENGINE_TOKEN Bearer secret-value https://private.internal'));
    findOne.mockResolvedValueOnce({ id: 'apply-run-2', resultJson: JSON.stringify({ reconciliation: { status: 'completed' } }) });

    await expect(configBundleRuntimeReconciliationTaskService.runNext()).resolves.toMatchObject({
      taskId: 'runtime-task-2', status: 'queued', attempts: 2,
      lastError: 'Configuration runtime reconciliation failed; inspect protected server logs',
    });
    expect(JSON.stringify(update.mock.calls)).not.toContain('ENGINE_TOKEN');
    expect(JSON.stringify(update.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(update.mock.calls)).not.toContain('private.internal');
    expect(update).toHaveBeenLastCalledWith({ id: 'apply-run-2' }, expect.objectContaining({
      resultJson: expect.stringContaining('"status":"failed"'),
    }));
  });
});
