import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it as vitestIt, vi } from 'vitest';
import { DataSource, type QueryRunner } from 'typeorm';

// Inject connection selection and engine transport only. Repositories, policies,
// transactions, row locks and the competing registry writers are real PostgreSQL.
const fixture = vi.hoisted(() => ({ database: null as DataSource | null, network: vi.fn<(...args: any[]) => Promise<any>>() }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: async () => {
  if (!fixture.database) throw Error('Fixture not initialized'); return fixture.database;
} }));
vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('@enterpriseglue/shared/services/bpmn-engine-client.js')>(),
  camundaGet: (...args: any[]) => fixture.network(...args), getDecisionDefinitions: async () => [],
}));
import { config } from '@enterpriseglue/shared/config/index.js';
import { PostgresAdapter } from '@enterpriseglue/shared/infrastructure/persistence/adapters/PostgresAdapter.js';
import { installPostgresContextBoundary, assertPostgresContextBoundary } from '@enterpriseglue/shared/infrastructure/persistence/subscribers/TenantRlsSubscriber.js';
import { applyPostgresTenantPolicies, readPostgresTenantPolicyCatalog } from '@enterpriseglue/shared/db/postgres-tenant-policy.js';
import { assertRestrictedPostgresRuntimeRole, verifyPostgresTenantRls } from '@enterpriseglue/shared/db/postgres-tenant-rls.js';
import { getTenantDatabaseContext, runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { reconcileSharedEngineInventory } from '@enterpriseglue/backend-host/services/sharedEngineInventoryReconciliation.js';

const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
const schema = `inventory_${suffix}`, ownerName = `owner_${suffix}`, runtimeName = `runtime_${suffix}`, password = `fixture_${suffix}`;
const env = (name: string, fallback: string) => process.env[`MIGRATION_TEST_${name}`] || process.env[name] || fallback;
const connection = { type: 'postgres' as const, host: env('POSTGRES_HOST', '127.0.0.1'), port: Number(env('POSTGRES_PORT', '5432')), database: env('POSTGRES_DATABASE', 'postgres') };
const admin = new DataSource({ ...connection, username: env('POSTGRES_USER', 'postgres'), password: env('POSTGRES_PASSWORD', 'postgres') });
const original = { tenancyMode: config.tenancyMode, postgresSchema: config.postgresSchema };
const tenantIds = [`a-${suffix}`, `b-${suffix}`];
let owner: DataSource, runtime: DataSource;
const tenant = <T>(id: string, work: () => Promise<T>) => runWithTenantDatabaseContext({ tenantId: id, tenantSlug: id }, work);
const definitions = tenantIds.map((id, index) => ({ id: `definition-${index}`, key: `process-${index}`, version: 1, tenantId: `runtime-${id}` }));
let activeCase: Promise<void> | undefined;
// Vitest deadlines reject the test but do not cancel its asynchronous database
// cleanup. Drain that work before another case can mutate this shared schema.
const it = (name: string, work: () => Promise<void>, timeout = 30000) => vitestIt(name, async () => {
  const pending = Promise.resolve().then(work);
  activeCase = pending;
  void pending.then(() => { if (activeCase === pending) activeCase = undefined; },
    () => { if (activeCase === pending) activeCase = undefined; });
  await pending;
}, timeout);

async function seed(): Promise<Engine> {
  const id = randomUUID();
  await runtime.getRepository(Engine).insert({ id, name: 'Shared readiness fixture', baseUrl: 'http://engine.invalid', tenancyMode: 'shared',
    tenantMappingStrategy: 'engine_tenant_id', tenantMappingVersion: 7, runtimeAccessScope: 'resource_aware', metadataDiscoveryEnabled: true,
    deploymentDiscoveryEnabled: false, tenantResolutionStatus: 'ready', createdAt: Date.now(), updatedAt: Date.now() });
  for (const enterpriseTenantId of tenantIds) await runtime.getRepository(EngineTenantMapping).insert({ id: randomUUID(), engineId: id,
    enterpriseTenantId, externalTenantId: `runtime-${enterpriseTenantId}`, strategy: 'engine_tenant_id', source: 'manual', sourceRef: `${id}-${enterpriseTenantId}`,
    createdAt: Date.now(), updatedAt: Date.now(), isActive: true });
  return runtime.getRepository(Engine).findOneByOrFail({ id });
}
async function writer(): Promise<{ runner: QueryRunner; pid: number }> {
  const runner = runtime.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  const [{ pid }] = await runner.query('SELECT pg_backend_pid() AS pid'); return { runner, pid };
}
async function awaitBlockedBy(pid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const rows = await admin.query('SELECT pid FROM pg_stat_activity WHERE usename=$1 AND pid<>$2 AND $2=ANY(pg_blocking_pids(pid))', [runtimeName, pid]);
    if (rows.length) return;
    await delay(10);
  }
  throw Error('Expected a real PostgreSQL row-lock waiter');
}
async function verifyPolicies() {
  const runner = runtime.createQueryRunner(); try { return await verifyPostgresTenantRls(runner); } finally { await runner.release(); }
}
async function restorePolicies() {
  const runner = owner.createQueryRunner(); try { await applyPostgresTenantPolicies(runner); } finally { await runner.release(); }
}

