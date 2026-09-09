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
import { ConfigBundleRuntimeReconciliationTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleRuntimeReconciliationTask.js';
import { tenantService } from '@enterpriseglue/shared/services/platform-admin/TenantService.js';
import { ReleaseEffectSettlementService } from '@enterpriseglue/shared/services/platform-admin/ReleaseEffectSettlementService.js';
import { TenantReleaseWorkAssignmentService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseWorkAssignmentService.js';
import {
  PluginEventDelivery,
  PluginScheduledJob,
  ReleaseEffectCohort,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { DatabasePluginEventDeliveryStoreV1 } from '@enterpriseglue/backend-host/plugins/pluginEventDeliveryStore.js';
import { DatabasePluginScheduleStoreV1 } from '@enterpriseglue/backend-host/plugins/pluginScheduleStore.js';
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
async function runtimePidsBlockedBy(pid: number): Promise<number[]> {
  const rows = await admin.query(
    'SELECT pid FROM pg_stat_activity WHERE usename=$1 AND pid<>$2 AND $2=ANY(pg_blocking_pids(pid)) ORDER BY pid',
    [runtimeName, pid],
  );
  return rows.map((row: { pid: number | string }) => Number(row.pid));
}
async function runtimeWaitChainSize(rootPid: number): Promise<number> {
  const rows = await admin.query(
    'SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE usename=$1 AND pid<>$2',
    [runtimeName, rootPid],
  ) as Array<{ pid: number | string; blockers: Array<number | string> }>;
  const reachable = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const pid = Number(row.pid);
      if (!reachable.has(pid) && row.blockers.some((blocker) => reachable.has(Number(blocker)))) {
        reachable.add(pid);
        changed = true;
      }
    }
  }
  return reachable.size - 1;
}
async function awaitBlockedBy(pid: number, minimumWaiters = 1): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if ((await runtimePidsBlockedBy(pid)).length >= minimumWaiters) return;
    await delay(10);
  }
  throw Error('Expected a real PostgreSQL row-lock waiter');
}
async function awaitBlockedChain(rootPid: number, minimumWaiters: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await runtimeWaitChainSize(rootPid) >= minimumWaiters) return;
    await delay(10);
  }
  throw Error('Expected a real PostgreSQL row-lock wait chain');
}
async function verifyPolicies() {
  const runner = runtime.createQueryRunner(); try { return await verifyPostgresTenantRls(runner); } finally { await runner.release(); }
}
async function restorePolicies() {
  const runner = owner.createQueryRunner(); try { await applyPostgresTenantPolicies(runner); } finally { await runner.release(); }
}

function scheduleCommand(tenantRef: string, idempotencyKey: string) {
  return {
    pluginId: 'io.enterpriseglue.reference' as const,
    deploymentRef: `deployment-${suffix}`,
    tenantRef,
    subjectRef: `subject-${suffix}`,
    deliveryOperationId: 'io.enterpriseglue.reference.refresh-index',
    allowedIntervalsSeconds: [3600],
    maxAttempts: 3,
    request: {
      apiVersion: 'fixed-schedule-request.plugin.enterpriseglue.io/v1' as const,
      callId: `call-${idempotencyKey}`,
      operationId: 'io.enterpriseglue.reference.schedule',
      action: 'upsert' as const,
      jobType: `io.enterpriseglue.reference.refresh-${suffix}`,
      intervalSeconds: 3600,
      idempotencyKey,
    },
  };
}

