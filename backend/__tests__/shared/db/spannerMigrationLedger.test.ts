import { ensureSpannerTypeOrmMigrationLedgerV1 } from '@enterpriseglue/shared/db/spanner-migration-ledger.js';
import { describe, expect, it, vi } from 'vitest';

describe('ensureSpannerTypeOrmMigrationLedgerV1', () => {
  it('derives the generated ledger key from the full migration name', async () => {
    const updateDDL = vi.fn(async (_statement: string) => undefined);
    const release = vi.fn(async () => undefined);
    const dataSource = {
      options: { type: 'spanner' },
      driver: { escape: (name: string) => `\`${name}\`` },
      createQueryRunner: () => ({
        hasTable: vi.fn(async () => false),
        updateDDL,
        release,
      }),
    } as any;

    await ensureSpannerTypeOrmMigrationLedgerV1(dataSource);

    expect(updateDDL).toHaveBeenCalledOnce();
    expect(updateDDL.mock.calls[0]?.[0]).toContain(
      '`id` INT64 AS (FARM_FINGERPRINT(`name`)) STORED',
    );
    expect(updateDDL.mock.calls[0]?.[0]).toContain(
      'PRIMARY KEY (`id`)',
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
