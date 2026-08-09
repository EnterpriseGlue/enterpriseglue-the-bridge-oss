import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runScheduledConfigBundleIdentityReplayOnce,
  startConfigBundleIdentityReplayPollerIfEnabled,
  stopConfigBundleIdentityReplayPoller,
} from '../../../packages/backend-host/src/poller/configBundleIdentityReplayPoller.js';

const runAvailablePages = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@enterpriseglue/shared/services/platform-admin/ConfigBundleIdentityReplayTaskService.js', () => ({
  configBundleIdentityReplayTaskService: { runAvailablePages },
}));

describe('configBundleIdentityReplayPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_INTERVAL_MS;
    delete process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_RUN_ON_START;
    delete process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_MAX_TASKS;
    delete process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_PAGE_LIMIT;
    stopConfigBundleIdentityReplayPoller();
  });

  afterEach(() => {
    stopConfigBundleIdentityReplayPoller();
    vi.useRealTimers();
  });

  it('does not start until explicitly configured', async () => {
    await expect(startConfigBundleIdentityReplayPollerIfEnabled()).resolves.toBeNull();
    expect(runAvailablePages).not.toHaveBeenCalled();
  });

  it('runs one bounded durable replay pass', async () => {
    await runScheduledConfigBundleIdentityReplayOnce({ maxTasks: 4, pageLimit: 250 });
    expect(runAvailablePages).toHaveBeenCalledWith({ maxTasks: 4, pageLimit: 250 });
  });

  it('uses configured bounds and does not overlap ticks', async () => {
    process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_INTERVAL_MS = '1000';
    process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_MAX_TASKS = '3';
    process.env.CONFIG_BUNDLE_IDENTITY_REPLAY_PAGE_LIMIT = '125';
    let release!: () => void;
    runAvailablePages.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));

    await expect(startConfigBundleIdentityReplayPollerIfEnabled()).resolves.not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(runAvailablePages).toHaveBeenCalledTimes(1);
    expect(runAvailablePages).toHaveBeenCalledWith({ maxTasks: 3, pageLimit: 125 });
    release();
  });
});