function eventCommand(tenantRef: string, id: string) {
  return {
    pluginId: 'io.enterpriseglue.reference' as const,
    deploymentRef: `deployment-${suffix}`,
    tenantRef,
    subscriptionType: 'io.enterpriseglue.host.incident.v1' as const,
    operationId: 'io.enterpriseglue.reference.consume-incident',
    maxAttempts: 3,
    event: {
      specversion: '1.0' as const,
      id,
      source: 'enterpriseglue-oss' as const,
      type: 'io.enterpriseglue.host.incident.v1' as const,
      subject: `incident-${suffix}`,
      time: '2026-09-10T00:00:00.000Z',
      dataschema: 'https://schemas.enterpriseglue.io/events/incident-v1.json',
      tenantRef,
      data: { engineRef: `engine-${suffix}`, incidentRef: `incident-${suffix}`, incidentType: 'failedJob' as const },
    },
    now: 10_000,
  };
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

  it('keeps a tenant RLS-hidden effect source uncovered instead of inferring an empty global drain', async () => {
    const releaseId = `release-${suffix}`;
    await tenant(tenantIds[0], () => runtime.getRepository(ConfigBundleRuntimeReconciliationTask).insert({
      id: randomUUID(), tenantId: tenantIds[0], applyRunId: `apply-${suffix}`,
      engineSetIdsJson: '[]', runtimeResourceSetIdsJson: '[]', engineIdsJson: '[]',
      status: 'queued', leaseId: null, leaseExpiresAt: null, attempts: 0,
      nextAttemptAt: Date.now(), resultJson: null, lastError: null, completedAt: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    }));
    expect(await tenant(tenantIds[0], () => runtime.getRepository(ConfigBundleRuntimeReconciliationTask).count()))
      .toBe(1);

    const settlement = new ReleaseEffectSettlementService(
      async () => runtime,
      () => ({ releaseId, cohortEpoch: 1 }),
    );
    await settlement.open({ releaseId, cohortEpoch: 1, expectedRevision: 0 });
    await settlement.close({ releaseId, cohortEpoch: 1, expectedRevision: 1 });
    const status = await settlement.verify({ releaseId, cohortEpoch: 1, expectedRevision: 2 });
    expect(status.sources.find((source) => source.sourceId === 'config_runtime_reconciliation'))
      .toMatchObject({ coverage: 'uncovered', outstanding: null, reasonCode: 'uncovered' });
    expect(status).toMatchObject({
      inventoryComplete: false,
      settled: false,
      eligibleForShutdown: false,
    });
  });

  it('serializes schedule admission before release assignment movement and resweeps the committed row', async () => {
    const oldReleaseId = `sha256:${'4'.repeat(64)}`;
    const newReleaseId = `sha256:${'5'.repeat(64)}`;
    const oldBinding = { releaseId: oldReleaseId, cohortEpoch: 11, managedPooledCloud: true };
    const newBinding = { releaseId: newReleaseId, cohortEpoch: 12, managedPooledCloud: true };
    const oldSettlement = new ReleaseEffectSettlementService(async () => runtime, () => oldBinding);
    const newSettlement = new ReleaseEffectSettlementService(async () => runtime, () => newBinding);
    await oldSettlement.open({ releaseId: oldReleaseId, cohortEpoch: 11, expectedRevision: 0 });
    await newSettlement.open({ releaseId: newReleaseId, cohortEpoch: 12, expectedRevision: 0 });
    await runtime.getRepository(TenantReleaseWorkAssignment).insert({
      id: randomUUID(), tenantRef: tenantIds[0], releaseId: oldReleaseId, assignmentEpoch: 1, updatedAt: Date.now(),
    });

    const blocker = await writer();
    const producer = new DatabasePluginScheduleStoreV1(async () => runtime, Date.now, () => oldBinding);
    const assignment = new TenantReleaseWorkAssignmentService(async () => runtime, () => newBinding);
    let produced: Promise<unknown> | undefined;
    let moved: Promise<unknown> | undefined;
    try {
      await blocker.runner.manager.getRepository(ReleaseEffectCohort).findOne({
        where: { releaseId: oldReleaseId }, lock: { mode: 'pessimistic_write' },
      });
      produced = producer.execute(scheduleCommand(tenantIds[0], `serialize-${suffix}`));
      await awaitBlockedBy(blocker.pid);
      moved = assignment.assign({ tenantId: tenantIds[0], releaseId: newReleaseId, assignmentEpoch: 2 });
      await delay(25);
      await blocker.runner.commitTransaction();
      await expect(produced).resolves.toMatchObject({ status: 'scheduled' });
      await expect(moved).resolves.toMatchObject({ releaseId: newReleaseId, assignmentEpoch: 2, updatedSchedules: 1 });
      const movedAssignment = await runtime.getRepository(TenantReleaseWorkAssignment).findOneByOrFail({ tenantRef: tenantIds[0] });
      expect(movedAssignment.releaseId).toBe(newReleaseId);
      expect(Number(movedAssignment.assignmentEpoch)).toBe(2);
      const movedSchedule = await runtime.getRepository(PluginScheduledJob).findOneByOrFail({ tenantRef: tenantIds[0] });
      expect(movedSchedule.releaseId).toBe(newReleaseId);
      expect(Number(movedSchedule.assignmentEpoch)).toBe(2);
      expect((await oldSettlement.status({ releaseId: oldReleaseId, cohortEpoch: 11 })).sources
        .find((source) => source.sourceId === 'plugin_schedule_delivery'))
        .toMatchObject({ outstanding: 0, reasonCode: 'settled' });
    } finally {
      if (blocker.runner.isTransactionActive) await blocker.runner.rollbackTransaction();
      await blocker.runner.release();
      await Promise.allSettled([produced, moved].filter(Boolean) as Promise<unknown>[]);
    }
  }, 45000);

  it('locks assignment then cohort then event/schedule effects before claiming delivery', async () => {
    const oldReleaseId = `sha256:${'6'.repeat(64)}`;
    const newReleaseId = `sha256:${'7'.repeat(64)}`;
    const oldBinding = { releaseId: oldReleaseId, cohortEpoch: 21, managedPooledCloud: true };
    const newBinding = { releaseId: newReleaseId, cohortEpoch: 22, managedPooledCloud: true };
    await runtime.getRepository(PluginEventDelivery).delete({ tenantRef: tenantIds[0] });
    await runtime.getRepository(PluginScheduledJob).delete({ tenantRef: tenantIds[0] });
    await runtime.getRepository(TenantReleaseWorkAssignment).delete({ tenantRef: tenantIds[0] });
    await new ReleaseEffectSettlementService(async () => runtime, () => oldBinding)
      .open({ releaseId: oldReleaseId, cohortEpoch: 21, expectedRevision: 0 });
    await new ReleaseEffectSettlementService(async () => runtime, () => newBinding)
      .open({ releaseId: newReleaseId, cohortEpoch: 22, expectedRevision: 0 });
    await runtime.getRepository(TenantReleaseWorkAssignment).insert({
      id: randomUUID(), tenantRef: tenantIds[0], releaseId: oldReleaseId, assignmentEpoch: 1, updatedAt: Date.now(),
    });
    const eventStore = new DatabasePluginEventDeliveryStoreV1(
      async () => runtime, {}, {}, undefined, () => oldBinding,
    );
    const scheduleStore = new DatabasePluginScheduleStoreV1(async () => runtime, () => 10_000, () => oldBinding);
    const event = await eventStore.enqueue(eventCommand(tenantIds[0], `claim-${suffix}`));
    await scheduleStore.execute(scheduleCommand(tenantIds[0], `claim-${suffix}`));
    await runtime.getRepository(PluginScheduledJob).update(
      { tenantRef: tenantIds[0] }, { nextRunAt: 10_000 },
    );

    const blocker = await writer();
    let eventClaim: Promise<unknown> | undefined;
    let scheduleClaim: Promise<unknown> | undefined;
    try {
      await blocker.runner.manager.getRepository(TenantReleaseWorkAssignment).findOne({
        where: { tenantRef: tenantIds[0] }, lock: { mode: 'pessimistic_write' },
      });
      eventClaim = eventStore.claimDue({ workerRef: 'event-worker', limit: 1, leaseSeconds: 30, now: 10_000 });
      scheduleClaim = scheduleStore.claimDue({ workerRef: 'schedule-worker', limit: 1, leaseSeconds: 30, now: 10_000 });
      await awaitBlockedBy(blocker.pid);

      const assignment = new TenantReleaseWorkAssignmentService(async () => runtime, () => newBinding);
      await expect(assignment.assign({
        tenantId: tenantIds[0], releaseId: newReleaseId, assignmentEpoch: 2,
      }, blocker.runner.manager)).resolves.toMatchObject({ updatedEvents: 1, updatedSchedules: 1 });
      await blocker.runner.commitTransaction();

      await expect(eventClaim).resolves.toEqual([]);
      await expect(scheduleClaim).resolves.toEqual([]);
      const movedEvent = await runtime.getRepository(PluginEventDelivery)
        .findOneByOrFail({ deliveryId: event.deliveryId });
      expect(movedEvent).toMatchObject({ releaseId: newReleaseId, status: 'pending' });
      expect(Number(movedEvent.assignmentEpoch)).toBe(2);
      const movedSchedule = await runtime.getRepository(PluginScheduledJob)
        .findOneByOrFail({ tenantRef: tenantIds[0] });
      expect(movedSchedule).toMatchObject({ releaseId: newReleaseId, status: 'scheduled' });
      expect(Number(movedSchedule.assignmentEpoch)).toBe(2);
    } finally {
      if (blocker.runner.isTransactionActive) await blocker.runner.rollbackTransaction();
      await blocker.runner.release();
      await Promise.allSettled([eventClaim, scheduleClaim].filter(Boolean) as Promise<unknown>[]);
    }
  }, 45000);

  it('serializes expired event and schedule recovery behind assignment before touching effect rows', async () => {
    const oldReleaseId = `sha256:${'8'.repeat(64)}`;
    const newReleaseId = `sha256:${'9'.repeat(64)}`;
    const oldBinding = { releaseId: oldReleaseId, cohortEpoch: 31, managedPooledCloud: true };
    const newBinding = { releaseId: newReleaseId, cohortEpoch: 32, managedPooledCloud: true };
    await runtime.getRepository(PluginEventDelivery).delete({ tenantRef: tenantIds[0] });
    await runtime.getRepository(PluginScheduledJob).delete({ tenantRef: tenantIds[0] });
    await runtime.getRepository(TenantReleaseWorkAssignment).delete({ tenantRef: tenantIds[0] });
    await new ReleaseEffectSettlementService(async () => runtime, () => oldBinding)
      .open({ releaseId: oldReleaseId, cohortEpoch: 31, expectedRevision: 0 });
    await new ReleaseEffectSettlementService(async () => runtime, () => newBinding)
      .open({ releaseId: newReleaseId, cohortEpoch: 32, expectedRevision: 0 });
    await runtime.getRepository(TenantReleaseWorkAssignment).insert({
      id: randomUUID(), tenantRef: tenantIds[0], releaseId: oldReleaseId, assignmentEpoch: 1, updatedAt: Date.now(),
    });
    const eventStore = new DatabasePluginEventDeliveryStoreV1(
      async () => runtime, {}, {}, undefined, () => oldBinding,
    );
    const scheduleStore = new DatabasePluginScheduleStoreV1(async () => runtime, () => 10_000, () => oldBinding);
    const event = await eventStore.enqueue(eventCommand(tenantIds[0], `expired-${suffix}`));
    await scheduleStore.execute(scheduleCommand(tenantIds[0], `expired-${suffix}`));
    await runtime.getRepository(PluginEventDelivery).update(
      { deliveryId: event.deliveryId },
      { status: 'delivering', attempt: 1, leaseOwner: 'expired-event', leaseExpiresAt: 9_999 },
    );
    await runtime.getRepository(PluginScheduledJob).update(
      { tenantRef: tenantIds[0] },
      { status: 'delivering', attempt: 1, nextRunAt: 9_000, leaseOwner: 'expired-schedule', leaseExpiresAt: 9_999 },
    );

    const assignment = new TenantReleaseWorkAssignmentService(async () => runtime, () => newBinding);
    const eventBlocker = await writer();
    let eventClaim: Promise<unknown> | undefined;
    try {
      await eventBlocker.runner.manager.getRepository(TenantReleaseWorkAssignment).findOne({
        where: { tenantRef: tenantIds[0] }, lock: { mode: 'pessimistic_write' },
      });
      eventClaim = eventStore.claimDue({ workerRef: 'event-recovery', limit: 1, leaseSeconds: 30, now: 10_000 });
      await awaitBlockedBy(eventBlocker.pid);
      await expect(assignment.assign({
        tenantId: tenantIds[0], releaseId: newReleaseId, assignmentEpoch: 2,
      }, eventBlocker.runner.manager)).rejects.toMatchObject({ statusCode: 409 });
      await eventBlocker.runner.commitTransaction();
      await expect(eventClaim).resolves.toEqual([
        expect.objectContaining({ deliveryId: event.deliveryId, attempt: 2, leaseOwner: 'event-recovery' }),
      ]);
    } finally {
      if (eventBlocker.runner.isTransactionActive) await eventBlocker.runner.rollbackTransaction();
      await eventBlocker.runner.release();
      await Promise.allSettled([eventClaim].filter(Boolean) as Promise<unknown>[]);
    }

    const scheduleBlocker = await writer();
    let scheduleClaim: Promise<unknown> | undefined;
    try {
      await scheduleBlocker.runner.manager.getRepository(TenantReleaseWorkAssignment).findOne({
        where: { tenantRef: tenantIds[0] }, lock: { mode: 'pessimistic_write' },
      });
      scheduleClaim = scheduleStore.claimDue({ workerRef: 'schedule-recovery', limit: 1, leaseSeconds: 30, now: 10_000 });
      await awaitBlockedBy(scheduleBlocker.pid);
      await expect(assignment.assign({
        tenantId: tenantIds[0], releaseId: newReleaseId, assignmentEpoch: 2,
      }, scheduleBlocker.runner.manager)).rejects.toMatchObject({ statusCode: 409 });
      await scheduleBlocker.runner.commitTransaction();
      await expect(scheduleClaim).resolves.toEqual([]);
      expect(await runtime.getRepository(TenantReleaseWorkAssignment).findOneByOrFail({ tenantRef: tenantIds[0] }))
        .toMatchObject({ releaseId: oldReleaseId });
      expect(await runtime.getRepository(PluginScheduledJob).findOneByOrFail({ tenantRef: tenantIds[0] }))
        .toMatchObject({ status: 'retry_wait', reasonCode: 'lease_expired', leaseOwner: null });
    } finally {
      if (scheduleBlocker.runner.isTransactionActive) await scheduleBlocker.runner.rollbackTransaction();
      await scheduleBlocker.runner.release();
      await Promise.allSettled([scheduleClaim].filter(Boolean) as Promise<unknown>[]);
    }
  }, 45000);

  it('orders two-tenant event and schedule claim batches before cohort and effect locks', async () => {
    const oldReleaseId = `sha256:${'a'.repeat(64)}`;
    const newReleaseId = `sha256:${'b'.repeat(64)}`;
    const oldBinding = { releaseId: oldReleaseId, cohortEpoch: 41, managedPooledCloud: true };
    const newBinding = { releaseId: newReleaseId, cohortEpoch: 42, managedPooledCloud: true };
    for (const tenantRef of tenantIds) {
      await runtime.getRepository(PluginEventDelivery).delete({ tenantRef });
      await runtime.getRepository(PluginScheduledJob).delete({ tenantRef });
      await runtime.getRepository(TenantReleaseWorkAssignment).delete({ tenantRef });
    }
    await new ReleaseEffectSettlementService(async () => runtime, () => oldBinding)
      .open({ releaseId: oldReleaseId, cohortEpoch: 41, expectedRevision: 0 });
    await new ReleaseEffectSettlementService(async () => runtime, () => newBinding)
      .open({ releaseId: newReleaseId, cohortEpoch: 42, expectedRevision: 0 });
    for (const tenantRef of tenantIds) {
      await runtime.getRepository(TenantReleaseWorkAssignment).insert({
        id: randomUUID(), tenantRef, releaseId: oldReleaseId, assignmentEpoch: 1, updatedAt: Date.now(),
      });
    }
    const eventStore = new DatabasePluginEventDeliveryStoreV1(
      async () => runtime, {}, {}, undefined, () => oldBinding,
    );
    const scheduleStore = new DatabasePluginScheduleStoreV1(async () => runtime, () => 10_000, () => oldBinding);
    const eventA = await eventStore.enqueue(eventCommand(tenantIds[0], `batch-a-${suffix}`));
    const eventB = await eventStore.enqueue(eventCommand(tenantIds[1], `batch-b-${suffix}`));
    await scheduleStore.execute(scheduleCommand(tenantIds[0], `batch-a-${suffix}`));
    await scheduleStore.execute(scheduleCommand(tenantIds[1], `batch-b-${suffix}`));
    // Reverse the preview order across stores. Tenant A carries the expired
    // leases while tenant B remains movable before either claimant reaches a
    // cohort or effect row.
    await runtime.getRepository(PluginEventDelivery).update(
      { deliveryId: eventA.deliveryId },
      { status: 'delivering', attempt: 1, leaseOwner: 'expired-event', leaseExpiresAt: 9_999 },
    );
    await runtime.getRepository(PluginEventDelivery).update(
      { deliveryId: eventB.deliveryId }, { nextAttemptAt: 8_000 },
    );
    await runtime.getRepository(PluginScheduledJob).update(
      { tenantRef: tenantIds[0] },
      { status: 'delivering', attempt: 1, nextRunAt: 8_000, leaseOwner: 'expired-schedule', leaseExpiresAt: 9_999 },
    );
    await runtime.getRepository(PluginScheduledJob).update(
      { tenantRef: tenantIds[1] }, { nextRunAt: 9_000 },
    );

    const blockerA = await writer();
    const blockerB = await writer();
    const assignment = new TenantReleaseWorkAssignmentService(async () => runtime, () => newBinding);
    let eventClaim: Promise<unknown> | undefined;
    let scheduleClaim: Promise<unknown> | undefined;
    try {
      await blockerA.runner.manager.getRepository(TenantReleaseWorkAssignment).findOne({
        where: { tenantRef: tenantIds[0] }, lock: { mode: 'pessimistic_write' },
      });
      await blockerB.runner.manager.getRepository(TenantReleaseWorkAssignment).findOne({
        where: { tenantRef: tenantIds[1] }, lock: { mode: 'pessimistic_write' },
      });
      eventClaim = eventStore.claimDue({ workerRef: 'event-batch', limit: 2, leaseSeconds: 30, now: 10_000 });
      scheduleClaim = scheduleStore.claimDue({ workerRef: 'schedule-batch', limit: 2, leaseSeconds: 30, now: 10_000 });
      // Although the event preview orders B→A and the schedule preview A→B,
      // both managed batches must try the sorted A assignment first. The old
      // per-candidate implementation instead leaves one waiter on each blocker
      // and can form the cross-batch cycle after both blockers are released.
      // PostgreSQL queues the second tuple-lock waiter behind the first, so
      // inspect the complete blocker chain rooted at A rather than only its
      // direct blockers.
      await awaitBlockedChain(blockerA.pid, 2);
      expect(await runtimePidsBlockedBy(blockerB.pid)).toEqual([]);
      await blockerA.runner.commitTransaction();
      await awaitBlockedBy(blockerB.pid);
      await expect(assignment.assign({
        tenantId: tenantIds[1], releaseId: newReleaseId, assignmentEpoch: 2,
      }, blockerB.runner.manager)).resolves.toMatchObject({ updatedEvents: 1, updatedSchedules: 1 });
      await blockerB.runner.commitTransaction();

      await expect(Promise.all([eventClaim, scheduleClaim])).resolves.toEqual([
        [expect.objectContaining({ deliveryId: eventA.deliveryId, attempt: 2, leaseOwner: 'event-batch' })],
        [],
      ]);
      const movedEvent = await runtime.getRepository(PluginEventDelivery)
        .findOneByOrFail({ deliveryId: eventB.deliveryId });
      expect(movedEvent).toMatchObject({ releaseId: newReleaseId, status: 'pending' });
      expect(Number(movedEvent.assignmentEpoch)).toBe(2);
      const movedSchedule = await runtime.getRepository(PluginScheduledJob)
        .findOneByOrFail({ tenantRef: tenantIds[1] });
      expect(movedSchedule).toMatchObject({ releaseId: newReleaseId, status: 'scheduled' });
      expect(Number(movedSchedule.assignmentEpoch)).toBe(2);
      expect(await runtime.getRepository(PluginScheduledJob).findOneByOrFail({ tenantRef: tenantIds[0] }))
        .toMatchObject({ releaseId: oldReleaseId, status: 'retry_wait', reasonCode: 'lease_expired' });
    } finally {
      if (blockerA.runner.isTransactionActive) await blockerA.runner.rollbackTransaction();
      if (blockerB.runner.isTransactionActive) await blockerB.runner.rollbackTransaction();
      await blockerA.runner.release();
      await blockerB.runner.release();
      await Promise.allSettled([eventClaim, scheduleClaim].filter(Boolean) as Promise<unknown>[]);
    }
  }, 45000);

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
