import { Table, TableIndex, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function text(queryRunner: QueryRunner, kind: 'key' | 'document' = 'document'): { type: string; length?: string } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mysql') return kind === 'key' ? { type: 'varchar', length: '191' } : { type: 'text' };
  if (database === 'mssql') return { type: 'nvarchar', length: kind === 'key' ? '191' : '4000' };
  if (database === 'oracle') return { type: 'varchar2', length: kind === 'key' ? '191' : '4000' };
  if (database === 'spanner') return { type: 'string', length: kind === 'key' ? '191' : '4096' };
  return { type: 'text' };
}

function largeText(queryRunner: QueryRunner): { type: string; length?: string } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mysql') return { type: 'longtext' };
  if (database === 'mssql') return { type: 'nvarchar', length: 'MAX' };
  if (database === 'oracle') return { type: 'clob' };
  if (database === 'spanner') return { type: 'string', length: 'max' };
  return { type: 'text' };
}

function bool(queryRunner: QueryRunner): { type: string; default: boolean | number } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mssql') return { type: 'bit', default: 0 };
  if (database === 'oracle') return { type: 'number', default: 0 };
  if (database === 'spanner') return { type: 'bool', default: false };
  return { type: 'boolean', default: false };
}

function bigint(queryRunner: QueryRunner): { type: string; precision?: number; scale?: number } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'oracle') return { type: 'number', precision: 19, scale: 0 };
  if (database === 'spanner') return { type: 'int64' };
  return { type: 'bigint' };
}

function integer(queryRunner: QueryRunner): { type: string; precision?: number; scale?: number } {
  return bigint(queryRunner);
}

async function createIfMissing(queryRunner: QueryRunner, table: Table): Promise<void> {
  if (!await queryRunner.hasTable(table.name)) await queryRunner.createTable(table, true);
}

/** Adds portable, encrypted persistence for the mirrored Camunda backstop. */
export class AddEngineBackstopFoundation1700000000101 implements MigrationInterface {
  name = 'AddEngineBackstopFoundation1700000000101';

  async up(queryRunner: QueryRunner): Promise<void> {
    const key = text(queryRunner, 'key');
    const document = text(queryRunner);
    const largeDocument = largeText(queryRunner);
    const timestamp = bigint(queryRunner);
    const boolean = bool(queryRunner);
    const count = integer(queryRunner);
    await createIfMissing(queryRunner, new Table({
      name: 'engine_backstop_group_mappings',
      columns: [
        { name: 'id', ...key, isPrimary: true }, { name: 'tenant_id', ...document, isNullable: true },
        { name: 'engine_id', ...key }, { name: 'authz_group_id', ...key },
        { name: 'encrypted_native_group_id', ...document }, { name: 'native_group_reference', ...key },
        // TypeORM treats a string default as a SQL expression. Quote literal
        // defaults explicitly so PostgreSQL does not interpret `manual` as a
        // column reference when applying this migration on an existing DB.
        { name: 'source', ...key, default: "'manual'" }, { name: 'source_ref', ...key },
        { name: 'ownership_mode', ...key, default: "'manual'" }, { name: 'source_hash', ...document, isNullable: true },
        { name: 'last_applied_at', ...timestamp, isNullable: true }, { name: 'is_active', ...boolean },
        { name: 'created_by_id', ...document, isNullable: true }, { name: 'created_at', ...timestamp }, { name: 'updated_at', ...timestamp },
      ],
      uniques: [
        new TableUnique({ name: 'uq_engine_backstop_group_mapping_group', columnNames: ['engine_id', 'authz_group_id'] }),
        new TableUnique({ name: 'uq_engine_backstop_group_mapping_native_group', columnNames: ['engine_id', 'native_group_reference'] }),
        new TableUnique({ name: 'uq_engine_backstop_group_mapping_source', columnNames: ['engine_id', 'source', 'source_ref'] }),
      ],
      indices: [
        new TableIndex({ name: 'idx_engine_backstop_group_mapping_engine_active', columnNames: ['engine_id', 'is_active'] }),
        new TableIndex({ name: 'idx_engine_backstop_group_mapping_tenant', columnNames: ['tenant_id'] }),
      ],
    }));
    await createIfMissing(queryRunner, new Table({
      name: 'engine_backstop_sync_runs',
      columns: [
        { name: 'id', ...key, isPrimary: true }, { name: 'tenant_id', ...document, isNullable: true }, { name: 'engine_id', ...key },
        { name: 'status', ...key }, { name: 'source_hash', ...document }, { name: 'desired_hash', ...document }, { name: 'result_hash', ...document, isNullable: true },
        { name: 'catalog_version', ...document }, { name: 'capability_json', ...document }, { name: 'counts_json', ...document },
        { name: 'classifications_json', ...largeDocument }, { name: 'encrypted_detailed_snapshot', ...largeDocument, isNullable: true },
        { name: 'detailed_snapshot_expires_at', ...timestamp, isNullable: true }, { name: 'rollback_of_run_id', ...document, isNullable: true },
        { name: 'created_by_id', ...document, isNullable: true }, { name: 'completed_at', ...timestamp, isNullable: true },
        { name: 'created_at', ...timestamp }, { name: 'updated_at', ...timestamp },
      ],
      indices: [
        new TableIndex({ name: 'idx_engine_backstop_sync_run_engine_created', columnNames: ['engine_id', 'created_at'] }),
        new TableIndex({ name: 'idx_engine_backstop_sync_run_status_updated', columnNames: ['status', 'updated_at'] }),
        new TableIndex({ name: 'idx_engine_backstop_sync_run_snapshot_expiry', columnNames: ['detailed_snapshot_expires_at'] }),
      ],
    }));
    await createIfMissing(queryRunner, new Table({
      name: 'engine_backstop_sync_tasks',
      columns: [
        { name: 'id', ...key, isPrimary: true }, { name: 'tenant_id', ...document, isNullable: true }, { name: 'engine_id', ...key },
        { name: 'run_id', ...key }, { name: 'source_hash', ...document }, { name: 'operation', ...key }, { name: 'status', ...key },
        { name: 'lease_id', ...document, isNullable: true }, { name: 'lease_expires_at', ...timestamp, isNullable: true },
        { name: 'attempts', ...count, default: 0 }, { name: 'next_attempt_at', ...timestamp, isNullable: true },
        { name: 'result_json', ...document, isNullable: true }, { name: 'last_error', ...document, isNullable: true },
        { name: 'completed_at', ...timestamp, isNullable: true }, { name: 'created_at', ...timestamp }, { name: 'updated_at', ...timestamp },
      ],
      uniques: [new TableUnique({ name: 'uq_engine_backstop_sync_task_run', columnNames: ['run_id'] })],
      indices: [
        new TableIndex({ name: 'idx_engine_backstop_sync_task_ready', columnNames: ['status', 'next_attempt_at', 'created_at'] }),
        new TableIndex({ name: 'idx_engine_backstop_sync_task_lease', columnNames: ['lease_expires_at'] }),
      ],
    }));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['engine_backstop_sync_tasks', 'engine_backstop_sync_runs', 'engine_backstop_group_mappings']) {
      if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table);
    }
  }
}
