import { TableColumn } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { setExistingColumnNullability, sqlIdentifier, sqlTablePath } from './support/portable-columns.js';

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
  if (database === 'mysql') return new TableColumn({ name, type: 'longtext', isNullable });
  if (database === 'mssql') return new TableColumn({ name, type: 'nvarchar', length: 'MAX', isNullable });
  if (database === 'spanner') return new TableColumn({ name, type: 'string', length: 'max', isNullable });
  return new TableColumn({ name, type: 'text', isNullable });
}

const EVIDENCE_COLUMNS = [
  { name: 'classifications_json', isNullable: false },
  { name: 'encrypted_detailed_snapshot', isNullable: true },
];

/**
 * Oracle cannot MODIFY a VARCHAR2 column to CLOB, and TypeORM's changeColumn
 * falls back to drop and re-add, which discards the evidence. Copy through a
 * staging CLOB column instead. Oracle DDL commits implicitly, so each step
 * checks the live schema and a rerun resumes an interrupted widening.
 */
async function widenOracleColumnToClob(
  queryRunner: QueryRunner,
  tableName: string,
  name: string,
  expectedNullable: boolean,
): Promise<void> {
  const staging = `${name}_clob`;
  const table = await queryRunner.getTable(tableName);
  const original = table?.findColumnByName(name);
  if (original?.type === 'clob') return;
  const isNullable = original?.isNullable ?? expectedNullable;
  if (original) {
    if (!table?.findColumnByName(staging)) {
      await queryRunner.addColumn(tableName, new TableColumn({ name: staging, type: 'clob', isNullable: true }));
    }
    await queryRunner.query(
      `UPDATE ${sqlTablePath(queryRunner, tableName)}`
      + ` SET ${sqlIdentifier(queryRunner, staging)} = ${sqlIdentifier(queryRunner, name)}`,
    );
    await queryRunner.dropColumn(tableName, name);
  }
  if (!(await queryRunner.getTable(tableName))?.findColumnByName(staging)) return;
  await queryRunner.renameColumn(tableName, staging, name);
  await setExistingColumnNullability(queryRunner, tableName, name, isNullable);
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
    for (const { name, isNullable } of EVIDENCE_COLUMNS) {
      if (databaseType(queryRunner) === 'oracle') {
        await widenOracleColumnToClob(queryRunner, tableName, name, isNullable);
        continue;
      }
      const existing = table.columns.find((column) => column.name === name);
      if (!existing) continue;
      await queryRunner.changeColumn(tableName, existing, largeDocumentColumn(queryRunner, name, existing.isNullable));
    }
  }

  async down(): Promise<void> {
    // See class comment: a lossy down migration is unsafe for migration evidence.
  }
}
