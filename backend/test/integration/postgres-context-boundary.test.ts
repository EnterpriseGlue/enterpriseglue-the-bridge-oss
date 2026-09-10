import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource, EntitySchema } from 'typeorm';
import { PostgresAdapter } from '@enterpriseglue/shared/infrastructure/persistence/adapters/PostgresAdapter.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { installPostgresContextBoundary, assertPostgresContextBoundary, TenantRlsSubscriber } from '@enterpriseglue/shared/infrastructure/persistence/subscribers/TenantRlsSubscriber.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { runWithPlatformDatabaseCapability, getPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';
import { applyPostgresTenantPolicies } from '@enterpriseglue/shared/db/postgres-tenant-policy.js';
import { withPostgresMigrationContext } from '@enterpriseglue/shared/db/postgres-migration-context.js';
import { assertRestrictedPostgresRuntimeRole } from '@enterpriseglue/shared/db/postgres-tenant-rls.js';

const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
const schema = `context_${suffix}`;
const ownerRole = `owner_${suffix}`;
const runtimeRole = `app_${suffix}`;
const password = `disposable_${suffix}`;
const project = new EntitySchema({ name: 'ContextProject', tableName: 'projects', schema,
  columns: { id: { type: String, primary: true }, tenantId: { type: String, name: 'tenant_id', nullable: true }, label: { type: String } } });
const provider = new EntitySchema({ name: 'ContextProvider', tableName: 'identity_providers', schema,
  columns: { id: { type: String, primary: true }, tenantId: { type: String, name: 'tenant_id', nullable: true },
    key: { type: String }, source_ref: { type: String }, is_enabled: { type: Boolean }, authentication_mode: { type: String }, protocol: { type: String } } });
const environment = (name: string, fallback: string) => process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const credentials = { type: 'postgres' as const, host: environment('POSTGRES_HOST','127.0.0.1'), port: Number(environment('POSTGRES_PORT','5432')),
  database: environment('POSTGRES_DATABASE','postgres') };
const admin = new DataSource({ ...credentials, username: environment('POSTGRES_USER','postgres'), password: environment('POSTGRES_PASSWORD','postgres') });
let owner: DataSource;
let runtime: DataSource;
let originalMode: typeof config.tenancyMode;
const tenant = <T>(tenantId: string, work: () => Promise<T>) => runWithTenantDatabaseContext({ tenantId, tenantSlug: tenantId }, work);
const select = (source = runtime) => source.query(`SELECT id FROM ${schema}.projects ORDER BY id`);
const build = (username: string, boundary = true) => {
  // Actual adapter registration, not manually new Subscriber() in the fixture.
  const options = new PostgresAdapter().getDataSourceOptions();
  if (options.type !== 'postgres') throw new Error('Expected PostgreSQL adapter options');
  const source = new DataSource({ ...options, ...credentials, url: undefined,
    schema, username, password, entities: [project, provider], migrations: [], synchronize: false, logging: false, extra: { max: 1 } });
  if (boundary) installPostgresContextBoundary(source);
  return source;
};

describe('PostgreSQL context boundary with the actual TypeORM runner and forced RLS', () => {
  beforeAll(async () => {
    originalMode = config.tenancyMode;
    config.tenancyMode = 'pooled';
    await admin.initialize();
    await admin.query(`CREATE ROLE ${ownerRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
    await admin.query(`CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${ownerRole}`);
    owner = build(ownerRole);
    await owner.initialize();
    assertPostgresContextBoundary(owner);
    await owner.synchronize();
    await owner.query(`INSERT INTO ${schema}.projects VALUES ('a','tenant-a','A'), ('b','tenant-b','B'), ('global',NULL,'global')`);
    await owner.query(`INSERT INTO ${schema}.identity_providers VALUES ('provider-a',NULL,'google','manual',true,'direct','oidc'), ('disabled',NULL,'disabled','manual',false,'direct','oidc'), ('tenant-provider','tenant-b','tenant','manual',true,'direct','oidc')`);
    const runner = owner.createQueryRunner();
    try { await applyPostgresTenantPolicies(runner); } finally { await runner.release(); }
    await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeRole}`);
    await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${runtimeRole}`);
    runtime = build(runtimeRole);
    await runtime.initialize();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    config.tenancyMode = originalMode;
    if (runtime?.isInitialized) await runtime.destroy();
    if (owner?.isInitialized) await owner.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`);
      await admin.query(`DROP ROLE IF EXISTS ${ownerRole}`);
      await admin.destroy();
    }
  });
  it('registers the actual subscriber and denies a missing boundary at startup/query', async () => {
    expect(runtime.subscribers.filter(s => s instanceof TenantRlsSubscriber)).toHaveLength(1);
    assertPostgresContextBoundary(runtime);
    const unguarded = build(runtimeRole, false);
    try {
      await unguarded.initialize();
      expect(() => assertPostgresContextBoundary(unguarded)).toThrow('not registered');
      await expect(select(unguarded)).rejects.toThrow('outside the security context');
    } finally { if (unguarded.isInitialized) await unguarded.destroy(); }
  });
  it('denies absent/unknown context, isolates tenants and prevents cross-tenant writes', async () => {
    expect(await select()).toEqual([]);
    expect(await tenant('unknown', () => select())).toEqual([]);
    expect(await tenant('tenant-a', () => select())).toEqual([{ id: 'a' }]);
    expect(await tenant('tenant-b', () => select())).toEqual([{ id: 'b' }]);
    await expect(tenant('tenant-a', () => runtime.query(`INSERT INTO ${schema}.projects VALUES ('attack','tenant-b','x')`))).rejects.toThrow('row-level security');
    expect(await select()).toEqual([]);
  });
  it('keeps provider discovery read-only and excludes disabled/tenant/business rows', async () => {
    await runWithPlatformDatabaseCapability({ kind: 'provider-discovery' }, async () => {
      expect(await runtime.query(`SELECT id FROM ${schema}.identity_providers`)).toEqual([{ id: 'provider-a' }]);
      expect(await select()).toEqual([]);
      expect(await runtime.query(`UPDATE ${schema}.identity_providers SET is_enabled=false RETURNING id`)).toEqual([[], 0]);
    });
    expect(await runtime.query(`SELECT id FROM ${schema}.identity_providers`)).toEqual([]);
  });
  it('revokes a capability in detached asynchronous work after its owner settles', async () => {
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    let later!: Promise<unknown>;
    await runWithPlatformDatabaseCapability({ kind: 'provider-discovery' }, async () => {
      later = (async () => { await gate; expect(getPlatformDatabaseCapability()).toBeUndefined(); return runtime.query(`SELECT id FROM ${schema}.identity_providers`); })();
    });
    resume();
    expect(await later).toEqual([]);
  });
  it('serializes concurrent contexts on one runner and rejects reuse after release', async () => {
    const runner = runtime.createQueryRunner();
    const query = () => runner.query(`SELECT id, pg_sleep(0.01) FROM ${schema}.projects ORDER BY id`);
    const results = await Promise.all([tenant('tenant-a', query), tenant('tenant-b', query), query()]);
    expect(results.map(rows => rows.map((row: {id: string}) => row.id))).toEqual([['a'], ['b'], []]);
    await runner.release();
    await expect(query()).rejects.toThrow('released');
  });
  it('cleans SQL errors and transaction rollback/savepoint recovery on a one-client pool', async () => {
    const runner = runtime.createQueryRunner();
    try {
      await runner.startTransaction();
      await runner.startTransaction();
      await expect(tenant('tenant-a', () => runner.query('SELECT 1/0'))).rejects.toThrow();
      await expect(runner.query('SELECT 1')).rejects.toThrow('requires rollback');
      await runner.rollbackTransaction();
      expect(await tenant('tenant-b', () => runner.query(`SELECT id FROM ${schema}.projects`))).toEqual([{id: 'b'}]);
      await runner.commitTransaction();
    } finally { await runner.release(); }
    expect(await select()).toEqual([]);
  });
  it('quarantines release with an aborted transaction instead of recycling its backend PID', async () => {
    const runner = runtime.createQueryRunner();
    const [{pid}] = await runner.query('SELECT pg_backend_pid() AS pid');
    await runner.startTransaction();
    await expect(runner.query('SELECT 1/0')).rejects.toThrow();
    await runner.release();
    expect((await runtime.query('SELECT pg_backend_pid() AS pid'))[0].pid).not.toBe(pid);
    expect(await select()).toEqual([]);
  });
  it('rejects a swallowed final SQL error instead of reporting a rolled-back transaction as committed', async () => {
    let sqlFailure: unknown;
    let transactionFailure: unknown;
    try {
      await tenant('tenant-a',()=>runtime.transaction(async manager=>{
        await manager.query(`INSERT INTO ${schema}.projects VALUES ('swallowed-error','tenant-a','must roll back')`);
        try { await manager.query('SELECT 1/0'); } catch(error) { sqlFailure=error; }
        return 'incorrect success';
      }));
    } catch(error) { transactionFailure=error; }
    expect(sqlFailure).toBeDefined();
    expect(transactionFailure).toBe(sqlFailure);
    expect(await tenant('tenant-a',()=>runtime.query(`SELECT id FROM ${schema}.projects WHERE id='swallowed-error'`))).toEqual([]);
    expect(await select()).toEqual([]);
  });
  it('allows only rollback recovery after a transaction fails, never commit or setup controls', async()=>{
    const runner=runtime.createQueryRunner();
    const dispatched:string[]=[];
    const observer={beforeQuery(event:{query:string}){dispatched.push(event.query);}};
    runtime.subscribers.push(observer);
    try {
      await runner.startTransaction();
      let sqlFailure:unknown;
      try { await runner.query('SELECT 1/0'); } catch(error) {sqlFailure=error;}
      expect(sqlFailure).toBeDefined();
      dispatched.length=0;
      for(const command of ['COMMIT','RELEASE SAVEPOINT typeorm_1','SAVEPOINT typeorm_1','SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']) {
        await expect(runner.query(command)).rejects.toBe(sqlFailure);
      }
      expect(dispatched).toEqual([]);
      await runner.rollbackTransaction();
      expect(await tenant('tenant-a',()=>runner.query(`SELECT id FROM ${schema}.projects`))).toEqual([{id:'a'}]);
    } finally {runtime.subscribers.splice(runtime.subscribers.indexOf(observer),1);await runner.release();}
  });
  it('preserves TypeORM isolation levels without injecting a query before SET TRANSACTION', async () => {
    for (const isolation of ['SERIALIZABLE', 'REPEATABLE READ'] as const) {
      await runtime.transaction(isolation, async manager => {
        expect((await manager.query('SHOW transaction_isolation'))[0].transaction_isolation).toBe(isolation.toLowerCase());
        expect(await tenant('tenant-a', () => manager.query(`SELECT id FROM ${schema}.projects`))).toEqual([{id:'a'}]);
      });
    }
  });
  it('unlocks and clears when another BeforeQuery hook rejects outside TypeORM try/finally', async () => {
    const other = { beforeQuery(event: {query: string}) { if (event.query === 'SELECT fail_before') return Promise.reject(new Error('other subscriber failure')); } };
    runtime.subscribers.push(other);
    const runner = runtime.createQueryRunner();
    try {
      await expect(tenant('tenant-a', () => runner.query('SELECT fail_before'))).rejects.toThrow('other subscriber failure');
      expect(await runner.query(`SELECT id FROM ${schema}.projects`)).toEqual([]);
    } finally { runtime.subscribers.splice(runtime.subscribers.indexOf(other), 1); await runner.release(); }
  });
  it('evicts the physical connection on context cleanup failure', async () => {
    const runner = runtime.createQueryRunner();
    const [{pid}] = await runner.query('SELECT pg_backend_pid() AS pid');
    const other = { beforeQuery(event: {query: string; parameters?: unknown[]}) {
      if (event.query.includes("set_config('enterpriseglue.tenancy_mode'") && event.parameters?.[0] === 'denied') throw new Error('cleanup refused');
    } };
    runtime.subscribers.push(other);
    try { await expect(runner.query('SELECT 1')).rejects.toThrow('cleanup failed'); }
    finally { runtime.subscribers.splice(runtime.subscribers.indexOf(other), 1); await runner.release(); }
    expect((await runtime.query('SELECT pg_backend_pid() AS pid'))[0].pid).not.toBe(pid);
  });
  it('binds migration authority to verified owner, rolls failures back, and revokes the lease', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', runtimeRole);
    expect(await withPostgresMigrationContext(owner, 'apply', () => select(owner))).toHaveLength(3);
    await expect(withPostgresMigrationContext(runtime, 'apply', () => select())).rejects.toThrow('schema owner');
    await expect(withPostgresMigrationContext(owner, 'apply', () => owner.transaction(async manager => {
      await manager.query(`INSERT INTO ${schema}.projects VALUES ('rolled-back',NULL,'x')`);
      throw new Error('migration failed');
    }))).rejects.toThrow('migration failed');
    expect(await withPostgresMigrationContext(owner, 'apply', () => select(owner))).toHaveLength(3);
    expect(await select(owner)).toEqual([]);
    expect(getPlatformDatabaseCapability()).toBeUndefined();
    expect(await runWithPlatformDatabaseCapability({kind:'migration-execution', schema, ownerRole: runtimeRole}, () => select())).toEqual([]);
    vi.unstubAllEnvs();
  });
  it('rejects privileged/member runtime configuration before running migration work', async () => {
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', ownerRole);
    const work = vi.fn(async () => true);
    await expect(withPostgresMigrationContext(owner, 'apply', work)).rejects.toThrow('restricted');
    expect(work).not.toHaveBeenCalled();
    vi.stubEnv('EG_POSTGRES_RUNTIME_ROLE', runtimeRole);
    await admin.query(`GRANT ${ownerRole} TO ${runtimeRole}`);
    try { await expect(withPostgresMigrationContext(owner, 'apply', work)).rejects.toThrow('restricted'); }
    finally { await admin.query(`REVOKE ${ownerRole} FROM ${runtimeRole}`); vi.unstubAllEnvs(); }
  });
  it('supports historical DML on an existing tenant-only policy and removes the temporary owner branch', async () => {
    for (const command of ['select','insert','update','delete']) await owner.query(`DROP POLICY eg_tenant_isolation_${command} ON ${schema}.projects`);
    await owner.query(`CREATE POLICY eg_tenant_isolation ON ${schema}.projects USING (tenant_id=NULLIF(current_setting('enterpriseglue.tenant_id',true),''))`);
    expect(await select(owner)).toEqual([]);
    await withPostgresMigrationContext(owner, 'apply', async () => {
      expect(await select(owner)).toHaveLength(3);
      await owner.transaction(async manager => { await manager.query(`UPDATE ${schema}.projects SET label='migrated' WHERE tenant_id IS NULL`); });
      const runner = owner.createQueryRunner();
      try { await applyPostgresTenantPolicies(runner); } finally { await runner.release(); }
    });
    expect(await owner.query(`SELECT policyname FROM pg_policies WHERE schemaname=$1 AND policyname='eg_migration_execution'`, [schema])).toEqual([]);
    expect(await select(owner)).toEqual([]);
    expect(await tenant('tenant-a', () => select())).toEqual([{id:'a'}]);
  });
  it('supports explicit single mode and rejects pooled streaming', async () => {
    const runner = runtime.createQueryRunner();
    await expect(runner.stream('SELECT 1')).rejects.toThrow('Pooled PostgreSQL streaming');
    await runner.release();
    config.tenancyMode = 'single';
    try {
      expect(await select()).toHaveLength(3);
      const streaming = runtime.createQueryRunner();
      try {
        // The shipped dependency graph does not include pg-query-stream. Keep
        // TypeORM's existing explicit error; no silent empty RLS result/fallback.
        await expect(streaming.stream(`SELECT id FROM ${schema}.projects ORDER BY id`)).rejects.toThrow('pg-query-stream');
      } finally { await streaming.release(); }
    }
    finally { config.tenancyMode = 'pooled'; }
    expect(await select()).toEqual([]);
  });
  it('rejects owner and indirect owner memberships in application verify mode independently of migration env', async () => {
    const verify = async (source: DataSource) => {const runner=source.createQueryRunner(); try {await assertRestrictedPostgresRuntimeRole(runner);} finally {await runner.release();}};
    await verify(runtime);
    await expect(verify(owner)).rejects.toThrow('restricted nonowning');
    const intermediary=`member_${suffix}`;
    await admin.query(`CREATE ROLE ${intermediary}`);
    await admin.query(`GRANT ${ownerRole} TO ${intermediary}`);
    await admin.query(`GRANT ${intermediary} TO ${runtimeRole}`);
    try {await expect(verify(runtime)).rejects.toThrow('restricted nonowning');}
    finally {await admin.query(`REVOKE ${intermediary} FROM ${runtimeRole}`);await admin.query(`DROP ROLE ${intermediary}`);}
  });
  it('cleans temporary policies after migration renames/drops captured relations', async () => {
    await withPostgresMigrationContext(owner,'apply',async () => {await owner.query(`ALTER TABLE ${schema}.identity_providers RENAME TO provider_archived`);});
    expect(await owner.query(`SELECT policyname FROM pg_policies WHERE schemaname=$1 AND policyname='eg_migration_execution'`,[schema])).toEqual([]);
    await owner.query(`ALTER TABLE ${schema}.provider_archived RENAME TO identity_providers`);
    await withPostgresMigrationContext(owner,'apply',async () => {await owner.query(`DROP TABLE ${schema}.identity_providers`);});
    expect(await owner.query(`SELECT policyname FROM pg_policies WHERE schemaname=$1 AND policyname='eg_migration_execution'`,[schema])).toEqual([]);
  });
});
