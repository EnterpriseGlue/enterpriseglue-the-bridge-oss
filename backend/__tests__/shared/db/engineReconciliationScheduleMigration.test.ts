import { describe, expect, it, vi } from 'vitest';
import { AddEngineReconciliationSchedule1700000000074 } from '@enterpriseglue/shared/db/migrations/1700000000074-add-engine-reconciliation-schedule.js';

describe('AddEngineReconciliationSchedule1700000000074', () => {
  it('adds missing scheduling and diagnostic columns', async () => {
    const addColumn = vi.fn();
    const queryRunner = {
      hasTable: vi.fn().mockResolvedValue(true),
      hasColumn: vi.fn().mockResolvedValue(false),
      addColumn,
    };

    await new AddEngineReconciliationSchedule1700000000074().up(queryRunner as any);

    expect(addColumn.mock.calls.map(([, column]) => column.name)).toEqual([
      'reconciliation_interval_seconds',
      'last_metadata_reconciled_at',
      'last_metadata_reconciliation_status',
    ]);
  });

  it('is idempotent when the columns already exist', async () => {
    const addColumn = vi.fn();
    const queryRunner = {
      hasTable: vi.fn().mockResolvedValue(true),
      hasColumn: vi.fn().mockResolvedValue(true),
      addColumn,
    };

    await new AddEngineReconciliationSchedule1700000000074().up(queryRunner as any);

    expect(addColumn).not.toHaveBeenCalled();
  });
});
