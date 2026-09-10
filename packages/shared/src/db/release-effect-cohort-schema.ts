import { TableIndex } from 'typeorm';
import type { QueryRunner, Table } from 'typeorm';

import { pluginMigrationTable } from './migrations/plugin-migration-schema.js';

export function expectedReleaseEffectCohortTable(queryRunner: QueryRunner, tablePath: string): Table {
  return pluginMigrationTable(queryRunner, {
    name: tablePath,
    columns: [
      { name: 'id', type: 'text', isPrimary: true },
      { name: 'release_id', type: 'text' },
      { name: 'cohort_epoch', type: 'bigint' },
      { name: 'state', type: 'text' },
      { name: 'revision', type: 'bigint', default: 1 },
      { name: 'inventory_version', type: 'text' },
      { name: 'inventory_sha256', type: 'text' },
      { name: 'opened_at', type: 'bigint' },
      { name: 'closed_at', type: 'bigint', isNullable: true },
      { name: 'settled_at', type: 'bigint', isNullable: true },
      { name: 'updated_at', type: 'bigint' },
    ],
    indices: [new TableIndex({
      name: 'idx_release_effect_cohort_identity',
      columnNames: ['release_id'],
      isUnique: true,
    })],
  });
}

/** Fail closed if DDL execution or later drift does not preserve the exact
 * portable cohort shape required by the settlement protocol. */
export async function assertReleaseEffectCohortTableShape(
  queryRunner: QueryRunner,
  expectedTable: Table,
): Promise<void> {
  if (queryRunner.connection.options.type === 'postgres') {
    await assertPostgresReleaseEffectCohortTableShape(queryRunner, expectedTable);
    return;
  }
  const table = await queryRunner.getTable(expectedTable.name);
  if (!table || table.columns.length !== expectedTable.columns.length) {
    throw new Error('Schema-epoch release-effect cohort relation has an unexpected column inventory');
  }
  for (const expected of expectedTable.columns) {
    const column = table.columns.find((candidate) => candidate.name === expected.name);
    if (
      !column
      || column.type !== expected.type
      || column.length !== expected.length
      || column.isNullable !== expected.isNullable
      || column.isPrimary !== expected.isPrimary
      || String(column.default ?? '').replace(/[()']/g, '') !== String(expected.default ?? '').replace(/[()']/g, '')
    ) {
      throw new Error(`Schema-epoch release-effect cohort column ${expected.name} has an unexpected definition`);
    }
  }
  const identity = table.indices.filter((index) => index.name === 'idx_release_effect_cohort_identity');
  if (
    identity.length !== 1
    || identity[0].isUnique !== true
    || identity[0].isSpatial === true
    || identity[0].isConcurrent === true
    || identity[0].isFulltext === true
    || identity[0].isNullFiltered === true
    || Boolean(identity[0].parser)
    || Boolean(identity[0].where)
    || identity[0].columnNames.length !== 1
    || identity[0].columnNames[0] !== 'release_id'
  ) {
    throw new Error('Schema-epoch release-effect cohort relation has an unexpected identity index');
  }
}

async function assertPostgresReleaseEffectCohortTableShape(
  queryRunner: QueryRunner,
  expectedTable: Table,
): Promise<void> {
  const [schema = 'public', tableName] = expectedTable.name.includes('.')
    ? expectedTable.name.split('.', 2)
    : [String((queryRunner.connection.options as { schema?: string }).schema || 'public'), expectedTable.name];
  const columns: Array<{
    name: string; data_type: string; not_null: boolean; default_expression: string | null; primary_key: boolean;
  }> = await queryRunner.query(`SELECT a.attname AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
      a.attnotnull AS not_null,pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS default_expression,
      EXISTS (SELECT 1 FROM pg_catalog.pg_index p WHERE p.indrelid=c.oid AND p.indisprimary AND a.attnum=ANY(p.indkey)) AS primary_key
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind IN ('r','p') ORDER BY a.attnum`, [schema, tableName]);
  const expectedTypes = new Map(expectedTable.columns.map((column) => [column.name, String(column.type)]));
  if (columns.length !== expectedTable.columns.length || columns.some((column) => {
    const expected = expectedTable.columns.find((candidate) => candidate.name === column.name);
    const normalizedDefault = String(column.default_expression ?? '').replace(/::(?:pg_catalog\.)?int8|[()']/g, '');
    const expectedDefault = String(expected?.default ?? '').replace(/[()']/g, '');
    return !expected
      || column.data_type !== expectedTypes.get(column.name)
      || column.not_null !== !expected.isNullable
      || column.primary_key !== expected.isPrimary
      || normalizedDefault !== expectedDefault;
  })) {
    throw new Error('Schema-epoch release-effect cohort relation has an unexpected PostgreSQL column definition');
  }
  const indexes: Array<{
    unique_index: boolean; valid_index: boolean; ready_index: boolean; live_index: boolean;
    predicate_free: boolean; expression_free: boolean; key_count: number | string;
    attribute_count: number | string; key_columns: string[];
  }> = await queryRunner.query(`SELECT i.indisunique AS unique_index,i.indisvalid AS valid_index,
      i.indisready AS ready_index,i.indislive AS live_index,i.indpred IS NULL AS predicate_free,
      i.indexprs IS NULL AS expression_free,i.indnkeyatts AS key_count,i.indnatts AS attribute_count,
      array_agg(a.attname::text ORDER BY key.ordinality) AS key_columns
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_index i ON i.indrelid=c.oid JOIN pg_catalog.pg_class x ON x.oid=i.indexrelid
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY key(attnum,ordinality) ON key.ordinality<=i.indnkeyatts
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=key.attnum
    WHERE n.nspname=$1 AND c.relname=$2 AND x.relname='idx_release_effect_cohort_identity'
    GROUP BY i.indisunique,i.indisvalid,i.indisready,i.indislive,i.indpred,i.indexprs,i.indnkeyatts,i.indnatts`, [schema, tableName]);
  const index = indexes[0];
  if (indexes.length !== 1 || !index || index.unique_index !== true || index.valid_index !== true
    || index.ready_index !== true || index.live_index !== true || index.predicate_free !== true
    || index.expression_free !== true || Number(index.key_count) !== 1 || Number(index.attribute_count) !== 1
    || JSON.stringify(index.key_columns) !== JSON.stringify(['release_id'])) {
    throw new Error('Schema-epoch release-effect cohort relation has an unexpected PostgreSQL identity index');
  }
}
