import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityReconciliationCheckpoint } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityReconciliationCheckpoint.js';
import { IsNull, MoreThan } from 'typeorm';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

class IdentityReconciliationCheckpointService {
  async acquire(
    providerId: string,
    tenantId?: string | null,
    leaseMs = 60_000,
    minimumIntervalMs = 0,
  ): Promise<{ leaseId: string; cursor: string | null } | null> {
    const repo = (await getDataSource()).getRepository(IdentityReconciliationCheckpoint);
    const now = Date.now();
    let row = await repo.findOne({ where: { providerId } });
    const leaseId = generateId();
    if (!row) {
      try {
        await repo.insert({
          id: generateId(),
          tenantId: tenantId || null,
          providerId,
          cursor: null,
          lastSuccessAt: null,
          leaseId,
          leaseExpiresAt: now + leaseMs,
          updatedAt: now,
        });
        return { leaseId, cursor: null };
      } catch (error) {
        // The provider key is unique. A simultaneous initial insert means another
        // scheduler won the lease; re-read its row before deciding whether to stop.
        row = await repo.findOne({ where: { providerId } });
        if (!row) throw error;
      }
    }

    if (row.leaseExpiresAt && row.leaseExpiresAt > now) return null;
    if (row.lastSuccessAt && minimumIntervalMs > 0 && row.lastSuccessAt + minimumIntervalMs > now) return null;

    // An expired lease is visible to every poller. Only acquire it if its observed
    // values are still current, so competing schedulers cannot both run a page.
    const result = await repo.update({
      id: row.id,
      leaseId: row.leaseId ?? IsNull(),
      leaseExpiresAt: row.leaseExpiresAt ?? IsNull(),
    }, { leaseId, leaseExpiresAt: now + leaseMs, updatedAt: now });
    if (result.affected !== 1) return null;
    return { leaseId, cursor: row.cursor };
  }

  /**
   * Renews only a lease that is still owned and unexpired. Returning false is
   * the caller's signal to stop before applying any more authoritative writes.
   */
  async renew(providerId: string, leaseId: string, leaseMs = 60_000): Promise<boolean> {
    const repo = (await getDataSource()).getRepository(IdentityReconciliationCheckpoint);
    const now = Date.now();
    const result = await repo.update({
      providerId,
      leaseId,
      leaseExpiresAt: MoreThan(now),
    }, {
      leaseExpiresAt: now + leaseMs,
      updatedAt: now,
    });
    return result.affected === 1;
  }

  async complete(providerId: string, leaseId: string, cursor: string | null): Promise<boolean> {
    const repo = (await getDataSource()).getRepository(IdentityReconciliationCheckpoint);
    const now = Date.now();
    const result = await repo.update({ providerId, leaseId, leaseExpiresAt: MoreThan(now) }, {
      cursor,
      lastSuccessAt: now,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: now,
    });
    return result.affected === 1;
  }

  async release(providerId: string, leaseId: string): Promise<void> {
    const repo = (await getDataSource()).getRepository(IdentityReconciliationCheckpoint);
    await repo.update({ providerId, leaseId }, { leaseId: null, leaseExpiresAt: null, updatedAt: Date.now() });
  }
}
export const identityReconciliationCheckpointService = new IdentityReconciliationCheckpointService();
