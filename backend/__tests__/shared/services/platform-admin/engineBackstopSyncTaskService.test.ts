import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineBackstopSyncTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineBackstopScopeBusyError, EngineBackstopSyncTaskService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncTaskService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const sourceHash = 'a'.repeat(64);

function setup(rows: any[] = [], engineActive = true) {
  const controls = { loseLeaseOnRenew: false };
  const repository = {
    findOne: vi.fn(async ({ where }: any) => {
      const filters = Array.isArray(where) ? where : [where];
      return rows.find((row) => filters.some((filter) => {
        if (filter.runId && row.runId !== filter.runId) return false;
        if (filter.engineId && row.engineId !== filter.engineId) return false;
        if (filter.status && row.status !== filter.status) return false;
        if (typeof filter.tenantId === 'string' && row.tenantId !== filter.tenantId) return false;
        if (filter.tenantId?._type === 'isNull' && row.tenantId !== null) return false;
        return true;
      })) || null;
    }),
    insert: vi.fn(async (row: any) => {
      if (rows.some((candidate) => candidate.runId === row.runId)) throw new Error('unique run_id constraint');
      rows.push({ ...row });
    }),
    find: vi.fn(async ({ where }: any) => {
      const filters = Array.isArray(where) ? where : [where];
      return rows.filter((row) => filters.some((filter) => {
        if (filter.runId && row.runId !== filter.runId) return false;
        if (filter.status && row.status !== filter.status) return false;
        return row.nextAttemptAt === null || row.nextAttemptAt <= Date.now();
      }));
    }),
    update: vi.fn(async (criteria: any, values: any) => {
      const leaseOperator = criteria.leaseExpiresAt as { _type?: string; _value?: number } | undefined;
      if (leaseOperator?._type === 'moreThan' && controls.loseLeaseOnRenew) return { affected: 0 };
      const matched = rows.filter((row) => {
        if (criteria.id && row.id !== criteria.id) return false;
        if (criteria.runId && row.runId !== criteria.runId) return false;
        if (criteria.status && row.status !== criteria.status) return false;
        if (criteria.leaseId && row.leaseId !== criteria.leaseId) return false;
        if (leaseOperator?._type === 'lessThanOrEqual' && (row.leaseExpiresAt === null || row.leaseExpiresAt > Number(leaseOperator._value))) return false;
        if (leaseOperator?._type === 'moreThan' && (row.leaseExpiresAt === null || row.leaseExpiresAt <= Number(leaseOperator._value))) return false;
        return true;
      });
      matched.forEach((row) => Object.assign(row, values));
      return { affected: matched.length };
    }),
  };
  const engineRepository = { update: vi.fn(async () => ({ affected: engineActive ? 1 : 0 })) };
  const getRepository = (entity: unknown) => {
    if (entity === EngineBackstopSyncTask) return repository;
    if (entity === Engine) return engineRepository;
    throw new Error('Unexpected repository');
  };
  vi.mocked(getDataSource).mockResolvedValue({
    getRepository,
    transaction: async (callback: (manager: { getRepository: typeof getRepository }) => unknown) => callback({ getRepository }),
  } as any);
  return { rows, repository, controls };
}

