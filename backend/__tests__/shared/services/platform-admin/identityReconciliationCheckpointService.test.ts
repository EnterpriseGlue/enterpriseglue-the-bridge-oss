import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityReconciliationCheckpoint } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityReconciliationCheckpoint.js';
import { identityReconciliationCheckpointService } from '@enterpriseglue/shared/services/platform-admin/IdentityReconciliationCheckpointService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

function setup(row: Record<string, unknown> | null) {
  const repo = {
    findOne: vi.fn().mockResolvedValue(row),
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
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
    expect(repo.update).toHaveBeenCalledWith({ id: 'checkpoint-1' }, expect.objectContaining({ leaseExpiresAt: 1_060_000 }));
  });
});
