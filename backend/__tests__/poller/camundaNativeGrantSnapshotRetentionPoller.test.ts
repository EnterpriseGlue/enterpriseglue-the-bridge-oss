import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS,
  runCamundaNativeGrantSnapshotRetentionOnce,
  startCamundaNativeGrantSnapshotRetentionPoller,
  stopCamundaNativeGrantSnapshotRetentionPoller,
} from '../../../packages/backend-host/src/poller/camundaNativeGrantSnapshotRetentionPoller.js';

const purgeExpiredDetailedSnapshots = vi.hoisted(() => vi.fn().mockResolvedValue(0));

vi.mock('@enterpriseglue/shared/services/platform-admin/CamundaNativeGrantImportRunService.js', () => ({
  camundaNativeGrantImportRunService: { purgeExpiredDetailedSnapshots },
}));

describe('camundaNativeGrantSnapshotRetentionPoller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS;
    stopCamundaNativeGrantSnapshotRetentionPoller();
  });

  afterEach(() => {
    stopCamundaNativeGrantSnapshotRetentionPoller();
    vi.useRealTimers();
  });

  it('purges expired ciphertext through the shared retention service', async () => {
    await expect(runCamundaNativeGrantSnapshotRetentionOnce(1234)).resolves.toBe(0);
    expect(purgeExpiredDetailedSnapshots).toHaveBeenCalledWith(1234);
  });

  it('starts by default, runs immediately, and does not overlap slow purge passes', async () => {
    let release!: () => void;
    purgeExpiredDetailedSnapshots.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(1); }));
    await expect(startCamundaNativeGrantSnapshotRetentionPoller({ intervalMs: 1_000 })).resolves.not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(purgeExpiredDetailedSnapshots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(purgeExpiredDetailedSnapshots).toHaveBeenCalledTimes(1);
    release();
  });

  it('uses a safe hourly cadence when configuration is missing or invalid', async () => {
    process.env.CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS = 'not-a-number';
    await startCamundaNativeGrantSnapshotRetentionPoller({ runOnStart: false });
    await vi.advanceTimersByTimeAsync(DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_PURGE_INTERVAL_MS - 1);
    expect(purgeExpiredDetailedSnapshots).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(purgeExpiredDetailedSnapshots).toHaveBeenCalledTimes(1);
  });
});
