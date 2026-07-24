import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { CamundaNativeGrantImportRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/CamundaNativeGrantImportRun.js';
import { AddCamundaNativeGrantImportRuns1700000000098 } from '@enterpriseglue/shared/db/migrations/1700000000098-add-camunda-native-grant-import-runs.js';

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
});
