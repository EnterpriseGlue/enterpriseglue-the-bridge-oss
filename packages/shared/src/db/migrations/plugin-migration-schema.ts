import { Table, TableColumn } from 'typeorm';
import type {
  QueryRunner,
  TableColumnOptions,
  TableOptions,
} from 'typeorm';

import {
  isPluginLargeTextColumn,
  pluginKeyColumnLength,
} from '../../infrastructure/persistence/pluginColumnPolicy.js';

/**
 * MySQL cannot use an unbounded TEXT column in a primary, unique, or secondary
 * key. Plugin identifiers are already bounded ASCII values at the public SDK
 * boundary, so migrations project only key/default text columns to
 * case-sensitive ASCII VARCHAR. Payload/content columns remain TEXT.
 */
export function pluginMigrationTable(
  queryRunner: QueryRunner,
  options: TableOptions,
): Table {
  const indexedColumns = new Set(
    (options.indices ?? []).flatMap((index) => index.columnNames ?? []),
  );

  return new Table({
    ...options,
    columns: (options.columns ?? []).map((column) =>
      normalizePluginMigrationColumn(queryRunner, column, {
        indexed: indexedColumns.has(column.name),
      }),
    ),
  });
}

export function pluginMigrationColumn(
  queryRunner: QueryRunner,
  options: TableColumnOptions,
): TableColumn {
  return new TableColumn(
    normalizePluginMigrationColumn(queryRunner, options, {
      indexed: false,
    }),
  );
}

type SpannerDdlQueryRunner = QueryRunner & {
  updateDDL(query: string, parameters?: unknown[]): Promise<void>;
};

/**
 * TypeORM 0.3.28 does not render Spanner DEFAULT clauses. Spanner cannot add a
 * NOT NULL column to an existing table unless a default or generated
 * expression is present, so use the driver's DDL channel for that one dialect.
 */
export async function addPluginMigrationColumn(
  queryRunner: QueryRunner,
  tablePath: string,
  column: TableColumn,
): Promise<void> {
  if (queryRunner.connection.options.type !== 'spanner') {
    await queryRunner.addColumn(tablePath, column);
    return;
  }

  const escape = queryRunner.connection.driver.escape.bind(
    queryRunner.connection.driver,
  );
  const defaultExpression = spannerDefaultExpression(column.default);
  if (!column.isNullable && defaultExpression === undefined) {
    throw new Error(
      `spanner_not_null_plugin_column_default_missing:${column.name}`,
    );
  }
  const defaultClause =
    defaultExpression === undefined
      ? ''
      : ` DEFAULT (${defaultExpression})`;
  await (queryRunner as SpannerDdlQueryRunner).updateDDL(
    `ALTER TABLE ${escape(tablePath)} ADD COLUMN ` +
      `${escape(column.name)} ` +
      `${queryRunner.connection.driver.createFullType(column)}` +
      `${column.isNullable ? '' : ' NOT NULL'}` +
      defaultClause,
  );
}

function spannerDefaultExpression(
  value: TableColumn['default'],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === true) return 'TRUE';
  if (value === false) return 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (
    typeof value === 'string' &&
    (/^'(?:[^']|'')*'$/.test(value) || /^-?[0-9]+$/.test(value))
  ) {
    return value;
  }
  throw new Error('spanner_plugin_column_default_invalid');
}

function normalizePluginMigrationColumn(
  queryRunner: QueryRunner,
  column: TableColumnOptions,
  context: { indexed: boolean },
): TableColumnOptions {
  const databaseType = queryRunner.connection.options.type;
  if (databaseType === 'spanner') {
    return normalizeSpannerColumn(column, context);
  }
  if (databaseType === 'oracle') {
    return normalizeOracleColumn(column, context);
  }
  if (databaseType === 'mssql') {
    return normalizeSqlServerColumn(column, context);
  }
  if (databaseType !== 'mysql' || column.type !== 'text') {
    return column;
  }

  const requiresBoundedKey =
    Boolean(column.isPrimary) ||
    Boolean(column.isUnique) ||
    context.indexed ||
    column.default !== undefined;
  if (!requiresBoundedKey) return column;

  return {
    ...column,
    type: 'varchar',
    length: String(pluginKeyColumnLength(column.name)),
    charset: 'ascii',
    collation: 'ascii_bin',
  };
}

function normalizeSpannerColumn(
  column: TableColumnOptions,
  context: { indexed: boolean },
): TableColumnOptions {
  if (column.type === 'boolean') {
    return {
      ...column,
      type: 'bool',
    };
  }
  if (
    column.type === 'bigint' ||
    column.type === 'integer' ||
    column.type === 'int'
  ) {
    return {
      ...column,
      type: 'int64',
    };
  }
  if (column.type !== 'text') return column;

  const requiresBoundedKey =
    Boolean(column.isPrimary) ||
    Boolean(column.isUnique) ||
    context.indexed ||
    column.default !== undefined;
  if (requiresBoundedKey) {
    return {
      ...column,
      type: 'string',
      length: String(pluginKeyColumnLength(column.name)),
    };
  }
  return {
    ...column,
    type: 'string',
    length: isPluginLargeTextColumn(column.name) ? 'max' : '4000',
  };
}

function normalizeOracleColumn(
  column: TableColumnOptions,
  context: { indexed: boolean },
): TableColumnOptions {
  if (column.type === 'boolean') {
    return {
      ...column,
      type: 'number',
      precision: 1,
      scale: 0,
      default:
        column.default === true
          ? 1
          : column.default === false
            ? 0
            : column.default,
    };
  }
  if (column.type === 'bigint') {
    return {
      ...column,
      type: 'number',
      precision: 19,
      scale: 0,
    };
  }
  if (column.type !== 'text') return column;

  const requiresBoundedKey =
    Boolean(column.isPrimary) ||
    Boolean(column.isUnique) ||
    context.indexed ||
    column.default !== undefined;
  if (requiresBoundedKey) {
    return {
      ...column,
      type: 'varchar2',
      length: String(pluginKeyColumnLength(column.name)),
    };
  }
  if (isPluginLargeTextColumn(column.name)) {
    return {
      ...column,
      type: 'clob',
      length: undefined,
    };
  }
  return {
    ...column,
    type: 'varchar2',
    length: '4000',
  };
}

function normalizeSqlServerColumn(
  column: TableColumnOptions,
  context: { indexed: boolean },
): TableColumnOptions {
  if (column.type === 'boolean') {
    return {
      ...column,
      type: 'bit',
      default:
        column.default === true
          ? 1
          : column.default === false
            ? 0
            : column.default,
    };
  }
  if (column.type !== 'text') return column;

  const requiresBoundedKey =
    Boolean(column.isPrimary) ||
    Boolean(column.isUnique) ||
    context.indexed ||
    column.default !== undefined;
  if (requiresBoundedKey) {
    return {
      ...column,
      type: 'varchar',
      length: String(pluginKeyColumnLength(column.name)),
      collation: 'Latin1_General_100_BIN2',
    };
  }
  if (isPluginLargeTextColumn(column.name)) {
    return {
      ...column,
      type: 'nvarchar',
      length: 'MAX',
    };
  }
  return {
    ...column,
    type: 'nvarchar',
    length: '4000',
  };
}
