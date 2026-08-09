import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

function portableText(queryRunner: QueryRunner): { type: string; length?: string } {
  const database = queryRunner.connection?.options?.type || 'postgres';
  if (database === 'mysql') return { type: 'text' };
  if (database === 'mssql') return { type: 'nvarchar', length: '4000' };
  if (database === 'oracle') return { type: 'varchar2', length: '4000' };
  if (database === 'spanner') return { type: 'string', length: '4096' };
  return { type: 'text' };
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

/** Retains the ordinary config-apply receipt for an import-owned rollback. */
export class AddCamundaNativeGrantRollbackReceipt1700000000099 implements MigrationInterface {
  name = 'AddCamundaNativeGrantRollbackReceipt1700000000099';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    if (!await queryRunner.hasColumn(tableName, 'rollback_config_bundle_run_id')) {
      await queryRunner.addColumn(tableName, new TableColumn({
        name: 'rollback_config_bundle_run_id',
        ...portableText(queryRunner),
        isNullable: true,
      }));
    }
    if (!await queryRunner.hasColumn(tableName, 'rolled_back_at')) {
      await queryRunner.addColumn(tableName, new TableColumn({
        name: 'rolled_back_at',
        ...portableBigint(queryRunner),
        isNullable: true,
      }));
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    if (!await queryRunner.hasTable(tableName)) return;
    if (await queryRunner.hasColumn(tableName, 'rolled_back_at')) await queryRunner.dropColumn(tableName, 'rolled_back_at');
    if (await queryRunner.hasColumn(tableName, 'rollback_config_bundle_run_id')) await queryRunner.dropColumn(tableName, 'rollback_config_bundle_run_id');
  }
}
