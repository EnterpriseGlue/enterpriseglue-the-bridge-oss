import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { EngineBackstopGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopGroupMapping.js';
import { EngineBackstopSyncRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { EngineBackstopSyncTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { AddEngineBackstopFoundation1700000000101 } from '@enterpriseglue/shared/db/migrations/1700000000101-add-engine-backstop-foundation.js';
import { AddEngineBackstopDriftObservations1700000000102 } from '@enterpriseglue/shared/db/migrations/1700000000102-add-engine-backstop-drift-observations.js';

function columns(entity: Function): string[] {
  return getMetadataArgsStorage().columns
    .filter((candidate) => candidate.target === entity)
    .map((candidate) => String(candidate.options.name || candidate.propertyName));
}

describe('mirrored engine backstop persistence', () => {
  it('stores native identities and owned grant details separately from ordinary receipts', () => {
    expect(columns(EngineBackstopGroupMapping)).toEqual(expect.arrayContaining([
      'tenant_id', 'engine_id', 'authz_group_id', 'encrypted_native_group_id', 'native_group_reference', 'is_active',
    ]));
    expect(columns(EngineBackstopSyncRun)).toEqual(expect.arrayContaining([
      'source_hash', 'desired_hash', 'result_hash', 'classifications_json', 'encrypted_detailed_snapshot', 'detailed_snapshot_expires_at',
      'observed_of_run_id',
    ]));
    expect(columns(EngineBackstopSyncTask)).toEqual(expect.arrayContaining([
      'run_id', 'source_hash', 'operation', 'lease_id', 'lease_expires_at', 'next_attempt_at',
    ]));
    const mappingUniques = getMetadataArgsStorage().uniques.filter((candidate) => candidate.target === EngineBackstopGroupMapping);
    expect(mappingUniques.map((unique) => unique.columns)).toEqual(expect.arrayContaining([
      ['engineId', 'authzGroupId'], ['engineId', 'nativeGroupReference'], ['engineId', 'source', 'sourceRef'],
    ]));
  });

  it('creates all three tables idempotently and deletes them in dependency order', async () => {
    const createTable = vi.fn().mockResolvedValue(undefined);
    const dropTable = vi.fn().mockResolvedValue(undefined);
    const migration = new AddEngineBackstopFoundation1700000000101();
    await migration.up({ hasTable: vi.fn().mockResolvedValue(false), createTable } as any);
    const tables = createTable.mock.calls.map(([table]) => table);
    expect(tables.map((table) => table.name)).toEqual([
      'engine_backstop_group_mappings', 'engine_backstop_sync_runs', 'engine_backstop_sync_tasks',
    ]);
    expect(tables[0].uniques).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnNames: ['engine_id', 'authz_group_id'] }),
      expect.objectContaining({ columnNames: ['engine_id', 'native_group_reference'] }),
    ]));
    expect(tables[1].indices).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnNames: ['engine_id', 'created_at'] }),
      expect.objectContaining({ columnNames: ['detailed_snapshot_expires_at'] }),
    ]));
    await migration.up({ hasTable: vi.fn().mockResolvedValue(true), createTable } as any);
    expect(createTable).toHaveBeenCalledTimes(3);
    await migration.down({ hasTable: vi.fn().mockResolvedValue(true), dropTable } as any);
    expect(dropTable.mock.calls.map(([table]) => table)).toEqual([
      'engine_backstop_sync_tasks', 'engine_backstop_sync_runs', 'engine_backstop_group_mappings',
    ]);
  });

  it.each([
    ['postgres', 'text', undefined],
    ['mysql', 'longtext', undefined],
    ['mssql', 'nvarchar', 'MAX'],
    ['oracle', 'clob', undefined],
    ['spanner', 'string', 'max'],
  ])('uses unbounded encrypted run detail for %s', async (database, type, length) => {
    const createTable = vi.fn().mockResolvedValue(undefined);
    await new AddEngineBackstopFoundation1700000000101().up({
      connection: { options: { type: database } },
      hasTable: vi.fn().mockResolvedValue(false),
      createTable,
    } as any);
    const runTable = createTable.mock.calls.map(([table]) => table).find((table) => table.name === 'engine_backstop_sync_runs');
    const detail = new Map(runTable.columns.map((column: { name: string }) => [column.name, column]));
    for (const name of ['classifications_json', 'encrypted_detailed_snapshot']) {
      expect(detail.get(name)).toMatchObject({ type, ...(length === undefined ? {} : { length }) });
    }
  });

  it.each([
    ['postgres', 'text', undefined],
    ['mysql', 'varchar', '191'],
    ['mssql', 'nvarchar', '191'],
    ['oracle', 'varchar2', '191'],
    ['spanner', 'string', '191'],
  ])('adds an indexed portable observation link for %s only after the backstop receipt table exists', async (database, type, length) => {
    const table = { columns: [], indices: [] } as any;
    const addColumn = vi.fn(async (_table, column) => { table.columns.push(column); });
    const createIndex = vi.fn(async (_table, index) => { table.indices.push(index); });
    const migration = new AddEngineBackstopDriftObservations1700000000102();
    await migration.up({ connection: { options: { type: database } }, getTable: vi.fn(async () => table), addColumn, createIndex } as any);
    expect(addColumn).toHaveBeenCalledWith('engine_backstop_sync_runs', expect.objectContaining({ name: 'observed_of_run_id', type, isNullable: true, ...(length === undefined ? {} : { length }) }));
    expect(createIndex).toHaveBeenCalledWith('engine_backstop_sync_runs', expect.objectContaining({ name: 'idx_engine_backstop_sync_run_observed_source', columnNames: ['observed_of_run_id'] }));
  });
});
