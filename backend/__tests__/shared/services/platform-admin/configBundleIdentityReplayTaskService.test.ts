import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { configBundleIdentityReplayTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js';

const replayMemberships = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({
  ssoNormalizedIdentityService: { replayMemberships },
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

  it('completes one claimed continuation page and aggregates its counters', async () => {
    find.mockResolvedValueOnce([{
      id: 'task-1', tenantId: 'tenant-a', applyRunId: 'run-1', providerId: 'provider-1', status: 'queued', cursor: 'page-2',
      attempts: 0, scanned: 500, created: 3, removed: 1, failed: 0,
    }]);
    replayMemberships.mockResolvedValueOnce({ scanned: 12, created: 2, removed: 1, failed: 0, truncated: false, nextCursor: null });

    await expect(configBundleIdentityReplayTaskService.runNextPage({ pageLimit: 100 })).resolves.toMatchObject({
      taskId: 'task-1', status: 'completed', scanned: 512, created: 5, removed: 2, failed: 0, truncated: false,
    });
    expect(replayMemberships).toHaveBeenCalledWith({ tenantId: 'tenant-a', providerIds: ['provider-1'], cursor: 'page-2', limit: 100 });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'task-1' }), expect.objectContaining({ status: 'completed', cursor: null, scanned: 512, created: 5, removed: 2 }));
  });

  it('queues truncated continuation work and retries failures with backoff', async () => {
    find.mockResolvedValueOnce([{
      id: 'task-2', tenantId: null, applyRunId: 'run-2', providerId: 'provider-2', status: 'queued', cursor: 'page-3',
      attempts: 1, scanned: 0, created: 0, removed: 0, failed: 0,
    }]);
    replayMemberships.mockRejectedValueOnce(new Error('identity store unavailable'));

    await expect(configBundleIdentityReplayTaskService.runNextPage()).resolves.toMatchObject({ taskId: 'task-2', status: 'queued', failed: 1, truncated: true, nextCursor: 'page-3' });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'task-2' }), expect.objectContaining({ status: 'queued', attempts: 2, lastError: 'identity store unavailable' }));
  });
});
