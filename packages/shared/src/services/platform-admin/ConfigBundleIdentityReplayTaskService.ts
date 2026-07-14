import { In, IsNull, LessThanOrEqual } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ConfigBundleIdentityReplayTask } from '@enterpriseglue/shared/infrastructure/persistence/entities/ConfigBundleIdentityReplayTask.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { ssoNormalizedIdentityService } from './SsoNormalizedIdentityService.js';

const ACTIVE_STATUSES: Array<ConfigBundleIdentityReplayTask['status']> = ['queued', 'running'];
const DEFAULT_PAGE_LIMIT = 500;
const MAX_PAGE_LIMIT = 5000;
const DEFAULT_LEASE_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export interface EnqueueConfigBundleIdentityReplayTaskInput {
  tenantId?: string | null;
  applyRunId: string;
  providerId: string;
  cursor: string;
  initial: { scanned: number; created: number; removed: number; failed: number };
}

export interface ConfigBundleIdentityReplayTaskResult {
  taskId: string;
  applyRunId: string;
  providerId: string;
  status: ConfigBundleIdentityReplayTask['status'];
  scanned: number;
  created: number;
  removed: number;
  failed: number;
  truncated: boolean;
  nextCursor: string | null;
}

export interface DrainConfigBundleIdentityReplayResult {
  status: 'completed' | 'pending' | 'failed';
  pagesProcessed: number;
  taskCount: number;
  activeTaskCount: number;
  failedTaskCount: number;
}

