import { describe, expect, it, vi } from 'vitest';
import { grantSchemaEpochReleaseEffectCohortRuntimePrivileges } from '@enterpriseglue/shared/db/schema-epoch-runtime-grant.js';

function fixture(options: { safe?: boolean; schemaUsage?: boolean; grants?: string[] } = {}) {
  const metadata = { tablePath: 'main.release_effect_cohorts', tableName: 'release_effect_cohorts', schema: 'main' };
  const dataSource = {
    options: { schema: 'main' },
    getMetadata: vi.fn().mockReturnValue(metadata),
  } as any;
  const queryRunner = {
    hasTable: vi.fn().mockResolvedValue(true),
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM pg_roles')) return [{ safe: options.safe ?? true, schema_usage: options.schemaUsage ?? true }];
      if (sql.includes('role_table_grants')) {
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
      }];
      return [];
    }),
  } as any;
  return { dataSource, queryRunner };
}

describe('schema-epoch release-effect runtime grant', () => {
  it('grants only SELECT, INSERT and UPDATE on the exact 0131 table', async () => {
    const { dataSource, queryRunner } = fixture();
    await grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, 'eg_runtime');
    expect(queryRunner.query).toHaveBeenCalledWith(
      'REVOKE ALL PRIVILEGES ON TABLE "main"."release_effect_cohorts" FROM "eg_runtime"',
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      'GRANT SELECT, INSERT, UPDATE ON TABLE "main"."release_effect_cohorts" TO "eg_runtime"',
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
});
