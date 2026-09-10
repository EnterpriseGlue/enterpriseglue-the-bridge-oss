import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource, type EntityManager } from 'typeorm';

import { config } from '@enterpriseglue/shared/config/index.js';
import {
  PluginEventDelivery,
  PluginScheduledJob,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { TenantReleaseWorkAssignmentService } from '@enterpriseglue/shared/services/platform-admin/TenantReleaseWorkAssignmentService.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';

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
    const events = { count: vi.fn(async () => 0), update: vi.fn(async () => ({ affected: 3 })) };
    const schedules = { count: vi.fn(async () => 0), update: vi.fn(async () => ({ affected: 2 })) };
    const service = new TenantReleaseWorkAssignmentService(async () => dataSource({ assignment, events, schedules }));
    await expect(service.assign({ tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4 })).resolves.toMatchObject({
      idempotent: true, updatedEvents: 3, updatedSchedules: 2,
    });
    expect(events.update).toHaveBeenCalledOnce();
    expect(schedules.update).toHaveBeenCalledOnce();
    await expect(service.assign({ tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 3 })).rejects.toMatchObject({ statusCode: 409 });

    assignment.findOne.mockResolvedValueOnce({ ...current, assignmentEpoch: 3 });
    events.count.mockResolvedValueOnce(1);
    await expect(service.assign({ tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4 })).rejects.toMatchObject({ statusCode: 409 });
    expect(assignment.update).not.toHaveBeenCalled();
  });
});

