import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityReconciliationCheckpoint } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityReconciliationCheckpoint.js';
import { identityReconciliationCheckpointService } from '@enterpriseglue/shared/services/platform-admin/IdentityReconciliationCheckpointService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

function setup(row: Record<string, unknown> | null) {
  const repo = {
    findOne: vi.fn().mockResolvedValue(row),
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };
  (getDataSource as unknown as Mock).mockResolvedValue({
    getRepository(entity: unknown) {
      if (entity === IdentityReconciliationCheckpoint) return repo;
      throw new Error('Unexpected repository');
    },
  });
  return repo;
}

describe('identityReconciliationCheckpointService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  it('does not acquire a checkpoint again until its configured interval has elapsed', async () => {
    const repo = setup({ id: 'checkpoint-1', cursor: null, lastSuccessAt: 970_000, leaseExpiresAt: null });

    await expect(identityReconciliationCheckpointService.acquire('provider-1', 'tenant-a', 60_000, 60_000)).resolves.toBeNull();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('acquires a checkpoint after its configured interval has elapsed', async () => {
    const repo = setup({ id: 'checkpoint-1', cursor: 'cursor-1', lastSuccessAt: 930_000, leaseExpiresAt: null });

    const lease = await identityReconciliationCheckpointService.acquire('provider-1', 'tenant-a', 60_000, 60_000);

    expect(lease).toMatchObject({ cursor: 'cursor-1' });
    expect(repo.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'checkpoint-1' }), expect.objectContaining({ leaseExpiresAt: 1_060_000 }));
  });

  it('lets only one concurrent poller acquire an expired checkpoint lease', async () => {
    const repo = setup({ id: 'checkpoint-1', cursor: 'cursor-1', lastSuccessAt: null, leaseId: null, leaseExpiresAt: 990_000 });
    repo.update.mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });

    const leases = await Promise.all([
      identityReconciliationCheckpointService.acquire('provider-1', 'tenant-a'),
      identityReconciliationCheckpointService.acquire('provider-1', 'tenant-a'),
    ]);

    expect(leases.filter(Boolean)).toHaveLength(1);
    expect(repo.update).toHaveBeenCalledTimes(2);
  });

  it('treats a competing first checkpoint insert as a lease held by the other poller', async () => {
    const repo = setup(null);
    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'checkpoint-1', cursor: null, lastSuccessAt: null, leaseId: 'other-lease', leaseExpiresAt: 1_060_000 });
    repo.insert.mockRejectedValueOnce(new Error('duplicate provider checkpoint'));

    await expect(identityReconciliationCheckpointService.acquire('provider-1', 'tenant-a')).resolves.toBeNull();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('renews and completes only the current unexpired lease owner', async () => {
    const repo = setup({ id: 'checkpoint-1' });

    await expect(identityReconciliationCheckpointService.renew('provider-1', 'lease-1', 90_000)).resolves.toBe(true);
    expect(repo.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ providerId: 'provider-1', leaseId: 'lease-1' }), expect.objectContaining({ leaseExpiresAt: 1_090_000 }));

    repo.update.mockResolvedValueOnce({ affected: 0 });
    await expect(identityReconciliationCheckpointService.complete('provider-1', 'stale-lease', null)).resolves.toBe(false);
  });
});
