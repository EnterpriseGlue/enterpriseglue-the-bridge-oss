import { IsNull, LessThanOrEqual, MoreThan } from 'typeorm';
import { getDataSource } from '../../db/data-source.js';
import { EngineBackstopSyncTask } from '../../infrastructure/persistence/entities/EngineBackstopSyncTask.js';
import { Engine } from '../../infrastructure/persistence/entities/Engine.js';
import {
  EngineBackstopSyncTaskResultSchema,
  type EngineBackstopSyncTaskResult,
} from '../../schemas/platform-admin/engine-backstop.js';
import { generateId } from '../../utils/id.js';
import { Errors } from '../../middleware/errorHandler.js';

export type { EngineBackstopSyncTaskResult } from '../../schemas/platform-admin/engine-backstop.js';

const DEFAULT_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export class EngineBackstopTaskLeaseLostError extends Error {
  constructor(message = 'Engine backstop task lease was lost') {
    super(message);
    this.name = 'EngineBackstopTaskLeaseLostError';
  }
}

export class EngineBackstopScopeBusyError extends Error {
  constructor(message = 'Another backstop operation is already queued or running for this engine') {
    super(message);
    this.name = 'EngineBackstopScopeBusyError';
  }
}

export interface EnqueueEngineBackstopSyncTaskInput {
  engineId: string;
  tenantId?: string | null;
  runId: string;
  sourceHash: string;
  operation: EngineBackstopSyncTask['operation'];
}

function retryDelay(attempts: number): number {
  return Math.min(60_000 * (2 ** Math.min(Math.max(attempts - 1, 0), 4)), MAX_RETRY_DELAY_MS);
}

function resultFor(task: EngineBackstopSyncTask): EngineBackstopSyncTaskResult {
  return EngineBackstopSyncTaskResultSchema.parse({
    taskId: task.id,
    runId: task.runId,
    operation: task.operation,
    status: task.status,
    attempts: Number(task.attempts || 0),
    nextAttemptAt: task.nextAttemptAt == null ? null : Number(task.nextAttemptAt),
    lastError: task.lastError || null,
  });
}

function sanitizedTaskFailure(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string'
    && /^[A-Z][A-Z0-9_]{2,80}$/.test((error as { code: string }).code)
    ? (error as { code: string }).code
    : error instanceof EngineBackstopTaskLeaseLostError
      ? 'ENGINE_BACKSTOP_LEASE_LOST'
      : 'ENGINE_BACKSTOP_TASK_FAILED';
  return `Backstop task failed (${code}); inspect protected server logs`;
}

/** Durable lease/retry envelope. The executor owns all native side effects. */
export class EngineBackstopSyncTaskService {
  async enqueue(input: EnqueueEngineBackstopSyncTaskInput): Promise<EngineBackstopSyncTask> {
    const engineId = input.engineId.trim();
    const runId = input.runId.trim();
    const sourceHash = input.sourceHash.trim().toLowerCase();
    if (!engineId || !runId || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error('A valid engine, run, and source hash are required');
    const dataSource = await getDataSource();
    const tenantId = input.tenantId?.trim() || null;
    return dataSource.transaction(async (manager) => {
      // A same-value update is a portable row lock inside this transaction.
      // It serializes distinct preview runs before their native side effects.
      const engineClaim = await manager.getRepository(Engine).update(
        { id: engineId, lifecycleStatus: 'active' },
        { id: engineId },
      );
      if (engineClaim.affected !== 1) {
        throw Errors.withCode('ENGINE_BACKSTOP_ENGINE_INACTIVE', 'Backstop operations require an active engine', 409, 'backstop');
      }
      const repository = manager.getRepository(EngineBackstopSyncTask);
      const existing = await repository.findOne({ where: { runId } });
      if (existing) return existing;
      const activeScopeTask = await repository.findOne({
        where: [
          { engineId, status: 'queued' },
          { engineId, status: 'running' },
        ],
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      if (activeScopeTask) throw new EngineBackstopScopeBusyError();
      const now = Date.now();
      const task = {
        id: generateId(), engineId, tenantId, runId, sourceHash, operation: input.operation,
        status: 'queued' as const, leaseId: null, leaseExpiresAt: null, attempts: 0, nextAttemptAt: null,
        resultJson: null, lastError: null, completedAt: null, createdAt: now, updatedAt: now,
      };
      try {
        await repository.insert(task);
      } catch (error) {
        const concurrent = await repository.findOne({ where: { runId } });
        if (concurrent) return concurrent;
        throw error;
      }
      return task as EngineBackstopSyncTask;
    });
  }

  async retryNow(runId: string): Promise<boolean> {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) throw new Error('Backstop run id is required');
    const now = Date.now();
    const result = await (await getDataSource()).getRepository(EngineBackstopSyncTask).update(
      { runId: normalizedRunId, status: 'queued' },
      { nextAttemptAt: null, updatedAt: now },
    );
    return result.affected === 1;
  }

  async runNext(
    execute: (task: Pick<EngineBackstopSyncTask, 'id' | 'engineId' | 'tenantId' | 'runId' | 'sourceHash' | 'operation'> & { leaseId: string; assertLease: () => Promise<void> }) => Promise<Record<string, unknown> | void>,
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
      let renewalInFlight: Promise<boolean> | null = null;
      const renew = async (): Promise<boolean> => {
        if (!renewalInFlight) {
          const renewedAt = Date.now();
          renewalInFlight = repository.update({
            id: candidate.id,
            status: 'running',
            leaseId,
            leaseExpiresAt: MoreThan(renewedAt),
          }, {
            leaseExpiresAt: renewedAt + leaseMs,
            updatedAt: renewedAt,
          }).then((result) => result.affected === 1).catch(() => false).finally(() => { renewalInFlight = null; });
        }
        return renewalInFlight;
      };
      const assertLease = async (): Promise<void> => {
        if (!await renew()) throw new EngineBackstopTaskLeaseLostError();
      };
      const heartbeat = setInterval(() => { void renew(); }, Math.floor(leaseMs / 3));
      try {
        const result = await execute({ ...candidate, leaseId, assertLease });
        await assertLease();
        const completedAt = Date.now();
        const values = {
          status: 'completed' as const, leaseId: null, leaseExpiresAt: null, nextAttemptAt: null,
          resultJson: JSON.stringify(result || {}), lastError: null, completedAt, updatedAt: completedAt,
        };
        const completion = await repository.update({ id: candidate.id, status: 'running', leaseId, leaseExpiresAt: MoreThan(completedAt) }, values);
        if (completion.affected !== 1) throw new EngineBackstopTaskLeaseLostError('Engine backstop task lease was lost before completion');
        return resultFor({ ...candidate, ...values } as EngineBackstopSyncTask);
      } catch (error) {
        const attempts = Number(candidate.attempts || 0) + 1;
        const failedAt = Date.now();
        const values = {
          status: 'queued' as const, leaseId: null, leaseExpiresAt: null, attempts,
          nextAttemptAt: failedAt + retryDelay(attempts),
          lastError: sanitizedTaskFailure(error),
          updatedAt: failedAt,
        };
        const failure = await repository.update({ id: candidate.id, status: 'running', leaseId, leaseExpiresAt: MoreThan(failedAt) }, values);
        if (failure.affected !== 1) throw error;
        return resultFor({ ...candidate, ...values } as EngineBackstopSyncTask);
      } finally {
        clearInterval(heartbeat);
      }
    }
    return null;
  }
}

export const engineBackstopSyncTaskService = new EngineBackstopSyncTaskService();