function normalizePageLimit(value?: number): number {
  return Math.min(Math.max(value ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
}

function retryDelay(attempts: number): number {
  return Math.min(60_000 * (2 ** Math.min(Math.max(attempts - 1, 0), 4)), MAX_RETRY_DELAY_MS);
}

class ConfigBundleIdentityReplayTaskService {
  async enqueue(input: EnqueueConfigBundleIdentityReplayTaskInput): Promise<void> {
    const providerId = input.providerId.trim();
    if (!providerId || !input.applyRunId || !input.cursor) return;
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ConfigBundleIdentityReplayTask);
    const tenantId = input.tenantId || null;
    const now = Date.now();

    // A later bundle is authoritative for the same provider. Its replay starts
    // from a fresh snapshot page, so older queued work must not race it.
    await repo.update({
      tenantId: tenantId || IsNull(),
      providerId,
      status: In(ACTIVE_STATUSES),
    }, {
      status: 'cancelled',
      leaseId: null,
      leaseExpiresAt: null,
      completedAt: now,
      updatedAt: now,
    });

    const existing = await repo.findOne({ where: { applyRunId: input.applyRunId, providerId } });
    if (existing) {
      await repo.update({ id: existing.id }, {
        status: 'queued',
        cursor: input.cursor,
        leaseId: null,
        leaseExpiresAt: null,
        attempts: 0,
        nextAttemptAt: null,
        scanned: input.initial.scanned,
        created: input.initial.created,
        removed: input.initial.removed,
        failed: input.initial.failed,
        lastError: null,
        completedAt: null,
        updatedAt: now,
      });
      return;
    }

    await repo.insert({
      id: generateId(), tenantId, applyRunId: input.applyRunId, providerId,
      status: 'queued', cursor: input.cursor, leaseId: null, leaseExpiresAt: null,
      attempts: 0, nextAttemptAt: null,
      scanned: input.initial.scanned, created: input.initial.created, removed: input.initial.removed, failed: input.initial.failed,
      lastError: null, completedAt: null, createdAt: now, updatedAt: now,
    });
  }

  async listForApplyRun(applyRunId: string, tenantId?: string | null): Promise<ConfigBundleIdentityReplayTask[]> {
    const repo = (await getDataSource()).getRepository(ConfigBundleIdentityReplayTask);
    return repo.find({
      where: tenantId ? { applyRunId, tenantId } : { applyRunId, tenantId: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  async runNextPage(options: { pageLimit?: number; leaseMs?: number; applyRunId?: string } = {}): Promise<ConfigBundleIdentityReplayTaskResult | null> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(ConfigBundleIdentityReplayTask);
    const now = Date.now();
    const pageLimit = normalizePageLimit(options.pageLimit);
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
        const replay = await ssoNormalizedIdentityService.replayMemberships({
          tenantId: candidate.tenantId,
          providerIds: [candidate.providerId],
          cursor: candidate.cursor,
          limit: pageLimit,
        });
        const completed = !replay.truncated;
        await repo.update({ id: candidate.id, leaseId }, {
          status: completed ? 'completed' : 'queued',
          cursor: replay.nextCursor,
          leaseId: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          scanned: candidate.scanned + replay.scanned,
          created: candidate.created + replay.created,
          removed: candidate.removed + replay.removed,
          failed: candidate.failed + replay.failed,
          lastError: null,
          completedAt: completed ? Date.now() : null,
          updatedAt: Date.now(),
        });
        return {
          taskId: candidate.id, applyRunId: candidate.applyRunId, providerId: candidate.providerId,
          status: completed ? 'completed' : 'queued', scanned: candidate.scanned + replay.scanned,
          created: candidate.created + replay.created, removed: candidate.removed + replay.removed,
          failed: candidate.failed + replay.failed, truncated: replay.truncated, nextCursor: replay.nextCursor,
        };
      } catch (error) {
        const attempts = candidate.attempts + 1;
        const retryAt = Date.now() + retryDelay(attempts);
        await repo.update({ id: candidate.id, leaseId }, {
          status: 'queued', leaseId: null, leaseExpiresAt: null, attempts,
          nextAttemptAt: retryAt, lastError: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), updatedAt: Date.now(),
        });
        return {
          taskId: candidate.id, applyRunId: candidate.applyRunId, providerId: candidate.providerId,
          status: 'queued', scanned: candidate.scanned, created: candidate.created, removed: candidate.removed,
          failed: candidate.failed + 1, truncated: true, nextCursor: candidate.cursor,
        };
      }
    }
    return null;
  }

  async runAvailablePages(options: { maxTasks?: number; pageLimit?: number } = {}): Promise<ConfigBundleIdentityReplayTaskResult[]> {
    const maxTasks = Math.min(Math.max(options.maxTasks ?? 10, 1), 100);
    const results: ConfigBundleIdentityReplayTaskResult[] = [];
    for (let index = 0; index < maxTasks; index += 1) {
      const result = await this.runNextPage({ pageLimit: options.pageLimit });
      if (!result) break;
      results.push(result);
    }
    return results;
  }

  async drainApplyRun(options: { applyRunId: string; maxPages?: number; pageLimit?: number }): Promise<DrainConfigBundleIdentityReplayResult> {
    const applyRunId = options.applyRunId.trim();
    if (!applyRunId) return { status: 'failed', pagesProcessed: 0, taskCount: 0, activeTaskCount: 0, failedTaskCount: 1 };
    const maxPages = Math.min(Math.max(options.maxPages ?? 100, 1), 1000);
    let pagesProcessed = 0;
    for (; pagesProcessed < maxPages; pagesProcessed += 1) {
      const result = await this.runNextPage({ applyRunId, pageLimit: options.pageLimit });
      if (!result) break;
    }
    const tasks = await (await getDataSource()).getRepository(ConfigBundleIdentityReplayTask).find({
      where: { applyRunId },
      order: { createdAt: 'ASC' },
    });
    const activeTaskCount = tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length;
    const failedTaskCount = tasks.filter((task) => task.status === 'cancelled' || task.failed > 0).length;
    return {
      status: tasks.length === 0 || failedTaskCount > 0 ? 'failed' : activeTaskCount > 0 ? 'pending' : 'completed',
      pagesProcessed,
      taskCount: tasks.length,
      activeTaskCount,
      failedTaskCount,
    };
  }
}

export const configBundleIdentityReplayTaskService = new ConfigBundleIdentityReplayTaskService();
