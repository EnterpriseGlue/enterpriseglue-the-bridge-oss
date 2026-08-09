import { camundaNativeGrantImportRunService } from '@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantImportRunService.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

export const DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export interface CamundaNativeGrantSnapshotRetentionPollerOptions {
  intervalMs?: number;
  runOnStart?: boolean;
}

function configuredInterval(): number {
  const parsed = Number(process.env.CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS;
}

/** Removes only expired ciphertext; opaque receipts and audit history remain. */
export async function runCamundaNativeGrantSnapshotRetentionOnce(now = Date.now()): Promise<number> {
  return camundaNativeGrantImportRunService.purgeExpiredDetailedSnapshots(now);
}

/**
 * Retention is deliberately enabled by default. Operators may adjust cadence,
 * but cannot accidentally turn deletion off through an empty or invalid value.
 */
export async function startCamundaNativeGrantSnapshotRetentionPoller(
  options: CamundaNativeGrantSnapshotRetentionPollerOptions = {},
) {
  if (timer) return timer;
  const requestedInterval = options.intervalMs ?? configuredInterval();
  const intervalMs = Number.isInteger(requestedInterval) && requestedInterval > 0
    ? requestedInterval
    : DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS;
  const runOnStart = options.runOnStart ?? true;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runCamundaNativeGrantSnapshotRetentionOnce();
    } catch (error) {
      logger.warn('Scheduled Camunda native-grant snapshot retention purge failed', { error });
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => { void tick(); }, intervalMs);
  if (runOnStart) void tick();
  return timer;
}

export function stopCamundaNativeGrantSnapshotRetentionPoller() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
