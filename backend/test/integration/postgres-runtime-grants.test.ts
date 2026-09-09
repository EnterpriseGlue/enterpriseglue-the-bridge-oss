import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { refreshPostgresRuntimeGrants } from '@enterpriseglue/shared/db/postgres-runtime-grants.js';

// Run only against the integration harness's disposable loopback PostgreSQL.
const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
const schema = `grants_${suffix}`;
const role = `runtime_${suffix}`;
const member = `member_${suffix}`;
const db = new DataSource({
  type: 'postgres', host: process.env.POSTGRES_HOST || '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT || 5432),
  username: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DATABASE || 'postgres', schema,
});

describe('PostgreSQL runtime grants', () => {
  beforeAll(async () => {
    await db.initialize();
    await db.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await db.query(`CREATE ROLE ${member} NOLOGIN`);
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.migrations (id serial PRIMARY KEY, name text)`);
    await db.query(`CREATE TABLE ${schema}.business (id serial PRIMARY KEY, value text)`);
  });
  afterAll(async () => {
    if (!db.isInitialized) return;
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.query(`DROP OWNED BY ${role}`);
    await db.query(`DROP ROLE IF EXISTS ${role}`);
    await db.query(`DROP ROLE IF EXISTS ${member}`);
    await db.destroy();
  });
  const refresh = async () => {
    const runner = db.createQueryRunner();
    try { await refreshPostgresRuntimeGrants(runner, role); } finally { await runner.release(); }
  };
  async function asRuntime(sql: string) {
    const runner = db.createQueryRunner();
    try {
      await runner.query(`SET ROLE ${role}`);
      return await runner.query(sql);
    } finally {
      await runner.query('RESET ROLE');
      await runner.release();
    }
  }
  it('grants CRUD and sequence nextval, but not DDL, ledger writes, truncate, or setval', async () => {
    await refresh();
    await asRuntime(`INSERT INTO ${schema}.business(value) VALUES ('ok')`);
    await asRuntime(`UPDATE ${schema}.business SET value = 'updated'`);
    expect(await asRuntime(`SELECT value FROM ${schema}.business`)).toEqual([{ value: 'updated' }]);
    await asRuntime(`DELETE FROM ${schema}.business`);
    expect(await asRuntime(`SELECT * FROM ${schema}.migrations`)).toEqual([]);
    for (const sql of [
      `INSERT INTO ${schema}.migrations(name) VALUES ('forged')`,
      `UPDATE ${schema}.migrations SET name = 'forged'`,
      `DELETE FROM ${schema}.migrations`,
      `TRUNCATE ${schema}.business`,
      `ALTER TABLE ${schema}.business ADD COLUMN hacked text`,
      `CREATE TABLE ${schema}.hacked(id int)`,
      `SELECT setval('${schema}.business_id_seq', 100)`,
      `SELECT nextval('${schema}.migrations_id_seq')`,
    ]) await expect(asRuntime(sql)).rejects.toThrow();
  });
  it('keeps future tables read-only until another owner refresh', async () => {
    await db.query(`CREATE TABLE ${schema}.future (id serial PRIMARY KEY, value text)`);
    expect(await asRuntime(`SELECT * FROM ${schema}.future`)).toEqual([]);
    await expect(asRuntime(`INSERT INTO ${schema}.future(value) VALUES ('blocked')`)).rejects.toThrow();
    await refresh();
    await asRuntime(`INSERT INTO ${schema}.future(value) VALUES ('allowed')`);
  });
  it('rejects role administration attributes and memberships without granting anything', async () => {
    for (const attribute of ['CREATEDB', 'CREATEROLE', 'BYPASSRLS', 'REPLICATION', 'SUPERUSER']) {
      await db.query(`ALTER ROLE ${role} ${attribute}`);
      try { await expect(refresh()).rejects.toThrow('no ownership'); }
      finally { await db.query(`ALTER ROLE ${role} NO${attribute}`); }
    }
    await db.query(`GRANT ${member} TO ${role}`);
    try { await expect(refresh()).rejects.toThrow('no ownership'); }
    finally { await db.query(`REVOKE ${member} FROM ${role}`); }
  });
  it('rejects ownership and schema CREATE', async () => {
    await db.query(`GRANT CREATE ON SCHEMA ${schema} TO ${role}`);
    try { await expect(refresh()).rejects.toThrow('no ownership'); }
    finally { await db.query(`REVOKE CREATE ON SCHEMA ${schema} FROM ${role}`); }
    await db.query(`CREATE TABLE ${schema}.owned(id int)`);
    await db.query(`ALTER TABLE ${schema}.owned OWNER TO ${role}`);
    try { await expect(refresh()).rejects.toThrow('no ownership'); }
    finally { await db.query(`DROP TABLE ${schema}.owned`); }
  });
  it('rolls back grants when PUBLIC makes the migration ledger writable', async () => {
    await db.query(`REVOKE ALL ON ${schema}.business FROM ${role}`);
    await db.query(`GRANT INSERT ON ${schema}.migrations TO PUBLIC`);
    try {
      await expect(refresh()).rejects.toThrow('PUBLIC');
      await expect(asRuntime(`SELECT * FROM ${schema}.business`)).rejects.toThrow();
    } finally { await db.query(`REVOKE INSERT ON ${schema}.migrations FROM PUBLIC`); }
    await refresh();
  });
  it('rejects unsafe global default ACLs that schema-local revocation cannot remove', async () => {
    await db.query(`ALTER DEFAULT PRIVILEGES GRANT INSERT ON TABLES TO ${role}`);
    try { await expect(refresh()).rejects.toThrow('default privileges'); }
    finally { await db.query(`ALTER DEFAULT PRIVILEGES REVOKE INSERT ON TABLES FROM ${role}`); }
  });
  it('rejects PUBLIC column-level ledger writes and sequence UPDATE', async () => {
    await db.query(`GRANT UPDATE(name) ON ${schema}.migrations TO PUBLIC`);
    try { await expect(refresh()).rejects.toThrow('PUBLIC'); }
    finally { await db.query(`REVOKE UPDATE(name) ON ${schema}.migrations FROM PUBLIC`); }
    await db.query(`GRANT UPDATE ON SEQUENCE ${schema}.business_id_seq TO PUBLIC`);
    try { await expect(refresh()).rejects.toThrow('PUBLIC'); }
    finally { await db.query(`REVOKE UPDATE ON SEQUENCE ${schema}.business_id_seq FROM PUBLIC`); }
  });
  it('rejects unknown and syntactically invalid identities', async () => {
    const runner = db.createQueryRunner();
    try {
      await expect(refreshPostgresRuntimeGrants(runner, 'role_does_not_exist')).rejects.toThrow('must exist');
      await expect(refreshPostgresRuntimeGrants(runner, 'runtime; SELECT 1')).rejects.toThrow('identifier');
    } finally { await runner.release(); }
  });
  it('preserves FORCE RLS after granting current-table DML', async () => {
    await db.query(`CREATE TABLE ${schema}.tenant_records(tenant_id text, value text)`);
    await db.query(`INSERT INTO ${schema}.tenant_records VALUES ('tenant-a', 'visible'), ('tenant-b', 'hidden')`);
    await db.query(`ALTER TABLE ${schema}.tenant_records ENABLE ROW LEVEL SECURITY`);
    await db.query(`ALTER TABLE ${schema}.tenant_records FORCE ROW LEVEL SECURITY`);
    await db.query(`CREATE POLICY tenant_scope ON ${schema}.tenant_records USING (tenant_id = 'tenant-a') WITH CHECK (tenant_id = 'tenant-a')`);
    await refresh();
    expect(await asRuntime(`SELECT value FROM ${schema}.tenant_records`)).toEqual([{ value: 'visible' }]);
    await expect(asRuntime(`INSERT INTO ${schema}.tenant_records VALUES ('tenant-b', 'forbidden')`)).rejects.toThrow();
    await asRuntime(`INSERT INTO ${schema}.tenant_records VALUES ('tenant-a', 'allowed')`);
  });
});
