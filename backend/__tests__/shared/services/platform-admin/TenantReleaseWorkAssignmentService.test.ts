import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';

import { config } from '@enterpriseglue/shared/config/index.js';
import {
  PluginEventDelivery,
  PluginScheduledJob,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { TenantReleaseWorkAssignmentService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseWorkAssignmentService.js';

const originalRelease = config.tenantPlacementReleaseId;

describe('TenantReleaseWorkAssignmentService', () => {
  beforeEach(() => { config.tenantPlacementReleaseId = 'release-preview'; });
  afterEach(() => { config.tenantPlacementReleaseId = originalRelease; });

  it('atomically rebinds queued events and schedules to a monotonic assignment epoch', async () => {
    const assignment = { findOne: vi.fn(async () => null), insert: vi.fn(async () => ({})), update: vi.fn() };
    const events = { count: vi.fn(async () => 0), update: vi.fn(async () => ({ affected: 3 })) };
    const schedules = { count: vi.fn(async () => 0), update: vi.fn(async () => ({ affected: 2 })) };
    const service = new TenantReleaseWorkAssignmentService(async () => dataSource({ assignment, events, schedules }));

    await expect(service.assign({ tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4 })).resolves.toMatchObject({
      tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4,
      updatedEvents: 3, updatedSchedules: 2, idempotent: false,
    });
    expect(assignment.insert).toHaveBeenCalledOnce();
  });

  it('is idempotent at the same epoch and rejects stale or in-flight transitions', async () => {
    const current = { id: 'assignment-1', tenantRef: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4, updatedAt: 1 };
    const assignment = { findOne: vi.fn(async () => current), insert: vi.fn(), update: vi.fn() };
    const events = { count: vi.fn(async () => 0), update: vi.fn() };
    const schedules = { count: vi.fn(async () => 0), update: vi.fn() };
    const service = new TenantReleaseWorkAssignmentService(async () => dataSource({ assignment, events, schedules }));
    await expect(service.assign({ tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4 })).resolves.toMatchObject({ idempotent: true });
    await expect(service.assign({ tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 3 })).rejects.toMatchObject({ statusCode: 409 });

    assignment.findOne.mockResolvedValueOnce({ ...current, assignmentEpoch: 3 });
    events.count.mockResolvedValueOnce(1);
    await expect(service.assign({ tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4 })).rejects.toMatchObject({ statusCode: 409 });
    expect(assignment.update).not.toHaveBeenCalled();
  });
});

function dataSource(repositories: { assignment: object; events: object; schedules: object }): DataSource {
  const manager = {
    getRepository(entity: unknown) {
      if (entity === TenantReleaseWorkAssignment) return repositories.assignment;
      if (entity === PluginEventDelivery) return repositories.events;
      if (entity === PluginScheduledJob) return repositories.schedules;
      throw new Error('unexpected repository');
    },
  } as EntityManager;
  return {
    options: { type: 'postgres' },
    transaction: vi.fn(async (operation: (value: EntityManager) => Promise<unknown>) => operation(manager)),
  } as unknown as DataSource;
}
