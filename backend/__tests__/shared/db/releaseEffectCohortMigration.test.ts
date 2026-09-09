import { describe, expect, it, vi } from 'vitest';

import { AddReleaseEffectCohorts1700000000131 } from '@enterpriseglue/shared/db/migrations/1700000000131-add-release-effect-cohorts.js';

const postgresColumns = [
  ['id', 'text', true, null, true], ['release_id', 'text', true, null, false],
  ['cohort_epoch', 'bigint', true, null, false], ['state', 'text', true, null, false],
  ['revision', 'bigint', true, '1', false], ['inventory_version', 'text', true, null, false],
  ['inventory_sha256', 'text', true, null, false], ['opened_at', 'bigint', true, null, false],
  ['closed_at', 'bigint', false, null, false], ['settled_at', 'bigint', false, null, false],
  ['updated_at', 'bigint', true, null, false],
].map(([name, data_type, not_null, default_expression, primary_key]) => ({
  name, data_type, not_null, default_expression, primary_key,
}));
const postgresIndex = {
  unique_index: true, valid_index: true, ready_index: true, live_index: true,
  predicate_free: true, expression_free: true, key_count: 1, attribute_count: 1,
  key_columns: ['release_id'],
};

function runner(database: string) {
  const createdTables: any[] = [];
  return {
    connection: {
      options: { type: database },
      getMetadata: vi.fn(() => ({ tablePath: 'main.release_effect_cohorts' })),
      entityMetadatas: [],
    },
    hasTable: vi.fn(async () => false),
    createTable: vi.fn(async (table: any) => { createdTables.push(table); }),
    getTable: vi.fn(async () => createdTables.at(-1)?.clone()),
    query: vi.fn(async (sql: string) => sql.includes('a.attname AS name') ? postgresColumns : [postgresIndex]),
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

  it('rejects a pre-existing relation before any mutation', async () => {
    const queryRunner = runner('postgres');
    queryRunner.hasTable.mockResolvedValue(true);
    await expect(new AddReleaseEffectCohorts1700000000131().up(queryRunner)).rejects.toThrow(
      /refuses a pre-existing release_effect_cohorts relation/,
    );
    expect(queryRunner.createTable).not.toHaveBeenCalled();
  });

  it('rejects post-DDL shape drift before installing compatibility policies', async () => {
    const queryRunner = runner('postgres');
    queryRunner.query.mockImplementation(async (sql: string) =>
      sql.includes('a.attname AS name') ? postgresColumns.slice(1) : [postgresIndex]);
    await expect(new AddReleaseEffectCohorts1700000000131().up(queryRunner)).rejects.toThrow(
      /unexpected PostgreSQL column definition/,
    );
  });

  it('rejects a partial unique release identity index', async () => {
    const queryRunner = runner('postgres');
    queryRunner.query.mockImplementation(async (sql: string) => sql.includes('a.attname AS name')
      ? postgresColumns
      : [{ ...postgresIndex, predicate_free: false }]);
    await expect(new AddReleaseEffectCohorts1700000000131().up(queryRunner)).rejects.toThrow(
      /unexpected PostgreSQL identity index/,
    );
  });
});
