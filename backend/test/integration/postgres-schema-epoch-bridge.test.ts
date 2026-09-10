import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { Pool } from 'pg';
import {
  verifyPostgresTenantRlsForPolicyProfile,
} from '@enterpriseglue/shared/db/postgres-tenant-rls.js';
import { applyDualContextPostgresTenantPolicies } from '@enterpriseglue/shared/db/postgres-tenant-policy.js';
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
let ownerDataSource: DataSource;
let preflightDataSource: DataSource;

const tenantTables = [
  { tableName: 'projects', columns: ['tenant_id'] },
  { tableName: 'users', columns: ['tenant_id'] },
  { tableName: 'authz_group_memberships', columns: ['tenant_id'] },
  { tableName: 'audit_logs', columns: ['tenant_id'] },
];

function runner() {
  return {
    connection: {
      options: { type: 'postgres', schema },
      driver: { escape: quoteIdentifier },
      entityMetadatas: tenantTables.map(({ tableName, columns }) => ({
        tableName,
        tablePath: `${schema}.${tableName}`,
        schema,
        columns: columns.map((databaseName) => ({ databaseName })),
      })),
    },
    hasTable: async (value: string) => tenantTables.some(({ tableName }) => value === `${schema}.${tableName}`),
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
    await pool.query(`CREATE TABLE ${quoteIdentifier(schema)}.users (id text PRIMARY KEY, tenant_id text, is_active boolean NOT NULL)`);
    await pool.query(`CREATE TABLE ${quoteIdentifier(schema)}.authz_group_memberships (
      id text PRIMARY KEY, tenant_id text, group_id text NOT NULL, user_id text NOT NULL,
      expires_at bigint, source text NOT NULL, source_ref text, created_by_id text,
      created_at bigint NOT NULL, updated_at bigint NOT NULL
    )`);
    await pool.query(`CREATE TABLE ${quoteIdentifier(schema)}.audit_logs (id text PRIMARY KEY, tenant_id text, action text NOT NULL)`);
    await pool.query(`CREATE TABLE ${cohortTableRef} (
      id text PRIMARY KEY,
      release_id text NOT NULL,
      cohort_epoch bigint NOT NULL,
      state text NOT NULL,
      revision bigint NOT NULL DEFAULT 1,
      inventory_version text NOT NULL,
      inventory_sha256 text NOT NULL,
      opened_at bigint NOT NULL,
      closed_at bigint,
      settled_at bigint,
      updated_at bigint NOT NULL
    )`);
    await pool.query(`CREATE UNIQUE INDEX idx_release_effect_cohort_identity ON ${cohortTableRef} (release_id)`);
    await pool.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN`);
    await pool.query(`CREATE ROLE ${quoteIdentifier(preflightRole)} LOGIN PASSWORD '${preflightPassword}'`);
    await pool.query(`GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(runtimeRole)}`);
    await pool.query(`GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(preflightRole)}`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(runtimeRole)}`);
    await pool.query(`INSERT INTO ${tableRef} VALUES ('project-a', 'tenant-a'), ('project-b', 'tenant-b')`);
    await pool.query(`INSERT INTO ${quoteIdentifier(schema)}.users VALUES ('administrator', NULL, true)`);
    await pool.query(`INSERT INTO ${quoteIdentifier(schema)}.authz_group_memberships
      VALUES ('membership', NULL, 'system.group.platform_administrators', 'administrator', NULL, 'system', 'bootstrap', NULL, 1, 1)`);
    for (const { tableName } of tenantTables) {
      const ref = `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
      await pool.query(`ALTER TABLE ${ref} ENABLE ROW LEVEL SECURITY`);
      await pool.query(`ALTER TABLE ${ref} FORCE ROW LEVEL SECURITY`);
      await pool.query(`CREATE POLICY eg_tenant_isolation ON ${ref} USING (${legacyPredicate}) WITH CHECK (${legacyPredicate})`);
    }
    const baseOptions = {
      type: 'postgres' as const,
      host: env('POSTGRES_HOST', 'localhost'),
      port: Number(env('POSTGRES_PORT', '5432')),
      database: env('POSTGRES_DATABASE', 'postgres'),
      schema,
      synchronize: false,
      entities: [],
      ssl: env('POSTGRES_SSL', 'false') === 'true' ? { rejectUnauthorized: false } : false,
    };
    ownerDataSource = await new DataSource({
      ...baseOptions,
      username: env('POSTGRES_USER', 'postgres'),
      password: env('POSTGRES_PASSWORD', 'postgres'),
    }).initialize();
    preflightDataSource = await new DataSource({
      ...baseOptions,
      username: preflightRole,
      password: preflightPassword,
    }).initialize();
  });

  afterAll(async () => {
    if (!pool) return;
    if (preflightDataSource?.isInitialized) await preflightDataSource.destroy();
    if (ownerDataSource?.isInitialized) await ownerDataSource.destroy();
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
    await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(preflightRole)}`);
    await pool.end();
  });

  it('moves exact legacy through dual compatibility to strict explicit policies without broadening roles', async () => {
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'legacy-tenant-context/v1'),
    ).resolves.toEqual({ expected: 3, enforced: 3 });
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'explicit-context/v1'),
    ).resolves.toEqual({ expected: 3, enforced: 0 });

    await applyDualContextPostgresTenantPolicies(runner());
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'dual-context-compatibility/v1'),
    ).resolves.toEqual({ expected: 3, enforced: 3 });
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'legacy-tenant-context/v1'),
    ).resolves.toEqual({ expected: 3, enforced: 0 });
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'explicit-context/v1'),
    ).resolves.toEqual({ expected: 3, enforced: 0 });

    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${quoteIdentifier(runtimeRole)}`);
      await client.query("SELECT set_config('enterpriseglue.tenancy_mode','pooled',false)");
      await client.query("SELECT set_config('enterpriseglue.tenant_id','tenant-a',false)");
      expect((await client.query(`SELECT id FROM ${tableRef} ORDER BY id`)).rows).toEqual([{ id: 'project-a' }]);

      await client.query("SELECT set_config('enterpriseglue.platform_capability',$1,false)", [JSON.stringify({
        kind: 'authenticated-account', userId: 'administrator',
      })]);
      expect((await client.query(
        `SELECT id FROM ${quoteIdentifier(schema)}.authz_group_memberships WHERE id='membership'`,
      )).rows).toEqual([{ id: 'membership' }]);

      await client.query("SELECT set_config('enterpriseglue.platform_capability',$1,false)", [JSON.stringify({
        kind: 'audit-append', rowId: 'audit-entry',
      })]);
      await expect(client.query(
        `INSERT INTO ${quoteIdentifier(schema)}.audit_logs (id, tenant_id, action) VALUES ('audit-entry', NULL, 'login')`,
      )).resolves.toBeDefined();
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }

    await new EnforceExplicitPostgresContext1700000000132().up(runner());
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'explicit-context/v1'),
    ).resolves.toEqual({ expected: 3, enforced: 3 });
    await expect(
      verifyPostgresTenantRlsForPolicyProfile(runner(), 'dual-context-compatibility/v1'),
    ).resolves.toEqual({ expected: 3, enforced: 0 });
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
    const queryRunner = ownerDataSource.createQueryRunner();
    await queryRunner.connect();
    await grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, queryRunner, runtimeRole);
    await queryRunner.release();
    const preflightQueryRunner = preflightDataSource.createQueryRunner();
    await preflightQueryRunner.connect();
    await expect(
      verifySchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, preflightQueryRunner, runtimeRole),
    ).resolves.toBeUndefined();
    await preflightQueryRunner.release();
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

    await pool.query(`GRANT CREATE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(runtimeRole)}`);
    const unsafeRunner = ownerDataSource.createQueryRunner();
    await unsafeRunner.connect();
    await expect(
      grantSchemaEpochReleaseEffectCohortRuntimePrivileges(dataSource, unsafeRunner, runtimeRole),
    ).rejects.toThrow(/restricted, nonowning/);
    await unsafeRunner.release();
    await pool.query(`REVOKE CREATE ON SCHEMA ${quoteIdentifier(schema)} FROM ${quoteIdentifier(runtimeRole)}`);
  });
});
