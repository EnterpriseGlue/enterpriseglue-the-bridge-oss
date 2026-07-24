import { Table, TableIndex } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function portableText(
  queryRunner: QueryRunner,
  length: 'key' | 'document' = 'document',
): { type: string; length?: string } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mysql') {
    return length === 'key'
      ? { type: 'varchar', length: '191' }
      : { type: 'text' };
  }
  if (database === 'mssql') return { type: 'nvarchar', length: length === 'key' ? '191' : '4000' };
  if (database === 'oracle') return { type: 'varchar2', length: length === 'key' ? '191' : '4000' };
  if (database === 'spanner') return { type: 'string', length: length === 'key' ? '191' : '4096' };
  return { type: 'text' };
}

/**
 * Bounded migration evidence can still be substantially larger than an
 * ordinary display field. Keep it out of indexes and use each adapter's
 * unbounded text type. The service applies a stricter cross-adapter byte cap
 * before writing, so this is defence in depth rather than an invitation to
 * retain arbitrary payloads.
 */
function portableLargeDocumentText(queryRunner: QueryRunner): { type: string; length?: string } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mysql') return { type: 'longtext' };
  if (database === 'mssql') return { type: 'nvarchar', length: 'MAX' };
  if (database === 'oracle') return { type: 'clob' };
  if (database === 'spanner') return { type: 'string', length: 'max' };
  return { type: 'text' };
}

function portableBoolean(queryRunner: QueryRunner): { type: string; default: boolean | number } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mssql') return { type: 'bit', default: 0 };
  if (database === 'oracle') return { type: 'number', default: 0 };
  if (database === 'spanner') return { type: 'bool', default: false };
  return { type: 'boolean', default: false };
}

function portableBigint(queryRunner: QueryRunner): { type: string; precision?: number; scale?: number } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'oracle') return { type: 'number', precision: 19, scale: 0 };
  if (database === 'spanner') return { type: 'int64' };
  return { type: 'bigint' };
}

function tablePath(queryRunner: QueryRunner): string {
  try {
    return queryRunner.connection?.getMetadata('CamundaNativeGrantImportRun').tablePath
      || 'camunda_native_grant_import_runs';
  } catch {
    return 'camunda_native_grant_import_runs';
  }
}

/** Adds portable, sanitized evidence storage for the Camunda 7 grant importer. */
export class AddCamundaNativeGrantImportRuns1700000000098 implements MigrationInterface {
  name = 'AddCamundaNativeGrantImportRuns1700000000098';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (await queryRunner.hasTable(tableName)) return;
    const keyText = portableText(queryRunner, 'key');
    const documentText = portableText(queryRunner, 'document');
    const largeDocumentText = portableLargeDocumentText(queryRunner);
    const boolean = portableBoolean(queryRunner);
    const bigint = portableBigint(queryRunner);
    await queryRunner.createTable(new Table({
      name: tableName,
      columns: [
        { name: 'id', ...keyText, isPrimary: true },
        { name: 'engine_id', ...keyText },
        { name: 'tenant_id', ...documentText, isNullable: true },
        { name: 'source_kind', ...documentText },
        { name: 'status', ...keyText },
        { name: 'input_hash', ...documentText },
        { name: 'mapping_catalog_version', ...documentText },
        { name: 'inventory_truncated', ...boolean },
        { name: 'normalized_counts_json', ...documentText },
        { name: 'classifications_json', ...largeDocumentText },
        { name: 'encrypted_detailed_snapshot', ...largeDocumentText, isNullable: true },
        { name: 'detailed_snapshot_expires_at', ...bigint, isNullable: true },
        { name: 'draft_hash', ...documentText, isNullable: true },
        { name: 'created_by_id', ...documentText, isNullable: true },
        { name: 'approved_by_id', ...documentText, isNullable: true },
        { name: 'approved_at', ...bigint, isNullable: true },
        { name: 'applied_config_bundle_run_id', ...documentText, isNullable: true },
        { name: 'created_at', ...bigint },
        { name: 'updated_at', ...bigint },
      ],
      indices: [
        new TableIndex({ name: 'idx_camunda_native_grant_import_engine_created', columnNames: ['engine_id', 'created_at'] }),
        new TableIndex({ name: 'idx_camunda_native_grant_import_snapshot_expiry', columnNames: ['detailed_snapshot_expires_at'] }),
        new TableIndex({ name: 'idx_camunda_native_grant_import_status_updated', columnNames: ['status', 'updated_at'] }),
      ],
    }), true);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (await queryRunner.hasTable(tableName)) await queryRunner.dropTable(tableName);
  }
}
