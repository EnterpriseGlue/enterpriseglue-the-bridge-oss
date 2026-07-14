import { IsNull, LessThanOrEqual } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ConfigBundleApplyRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { ConfigBundleRuntimeReconciliationTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleRuntimeReconciliationTask.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { engineSetService } from './EngineSetService.js';
import { runtimeResourceInventoryService } from './RuntimeResourceInventoryService.js';

const ACTIVE_STATUSES: Array<ConfigBundleRuntimeReconciliationTask['status']> = ['queued', 'running'];
const DEFAULT_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface EnqueueConfigBundleRuntimeReconciliationTaskInput {
  tenantId?: string | null;
  applyRunId: string;
  engineSetIds: string[];
  runtimeResourceSetIds: string[];
  engineIds: string[];
}

export interface ConfigBundleRuntimeReconciliationTaskResult {
  taskId: string;
  applyRunId: string;
  status: ConfigBundleRuntimeReconciliationTask['status'];
  engineSetCount: number;
  runtimeResourceSetCount: number;
  engineCount: number;
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
}

export interface DrainConfigBundleRuntimeReconciliationResult {
  status: 'completed' | 'pending' | 'failed';
  taskCount: number;
  activeTaskCount: number;
  failedTaskCount: number;
}

function ids(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function parseIds(value: string): string[] {
  try {
    return Array.isArray(JSON.parse(value)) ? ids(JSON.parse(value)) : [];
  } catch { return []; }
}

function retryDelay(attempts: number): number {
  return Math.min(60_000 * (2 ** Math.min(Math.max(attempts - 1, 0), 4)), MAX_RETRY_DELAY_MS);
}

function resultFor(task: ConfigBundleRuntimeReconciliationTask): ConfigBundleRuntimeReconciliationTaskResult {
  return {
    taskId: task.id,
    applyRunId: task.applyRunId,
    status: task.status,
    engineSetCount: parseIds(task.engineSetIdsJson).length,
    runtimeResourceSetCount: parseIds(task.runtimeResourceSetIdsJson).length,
    engineCount: parseIds(task.engineIdsJson).length,
    attempts: task.attempts,
    nextAttemptAt: task.nextAttemptAt,
    lastError: task.lastError,
  };
}

async function updateApplyRunReceipt(
  task: ConfigBundleRuntimeReconciliationTask,
  runtimeStatus: 'queued' | 'completed' | 'failed',
): Promise<void> {
  const dataSource = await getDataSource();
  const repo = dataSource.getRepository(ConfigBundleApplyRun);
  const run = await repo.findOne({ where: { id: task.applyRunId } });
  if (!run) return;
  let result: Record<string, unknown> = {};
  try { result = run.resultJson ? JSON.parse(run.resultJson) as Record<string, unknown> : {}; } catch { /* preserve receipt availability */ }
  const reconciliation = result.reconciliation && typeof result.reconciliation === 'object'
    ? result.reconciliation as Record<string, unknown>
    : {};
  await repo.update({ id: run.id }, {
    resultJson: JSON.stringify({
      ...result,
      reconciliation: {
        ...reconciliation,
        runtimeReconciliation: {
          status: runtimeStatus,
          taskId: task.id,
          engineSetCount: parseIds(task.engineSetIdsJson).length,
          runtimeResourceSetCount: parseIds(task.runtimeResourceSetIdsJson).length,
          engineCount: parseIds(task.engineIdsJson).length,
        },
      },
    }),
    updatedAt: Date.now(),
  });
}

class ConfigBundleRuntimeReconciliationTaskService {
  async enqueue(input: EnqueueConfigBundleRuntimeReconciliationTaskInput): Promise<ConfigBundleRuntimeReconciliationTask | null> {
    const applyRunId = input.applyRunId.trim();
    const engineSetIds = ids(input.engineSetIds);
    const runtimeResourceSetIds = ids(input.runtimeResourceSetIds);
    const engineIds = ids(input.engineIds);
    if (!applyRunId || (!engineSetIds.length && !runtimeResourceSetIds.length && !engineIds.length)) return null;
    const repo = (await getDataSource()).getRepository(ConfigBundleRuntimeReconciliationTask);
    const now = Date.now();
    const existing = await repo.findOne({ where: { applyRunId } });
    const values = {
      tenantId: input.tenantId || null,
      engineSetIdsJson: JSON.stringify(engineSetIds),
      runtimeResourceSetIdsJson: JSON.stringify(runtimeResourceSetIds),
      engineIdsJson: JSON.stringify(engineIds),
      status: 'queued' as const,
      leaseId: null,
      leaseExpiresAt: null,
      attempts: 0,
      nextAttemptAt: null,
      resultJson: null,
      lastError: null,
      completedAt: null,
      updatedAt: now,
    };
    if (existing) {
      await repo.update({ id: existing.id }, values);
      return { ...existing, ...values } as ConfigBundleRuntimeReconciliationTask;
    }
    const task = { id: generateId(), applyRunId, ...values, createdAt: now };
    await repo.insert(task);
    return task as ConfigBundleRuntimeReconciliationTask;
  }

  async listForApplyRun(applyRunId: string, tenantId?: string | null): Promise<ConfigBundleRuntimeReconciliationTask[]> {
    const repo = (await getDataSource()).getRepository(ConfigBundleRuntimeReconciliationTask);
    return repo.find({
      where: tenantId ? { applyRunId, tenantId } : { applyRunId, tenantId: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  async runNext(options: { leaseMs?: number; applyRunId?: string } = {}): Promise<ConfigBundleRuntimeReconciliationTaskResult | null> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ConfigBundleRuntimeReconciliationTask);
    const now = Date.now();
    const leaseMs = Math.max(options.leaseMs ?? DEFAULT_LEASE_MS, 1_000);
    const applyRunFilter = options.applyRunId ? { applyRunId: options.applyRunId } : {};
    await repo.update({ ...applyRunFilter, status: 'running', leaseExpiresAt: LessThanOrEqual(now) }, {
      status: 'queued', leaseId: null, leaseExpiresAt: null, updatedAt: now,
    });
    const candidates = await repo.find({
      where: [
        { ...applyRunFilter, status: 'queued', nextAttemptAt: IsNull() },
        { ...applyRunFilter, status: 'queued', nextAttemptAt: LessThanOrEqual(now) },
      ],
      order: { createdAt: 'ASC' },
      take: 10,
    });
    for (const candidate of candidates) {
      const leaseId = generateId();
      const claim = await repo.update({ id: candidate.id, status: 'queued' }, {
        status: 'running', leaseId, leaseExpiresAt: now + leaseMs, updatedAt: now,
      });
      if (!claim.affected) continue;
      try {
        const engineSetIds = parseIds(candidate.engineSetIdsJson);
        const runtimeResourceSetIds = parseIds(candidate.runtimeResourceSetIdsJson);
        const engineIds = parseIds(candidate.engineIdsJson);
        for (const id of engineSetIds) await engineSetService.materializeEngineSet(id, candidate.tenantId);
        for (const id of runtimeResourceSetIds) await runtimeResourceInventoryService.materialize(id, candidate.tenantId);
        for (const id of engineIds) {
          await engineSetService.materializeEngineSetsForEngine(id, candidate.tenantId);
          await runtimeResourceInventoryService.materializeForEngine(id, candidate.tenantId);
        }
        const completedAt = Date.now();
        const completed = {
          ...candidate,
          status: 'completed' as const,
          leaseId: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          resultJson: JSON.stringify({ engineSetCount: engineSetIds.length, runtimeResourceSetCount: runtimeResourceSetIds.length, engineCount: engineIds.length }),
          lastError: null,
          completedAt,
          updatedAt: completedAt,
        };
        await repo.update({ id: candidate.id, leaseId }, completed);
        await updateApplyRunReceipt(completed as ConfigBundleRuntimeReconciliationTask, 'completed');
        return resultFor(completed as ConfigBundleRuntimeReconciliationTask);
      } catch (error) {
        const attempts = candidate.attempts + 1;
        const failed = {
          ...candidate,
          status: 'queued' as const,
          leaseId: null,
          leaseExpiresAt: null,
          attempts,
          nextAttemptAt: Date.now() + retryDelay(attempts),
          lastError: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
          updatedAt: Date.now(),
        };
        await repo.update({ id: candidate.id, leaseId }, failed);
        await updateApplyRunReceipt(failed as ConfigBundleRuntimeReconciliationTask, 'failed');
        return resultFor(failed as ConfigBundleRuntimeReconciliationTask);
      }
    }
    return null;
  }

  async runAvailable(options: { maxTasks?: number } = {}): Promise<ConfigBundleRuntimeReconciliationTaskResult[]> {
    const maxTasks = Math.min(Math.max(options.maxTasks ?? 10, 1), 100);
    const results: ConfigBundleRuntimeReconciliationTaskResult[] = [];
    for (let index = 0; index < maxTasks; index += 1) {
      const result = await this.runNext();
      if (!result) break;
      results.push(result);
    }
    return results;
  }

  async drainApplyRun(options: { applyRunId: string; maxTasks?: number }): Promise<DrainConfigBundleRuntimeReconciliationResult> {
    const applyRunId = options.applyRunId.trim();
    if (!applyRunId) return { status: 'failed', taskCount: 0, activeTaskCount: 0, failedTaskCount: 1 };
    const maxTasks = Math.min(Math.max(options.maxTasks ?? 100, 1), 1000);
    for (let index = 0; index < maxTasks; index += 1) {
      const result = await this.runNext({ applyRunId });
      if (!result) break;
      if (result.status !== 'completed') break;
    }
    const tasks = await (await getDataSource()).getRepository(ConfigBundleRuntimeReconciliationTask).find({ where: { applyRunId }, order: { createdAt: 'ASC' } });
    const activeTaskCount = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length;
    const failedTaskCount = tasks.filter((task) => task.attempts > 0 || task.lastError).length;
    return {
      status: tasks.length === 0 || failedTaskCount > 0 ? 'failed' : activeTaskCount > 0 ? 'pending' : 'completed',
      taskCount: tasks.length,
      activeTaskCount,
      failedTaskCount,
    };
  }
}

export const configBundleRuntimeReconciliationTaskService = new ConfigBundleRuntimeReconciliationTaskService();
