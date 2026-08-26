import { describe, expect, it } from 'vitest';
import { AddPostgresTenantRls1700000000126 } from '@enterpriseglue/shared/db/migrations/1700000000126-add-postgres-tenant-rls.js';
import { verifyPostgresTenantRlsRole } from '@enterpriseglue/shared/db/postgres-tenant-rls.js';

const migrationTestEnv = (name: string, fallback: string): string =>
  process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;

const connectionOptions = {
  host: migrationTestEnv('POSTGRES_HOST', 'localhost'),
  port: Number(migrationTestEnv('POSTGRES_PORT', '5432')),
  user: migrationTestEnv('POSTGRES_USER', 'postgres'),
  password: migrationTestEnv('POSTGRES_PASSWORD', 'postgres'),
  database: migrationTestEnv('POSTGRES_DATABASE', 'postgres'),
  ssl: false as const,
};

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

describe('native pooled-tenancy PostgreSQL RLS', () => {
  it('isolates reads and writes for a restricted application role', async () => {
    const pgModule = await import('pg');
    const Pool = (pgModule.default?.Pool || pgModule.Pool) as typeof import('pg').Pool;
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const schema = `tenant_rls_${suffix}`;
    const role = `tenant_rls_app_${suffix}`;
    const password = `tenant-rls-${suffix}`;
    const admin = new Pool(connectionOptions);
    let appPool: import('pg').Pool | null = null;
    let appClient: import('pg').PoolClient | null = null;

    try {
      await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
      await admin.query(`CREATE TABLE ${quoteIdentifier(schema)}.projects (id text PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL)`);
      await admin.query(`CREATE ROLE ${quoteIdentifier(role)} LOGIN PASSWORD '${password.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS`);
      await admin.query(`GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(role)}`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteIdentifier(schema)}.projects TO ${quoteIdentifier(role)}`);

      const migrationRunner = {
        connection: {
          options: { type: 'postgres', schema },
          entityMetadatas: [{
            tableName: 'projects',
            tablePath: `${schema}.projects`,
            columns: [{ databaseName: 'tenant_id' }],
          }],
          driver: { escape: quoteIdentifier },
        },
        hasTable: async (tablePath: string) => tablePath === `${schema}.projects`,
        query: (sql: string, parameters?: unknown[]) => admin.query(sql, parameters),
      } as any;
      await new AddPostgresTenantRls1700000000126().up(migrationRunner);

      appPool = new Pool({ ...connectionOptions, user: role, password });
      appClient = await appPool.connect();
      const appRunner = {
        connection: { options: { type: 'postgres' } },
        query: async (sql: string, parameters?: unknown[]) => (await appClient!.query(sql, parameters)).rows,
      } as any;
      await expect(verifyPostgresTenantRlsRole(appRunner)).resolves.toEqual({
        role,
        superuser: false,
        bypassRls: false,
      });

      await appClient.query("SELECT set_config('enterpriseglue.tenancy_mode', 'pooled', false), set_config('enterpriseglue.tenant_id', 'tenant-a', false)");
      await appClient.query(`INSERT INTO ${quoteIdentifier(schema)}.projects (id, tenant_id, name) VALUES ('a', 'tenant-a', 'A')`);
      await appClient.query("SELECT set_config('enterpriseglue.tenant_id', 'tenant-b', false)");
      await appClient.query(`INSERT INTO ${quoteIdentifier(schema)}.projects (id, tenant_id, name) VALUES ('b', 'tenant-b', 'B')`);

      await appClient.query("SELECT set_config('enterpriseglue.tenant_id', 'tenant-a', false)");
      const tenantA = await appClient.query(`SELECT id, tenant_id FROM ${quoteIdentifier(schema)}.projects ORDER BY id`);
      expect(tenantA.rows).toEqual([{ id: 'a', tenant_id: 'tenant-a' }]);
      const crossTenantUpdate = await appClient.query(`UPDATE ${quoteIdentifier(schema)}.projects SET name = 'changed' WHERE id = 'b'`);
      expect(crossTenantUpdate.rowCount).toBe(0);
      await expect(appClient.query(
        `INSERT INTO ${quoteIdentifier(schema)}.projects (id, tenant_id, name) VALUES ('cross', 'tenant-b', 'Cross')`,
      )).rejects.toThrow(/row-level security policy/i);

      await appClient.query("SELECT set_config('enterpriseglue.tenant_id', '', false)");
      const noTenant = await appClient.query(`SELECT count(*)::int AS count FROM ${quoteIdentifier(schema)}.projects`);
      expect(noTenant.rows[0]?.count).toBe(0);

      await appClient.query("SELECT set_config('enterpriseglue.tenancy_mode', 'single', false)");
      const singleMode = await appClient.query(`SELECT count(*)::int AS count FROM ${quoteIdentifier(schema)}.projects`);
      expect(singleMode.rows[0]?.count).toBe(2);
    } finally {
      appClient?.release();
      await appPool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS ${quoteIdentifier(role)}`);
      await admin.end();
    }
  });
});
