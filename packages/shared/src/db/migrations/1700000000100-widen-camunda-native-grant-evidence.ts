import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { portableColumn } from './support/portable-columns.js';

function databaseType(queryRunner: QueryRunner): string {
  return queryRunner.connection?.options?.type || 'postgres';
}

function tablePath(queryRunner: QueryRunner): string {
  try {
    return queryRunner.connection?.getMetadata('CamundaNativeGrantImportRun').tablePath
      || 'camunda_native_grant_import_runs';
  } catch {
    return 'camunda_native_grant_import_runs';
  }
}

function largeDocumentColumn(queryRunner: QueryRunner, name: string, isNullable: boolean): TableColumn {
  const database = databaseType(queryRunner);
  if (database === 'mysql') return portableColumn(queryRunner, { name, type: 'longtext', isNullable });
  if (database === 'mssql') return portableColumn(queryRunner, { name, type: 'nvarchar', length: 'MAX', isNullable });
  if (database === 'oracle') return portableColumn(queryRunner, { name, type: 'clob', isNullable });
  if (database === 'spanner') return portableColumn(queryRunner, { name, type: 'string', length: 'max', isNullable });
  return portableColumn(queryRunner, { name, type: 'text', isNullable });
}

/**
 * Widens evidence created by the initial native-grant migrations. It is
 * intentionally one-way: shrinking a retained encrypted snapshot could
 * silently destroy the exact approved draft required for safe rollback.
 */
export class WidenCamundaNativeGrantEvidence1700000000100 implements MigrationInterface {
  name = 'WidenCamundaNativeGrantEvidence1700000000100';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tableName = tablePath(queryRunner);
    const table = await queryRunner.getTable(tableName);
    if (!table) return;
    for (const name of ['classifications_json', 'encrypted_detailed_snapshot']) {
      const existing = table.columns.find((column) => column.name === name);
      if (!existing) continue;
      await queryRunner.changeColumn(tableName, existing, largeDocumentColumn(queryRunner, name, existing.isNullable));
    }
  }

  async down(): Promise<void> {
    // See class comment: a lossy down migration is unsafe for migration evidence.
  }
}
