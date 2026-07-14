import { configBundleRuntimeReconciliationTaskService } from '@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export interface ConfigBundleRuntimeReconciliationPollerOptions {
  intervalMs?: number;
  runOnStart?: boolean;
  maxTasks?: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionsFromEnv(): Required<ConfigBundleRuntimeReconciliationPollerOptions> {
  return {
    intervalMs: positiveInteger(process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_INTERVAL_MS, 0),
    runOnStart: process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_RUN_ON_START === 'true',
    maxTasks: positiveInteger(process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_MAX_TASKS, 10),
  };
}

/** Processes bounded, durable post-apply Engine Set and runtime-resource materialization. */
export async function runScheduledConfigBundleRuntimeReconciliationOnce(
  options: Pick<ConfigBundleRuntimeReconciliationPollerOptions, 'maxTasks'> = {},
) {
  return configBundleRuntimeReconciliationTaskService.runAvailable({ maxTasks: options.maxTasks });
}

export async function startConfigBundleRuntimeReconciliationPollerIfEnabled(options: ConfigBundleRuntimeReconciliationPollerOptions = {}) {
  const env = readOptionsFromEnv();
  const intervalMs = options.intervalMs ?? env.intervalMs;
  if (timer) return timer;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const runOnStart = options.runOnStart ?? env.runOnStart;
  const maxTasks = options.maxTasks ?? env.maxTasks;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledConfigBundleRuntimeReconciliationOnce({ maxTasks });
    } catch (error) {
      logger.warn('Scheduled configuration runtime reconciliation failed', { error });
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => { void tick(); }, intervalMs);
  if (runOnStart) void tick();
  return timer;
}

export function stopConfigBundleRuntimeReconciliationPoller() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
