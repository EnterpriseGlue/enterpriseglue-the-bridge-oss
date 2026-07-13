import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SamlAssertionReplay } from '@enterpriseglue/shared/infrastructure/persistence/entities/SamlAssertionReplay.js';
import { samlAssertionReplayService } from '@enterpriseglue/shared/services/platform-admin/SamlAssertionReplayService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/utils/id.js', () => ({ generateId: vi.fn(() => 'replay-1') }));

describe('samlAssertionReplayService', () => {
  const removeExpired = vi.fn();
  const findOne = vi.fn();
  const insert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    removeExpired.mockResolvedValue(undefined);
    findOne.mockResolvedValue(null);
    insert.mockResolvedValue(undefined);
    (getDataSource as any).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === SamlAssertionReplay) return { delete: removeExpired, findOne, insert };
      throw new Error('Unexpected repository');
    }});
  });

  it('stores only a short-lived provider-scoped hash after a validated assertion is consumed', async () => {
    await samlAssertionReplayService.consume({ providerId: 'provider-1', tenantId: 'tenant-a', samlResponse: 'signed-assertion', now: 1000, ttlMs: 5000 });

    expect(removeExpired).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'replay-1', tenantId: 'tenant-a', providerId: 'provider-1', expiresAt: 6000, createdAt: 1000,
      responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(insert.mock.calls[0][0].responseHash).not.toBe('signed-assertion');
  });

  it('fails closed when the same provider has already consumed the assertion hash', async () => {
    findOne.mockResolvedValue({ id: 'replay-1', providerId: 'provider-1' });
    await expect(samlAssertionReplayService.consume({ providerId: 'provider-1', samlResponse: 'signed-assertion' }))
      .rejects.toMatchObject({ statusCode: 401 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('maps a concurrent unique constraint conflict to the same replay denial', async () => {
    insert.mockRejectedValue({ code: '23505' });
    await expect(samlAssertionReplayService.consume({ providerId: 'provider-1', samlResponse: 'signed-assertion' }))
      .rejects.toMatchObject({ statusCode: 401 });
  });
});
