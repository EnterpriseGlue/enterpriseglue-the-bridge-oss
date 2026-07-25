import { IsNull, LessThanOrEqual } from 'typeorm';
import { getDataSource } from '../../db/data-source.js';
import { EngineBackstopSyncTask } from '../../infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { generateId } from '../../utils/id.js';

const DEFAULT_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface EnqueueEngineBackstopSyncTaskInput {
  engineId: string;
  tenantId?: string | null;
  runId: string;
  sourceHash: string;
  operation: EngineBackstopSyncTask['operation'];
}

export interface EngineBackstopSyncTaskResult {
  taskId: string;
  runId: string;
  operation: EngineBackstopSyncTask['operation'];
  status: EngineBackstopSyncTask['status'];
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
}

function retryDelay(attempts: number): number {
  return Math.min(60_000 * (2 ** Math.min(Math.max(attempts - 1, 0), 4)), MAX_RETRY_DELAY_MS);
}

function resultFor(task: EngineBackstopSyncTask): EngineBackstopSyncTaskResult {
  return {
    taskId: task.id,
    runId: task.runId,
    operation: task.operation,
    status: task.status,
    attempts: Number(task.attempts || 0),
    nextAttemptAt: task.nextAttemptAt == null ? null : Number(task.nextAttemptAt),
    lastError: task.lastError || null,
  };
}

/** Durable lease/retry envelope. The executor owns all native side effects. */
export class EngineBackstopSyncTaskService {
  async enqueue(input: EnqueueEngineBackstopSyncTaskInput): Promise<EngineBackstopSyncTask> {
    const engineId = input.engineId.trim();
    const runId = input.runId.trim();
    const sourceHash = input.sourceHash.trim().toLowerCase();
    if (!engineId || !runId || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('A valid engine, run, and source hash are required');
    const repository = (await getDataSource()).getRepository(EngineBackstopSyncTask);
    const existing = await repository.findOne({ where: { runId } });
    if (existing) return existing;
    const now = Date.now();
    const task = {
      id: generateId(), engineId, tenantId: input.tenantId?.trim() || null, runId, sourceHash, operation: input.operation,
      status: 'queued' as const, leaseId: null, leaseExpiresAt: null, attempts: 0, nextAttemptAt: null,
      resultJson: null, lastError: null, completedAt: null, createdAt: now, updatedAt: now,
    };
    await repository.insert(task);
    return task as EngineBackstopSyncTask;
  }

  async runNext(
    execute: (task: Pick<EngineBackstopSyncTask, 'id' | 'engineId' | 'tenantId' | 'runId' | 'sourceHash' | 'operation'>) => Promise<Record<string, unknown> | void>,
    options: { leaseMs?: number; runId?: string } = {},
  ): Promise<EngineBackstopSyncTaskResult | null> {
    const dataSource = await getDataSource();
    const repository = dataSource.getRepository(EngineBackstopSyncTask);
    const now = Date.now();
    const leaseMs = Math.max(options.leaseMs ?? DEFAULT_LEASE_MS, 1_000);
    const runIdFilter = options.runId?.trim() ? { runId: options.runId.trim() } : {};
    await repository.update({ ...runIdFilter, status: 'running', leaseExpiresAt: LessThanOrEqual(now) }, {
      status: 'queued', leaseId: null, leaseExpiresAt: null, updatedAt: now,
    });
    const candidates = await repository.find({
      where: [
        { ...runIdFilter, status: 'queued', nextAttemptAt: IsNull() },
        { ...runIdFilter, status: 'queued', nextAttemptAt: LessThanOrEqual(now) },
      ],
      order: { createdAt: 'ASC' },
      take: 10,
    });
    for (const candidate of candidates) {
      const leaseId = generateId();
      const claim = await repository.update({ id: candidate.id, status: 'queued' }, {
        status: 'running', leaseId, leaseExpiresAt: now + leaseMs, updatedAt: now,
      });
      if (!claim.affected) continue;
      try {
        const result = await execute(candidate);
        const completedAt = Date.now();
        const values = {
          status: 'completed' as const, leaseId: null, leaseExpiresAt: null, nextAttemptAt: null,
          resultJson: JSON.stringify(result || {}), lastError: null, completedAt, updatedAt: completedAt,
        };
        await repository.update({ id: candidate.id, leaseId }, values);
        return resultFor({ ...candidate, ...values } as EngineBackstopSyncTask);
      } catch (error) {
        const attempts = Number(candidate.attempts || 0) + 1;
        const failedAt = Date.now();
        const values = {
          status: 'queued' as const, leaseId: null, leaseExpiresAt: null, attempts,
          nextAttemptAt: failedAt + retryDelay(attempts),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
          updatedAt: failedAt,
        };
        await repository.update({ id: candidate.id, leaseId }, values);
        return resultFor({ ...candidate, ...values } as EngineBackstopSyncTask);
      }
    }
    return null;
  }
}

export const engineBackstopSyncTaskService = new EngineBackstopSyncTaskService();
