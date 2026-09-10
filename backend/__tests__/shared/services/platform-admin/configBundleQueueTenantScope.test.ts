import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { configBundleIdentityReplayTaskService as identity } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js';
import { configBundleRuntimeReconciliationTaskService as runtime } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js';
import { getTenantDatabaseContext, runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { runWithPlatformDatabaseCapability } from '@enterpriseglue/shared/services/platform-database-context.js';
import { runConfigQueueBatch } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleQueueTenantScope.js';

const replay = vi.hoisted(() => vi.fn());
const materialize = vi.hoisted(() => vi.fn());
const startRun = vi.hoisted(() => vi.fn());
const completeRun = vi.hoisted(() => vi.fn());
const failRun = vi.hoisted(() => vi.fn());
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService: { replayMemberships: replay } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService: { startRun, completeRun, failRun } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/EngineSetService.js', () => ({ engineSetService: { materializeEngineSet: materialize, materializeEngineSetsForEngine: materialize } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js', () => ({ runtimeResourceInventoryService: { materialize, materializeForEngine: materialize } }));

const originalMode = config.tenancyMode;
const bound = (work: () => Promise<unknown>) => runWithTenantDatabaseContext({ tenantId: 'a', tenantSlug: 'untrusted-stale-slug' }, work);
const cases = [
  {
    name: 'identity replay',
    batch: () => identity.runAvailablePages({ maxTasks: 2 }),
    next: () => identity.runNextPage(),
    targeted: () => identity.runNextPage({ applyRunId: 'run-a' }),
    drain: () => identity.drainApplyRun({ applyRunId: 'run-a' }),
    list: (tenantId?: string | null) => identity.listForApplyRun('run-a', tenantId),
    enqueue: (tenantId?: string | null) => identity.enqueue({ tenantId, applyRunId: 'run-a', providerId: 'provider-a', cursor: 'next', initial: { scanned: 1, created: 0, removed: 0, failed: 0 } }),
    work: replay,
  },
  {
    name: 'runtime reconciliation',
    batch: () => runtime.runAvailable({ maxTasks: 2 }),
    next: () => runtime.runNext(),
    targeted: () => runtime.runNext({ applyRunId: 'run-a' }),
    drain: () => runtime.drainApplyRun({ applyRunId: 'run-a' }),
    list: (tenantId?: string | null) => runtime.listForApplyRun('run-a', tenantId),
    enqueue: (tenantId?: string | null) => runtime.enqueue({ tenantId, applyRunId: 'run-a', engineSetIds: ['set-a'], runtimeResourceSetIds: [], engineIds: [] }),
    work: materialize,
  },
];

