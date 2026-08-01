import { TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';

type SupportedDatabase = 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'spanner';
type TextSize = 'key' | 'document' | 'large';

export function migrationDatabase(queryRunner: QueryRunner): SupportedDatabase {
  return (queryRunner.connection.options.type || 'postgres') as SupportedDatabase;
}

export function portableText(
  queryRunner: QueryRunner,
  size: TextSize = 'document',
): { type: string; length?: string } {
  const database = migrationDatabase(queryRunner);
  if (database === 'mysql') {
    if (size === 'large') return { type: 'longtext' };
    return { type: 'varchar', length: size === 'key' ? '191' : '4000' };
  }
  if (database === 'mssql') {
    return { type: 'nvarchar', length: size === 'large' ? 'MAX' : size === 'key' ? '191' : '4000' };
  }
  if (database === 'oracle') {
    if (size === 'large') return { type: 'clob' };
    return { type: 'varchar2', length: size === 'key' ? '191' : '4000' };
  }
  if (database === 'spanner') {
    return { type: 'string', length: size === 'large' ? 'max' : size === 'key' ? '191' : '4096' };
  }
  return { type: 'text' };
}

export function portableBoolean(queryRunner: QueryRunner): {
  type: string;
  precision?: number;
  scale?: number;
} {
  const database = migrationDatabase(queryRunner);
  if (database === 'mssql') return { type: 'bit' };
  if (database === 'oracle') return { type: 'number', precision: 1, scale: 0 };
  if (database === 'spanner') return { type: 'bool' };
  return { type: 'boolean' };
}

export function portableInteger(queryRunner: QueryRunner): {
  type: string;
  precision?: number;
  scale?: number;
} {
  const database = migrationDatabase(queryRunner);
  if (database === 'oracle') return { type: 'number', precision: 10, scale: 0 };
  if (database === 'spanner') return { type: 'int64' };
  return { type: 'integer' };
}

export function portableBigint(queryRunner: QueryRunner): {
  type: string;
  precision?: number;
  scale?: number;
} {
  const database = migrationDatabase(queryRunner);
  if (database === 'oracle') return { type: 'number', precision: 19, scale: 0 };
  if (database === 'spanner') return { type: 'int64' };
  return { type: 'bigint' };
}

export function sqlStringLiteral(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

export function portableStringDefault(queryRunner: QueryRunner, value: string): string | undefined {
  return migrationDatabase(queryRunner) === 'spanner' ? undefined : sqlStringLiteral(value);
}

export function portableBooleanDefault(queryRunner: QueryRunner, value: boolean): boolean | number | undefined {
  const database = migrationDatabase(queryRunner);
  if (database === 'spanner') return undefined;
  if (database === 'postgres') return value;
  return value ? 1 : 0;
}

export function portableNumberDefault(queryRunner: QueryRunner, value: number): number | undefined {
  return migrationDatabase(queryRunner) === 'spanner' ? undefined : value;
}

export function sqlBooleanLiteral(queryRunner: QueryRunner, value: boolean): string {
  const database = migrationDatabase(queryRunner);
  if (database === 'postgres' || database === 'spanner') return value ? 'TRUE' : 'FALSE';
  return value ? '1' : '0';
}

export function sqlIdentifier(queryRunner: QueryRunner, value: string): string {
  return queryRunner.connection.driver.escape(value);
}

export function sqlTablePath(queryRunner: QueryRunner, value: string): string {
  return value
    .split('.')
    .filter(Boolean)
    .map((part) => sqlIdentifier(queryRunner, part))
    .join('.');
}

/**
 * Adds a required column to a table that may already contain rows.
 *
 * Spanner does not apply TypeORM column defaults during DDL. All adapters use
 * the same nullable-add/backfill/require sequence so retries are safe and an
 * upgrade proves that existing rows receive the intended value.
 */
export async function addRequiredColumnWithBackfill(
  queryRunner: QueryRunner,
  tableName: string,
  finalColumn: TableColumn,
  backfillExpression: string,
): Promise<void> {
  if (!await queryRunner.hasColumn(tableName, finalColumn.name)) {
    const nullableColumn = finalColumn.clone();
    nullableColumn.isNullable = true;
    nullableColumn.default = undefined;
    await queryRunner.addColumn(tableName, nullableColumn);
  }

  const tablePath = sqlTablePath(queryRunner, tableName);
  const columnName = sqlIdentifier(queryRunner, finalColumn.name);
  await queryRunner.query(
    `UPDATE ${tablePath} SET ${columnName} = ${backfillExpression} WHERE ${columnName} IS NULL`,
  );

  const table = await queryRunner.getTable(tableName);
  const existing = table?.columns.find((column) => column.name === finalColumn.name);
  if (!existing || !existing.isNullable) return;

  const requiredColumn = finalColumn.clone();
  requiredColumn.isNullable = false;
  if (migrationDatabase(queryRunner) === 'spanner') {
    requiredColumn.default = undefined;
    const columnType = queryRunner.connection.driver.createFullType(requiredColumn);
    await (queryRunner as QueryRunner & { updateDDL(sql: string): Promise<void> }).updateDDL(
      `ALTER TABLE ${tablePath} ALTER COLUMN ${columnName} ${columnType} NOT NULL`,
    );
    return;
  }

  await queryRunner.changeColumn(tableName, existing, requiredColumn);
}

export async function addNullableColumnIfMissing(
  queryRunner: QueryRunner,
  tableName: string,
  column: TableColumn,
): Promise<void> {
  if (!await queryRunner.hasColumn(tableName, column.name)) {
    await queryRunner.addColumn(tableName, column);
  }
}
