import { Table, TableColumn } from 'typeorm';
import type { QueryRunner, TableColumnOptions, TableOptions } from 'typeorm';

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

/** Preserve historical non-Oracle DDL while repairing pre-23 Oracle booleans. */
export function legacyBooleanColumn(queryRunner: QueryRunner, defaultValue?: boolean): {
  type: string;
  precision?: number;
  scale?: number;
  default?: boolean | number;
} {
  const oracle = migrationDatabase(queryRunner) === 'oracle';
  const column = oracle ? portableBoolean(queryRunner) : { type: 'boolean' };
  if (defaultValue === undefined) return column;
  return { ...column, default: oracle ? Number(defaultValue) : defaultValue };
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

/**
 * Projects the PostgreSQL-flavoured column spellings used throughout the legacy
 * migration epoch (`text`, `bigint`, `boolean`) onto the dialect the migration
 * is actually running against. Text columns that participate in a primary key,
 * unique constraint or index are bounded because Oracle, MySQL and Spanner all
 * reject unbounded key columns.
 */
function normalizePortableColumn(
  queryRunner: QueryRunner,
  column: TableColumnOptions,
  context: { indexed: boolean },
): TableColumnOptions {
  if (column.type === 'boolean') {
    return {
      ...column,
      ...portableBoolean(queryRunner),
      default: typeof column.default === 'boolean'
        ? portableBooleanDefault(queryRunner, column.default)
        : column.default,
    };
  }
  if (column.type === 'bigint') {
    return { ...column, ...portableBigint(queryRunner) };
  }
  // `integer` is ANSI and valid on Oracle/MySQL/SQL Server; only Spanner rejects it.
  if ((column.type === 'integer' || column.type === 'int') && migrationDatabase(queryRunner) === 'spanner') {
    return { ...column, type: 'int64' };
  }
  if (column.type !== 'text') return column;

  const bounded = Boolean(column.isPrimary)
    || Boolean(column.isUnique)
    || context.indexed
    || column.default !== undefined;
  return { ...column, ...portableText(queryRunner, bounded ? 'key' : 'document') };
}

/** Builds a `Table` whose column types are valid on the connected dialect. */
export function portableTable(queryRunner: QueryRunner, options: TableOptions): Table {
  const keyColumns = new Set<string>([
    ...(options.indices ?? []).flatMap((index) => index.columnNames ?? []),
    ...(options.uniques ?? []).flatMap((unique) => unique.columnNames ?? []),
  ]);
  return new Table({
    ...options,
    columns: (options.columns ?? []).map((column) =>
      normalizePortableColumn(queryRunner, column, { indexed: keyColumns.has(column.name) })),
  });
}

/** Builds a `TableColumn` whose type is valid on the connected dialect. */
export function portableColumn(
  queryRunner: QueryRunner,
  options: TableColumnOptions,
  context: { indexed?: boolean } = {},
): TableColumn {
  return new TableColumn(
    normalizePortableColumn(queryRunner, options, { indexed: context.indexed ?? false }),
  );
}

/**
 * Changes only the nullability of an existing column.
 *
 * Passing a freshly built column makes TypeORM's Oracle query runner drop and
 * re-add it whenever the declared type or length differs at all from the live
 * one. Re-adding a NOT NULL column fails on a populated table (ORA-01758), and
 * re-adding a nullable one silently discards the column's data. Cloning the
 * live column keeps the change to nullability alone.
 */
export async function setExistingColumnNullability(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
  isNullable: boolean,
): Promise<void> {
  const current = (await queryRunner.getTable(tableName))?.findColumnByName(columnName);
  if (!current || current.isNullable === isNullable) return;
  const changed = current.clone();
  changed.isNullable = isNullable;
  await queryRunner.changeColumn(tableName, current, changed);
}

/** Tightens an existing column to NOT NULL; see `setExistingColumnNullability`. */
export async function requireExistingColumn(
  queryRunner: QueryRunner,
  tableName: string,
  columnName: string,
): Promise<void> {
  await setExistingColumnNullability(queryRunner, tableName, columnName, false);
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
    const dependentIndexes = (table?.indices || []).filter((index) => index.columnNames.includes(finalColumn.name));
    for (const index of dependentIndexes) await queryRunner.dropIndex(tableName, index);
    requiredColumn.default = undefined;
    const columnType = queryRunner.connection.driver.createFullType(requiredColumn);
    await (queryRunner as QueryRunner & { updateDDL(sql: string): Promise<void> }).updateDDL(
      `ALTER TABLE ${tablePath} ALTER COLUMN ${columnName} ${columnType} NOT NULL`,
    );
    for (const index of dependentIndexes) await queryRunner.createIndex(tableName, index);
    return;
  }

  const dependentIndexes = migrationDatabase(queryRunner) === 'mssql'
    ? (table?.indices || []).filter((index) => index.columnNames.includes(finalColumn.name))
    : [];
  for (const index of dependentIndexes) await queryRunner.dropIndex(tableName, index);
  await queryRunner.changeColumn(tableName, existing, requiredColumn);
  for (const index of dependentIndexes) await queryRunner.createIndex(tableName, index);
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
