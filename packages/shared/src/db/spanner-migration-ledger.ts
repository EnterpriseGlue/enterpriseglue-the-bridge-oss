import type { DataSource, QueryRunner } from 'typeorm';

type SpannerDdlQueryRunner = QueryRunner & {
  updateDDL(query: string, parameters?: unknown[]): Promise<void>;
};

const DEFAULT_MIGRATIONS_TABLE = 'migrations';

/**
 * TypeORM 0.3.28 marks its Spanner migration id as auto-generated but emits a
 * plain INT64 column. Every migration insert then omits `id` and fails.
 *
 * Create the ledger first with a deterministic generated id derived from the
 * complete migration name. Released v0.13.1 contains one explicitly allowed
 * duplicate timestamp, so the timestamp alone is not a safe primary key.
 * TypeORM can still use the timestamp for ordering while Spanner generates a
 * stable INT64 key without auto-increment support.
 */
export async function ensureSpannerTypeOrmMigrationLedgerV1(
  dataSource: DataSource,
  tableName = DEFAULT_MIGRATIONS_TABLE,
): Promise<void> {
  if (dataSource.options.type !== 'spanner') return;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(tableName)) {
    throw new Error('spanner_migration_table_name_invalid');
  }

  const queryRunner = dataSource.createQueryRunner();
  try {
    if (await queryRunner.hasTable(tableName)) return;
    const escape = dataSource.driver.escape.bind(dataSource.driver);
    await (queryRunner as SpannerDdlQueryRunner).updateDDL(
      `CREATE TABLE ${escape(tableName)} (` +
        `${escape('id')} INT64 AS (FARM_FINGERPRINT(${escape('name')})) STORED, ` +
        `${escape('timestamp')} INT64 NOT NULL, ` +
        `${escape('name')} STRING(MAX) NOT NULL` +
        `) PRIMARY KEY (${escape('id')})`,
    );
  } finally {
    await queryRunner.release();
  }
}
