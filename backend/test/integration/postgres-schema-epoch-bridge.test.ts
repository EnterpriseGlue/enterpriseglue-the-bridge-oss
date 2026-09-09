import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  verifyPostgresTenantRlsForPolicyProfile,
} from '@enterpriseglue/shared/db/postgres-tenant-rls.js';
import {
  grantSchemaEpochReleaseEffectCohortRuntimePrivileges,
  verifySchemaEpochReleaseEffectCohortRuntimePrivileges,
} from '@enterpriseglue/shared/db/schema-epoch-runtime-grant.js';
import { EnforceExplicitPostgresContext1700000000132 } from '@enterpriseglue/shared/db/migrations/1700000000132-enforce-explicit-postgres-context.js';

const env = (name: string, fallback: string) =>
  process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const schema = `epoch_bridge_${Date.now()}`;
const tablePath = `${schema}.projects`;
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier('projects')}`;
const cohortTablePath = `${schema}.release_effect_cohorts`;
const cohortTableRef = `${quoteIdentifier(schema)}.${quoteIdentifier('release_effect_cohorts')}`;
const runtimeRole = `epoch_runtime_${Date.now()}`;
const preflightRole = `epoch_preflight_${Date.now()}`;
const preflightPassword = 'epoch_preflight_membership_free_password';
const legacyPredicate = "COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode', true), ''), 'single') <> 'pooled' OR tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), '')";

let pool: Pool;
let preflightPool: Pool;

function runner() {
  return {
    connection: {
      options: { type: 'postgres', schema },
      driver: { escape: quoteIdentifier },
      entityMetadatas: [{
        tableName: 'projects',
        tablePath,
        schema,
        columns: [{ databaseName: 'tenant_id' }],
      }],
    },
    hasTable: async (value: string) => value === tablePath,
    query: async (sql: string, parameters?: unknown[]) => (await pool.query(sql, parameters)).rows,
  } as any;
}

describe('PostgreSQL schema-epoch bridge policy readiness', () => {
  beforeAll(async () => {
    const pgModule = await import('pg');
    const PoolConstructor = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;
    pool = new PoolConstructor({
      host: env('POSTGRES_HOST', 'localhost'),
      port: Number(env('POSTGRES_PORT', '5432')),
      user: env('POSTGRES_USER', 'postgres'),
      password: env('POSTGRES_PASSWORD', 'postgres'),
      database: env('POSTGRES_DATABASE', 'postgres'),
      ssl: env('POSTGRES_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
    });
    await pool.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await pool.query(`CREATE TABLE ${tableRef} (id text PRIMARY KEY, tenant_id text NOT NULL)`);
    await pool.query(`CREATE TABLE ${cohortTableRef} (id text PRIMARY KEY, release_id text NOT NULL, state text NOT NULL)`);
    await pool.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN`);
    await pool.query(`CREATE ROLE ${quoteIdentifier(preflightRole)} LOGIN PASSWORD '${preflightPassword}'`);
    await pool.query(`GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(runtimeRole)}`);
    await pool.query(`ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${tableRef} FORCE ROW LEVEL SECURITY`);
    await pool.query(
      `CREATE POLICY eg_tenant_isolation ON ${tableRef} USING (${legacyPredicate}) WITH CHECK (${legacyPredicate})`,
    );
  });

  afterAll(async () => {
    if (!pool) return;
    if (preflightPool) await preflightPool.end();
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
    await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(preflightRole)}`);
    await pool.end();
  });

  it('is ready on the exact pre-enforcement policy and rejects post-enforcement verification', async () => {
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'legacy-explicit-runtime-compatible/v1'),
    ).resolves.toEqual({ expected: 1, enforced: 1 });
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'explicit-context/v1'),
    ).resolves.toEqual({ expected: 1, enforced: 0 });
  });

  it('remains on the legacy policy until the later owner-controlled 0132 migration applies enforcement', async () => {
    await new EnforceExplicitPostgresContext1700000000132().up(runner());
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'explicit-context/v1'),
    ).resolves.toEqual({ expected: 1, enforced: 1 });
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'legacy-explicit-runtime-compatible/v1'),
    ).resolves.toEqual({ expected: 1, enforced: 0 });
  });

  it('gives the configured restricted runtime exactly the 0131 cohort DML privileges', async () => {
    const dataSource = {
      options: { schema },
      getMetadata: () => ({
        tablePath: cohortTablePath,
        tableName: 'release_effect_cohorts',
        schema,
      }),
    } as any;
    const queryRunner = {
      hasTable: async (value: string) => value === cohortTablePath,
      query: async (sql: string, parameters?: unknown[]) => (await pool.query(sql, parameters)).rows,
    } as any;
    await grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, runtimeRole);
    const pgModule = await import('pg');
    const PoolConstructor = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;
    preflightPool = new PoolConstructor({
      host: env('POSTGRES_HOST', 'localhost'),
      port: Number(env('POSTGRES_PORT', '5432')),
      user: preflightRole,
      password: preflightPassword,
      database: env('POSTGRES_DATABASE', 'postgres'),
      ssl: env('POSTGRES_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
    });
    const preflightQueryRunner = {
      hasTable: async (value: string) => value === cohortTablePath,
      query: async (sql: string, parameters?: unknown[]) => (await preflightPool.query(sql, parameters)).rows,
    } as any;
    await expect(
      verifySchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, preflightQueryRunner, runtimeRole),
    ).resolves.toBeUndefined();
    const memberships = await pool.query(
      `SELECT count(*)::int AS count FROM pg_auth_members m
       JOIN pg_roles member ON member.oid=m.member
       WHERE member.rolname=$1`,
      [preflightRole],
    );
    expect(memberships.rows).toEqual([{ count: 0 }]);
    const result = await pool.query(`SELECT
      has_table_privilege($1, $2, 'SELECT') AS select_ok,
      has_table_privilege($1, $2, 'INSERT') AS insert_ok,
      has_table_privilege($1, $2, 'UPDATE') AS update_ok,
      has_table_privilege($1, $2, 'DELETE') AS delete_ok`, [runtimeRole, cohortTablePath]);
    expect(result.rows).toEqual([{ select_ok: true, insert_ok: true, update_ok: true, delete_ok: false }]);
  });
});
