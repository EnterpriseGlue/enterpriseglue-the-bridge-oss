import { describe, expect, it, vi } from 'vitest';

import { AddReleaseEffectCohorts1700000000131 } from '@enterpriseglue/shared/db/migrations/1700000000131-add-release-effect-cohorts.js';

function runner(database: string) {
  const createdTables: any[] = [];
  return {
    connection: {
      options: { type: database },
      getMetadata: vi.fn(() => ({ tablePath: 'main.release_effect_cohorts' })),
    },
    hasTable: vi.fn(async () => false),
    createTable: vi.fn(async (table: any) => { createdTables.push(table); }),
    dropTable: vi.fn(async () => undefined),
    createdTables,
  } as any;
}

describe('AddReleaseEffectCohorts1700000000131', () => {
  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner'])(
    'creates the portable durable cohort state on %s',
    async (database) => {
      const queryRunner = runner(database);
      await new AddReleaseEffectCohorts1700000000131().up(queryRunner);
      expect(queryRunner.createdTables).toHaveLength(1);
      const table = queryRunner.createdTables[0];
      expect(table.name).toBe('main.release_effect_cohorts');
      expect(table.columns.map((column: { name: string }) => column.name)).toEqual([
        'id', 'release_id', 'cohort_epoch', 'state', 'revision', 'inventory_version',
        'inventory_sha256', 'opened_at', 'closed_at', 'settled_at', 'updated_at',
      ]);
      expect(table.indices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'idx_release_effect_cohort_identity',
          columnNames: ['release_id'],
          isUnique: true,
        }),
      ]));
      const keyedText = table.columns.find((column: { name: string }) => column.name === 'release_id');
      if (database === 'mysql') expect(keyedText.type).toBe('varchar');
      if (database === 'oracle') expect(keyedText.type).toBe('varchar2');
      if (database === 'mssql') expect(keyedText.type).toBe('varchar');
      if (database === 'spanner') expect(keyedText.type).toBe('string');
    },
  );
});
