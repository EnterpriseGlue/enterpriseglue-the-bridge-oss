import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runScheduledConfigBundleRuntimeReconciliationOnce,
  startConfigBundleRuntimeReconciliationPollerIfEnabled,
  stopConfigBundleRuntimeReconciliationPoller,
} from '../../../packages/backend-host/src/poller/configBundleRuntimeReconciliationPoller.js';

const runAvailable = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleRuntimeReconciliationTaskService.js', () => ({
  configBundleRuntimeReconciliationTaskService: { runAvailable },
}));

describe('configBundleRuntimeReconciliationPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_INTERVAL_MS;
    delete process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_RUN_ON_START;
    delete process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_MAX_TASKS;
    stopConfigBundleRuntimeReconciliationPoller();
  });

  afterEach(() => {
    stopConfigBundleRuntimeReconciliationPoller();
    vi.useRealTimers();
  });

  it('does not start until explicitly configured', async () => {
    await expect(startConfigBundleRuntimeReconciliationPollerIfEnabled()).resolves.toBeNull();
    expect(runAvailable).not.toHaveBeenCalled();
  });

  it('runs bounded durable runtime reconciliation without overlapping ticks', async () => {
    process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_INTERVAL_MS = '1000';
    process.env.CONFIG_BUNDLE_RUNTIME_RECONCILIATION_MAX_TASKS = '3';
    let release!: () => void;

    await runScheduledConfigBundleRuntimeReconciliationOnce({ maxTasks: 4 });
    expect(runAvailable).toHaveBeenCalledWith({ maxTasks: 4 });
    runAvailable.mockClear();
    runAvailable.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));
    await expect(startConfigBundleRuntimeReconciliationPollerIfEnabled()).resolves.not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(runAvailable).toHaveBeenCalledTimes(1);
    expect(runAvailable).toHaveBeenCalledWith({ maxTasks: 3 });
    release();
  });
});
