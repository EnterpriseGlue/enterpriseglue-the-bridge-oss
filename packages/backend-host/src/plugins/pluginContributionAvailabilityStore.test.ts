import { describe, expect, it } from 'vitest';

import {
  MemoryPluginContributionAvailabilityStoreV1,
  type PluginContributionAvailabilityTargetV1,
} from './pluginContributionAvailabilityStore.js';

const target: PluginContributionAvailabilityTargetV1 = {
  deploymentRef: 'deployment-1',
  tenantRef: 'tenant-1',
  pluginId: 'io.enterpriseglue.reference',
  pluginVersion: '1.0.0',
  installerRevision: 7,
  refreshIntervalSeconds: 300,
  maximumStalenessSeconds: 900,
};

describe('MemoryPluginContributionAvailabilityStoreV1', () => {
  it('leases once, persists a bounded projection, and expires closed', async () => {
    const store = new MemoryPluginContributionAvailabilityStoreV1();
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    await store.reconcileTargets([target], now);

    const [claim] = await store.claimDue({
      workerRef: 'worker-1',
      now,
      leaseMs: 60_000,
      limit: 10,
    });
    expect(claim).toBeDefined();
    await expect(
      store.claimDue({
        workerRef: 'worker-2',
        now,
        leaseMs: 60_000,
        limit: 10,
      }),
    ).resolves.toEqual([]);

    const projection = {
      apiVersion:
        'contribution-availability.plugin.enterpriseglue.io/v1' as const,
      evaluatedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 900_000).toISOString(),
      contributions: [
        {
          contributionId: 'io.enterpriseglue.reference.action',
          available: true,
          reasonCode: 'available' as const,
        },
      ],
    };
    await expect(
      store.completeSuccess(claim!, projection, now + 300_000, now),
    ).resolves.toBe(true);
    await expect(
      store.readCurrent({ ...target, now: now + 899_999 }),
    ).resolves.toEqual(projection);
    await expect(
      store.readCurrent({ ...target, now: now + 900_000 }),
    ).resolves.toBeNull();
  });

  it('invalidates a projection when plugin source revision changes', async () => {
    const store = new MemoryPluginContributionAvailabilityStoreV1();
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    await store.reconcileTargets([target], now);
    const [claim] = await store.claimDue({
      workerRef: 'worker-1',
      now,
      leaseMs: 60_000,
      limit: 1,
    });
    await store.completeSuccess(
      claim!,
      {
        apiVersion:
          'contribution-availability.plugin.enterpriseglue.io/v1',
        evaluatedAt: new Date(now).toISOString(),
        validUntil: new Date(now + 900_000).toISOString(),
        contributions: [],
      },
      now + 300_000,
      now,
    );

    const upgraded = { ...target, installerRevision: 8 };
    await store.reconcileTargets([upgraded], now + 1);
    await expect(
      store.readCurrent({ ...upgraded, now: now + 2 }),
    ).resolves.toBeNull();
    await expect(
      store.claimDue({
        workerRef: 'worker-2',
        now: now + 1,
        leaseMs: 60_000,
        limit: 1,
      }),
    ).resolves.toHaveLength(1);
  });

  it('keeps the last success only until expiry after refresh failure', async () => {
    const store = new MemoryPluginContributionAvailabilityStoreV1();
    const now = Date.parse('2026-07-26T00:00:00.000Z');
    await store.reconcileTargets([target], now);
    const [firstClaim] = await store.claimDue({
      workerRef: 'worker-1',
      now,
      leaseMs: 60_000,
      limit: 1,
    });
    const projection = {
      apiVersion:
        'contribution-availability.plugin.enterpriseglue.io/v1' as const,
      evaluatedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 900_000).toISOString(),
      contributions: [],
    };
    await store.completeSuccess(
      firstClaim!,
      projection,
      now + 300_000,
      now,
    );
    const [refreshClaim] = await store.claimDue({
      workerRef: 'worker-2',
      now: now + 300_000,
      leaseMs: 60_000,
      limit: 1,
    });
    await store.completeFailure(
      refreshClaim!,
      'refresh_failed',
      now + 360_000,
      now + 300_001,
    );

    await expect(
      store.readCurrent({ ...target, now: now + 899_999 }),
    ).resolves.toEqual(projection);
    await expect(
      store.readCurrent({ ...target, now: now + 900_000 }),
    ).resolves.toBeNull();
  });
});
