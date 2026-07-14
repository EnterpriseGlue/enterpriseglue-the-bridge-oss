import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { configBundleIdentityReplayTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js';

const replayMemberships = vi.hoisted(() => vi.fn());
const syncDiagnostics = vi.hoisted(() => ({
  startRun: vi.fn().mockResolvedValue('sync-run-1'),
  completeRun: vi.fn().mockResolvedValue(undefined),
  failRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({
  ssoNormalizedIdentityService: { replayMemberships },
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({
  ssoSyncDiagnosticsService: syncDiagnostics,
}));

describe('configBundleIdentityReplayTaskService', () => {
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
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ update, find, findOne, insert }),
    });
  });

  it('creates and persists a provider sync-run link when queueing continuation work', async () => {
    await configBundleIdentityReplayTaskService.enqueue({
      tenantId: 'tenant-a', applyRunId: 'apply-run-1', providerId: 'provider-1', cursor: 'page-2',
      initial: { scanned: 500, created: 3, removed: 1, failed: 0 },
    });

    expect(syncDiagnostics.startRun).toHaveBeenCalledWith({
      tenantId: 'tenant-a', providerId: 'provider-1', trigger: 'mapping_change',
      details: { kind: 'config_bundle_identity_replay', applyRunId: 'apply-run-1' },
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      applyRunId: 'apply-run-1', providerId: 'provider-1', syncRunId: 'sync-run-1', cursor: 'page-2',
    }));
  });

  it('completes one claimed continuation page and aggregates its counters', async () => {
    find.mockResolvedValueOnce([{
      id: 'task-1', tenantId: 'tenant-a', applyRunId: 'run-1', providerId: 'provider-1', syncRunId: 'sync-run-1', status: 'queued', cursor: 'page-2',
      attempts: 0, scanned: 500, created: 3, removed: 1, failed: 0,
    }]);
    replayMemberships.mockResolvedValueOnce({ scanned: 12, created: 2, removed: 1, failed: 0, truncated: false, nextCursor: null });

    await expect(configBundleIdentityReplayTaskService.runNextPage({ pageLimit: 100 })).resolves.toMatchObject({
      taskId: 'task-1', status: 'completed', scanned: 512, created: 5, removed: 2, failed: 0, truncated: false,
    });
    expect(replayMemberships).toHaveBeenCalledWith({ tenantId: 'tenant-a', providerIds: ['provider-1'], cursor: 'page-2', limit: 100 });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'task-1' }), expect.objectContaining({ status: 'completed', cursor: null, scanned: 512, created: 5, removed: 2 }));
    expect(syncDiagnostics.completeRun).toHaveBeenCalledWith('sync-run-1', expect.objectContaining({
      tenantId: 'tenant-a', providerId: 'provider-1', groupMembershipsCreated: 5, groupMembershipsRemoved: 2,
    }));
  });

  it('queues truncated continuation work and retries failures with backoff', async () => {
    find.mockResolvedValueOnce([{
      id: 'task-2', tenantId: null, applyRunId: 'run-2', providerId: 'provider-2', syncRunId: 'sync-run-2', status: 'queued', cursor: 'page-3',
      attempts: 1, scanned: 0, created: 0, removed: 0, failed: 0,
    }]);
    replayMemberships.mockRejectedValueOnce(new Error('identity store unavailable'));

    await expect(configBundleIdentityReplayTaskService.runNextPage()).resolves.toMatchObject({ taskId: 'task-2', status: 'queued', failed: 1, truncated: true, nextCursor: 'page-3' });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'task-2' }), expect.objectContaining({ status: 'queued', attempts: 2, lastError: 'identity store unavailable' }));
    const [runId, error, diagnosticInput] = syncDiagnostics.failRun.mock.calls[0];
    expect(runId).toBe('sync-run-2');
    expect((error as Error).message).toBe('identity store unavailable');
    expect(diagnosticInput).toMatchObject({ details: { applyRunId: 'run-2' } });
  });

  it('drains only the selected apply run and reports completed continuation work', async () => {
    find
      .mockResolvedValueOnce([{
        id: 'task-3', tenantId: null, applyRunId: 'run-3', providerId: 'provider-3', status: 'queued', cursor: 'page-2',
        attempts: 0, scanned: 10, created: 1, removed: 0, failed: 0,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'task-3', tenantId: null, applyRunId: 'run-3', providerId: 'provider-3', status: 'completed', cursor: null,
        attempts: 0, scanned: 15, created: 2, removed: 0, failed: 0,
      }]);
    replayMemberships.mockResolvedValueOnce({ scanned: 5, created: 1, removed: 0, failed: 0, truncated: false, nextCursor: null });

    await expect(configBundleIdentityReplayTaskService.drainApplyRun({ applyRunId: 'run-3', maxPages: 5, pageLimit: 100 })).resolves.toEqual({
      status: 'completed', pagesProcessed: 1, taskCount: 1, activeTaskCount: 0, failedTaskCount: 0,
    });
    expect(find).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.arrayContaining([expect.objectContaining({ applyRunId: 'run-3', status: 'queued' })]),
    }));
    expect(find).toHaveBeenLastCalledWith({ where: { applyRunId: 'run-3' }, order: { createdAt: 'ASC' } });
  });

  it('reports pending when selected apply-run tasks are not currently eligible for retry', async () => {
    find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'task-4', tenantId: 'tenant-a', applyRunId: 'run-4', providerId: 'provider-4', status: 'queued', cursor: 'page-2',
        attempts: 1, nextAttemptAt: Date.now() + 60_000, scanned: 10, created: 0, removed: 0, failed: 0,
      }]);

    await expect(configBundleIdentityReplayTaskService.drainApplyRun({ applyRunId: 'run-4' })).resolves.toEqual({
      status: 'pending', pagesProcessed: 0, taskCount: 1, activeTaskCount: 1, failedTaskCount: 0,
    });
  });

  it('fails closed when a truncated apply has no persisted continuation task', async () => {
    find.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(configBundleIdentityReplayTaskService.drainApplyRun({ applyRunId: 'run-missing' })).resolves.toEqual({
      status: 'failed', pagesProcessed: 0, taskCount: 0, activeTaskCount: 0, failedTaskCount: 0,
    });
  });
});