describe('conditional tenant release assignment', () => {
  const request = { tenantId: 'tenant-alpha', releaseId: 'release-preview', assignmentEpoch: 4, expectedPlacementEpoch: 7 };
  beforeEach(() => { config.tenantPlacementReleaseId = request.releaseId; });
  afterEach(() => { config.tenantPlacementReleaseId = originalRelease; });

  function fixture(type: string = 'postgres', currentEpoch?: number) {
    const tenant = { update: vi.fn(async () => ({ affected: 1 as number | undefined })) };
    const findAssignment = vi.fn(async () => currentEpoch === undefined ? null : { id: 'a', releaseId: request.releaseId, assignmentEpoch: currentEpoch, updatedAt: 1 });
    const assignment = {
      findOne: findAssignment,
      findOneBy: findAssignment,
      insert: vi.fn(), update: vi.fn(),
      createQueryBuilder: vi.fn(),
    };
    const query = { where: vi.fn().mockReturnThis(), setLock: vi.fn().mockReturnThis(), getOne: assignment.findOne };
    assignment.createQueryBuilder.mockReturnValue(query);
    const events = { count: vi.fn(async () => 0), update: vi.fn(async () => ({ affected: 2 })) };
    const schedules = { count: vi.fn(async () => 0), update: vi.fn(async () => ({ affected: 1 })) };
    const service = new TenantReleaseWorkAssignmentService(async () => dataSource({ tenant, assignment, events, schedules }, type));
    return { tenant, assignment, events, schedules, service, query };
  }

  it.each(['postgres', 'mysql', 'mssql', 'oracle', 'spanner', 'sqljs', 'sqlite', 'better-sqlite3'])('uses a tenant-first conditional write on %s (repository contract, not physical evidence)', async (type) => {
    const f = fixture(type);
    await expect(f.service.assign(request)).resolves.toEqual({
      schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v2',
      tenantId: request.tenantId, releaseId: request.releaseId, assignmentEpoch: 4,
      tenantStatus: 'active', placementEpoch: 7, updatedEvents: 2, updatedSchedules: 1, idempotent: false,
    });
    expect(f.tenant.update).toHaveBeenCalledExactlyOnceWith(
      { id: request.tenantId, status: 'active', placementEpoch: 7 }, { placementEpoch: 7 },
    );
    const assignmentRead = ['spanner', 'sqljs', 'sqlite', 'better-sqlite3'].includes(type)
      ? f.assignment.findOneBy : f.assignment.findOne;
    expect(f.tenant.update.mock.invocationCallOrder[0]).toBeLessThan(assignmentRead.mock.invocationCallOrder[0]);
    if (type === 'oracle') {
      expect(f.assignment.createQueryBuilder).toHaveBeenCalledExactlyOnceWith('assignment');
      expect(f.query.where).toHaveBeenCalledExactlyOnceWith({ tenantRef: request.tenantId });
      expect(f.query.setLock).toHaveBeenCalledExactlyOnceWith('pessimistic_write');
      expect(f.query.getOne).toHaveBeenCalledExactlyOnceWith();
    } else {
      if (['spanner', 'sqljs', 'sqlite', 'better-sqlite3'].includes(type)) {
        expect(f.assignment.findOneBy).toHaveBeenCalledExactlyOnceWith({ tenantRef: request.tenantId });
      } else {
        expect(f.assignment.findOne).toHaveBeenCalledWith({
          where: { tenantRef: request.tenantId }, lock: { mode: 'pessimistic_write' },
        });
      }
      expect(f.assignment.createQueryBuilder).not.toHaveBeenCalled();
    }
  });

  it.each([undefined, 0, 2])('fails closed on an unconfirmed tenant write (%s), including assignment replay', async (affected) => {
    const f = fixture('postgres', 4);
    f.tenant.update.mockResolvedValue({ affected });
    await expect(f.service.assign(request)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.assignment.findOne).not.toHaveBeenCalled();
    expect(f.assignment.findOneBy).not.toHaveBeenCalled();
    expect(f.assignment.insert).not.toHaveBeenCalled();
    expect(f.events.count).not.toHaveBeenCalled();
    expect(f.schedules.update).not.toHaveBeenCalled();
  });

  it('revalidates placement on every idempotent replay', async () => {
    const f = fixture('postgres', 4);
    await expect(f.service.assign(request)).resolves.toMatchObject({ idempotent: true, placementEpoch: 7, tenantStatus: 'active' });
    f.tenant.update.mockResolvedValueOnce({ affected: 0 });
    await expect(f.service.assign(request)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.tenant.update).toHaveBeenCalledTimes(2);
    expect(f.assignment.findOne).toHaveBeenCalledOnce();
    expect(f.assignment.update).not.toHaveBeenCalled();
  });

  it('keeps the exact legacy v1 response and avoids the new tenant guard when omitted', async () => {
    const f = fixture('postgres', 4);
    const { expectedPlacementEpoch: _, ...legacy } = request;
    await expect(f.service.assign(legacy)).resolves.toEqual({
      schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v1',
      ...legacy, updatedEvents: 2, updatedSchedules: 1, idempotent: true,
    });
    expect(f.tenant.update).not.toHaveBeenCalled();
  });

  it('propagates transaction/guard failures without activation or automatic retry', async () => {
    const f = fixture();
    f.tenant.update.mockRejectedValueOnce(new Error('transaction aborted'));
    await expect(f.service.assign(request)).rejects.toThrow('transaction aborted');
    expect(f.tenant.update).toHaveBeenCalledOnce();
    expect(f.assignment.findOne).not.toHaveBeenCalled();
  });

  it('executes conditional DML and idempotent replay against real in-memory SQLite', async () => {
    const source = new DataSource({
      type: 'sqljs', synchronize: true,
      entities: [Tenant, TenantReleaseWorkAssignment, PluginEventDelivery, PluginScheduledJob],
    });
    await source.initialize();
    try {
      const service = new TenantReleaseWorkAssignmentService(async () => source);
      const tenants = source.getRepository(Tenant);
      await expect(service.assign(request)).rejects.toMatchObject({ statusCode: 409 });
      await tenants.insert({ id: request.tenantId, name: 'Test', slug: 'test', status: 'active', placementEpoch: 7, createdAt: 1, updatedAt: 1 });
      await expect(service.assign(request)).resolves.toMatchObject({ tenantStatus: 'active', placementEpoch: 7, idempotent: false });
      await expect(service.assign(request)).resolves.toMatchObject({ tenantStatus: 'active', placementEpoch: 7, idempotent: true });
      expect(await tenants.findOneByOrFail({ id: request.tenantId })).toMatchObject({ placementEpoch: 7, updatedAt: 1 });
      await tenants.update({ id: request.tenantId }, { status: 'suspended' });
      await expect(service.assign(request)).rejects.toMatchObject({ statusCode: 409 });
      await tenants.update({ id: request.tenantId }, { status: 'active', placementEpoch: 8 });
      await expect(service.assign(request)).rejects.toMatchObject({ statusCode: 409 });
      await tenants.delete({ id: request.tenantId });
      await expect(service.assign(request)).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await source.destroy();
    }
  });
});

function dataSource(repositories: { assignment: object; events: object; schedules: object; tenant?: object }, type = 'postgres'): DataSource {
  const manager = {
    connection: { options: { type } },
    getRepository(entity: unknown) {
      if (entity === Tenant && repositories.tenant) return repositories.tenant;
      if (entity === TenantReleaseWorkAssignment) return repositories.assignment;
      if (entity === PluginEventDelivery) return repositories.events;
      if (entity === PluginScheduledJob) return repositories.schedules;
      throw new Error('unexpected repository');
    },
  } as EntityManager;
  return {
    options: { type },
    transaction: vi.fn(async (operation: (value: EntityManager) => Promise<unknown>) => operation(manager)),
  } as unknown as DataSource;
}