describe('EngineBackstopSyncTaskService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the run unique key to collapse concurrent enqueue attempts into one durable task', async () => {
    const state = setup();
    const service = new EngineBackstopSyncTaskService();

    const [first, second] = await Promise.all([
      service.enqueue({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash, operation: 'apply' }),
      service.enqueue({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash, operation: 'apply' }),
    ]);

    expect(first.id).toBe(second.id);
    expect(state.rows).toHaveLength(1);
    expect(state.repository.insert).toHaveBeenCalledTimes(2);
  });

  it('serializes distinct backstop runs for an engine across tenants while allowing a later run after completion', async () => {
    const state = setup();
    const service = new EngineBackstopSyncTaskService();
    await service.enqueue({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash, operation: 'apply' });

    await expect(service.enqueue({ engineId: 'engine-1', tenantId: 'tenant-b', runId: 'run-2', sourceHash, operation: 'apply' }))
      .rejects.toBeInstanceOf(EngineBackstopScopeBusyError);
    expect(state.rows).toHaveLength(1);

    state.rows[0].status = 'completed';
    await expect(service.enqueue({ engineId: 'engine-1', tenantId: 'tenant-b', runId: 'run-2', sourceHash, operation: 'apply' }))
      .resolves.toMatchObject({ runId: 'run-2', status: 'queued' });
    expect(state.rows).toHaveLength(2);
  });

  it('does not enqueue after engine decommission wins the lifecycle claim', async () => {
    const state = setup([], false);
    const service = new EngineBackstopSyncTaskService();
    await expect(service.enqueue({ engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash, operation: 'apply' }))
      .rejects.toMatchObject({ code: 'ENGINE_BACKSTOP_ENGINE_INACTIVE', statusCode: 409 });
    expect(state.rows).toHaveLength(0);
  });

  it('leases a queued run to one executor even when workers poll concurrently', async () => {
    const state = setup([{
      id: 'task-1', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-1', sourceHash, operation: 'apply',
      status: 'queued', leaseId: null, leaseExpiresAt: null, attempts: 0, nextAttemptAt: null, resultJson: null, lastError: null,
      completedAt: null, createdAt: 1, updatedAt: 1,
    }]);
    const service = new EngineBackstopSyncTaskService();
    const execute = vi.fn(async () => ({ createdCount: 1 }));

    const [first, second] = await Promise.all([
      service.runNext(execute, { runId: 'run-1' }),
      service.runNext(execute, { runId: 'run-1' }),
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ status: 'completed', attempts: 0, resultJson: JSON.stringify({ createdCount: 1 }) });
  });

  it('recovers an expired lease and records a bounded retry without performing duplicate work', async () => {
    const state = setup([{
      id: 'task-stale', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-stale', sourceHash, operation: 'apply',
      status: 'running', leaseId: 'expired-lease', leaseExpiresAt: Date.now() - 1, attempts: 0, nextAttemptAt: null, resultJson: null,
      lastError: null, completedAt: null, createdAt: 1, updatedAt: 1,
    }]);
    const service = new EngineBackstopSyncTaskService();

    const recovered = await service.runNext(async () => ({ recovered: true }), { runId: 'run-stale' });
    expect(recovered).toMatchObject({ status: 'completed', attempts: 0 });
    expect(state.rows[0]).toMatchObject({ status: 'completed', leaseId: null, leaseExpiresAt: null });

    state.rows[0] = {
      ...state.rows[0], id: 'task-retry', runId: 'run-retry', status: 'queued', attempts: 0, nextAttemptAt: null,
      resultJson: null, completedAt: null,
    };
    const failed = await service.runNext(async () => { throw new Error('sidecar rejected request'); }, { runId: 'run-retry' });
    expect(failed).toMatchObject({
      status: 'queued', attempts: 1,
      lastError: 'Backstop task failed (ENGINE_BACKSTOP_TASK_FAILED); inspect protected server logs',
    });
    expect(state.rows[0].nextAttemptAt).toBeGreaterThan(Date.now());
    expect(await service.runNext(async () => ({ shouldNotRun: true }), { runId: 'run-retry' })).toBeNull();
  });

  it('never persists adapter, endpoint, secret-reference, bearer, or native identifier details in retry evidence', async () => {
    const state = setup([{
      id: 'task-secret-failure', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-secret-failure', sourceHash, operation: 'apply',
      status: 'queued', leaseId: null, leaseExpiresAt: null, attempts: 0, nextAttemptAt: null, resultJson: null, lastError: null,
      completedAt: null, createdAt: 1, updatedAt: 1,
    }]);
    const service = new EngineBackstopSyncTaskService();
    const rawFailure = 'External secret reference is unavailable: ENGINE_ADMIN_SECRET; Bearer token-secret; https://sidecar.example.test; native-group-ops';

    const failed = await service.runNext(async () => { throw new Error(rawFailure); }, { runId: 'run-secret-failure' });

    expect(failed?.lastError).toBe('Backstop task failed (ENGINE_BACKSTOP_TASK_FAILED); inspect protected server logs');
    expect(state.rows[0].lastError).not.toContain('ENGINE_ADMIN_SECRET');
    expect(state.rows[0].lastError).not.toContain('Bearer');
    expect(state.rows[0].lastError).not.toContain('sidecar.example.test');
    expect(state.rows[0].lastError).not.toContain('native-group-ops');
  });

  it('makes only a queued retry immediately eligible without stealing a running lease', async () => {
    const state = setup([{
      id: 'task-retry-now', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-retry-now', sourceHash, operation: 'apply',
      status: 'queued', leaseId: null, leaseExpiresAt: null, attempts: 1, nextAttemptAt: Date.now() + 60_000, resultJson: null, lastError: 'failed',
      completedAt: null, createdAt: 1, updatedAt: 1,
    }]);
    const service = new EngineBackstopSyncTaskService();
    await expect(service.retryNow('run-retry-now')).resolves.toBe(true);
    expect(state.rows[0].nextAttemptAt).toBeNull();

    state.rows[0].status = 'running';
    state.rows[0].nextAttemptAt = Date.now() + 60_000;
    await expect(service.retryNow('run-retry-now')).resolves.toBe(false);
    expect(state.rows[0].nextAttemptAt).not.toBeNull();
  });

  it('stops a worker after lease ownership is lost and does not overwrite the new owner state', async () => {
    const state = setup([{
      id: 'task-lost', engineId: 'engine-1', tenantId: 'tenant-a', runId: 'run-lost', sourceHash, operation: 'apply',
      status: 'queued', leaseId: null, leaseExpiresAt: null, attempts: 0, nextAttemptAt: null, resultJson: null, lastError: null,
      completedAt: null, createdAt: 1, updatedAt: 1,
    }]);
    const service = new EngineBackstopSyncTaskService();

    await expect(service.runNext(async (task) => {
      state.controls.loseLeaseOnRenew = true;
      await task.assertLease();
      return { mustNotComplete: true };
    }, { runId: 'run-lost' })).rejects.toThrow('lease was lost');

    expect(state.rows[0]).toMatchObject({ status: 'running', attempts: 0, resultJson: null });
  });
});
