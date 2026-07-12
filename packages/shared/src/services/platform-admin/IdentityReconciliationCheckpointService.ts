import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityReconciliationCheckpoint } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityReconciliationCheckpoint.js';
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
    if (row && row.leaseExpiresAt && row.leaseExpiresAt > now) return null;
    if (row?.lastSuccessAt && minimumIntervalMs > 0 && row.lastSuccessAt + minimumIntervalMs > now) return null;

    const leaseId = generateId();
    if (!row) {
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
    }

    await repo.update({ id: row.id }, { leaseId, leaseExpiresAt: now + leaseMs, updatedAt: now });
    return { leaseId, cursor: row.cursor };
  }

  async complete(providerId: string, leaseId: string, cursor: string | null): Promise<void> {
    const repo = (await getDataSource()).getRepository(IdentityReconciliationCheckpoint);
    const row = await repo.findOne({ where: { providerId, leaseId } });
    if (row) {
      await repo.update({ id: row.id }, {
        cursor,
        lastSuccessAt: Date.now(),
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: Date.now(),
      });
    }
  }

  async release(providerId: string, leaseId: string): Promise<void> {
    const repo = (await getDataSource()).getRepository(IdentityReconciliationCheckpoint);
    await repo.update({ providerId, leaseId }, { leaseId: null, leaseExpiresAt: null, updatedAt: Date.now() });
  }
}
export const identityReconciliationCheckpointService = new IdentityReconciliationCheckpointService();
