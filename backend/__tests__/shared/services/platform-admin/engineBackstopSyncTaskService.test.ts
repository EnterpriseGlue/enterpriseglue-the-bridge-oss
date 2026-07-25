import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { EngineBackstopSyncTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { EngineBackstopSyncTaskService } from '@enterpriseglue/shared/services/platform-admin/EngineBackstopSyncTaskService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

const sourceHash = 'a'.repeat(64);

function setup(rows: any[] = []) {
  const repository = {
    findOne: vi.fn(async ({ where }: any) => rows.find((row) => row.runId === where.runId) || null),
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
      const matched = rows.filter((row) => {
        if (criteria.id && row.id !== criteria.id) return false;
        if (criteria.runId && row.runId !== criteria.runId) return false;
        if (criteria.status && row.status !== criteria.status) return false;
        if (criteria.leaseId && row.leaseId !== criteria.leaseId) return false;
        if (criteria.leaseExpiresAt && (row.leaseExpiresAt === null || row.leaseExpiresAt > Date.now())) return false;
        return true;
      });
      matched.forEach((row) => Object.assign(row, values));
      return { affected: matched.length };
    }),
  };
  vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
    if (entity === EngineBackstopSyncTask) return repository;
    throw new Error('Unexpected repository');
  } } as any);
  return { rows, repository };
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
    expect(failed).toMatchObject({ status: 'queued', attempts: 1, lastError: 'sidecar rejected request' });
    expect(state.rows[0].nextAttemptAt).toBeGreaterThan(Date.now());
    expect(await service.runNext(async () => ({ shouldNotRun: true }), { runId: 'run-retry' })).toBeNull();
  });
});
