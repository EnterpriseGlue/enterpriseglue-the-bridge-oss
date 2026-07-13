import { configBundleIdentityReplayTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export interface ConfigBundleIdentityReplayPollerOptions {
  intervalMs?: number;
  runOnStart?: boolean;
  maxTasks?: number;
  pageLimit?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionsFromEnv(): Required<ConfigBundleIdentityReplayPollerOptions> {
  return {
    intervalMs: positiveInteger(process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_INTERVAL_MS, 0),
    runOnStart: process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_RUN_ON_START === 'true',
    maxTasks: positiveInteger(process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_MAX_TASKS, 10),
    pageLimit: positiveInteger(process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_PAGE_LIMIT, 500),
  };
}

/** Processes a bounded number of durable continuation pages for config applies. */
export async function runScheduledConfigBundleIdentityReplayOnce(
  options: Pick<ConfigBundleIdentityReplayPollerOptions, 'maxTasks' | 'pageLimit'> = {},
) {
  return configBundleIdentityReplayTaskService.runAvailablePages({
    maxTasks: options.maxTasks,
    pageLimit: options.pageLimit,
  });
}

export async function startConfigBundleIdentityReplayPollerIfEnabled(options: ConfigBundleIdentityReplayPollerOptions = {}) {
  const env = readOptionsFromEnv();
  const intervalMs = options.intervalMs ?? env.intervalMs;
  if (timer) return timer;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const runOnStart = options.runOnStart ?? env.runOnStart;
  const maxTasks = options.maxTasks ?? env.maxTasks;
  const pageLimit = options.pageLimit ?? env.pageLimit;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledConfigBundleIdentityReplayOnce({ maxTasks, pageLimit });
    } catch (error) {
      logger.warn('Scheduled configuration identity replay failed', { error });
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => { void tick(); }, intervalMs);
  if (runOnStart) void tick();
  return timer;
}

export function stopConfigBundleIdentityReplayPoller() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