describe.each(cases)('$name pooled queue scope', queue => {
  const registry = { find: vi.fn(), findOne: vi.fn() };
  const tasks = { find: vi.fn(), findOne: vi.fn(), insert: vi.fn(), update: vi.fn() };
  const receipts = { findOne: vi.fn(), update: vi.fn() };
  const events: Array<{ kind: string; tenantId: string }> = [];
  const consumed = new Set<string>();
  const assertScope = (kind: string) => {
    const context = getTenantDatabaseContext();
    expect(context).toEqual({ tenantId: expect.any(String), tenantSlug: `canonical-${context?.tenantId}` });
    events.push({ kind, tenantId: context!.tenantId });
    return context!.tenantId;
  };
  const task = (tenantId: string) => ({
    id: `task-${tenantId}`, tenantId, applyRunId: `run-${tenantId}`, providerId: `provider-${tenantId}`, syncRunId: 'sync',
    status: 'queued', cursor: 'next', attempts: 0, scanned: 0, created: 0, removed: 0, failed: 0,
    engineSetIdsJson: '["set-a"]', runtimeResourceSetIdsJson: '[]', engineIdsJson: '[]', nextAttemptAt: null, lastError: null,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    config.tenancyMode = 'pooled';
    events.length = 0;
    consumed.clear();
    registry.find.mockResolvedValue(['a', 'b'].map(id => ({ id, slug: `canonical-${id}`, status: 'active' })));
    registry.findOne.mockImplementation(async ({ where }) => ({ id: where.id, slug: `canonical-${where.id}`, status: 'active' }));
    tasks.find.mockImplementation(async ({ where }) => {
      const id = assertScope('scan');
      for (const filter of Array.isArray(where) ? where : [where]) expect(filter.tenantId).toBe(id);
      if (!Array.isArray(where)) return [{ ...task(id), status: 'completed' }];
      if (consumed.has(id)) return [];
      consumed.add(id);
      return [task(id)];
    });
    tasks.findOne.mockImplementation(async ({ where }) => {
      expect(where.tenantId).toBe(assertScope('lookup'));
      return null;
    });
    tasks.insert.mockImplementation(async value => {
      expect(value.tenantId).toBe(assertScope('insert'));
      return {};
    });
    tasks.update.mockImplementation(async (where, value) => {
      expect(where.tenantId).toBe(assertScope(value.attempts ? 'retry' : 'update'));
      return { affected: 1 };
    });
    receipts.findOne.mockImplementation(async ({ where }) => {
      const id = assertScope('receipt-read');
      expect(where.tenantId).toBe(id);
      return { id: `run-${id}`, tenantId: id, resultJson: '{}' };
    });
    receipts.update.mockImplementation(async where => {
      expect(where.tenantId).toBe(assertScope('receipt-write'));
      return { affected: 1 };
    });
    replay.mockImplementation(async () => {
      await Promise.resolve();
      assertScope('work');
      return { scanned: 1, created: 0, removed: 0, failed: 0, truncated: false, nextCursor: null };
    });
    materialize.mockImplementation(async () => { await Promise.resolve(); assertScope('work'); return {}; });
    startRun.mockImplementation(async () => { assertScope('sync-start'); return 'sync'; });
    completeRun.mockImplementation(async () => { assertScope('sync-complete'); });
    failRun.mockImplementation(async () => { assertScope('sync-fail'); });
    const getRepository = (entity: unknown) => entity === Tenant ? registry : entity === ConfigBundleApplyRun ? receipts : tasks;
    vi.mocked(getDataSource).mockResolvedValue({ getRepository, transaction: (work: (manager: unknown) => Promise<unknown>) => work({ getRepository }) } as never);
  });
  afterEach(() => { config.tenancyMode = originalMode; });

  it('fans out before discovery and retains canonical ALS through claim, work and receipts', async () => {
    const results = await queue.batch();
    expect(results.map(result => result.taskId)).toEqual(['task-a', 'task-b']);
    expect(events.filter(event => event.kind === 'work').map(event => event.tenantId)).toEqual(['a', 'b']);
    expect(registry.find).toHaveBeenCalledWith({ where: { status: 'active' }, order: { id: 'ASC' } });
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('keeps retry updates and failure receipts inside the same tenant', async () => {
    queue.work.mockImplementationOnce(async () => { assertScope('work-error'); throw new Error('private failure'); });
    await expect(bound(queue.next)).resolves.toMatchObject({ taskId: 'task-a', status: 'queued' });
    expect(events.some(event => event.kind === 'retry')).toBe(true);
    expect(events.every(event => event.tenantId === 'a')).toBe(true);
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  if (queue.name === 'identity replay') {
    it.each(['completed', 'retry'])('rejects a pooled %s CAS loss without diagnostics and releases tenant scope', async outcome => {
      tasks.update.mockImplementation(async (where, value) => {
        expect(where.tenantId).toBe(assertScope('update'));
        if (where.leaseId) {
          expect(where).toMatchObject({ id: 'task-a', tenantId: 'a', status: 'running' });
          expect(value.leaseId).toBeNull();
          return { affected: 0 };
        }
        return { affected: 1 };
      });
      if (outcome === 'retry') replay.mockRejectedValueOnce(new Error('replay failed'));
      await expect(bound(queue.next)).rejects.toThrow('task lease was lost');
      expect(completeRun).not.toHaveBeenCalled();
      expect(failRun).not.toHaveBeenCalled();
      expect(tasks.update).toHaveBeenCalledTimes(3);
      expect(events.every(event => event.tenantId === 'a')).toBe(true);
      expect(getTenantDatabaseContext()).toBeUndefined();
    });
  }

  it('binds enqueue, listing and the complete drain including its final receipt scan', async () => {
    await bound(() => queue.enqueue());
    await bound(() => queue.list());
    await expect(bound(queue.drain)).resolves.toMatchObject({ status: 'completed' });
    expect(events.every(event => event.tenantId === 'a')).toBe(true);
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('rejects unbound targeted and global requests before touching a protected queue', async () => {
    await expect(queue.enqueue(null)).rejects.toThrow('global queues are unsupported');
    await expect(queue.list(null)).rejects.toThrow('global queues are unsupported');
    await expect(queue.list()).rejects.toThrow('global queues are unsupported');
    await expect(queue.targeted()).rejects.toThrow('global queues are unsupported');
    await expect(queue.drain()).rejects.toThrow('global queues are unsupported');
    await expect(bound(() => queue.enqueue(null))).rejects.toThrow('global queues are unsupported');
    expect(events).toEqual([]);
  });

  it('rejects tenant switching and inactive tenants', async () => {
    await expect(bound(() => queue.enqueue('b'))).rejects.toThrow('bound tenant');
    registry.findOne.mockResolvedValueOnce({ id: 'a', slug: 'canonical-a', status: 'suspended' });
    await expect(bound(queue.next)).rejects.toThrow('not active');
    expect(events).toEqual([]);
  });

  it('does not scan inactive tenant queues or invent a global queue when no tenants are active', async () => {
    registry.find.mockResolvedValue([{ id: 'suspended', slug: 'suspended', status: 'suspended' }]);
    await expect(queue.batch()).resolves.toEqual([]);
    expect(events).toEqual([]);
  });

  it('rejects an incorrectly scoped candidate before claim or work', async () => {
    tasks.find.mockResolvedValueOnce([task('b')]);
    await expect(bound(queue.next)).rejects.toThrow('different tenant');
    expect(queue.work).not.toHaveBeenCalled();
    expect(tasks.update).toHaveBeenCalledTimes(1); // Expired lease reset only.
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('does not convert provider bootstrap authority into tenant queue fanout', async () => {
    await expect(runWithPlatformDatabaseCapability<unknown>({ kind: 'config-bootstrap', bundleKey: 'signup', providerKeys: ['oidc'] }, queue.batch)).rejects.toThrow('Global config continuation queues are unsupported');
    expect(registry.find).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('rotates a continuously busy cohort across ticks with only one task per tick', async () => {
    const ids: string[] = [];
    for (let tick = 0; tick < 4; tick += 1) {
      consumed.clear();
      ids.push((await queue.next())!.taskId);
    }
    expect(new Set(ids.slice(0, 2)).size).toBe(2);
    expect(ids.slice(0, 2)).toEqual(ids.slice(2));
  });

  it('resumes after a removed cursor tenant and skips inactive tenants', async () => {
    const cursor = { lastTenantId: 'b' };
    registry.find.mockResolvedValue([
      { id: 'a', slug: 'canonical-a', status: 'active' },
      { id: 'b', slug: 'canonical-b', status: 'suspended' },
      { id: 'c', slug: 'canonical-c', status: 'active' },
    ]);
    const work = async () => getTenantDatabaseContext()!.tenantId;
    expect(await runConfigQueueBatch(1, work, false, cursor)).toEqual(['c']);
    registry.find.mockResolvedValue([{ id: 'a', slug: 'canonical-a', status: 'active' }]);
    expect(await runConfigQueueBatch(1, work, false, cursor)).toEqual(['a']);
  });

  if (queue.name === 'identity replay') it('keeps replay and runtime worker cursors independent', async () => {
    consumed.clear(); const firstIdentity = await identity.runNextPage();
    consumed.clear(); const firstRuntime = await runtime.runNext();
    consumed.clear(); const secondIdentity = await identity.runNextPage();
    consumed.clear(); const secondRuntime = await runtime.runNext();
    expect(firstIdentity!.taskId).not.toBe(secondIdentity!.taskId);
    expect(firstRuntime!.taskId).not.toBe(secondRuntime!.taskId);
  });

  if (queue.name === 'runtime reconciliation') {
    it.each(['completed', 'failed'])('does not mutate the receipt after a lost lease on the %s path', async status => {
      if (status === 'failed') materialize.mockRejectedValueOnce(new Error('work failed'));
      tasks.update.mockImplementation(async where => {
        expect(where.tenantId).toBe(assertScope('update'));
        return { affected: where.leaseId ? 0 : 1 };
      });
      await expect(bound(queue.next)).rejects.toThrow('lease was lost');
      expect(receipts.findOne).not.toHaveBeenCalled();
      expect(receipts.update).not.toHaveBeenCalled();
      expect(getTenantDatabaseContext()).toBeUndefined();
    });

    it.each(['throw', 'zero affected'])('rolls back terminal state when receipt update has %s, then commits retry and failed receipt together', async failure => {
      const commits: Array<Array<{ kind: string; value: any }>> = [];
      const rollbacks = vi.fn();
      const transaction = vi.fn(async (work: (manager: unknown) => Promise<unknown>) => {
        const pending: Array<{ kind: string; value: any }> = [];
        const manager = { getRepository: (entity: unknown) => {
          const original = entity === ConfigBundleApplyRun ? receipts : tasks;
          return { ...original, update: async (where: unknown, value: unknown) => {
            const result = await original.update(where, value);
            pending.push({ kind: entity === ConfigBundleApplyRun ? 'receipt' : 'task', value });
            return result;
          } };
        } };
        try {
          const result = await work(manager);
          commits.push(pending);
          return result;
        } catch (error) {
          rollbacks();
          throw error;
        }
      });
      const dataSource = await getDataSource();
      vi.mocked(getDataSource).mockResolvedValue({ ...dataSource, transaction } as never);
      if (failure === 'throw') receipts.update.mockRejectedValueOnce(new Error('receipt write failed'));
      else receipts.update.mockResolvedValueOnce({ affected: 0 });

      await expect(bound(queue.next)).resolves.toMatchObject({ status: 'queued', attempts: 1 });
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(rollbacks).toHaveBeenCalledTimes(1);
      expect(commits).toHaveLength(1);
      expect(commits[0].map(write => write.kind)).toEqual(['task', 'receipt']);
      expect(commits[0][0].value).toMatchObject({ status: 'queued', attempts: 1 });
      expect(commits[0][1].value.resultJson).toContain('"status":"failed"');
      expect(events.every(event => event.tenantId === 'a')).toBe(true);
      expect(getTenantDatabaseContext()).toBeUndefined();
    });
  }
});