describe('shared readiness with actual restricted PostgreSQL repositories and writer races', () => {
  beforeAll(async () => {
    Object.assign(config, { tenancyMode: 'pooled', postgresSchema: schema });
    await admin.initialize();
    await admin.query(`CREATE ROLE ${ownerName} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
    await admin.query(`CREATE ROLE ${runtimeName} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${ownerName}`);
    const options = new PostgresAdapter().getDataSourceOptions();
    if (options.type !== 'postgres') throw Error('Expected PostgreSQL adapter');
    const build = (username: string) => {
      const source = new DataSource({ ...options, ...connection, url: undefined, username, password, schema, migrations: [], logging: false, extra: { max: 4 } });
      installPostgresContextBoundary(source); return source;
    };
    owner = build(ownerName); await owner.initialize(); await owner.synchronize();
    const policyRunner = owner.createQueryRunner();
    try { await applyPostgresTenantPolicies(policyRunner); } finally { await policyRunner.release(); }
    await owner.query(`GRANT USAGE ON SCHEMA ${schema} TO ${runtimeName}`);
    await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${runtimeName}`);
    runtime = build(runtimeName); await runtime.initialize(); assertPostgresContextBoundary(runtime); fixture.database = runtime;
    const check = runtime.createQueryRunner(); try { await assertRestrictedPostgresRuntimeRole(check); } finally { await check.release(); }
    for (const id of tenantIds) await runtime.getRepository(Tenant).insert({ id, slug: id, name: id, status: 'active', createdAt: Date.now(), updatedAt: Date.now() });
  }, 30000);
  beforeEach(async () => {
    if (activeCase) throw Error('Previous database case has not settled; refusing overlapping fixture mutations');
    fixture.network.mockReset(); fixture.network.mockResolvedValue(definitions);
    for (const id of tenantIds) await tenantService.update(id, { status: 'active' });
  });
  afterEach(async () => { if (activeCase) await Promise.allSettled([activeCase]); }, 90000);
  afterAll(async () => {
    if (activeCase) await Promise.allSettled([activeCase]);
    fixture.database = null;
    if (runtime?.isInitialized) await runtime.destroy(); if (owner?.isInitialized) await owner.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS ${runtimeName}`); await admin.query(`DROP ROLE IF EXISTS ${ownerName}`); await admin.destroy();
    }
    Object.assign(config, original);
  });

  it('fully reconciles two tenants through real inventory services without an unscoped RLS read', async () => {
    const engine = await seed(); const result = await reconcileSharedEngineInventory(engine);
    expect(result).toHaveLength(2); expect(result.every(row => row.status === 'reconciled')).toBe(true);
    expect(await runtime.getRepository(Engine).findOneByOrFail({ id: engine.id })).toMatchObject({ tenantResolutionStatus: 'ready', lastMetadataReconciliationStatus: 'succeeded' });
    expect(await runtime.getRepository(RuntimeResource).find()).toEqual([]);
    for (const id of tenantIds) {
      const rows = await tenant(id, () => runtime.getRepository(RuntimeResource).findBy({ engineId: engine.id }));
      expect(rows).toHaveLength(1); expect(rows[0].tenantId).toBe(id); expect(rows[0].tenantMappingVersion).toBe(7);
    }
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('partial and earlier-failed cohorts cannot publish later tenant success as global readiness', async () => {
    const partial = await seed(); await reconcileSharedEngineInventory(partial, [tenantIds[0]]);
    expect(await runtime.getRepository(Engine).findOneByOrFail({ id: partial.id })).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
    const failed = await seed(); fixture.network.mockImplementation(async () => {
      if (getTenantDatabaseContext()?.tenantId === tenantIds[0]) throw Error('Engine scope unavailable'); return definitions;
    });
    const result = await reconcileSharedEngineInventory(failed);
    expect(result.some(row => row.tenantId === tenantIds[1] && row.status === 'reconciled')).toBe(true);
    expect(await runtime.getRepository(Engine).findOneByOrFail({ id: failed.id })).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
  });

  it('serializes against a mapping transaction on the same engine row and rejects its changed version', async () => {
    const engine = await seed(); const concurrent = await writer(); let started = false;
    fixture.network.mockImplementation(async () => {
      if (!started && getTenantDatabaseContext()?.tenantId === tenantIds[1]) {
        started = true;
        // Same transaction ordering as EngineTenantMappingService: mapping rows
        // and the versioned shared Engine publication commit together.
        await concurrent.runner.manager.getRepository(EngineTenantMapping).update({ engineId: engine.id, enterpriseTenantId: tenantIds[0] }, { externalTenantId: 'replacement' });
        await concurrent.runner.manager.getRepository(Engine).update({ id: engine.id }, { tenantMappingVersion: 8, tenantResolutionStatus: 'incomplete' });
      }
      return definitions;
    });
    const aggregate = reconcileSharedEngineInventory(engine);
    try {
      await awaitBlockedBy(concurrent.pid); await concurrent.runner.commitTransaction();
      const result = await aggregate;
      expect(result[result.length - 1]).toMatchObject({ tenantId: null, status: 'failed' });
      expect(await runtime.getRepository(Engine).findOneByOrFail({ id: engine.id })).toMatchObject({ tenantMappingVersion: 8, tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
    } finally {
      if (concurrent.runner.isTransactionActive) await concurrent.runner.rollbackTransaction();
      await concurrent.runner.release(); await aggregate.catch(() => {});
    }
  });

  it('waits for a concurrent tenant lifecycle transaction and rejects the changed canonical cohort', async () => {
    const engine = await seed(); const concurrent = await writer(); let started = false;
    fixture.network.mockImplementation(async () => {
      if (!started && getTenantDatabaseContext()?.tenantId === tenantIds[1]) {
        started = true; await tenantService.update(tenantIds[0], { status: 'suspended' }, concurrent.runner.manager);
      }
      return definitions;
    });
    const aggregate = reconcileSharedEngineInventory(engine);
    try {
      await awaitBlockedBy(concurrent.pid); await concurrent.runner.commitTransaction();
      const result = await aggregate;
      expect(result[result.length - 1]).toMatchObject({ tenantId: null, status: 'failed' });
      expect(await runtime.getRepository(Engine).findOneByOrFail({ id: engine.id })).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
    } finally {
      if (concurrent.runner.isTransactionActive) await concurrent.runner.rollbackTransaction();
      await concurrent.runner.release(); await aggregate.catch(() => {});
    }
  });

  it('rejects lost attempt ownership and stale initial CAS using real bigint persistence', async () => {
    const engine = await seed(); let replaced = false;
    fixture.network.mockImplementation(async () => {
      if (!replaced && getTenantDatabaseContext()?.tenantId === tenantIds[1]) {
        replaced = true; const current = await runtime.getRepository(Engine).findOneByOrFail({ id: engine.id });
        await runtime.getRepository(Engine).update({ id: engine.id }, { lastMetadataReconciledAt: Number(current.lastMetadataReconciledAt) + 1 });
      }
      return definitions;
    });
    const result = await reconcileSharedEngineInventory(engine);
    expect(result[result.length - 1]).toMatchObject({ tenantId: null, status: 'failed' });
    expect(await runtime.getRepository(Engine).findOneByOrFail({ id: engine.id })).toMatchObject({ tenantResolutionStatus: 'incomplete', lastMetadataReconciliationStatus: 'failed' });
    fixture.network.mockClear();
    await expect(reconcileSharedEngineInventory(engine)).rejects.toThrow('snapshot changed'); expect(fixture.network).not.toHaveBeenCalled();
  });

  it('verifies fresh/reapplied canonical predicates and rejects same-name broadened SELECT', async () => {
    const before = await verifyPolicies(); expect(before.expected).toBeGreaterThan(0); expect(before.enforced).toBe(before.expected);
    try {
      await owner.query(`ALTER POLICY eg_tenant_isolation_select ON ${schema}.runtime_resources USING (true)`);
      const drifted = await verifyPolicies(); expect(drifted.enforced).toBe(drifted.expected - 1);
    } finally { await restorePolicies(); }
    const repaired = await verifyPolicies(); expect(repaired.enforced).toBe(repaired.expected);
  });

  it('rejects same-name broadened UPDATE USING and WITH CHECK independently', async () => {
    const runner = owner.createQueryRunner();
    let originalPolicy;
    try { originalPolicy = (await readPostgresTenantPolicyCatalog(runner, schema, 'runtime_resources')).find(row => row.policy_name === 'eg_tenant_isolation_update'); }
    finally { await runner.release(); }
    if (!originalPolicy?.using_expression || !originalPolicy.check_expression) throw Error('Expected canonical UPDATE policy');
    for (const expression of ['USING (true)', 'WITH CHECK (true)']) {
      try {
        await owner.query(`ALTER POLICY eg_tenant_isolation_update ON ${schema}.runtime_resources ${expression}`);
        const drifted = await verifyPolicies(); expect(drifted.enforced).toBe(drifted.expected - 1);
      } finally {
        // Restore only the mutated policy body, retaining its original owner
        // attestation. The preceding case separately proves full builder repair.
        await owner.query(`ALTER POLICY eg_tenant_isolation_update ON ${schema}.runtime_resources USING (${originalPolicy.using_expression}) WITH CHECK (${originalPolicy.check_expression})`);
      }
    }
  });

  it('fails closed on missing, malformed, source-stale or wrong-command owner attestations', async () => {
    const [{ description }] = await owner.query(`SELECT obj_description(p.oid,'pg_policy') AS description FROM pg_policy p
      JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname='runtime_resources' AND p.polname='eg_tenant_isolation_select'`, [schema]);
    for (const value of [null, 'not-json', JSON.stringify({ ...JSON.parse(description), sourceSha256: '0'.repeat(64) }),
      JSON.stringify({ ...JSON.parse(description), command: 'DELETE' })]) {
      try {
        const literal = value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
        await owner.query(`COMMENT ON POLICY eg_tenant_isolation_select ON ${schema}.runtime_resources IS ${literal}`);
        const drifted = await verifyPolicies(); expect(drifted.enforced).toBe(drifted.expected - 1);
      } finally {
        // Only the comment changed; avoid rebuilding the entire schema's
        // policy catalogue four times in this bounded negative fixture.
        await owner.query(`COMMENT ON POLICY eg_tenant_isolation_select ON ${schema}.runtime_resources IS '${description.replace(/'/g, "''")}'`);
      }
    }
  });

  it('normalizes under a fixed path and restores caller path for populated, empty and errored statements', async () => {
    const runner = runtime.createQueryRunner();
    try {
      const [{ path: originalPath }] = await runner.query("SELECT current_setting('search_path') AS path");
      const customPath = `"${schema}", public`;
      await runner.query("SELECT set_config('search_path',$1,false)", [customPath]);
      const canonical = await readPostgresTenantPolicyCatalog(runner, schema, 'authz_groups');
      expect(canonical).toHaveLength(4);
      expect((await runner.query("SELECT current_setting('search_path') AS path"))[0].path).toBe(customPath);
      expect(await readPostgresTenantPolicyCatalog(runner, schema, 'absent')).toEqual([]);
      expect((await runner.query("SELECT current_setting('search_path') AS path"))[0].path).toBe(customPath);
      await runner.query("SELECT set_config('search_path','pg_catalog',false)");
      expect(await readPostgresTenantPolicyCatalog(runner, schema, 'authz_groups')).toEqual(canonical);
      await runner.query("SELECT set_config('search_path',$1,false)", [customPath]);
      // Exercise PostgreSQL's statement rollback after the same transactional
      // GUC change, with an execution-time (not constant-folded) SQL error.
      await expect(runner.query(`WITH changed AS MATERIALIZED (SELECT set_config('search_path','pg_catalog',false) AS path)
        SELECT 1 / (length(path)-length('pg_catalog')) FROM changed`)).rejects.toThrow('division by zero');
      expect((await runner.query("SELECT current_setting('search_path') AS path"))[0].path).toBe(customPath);
      await runner.query("SELECT set_config('search_path',$1,false)", [originalPath]);
    } finally { await runner.release(); }
  });

  it('preserves unchanged policy attestations through a same-version PostgreSQL dump/restore with new relation OIDs', async () => {
    const container = process.env.MIGRATION_TEST_POSTGRES_CONTAINER;
    if (!container || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(container)) throw Error('Owned PostgreSQL container is required for restore acceptance');
    const [{ oid: beforeOid }] = await admin.query('SELECT oid FROM pg_class WHERE relnamespace=$1::regnamespace AND relname=$2', [schema, 'authz_groups']);
    const dump = execFileSync('docker', ['exec', container, 'pg_dump', '-U', 'postgres', '-d', connection.database, '--schema', schema, '--format=custom'], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
    // Only this test's random schema is replaced; roles and unrelated schemas
    // in the shared owned fixture remain intact. No migration repairs the dump.
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    const restored = spawnSync('docker', ['exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', connection.database, '--exit-on-error'],
      { input: dump, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
    expect(restored.error).toBeUndefined(); expect(restored.status, restored.stderr).toBe(0);
    const [{ oid: afterOid }] = await admin.query('SELECT oid FROM pg_class WHERE relnamespace=$1::regnamespace AND relname=$2', [schema, 'authz_groups']);
    expect(afterOid).not.toBe(beforeOid);
    const verified = await verifyPolicies(); expect(verified.enforced).toBe(verified.expected);
  }, 90000);
});
