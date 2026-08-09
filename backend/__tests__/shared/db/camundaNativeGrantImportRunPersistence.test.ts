import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { CamundaNativeGrantImportRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/CamundaNativeGrantImportRun.js';
import { AddCamundaNativeGrantImportRuns1700000000098 } from '@enterpriseglue/shared/db/migrations/1700000000098-add-camunda-native-grant-import-runs.js';
import { AddCamundaNativeGrantRollbackReceipt1700000000099 } from '@enterpriseglue/shared/db/migrations/1700000000099-add-camunda-native-grant-rollback-receipt.js';
import { WidenCamundaNativeGrantEvidence1700000000100 } from '@enterpriseglue/shared/db/migrations/1700000000100-widen-camunda-native-grant-evidence.js';

function columns() {
  return getMetadataArgsStorage().columns
    .filter((candidate) => candidate.target === CamundaNativeGrantImportRun)
    .map((candidate) => candidate.options.name || candidate.propertyName);
}

describe('Camunda native-grant import evidence persistence', () => {
  it('keeps raw native detail in a separately expiring encrypted field and indexes safe history lookup', () => {
    expect(columns()).toEqual(expect.arrayContaining([
      'engine_id', 'source_kind', 'input_hash', 'normalized_counts_json', 'classifications_json',
      'encrypted_detailed_snapshot', 'detailed_snapshot_expires_at', 'draft_hash', 'applied_config_bundle_run_id',
      'rollback_config_bundle_run_id', 'rolled_back_at',
    ]));
    const indexes = getMetadataArgsStorage().indices.filter((candidate) => candidate.target === CamundaNativeGrantImportRun);
    expect(indexes.map((index) => index.columns)).toEqual(expect.arrayContaining([
      ['engineId', 'createdAt'], ['detailedSnapshotExpiresAt'], ['status', 'updatedAt'],
    ]));
  });

  it('creates an idempotent portable table and removes it on rollback', async () => {
    const createTable = vi.fn().mockResolvedValue(undefined);
    const dropTable = vi.fn().mockResolvedValue(undefined);
    const migration = new AddCamundaNativeGrantImportRuns1700000000098();

    await migration.up({ hasTable: vi.fn().mockResolvedValue(false), createTable } as any);
    const table = createTable.mock.calls[0][0];
    expect(table.name).toBe('camunda_native_grant_import_runs');
    expect(table.columns.map((column: { name: string }) => column.name)).toEqual(expect.arrayContaining([
      'encrypted_detailed_snapshot', 'detailed_snapshot_expires_at', 'classifications_json',
    ]));
    expect(table.indices.map((index: { columnNames: string[] }) => index.columnNames)).toEqual(expect.arrayContaining([
      ['engine_id', 'created_at'], ['detailed_snapshot_expires_at'],
    ]));
    await migration.up({ hasTable: vi.fn().mockResolvedValue(true), createTable } as any);
    expect(createTable).toHaveBeenCalledTimes(1);
    await migration.down({ hasTable: vi.fn().mockResolvedValue(true), dropTable } as any);
    expect(dropTable).toHaveBeenCalledWith('camunda_native_grant_import_runs');
  });

  it.each([
    ['postgres', 'text', undefined],
    ['mysql', 'longtext', undefined],
    ['mssql', 'nvarchar', 'MAX'],
    ['oracle', 'clob', undefined],
    ['spanner', 'string', 'max'],
  ])('uses unbounded evidence columns for %s without assuming a connection in simple stubs', async (database, type, length) => {
    const createTable = vi.fn().mockResolvedValue(undefined);
    const migration = new AddCamundaNativeGrantImportRuns1700000000098();
    await migration.up({
      connection: { options: { type: database }, getMetadata: vi.fn().mockImplementation(() => { throw new Error('no metadata'); }) },
      hasTable: vi.fn().mockResolvedValue(false),
      createTable,
    } as any);
    const columns = new Map(createTable.mock.calls[0][0].columns.map((column: { name: string }) => [column.name, column]));
    for (const name of ['classifications_json', 'encrypted_detailed_snapshot']) {
      expect(columns.get(name)).toMatchObject({ type, ...(length === undefined ? {} : { length }) });
    }
  });

  it('adds and removes an idempotent portable rollback receipt only after the import table exists', async () => {
    const addColumn = vi.fn().mockResolvedValue(undefined);
    const dropColumn = vi.fn().mockResolvedValue(undefined);
    const migration = new AddCamundaNativeGrantRollbackReceipt1700000000099();

    await migration.up({ hasTable: vi.fn().mockResolvedValue(false), hasColumn: vi.fn(), addColumn } as any);
    expect(addColumn).not.toHaveBeenCalled();

    const hasColumn = vi.fn().mockResolvedValue(false);
    await migration.up({ hasTable: vi.fn().mockResolvedValue(true), hasColumn, addColumn } as any);
    expect(addColumn).toHaveBeenCalledTimes(2);
    expect(addColumn.mock.calls.map(([, column]) => ({ name: column.name, type: column.type, isNullable: column.isNullable }))).toEqual([
      { name: 'rollback_config_bundle_run_id', type: 'text', isNullable: true },
      { name: 'rolled_back_at', type: 'bigint', isNullable: true },
    ]);

    await migration.up({ hasTable: vi.fn().mockResolvedValue(true), hasColumn: vi.fn().mockResolvedValue(true), addColumn } as any);
    expect(addColumn).toHaveBeenCalledTimes(2);
    await migration.down({ hasTable: vi.fn().mockResolvedValue(true), hasColumn: vi.fn().mockResolvedValue(true), dropColumn } as any);
    expect(dropColumn).toHaveBeenNthCalledWith(1, 'camunda_native_grant_import_runs', 'rolled_back_at');
    expect(dropColumn).toHaveBeenNthCalledWith(2, 'camunda_native_grant_import_runs', 'rollback_config_bundle_run_id');
  });

  it.each([
    ['postgres', 'text', undefined],
    ['mysql', 'longtext', undefined],
    ['mssql', 'nvarchar', 'MAX'],
    ['oracle', 'clob', undefined],
    ['spanner', 'string', 'max'],
  ])('widens existing evidence columns safely for %s', async (database, type, length) => {
    const changeColumn = vi.fn().mockResolvedValue(undefined);
    const migration = new WidenCamundaNativeGrantEvidence1700000000100();
    await migration.up({
      connection: { options: { type: database }, getMetadata: vi.fn().mockImplementation(() => { throw new Error('no metadata'); }) },
      getTable: vi.fn().mockResolvedValue({ columns: [
        { name: 'classifications_json', isNullable: false },
        { name: 'encrypted_detailed_snapshot', isNullable: true },
      ] }),
      changeColumn,
    } as any);
    expect(changeColumn).toHaveBeenCalledTimes(2);
    expect(changeColumn.mock.calls.map(([, , column]) => ({ name: column.name, type: column.type, length: column.length || undefined, isNullable: column.isNullable }))).toEqual([
      { name: 'classifications_json', type, length, isNullable: false },
      { name: 'encrypted_detailed_snapshot', type, length, isNullable: true },
    ]);
  });
});
