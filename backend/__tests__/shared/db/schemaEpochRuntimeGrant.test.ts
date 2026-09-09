import { describe, expect, it, vi } from 'vitest';
import { grantSchemaEpochReleaseEffectCohortRuntimePrivileges } from '@enterpriseglue/shared/db/schema-epoch-runtime-grant.js';
import { expectedReleaseEffectCohortTable } from '@enterpriseglue/shared/db/release-effect-cohort-schema.js';

const postgresColumns = [
  ['id', 'text', true, null, true], ['release_id', 'text', true, null, false],
  ['cohort_epoch', 'bigint', true, null, false], ['state', 'text', true, null, false],
  ['revision', 'bigint', true, '1', false], ['inventory_version', 'text', true, null, false],
  ['inventory_sha256', 'text', true, null, false], ['opened_at', 'bigint', true, null, false],
  ['closed_at', 'bigint', false, null, false], ['settled_at', 'bigint', false, null, false],
  ['updated_at', 'bigint', true, null, false],
].map(([name, data_type, not_null, default_expression, primary_key]) => ({
  name, data_type, not_null, default_expression, primary_key,
}));
const postgresIndex = {
  unique_index: true, valid_index: true, ready_index: true, live_index: true,
  predicate_free: true, expression_free: true, key_count: 1, attribute_count: 1,
  key_columns: ['release_id'],
};

function fixture(options: {
  safe?: boolean;
  schemaUsage?: boolean;
  grants?: string[];
  publicGrant?: boolean;
  columnGrant?: boolean;
} = {}) {
  const metadata = { tablePath: 'main.release_effect_cohorts', tableName: 'release_effect_cohorts', schema: 'main' };
  const dataSource = {
    options: { schema: 'main' },
    getMetadata: vi.fn().mockReturnValue(metadata),
  } as any;
  const queryRunner = {
    connection: { options: { type: 'postgres' } },
    hasTable: vi.fn().mockResolvedValue(true),
    query: vi.fn(async (sql: string) => {
      if (sql.includes('a.attname AS name')) return postgresColumns;
      if (sql.includes('i.indisunique AS unique_index')) return [postgresIndex];
      if (sql.includes('FROM pg_roles')) return [{ safe: options.safe ?? true, schema_usage: options.schemaUsage ?? true }];
      if (sql.includes('aclexplode') && sql.includes('JOIN pg_roles grantee')) {
        return (options.grants ?? ['INSERT', 'SELECT', 'UPDATE']).map((privilege_type) => ({ privilege_type }));
      }
      if (sql.includes('has_table_privilege')) return [{
        select_ok: true,
        insert_ok: true,
        update_ok: true,
        delete_ok: false,
        truncate_ok: false,
        references_ok: false,
        trigger_ok: false,
        public_grant: options.publicGrant ?? false,
        column_grant: options.columnGrant ?? false,
      }];
      return [];
    }),
  } as any;
  queryRunner.getTable = vi.fn().mockImplementation(async () =>
    expectedReleaseEffectCohortTable(queryRunner, metadata.tablePath));
  return { dataSource, queryRunner };
}

describe('schema-epoch release-effect runtime grant', () => {
  it('grants only SELECT, INSERT and UPDATE on the exact 0131 table', async () => {
    const { dataSource, queryRunner } = fixture();
    await grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, 'eg_runtime');
    expect(queryRunner.query).toHaveBeenCalledWith(
      'REVOKE ALL PRIVILEGES ON TABLE "main"."release_effect_cohorts" FROM "eg_runtime"',
      undefined,
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'GRANT SELECT, INSERT, UPDATE ON TABLE "main"."release_effect_cohorts" TO "eg_runtime"',
      undefined,
    );
    expect(queryRunner.query).not.toHaveBeenCalledWith(expect.stringMatching(/DEFAULT PRIVILEGES|GRANT DELETE/));
  });

  it('rejects an unsafe role before changing privileges', async () => {
    const { dataSource, queryRunner } = fixture({ safe: false });
    await expect(
      grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, 'eg_runtime'),
    ).rejects.toThrow(/restricted, nonowning/);
    expect(queryRunner.query).not.toHaveBeenCalledWith(expect.stringMatching(/^REVOKE|^GRANT/));
  });

  it('fails closed when the exact post-grant privilege set is not observed', async () => {
    const { dataSource, queryRunner } = fixture({ grants: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] });
    await expect(
      grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, 'eg_runtime'),
    ).rejects.toThrow(/exact release-effect cohort privileges/);
  });

  it('rejects cohort schema drift before inspecting or changing privileges', async () => {
    const { dataSource, queryRunner } = fixture();
    queryRunner.query.mockImplementation(async (sql: string) =>
      sql.includes('a.attname AS name') ? postgresColumns.slice(1) : [postgresIndex]);
    await expect(
      grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, 'eg_runtime'),
    ).rejects.toThrow(/unexpected PostgreSQL column definition/);
  });

  it('uses catalog ACLs visible to a membership-free preflight and rejects PUBLIC grants', async () => {
    const { dataSource, queryRunner } = fixture({ publicGrant: true });
    await expect(
      grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, 'eg_runtime'),
    ).rejects.toThrow(/unexpected effective/);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('aclexplode'),
      ['eg_runtime', 'main', 'release_effect_cohorts'],
    );
    expect(queryRunner.query).not.toHaveBeenCalledWith(expect.stringContaining('information_schema'));
  });

  it('rejects runtime or PUBLIC column-level grants', async () => {
    const { dataSource, queryRunner } = fixture({ columnGrant: true });
    await expect(
      grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, 'eg_runtime'),
    ).rejects.toThrow(/unexpected effective/);
  });
});
