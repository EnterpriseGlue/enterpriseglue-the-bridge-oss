import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  verifyPostgresTenantRlsForPolicyProfile,
} from '@enterpriseglue/shared/db/postgres-tenant-rls.js';
import { EnforceExplicitPostgresContext1700000000132 } from '@enterpriseglue/shared/db/migrations/1700000000132-enforce-explicit-postgres-context.js';

const env = (name: string, fallback: string) =>
  process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const schema = `epoch_bridge_${Date.now()}`;
const tablePath = `${schema}.projects`;
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
const tableRef = `${quoteIdentifier(schema)}.${quoteIdentifier('projects')}`;
const legacyPredicate = "COALESCE(NULLIF(current_setting('enterpriseglue.tenancy_mode', true), ''), 'single') <> 'pooled' OR tenant_id = NULLIF(current_setting('enterpriseglue.tenant_id', true), '')";

let pool: Pool;

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
    await pool.query(`ALTER TABLE ${tableRef} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`ALTER TABLE ${tableRef} FORCE ROW LEVEL SECURITY`);
    await pool.query(
      `CREATE POLICY eg_tenant_isolation ON ${tableRef} USING (${legacyPredicate}) WITH CHECK (${legacyPredicate})`,
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
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
});
