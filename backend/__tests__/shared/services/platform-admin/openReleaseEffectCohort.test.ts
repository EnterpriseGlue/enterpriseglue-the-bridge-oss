import { describe, expect, it, vi } from 'vitest';

import { RELEASE_EFFECT_INVENTORY_VERSION } from '@enterpriseglue/shared/contracts/release-effect-inventory.js';
import { releaseEffectInventorySha256 } from '@enterpriseglue/shared/services/platform-admin/ReleaseEffectSettlementService.js';
import {
  openConfiguredReleaseEffectCohortWith,
  openReleaseEffectCohort,
} from '@enterpriseglue/shared/services/platform-admin/open-release-effect-cohort.js';

const releaseId = 'saas-preview-1';
const cohortEpoch = 41;
const inventorySha256 = releaseEffectInventorySha256();
const status = {
  schemaVersion: 'release-effect-settlement.enterpriseglue.io/v1' as const,
  releaseId,
  cohortEpoch,
  state: 'open' as const,
  revision: 1,
  inventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
  configuredInventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
  inventorySha256,
  configuredInventorySha256: inventorySha256,
  inventoryComplete: false,
  releaseAssignmentsOutstanding: 0,
  coveredSourcesSettled: true,
  settled: false,
  eligibleForShutdown: false,
  openedAt: 1,
  closedAt: null,
  settledAt: null,
  updatedAt: 1,
  sources: [],
};

const command = {
  releaseId,
  cohortEpoch,
  inventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
  inventorySha256,
};

describe('openReleaseEffectCohort', () => {
  it('opens revision zero through the settlement service and accepts an exact idempotent result', async () => {
    const open = vi.fn().mockResolvedValue(status);
    await expect(openReleaseEffectCohort(command, { open })).resolves.toEqual(status);
    expect(open).toHaveBeenCalledWith({ releaseId, cohortEpoch, expectedRevision: 0 });
  });

  it.each([
    { releaseId: '' },
    { cohortEpoch: 0 },
    { cohortEpoch: Number.MAX_SAFE_INTEGER + 1 },
    { inventoryVersion: 'release-effect-inventory.enterpriseglue.io/other' },
    { inventorySha256: 'a'.repeat(64) },
  ])('rejects missing or drifted command identity before opening', async (override) => {
    const open = vi.fn();
    await expect(openReleaseEffectCohort({ ...command, ...override } as typeof command, { open }))
      .rejects.toThrow('does not match');
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    { releaseId: 'other-release' },
    { cohortEpoch: cohortEpoch + 1 },
    { state: 'closing' },
    { revision: 2 },
    { inventorySha256: 'b'.repeat(64) },
    { configuredInventorySha256: 'b'.repeat(64) },
    { closedAt: 2 },
    { eligibleForShutdown: true },
  ])('fails closed when the stored/opened cohort differs from the command', async (override) => {
    const open = vi.fn().mockResolvedValue({ ...status, ...override });
    await expect(openReleaseEffectCohort(command, { open })).rejects.toThrow('not the exact open');
  });

  it('runs the configured CLI contract, emits only bounded identity, and closes its data source', async () => {
    const open = vi.fn().mockResolvedValue(status);
    const close = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn();
    await expect(openConfiguredReleaseEffectCohortWith({
      runtime: { releaseId, cohortEpoch, managedPooledCloud: true },
      inventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
      inventorySha256,
      service: { open }, close, write,
    })).resolves.toEqual(status);
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({
      schemaVersion: status.schemaVersion,
      releaseId,
      cohortEpoch,
      state: 'open',
      revision: 1,
      inventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
      inventorySha256,
    });
  });

  it('closes the data source after a failed cohort response', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    await expect(openConfiguredReleaseEffectCohortWith({
      runtime: { releaseId, cohortEpoch, managedPooledCloud: true },
      inventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
      inventorySha256,
      service: { open: vi.fn().mockResolvedValue({ ...status, state: 'closing' }) },
      close, write: vi.fn(),
    })).rejects.toThrow('not the exact open');
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects a runtime that is not explicitly managed pooled Cloud before opening', async () => {
    const open = vi.fn();
    const close = vi.fn();
    await expect(openConfiguredReleaseEffectCohortWith({
      runtime: { releaseId, cohortEpoch, managedPooledCloud: false },
      inventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
      inventorySha256,
      service: { open }, close, write: vi.fn(),
    })).rejects.toThrow('runtime identity is not configured');
    expect(open).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
