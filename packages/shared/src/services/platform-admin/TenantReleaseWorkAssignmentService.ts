import { randomUUID } from 'node:crypto';
import { In, Not } from 'typeorm';

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginEventDelivery,
  PluginScheduledJob,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { config } from '@enterpriseglue/shared/config/index.js';

export interface TenantReleaseWorkAssignmentResult {
  schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v1';
  tenantId: string;
  releaseId: string;
  assignmentEpoch: number;
  updatedEvents: number;
  updatedSchedules: number;
  idempotent: boolean;
}

export class TenantReleaseWorkAssignmentService {
  constructor(private readonly dataSourceProvider = getDataSource) {}

  async assign(input: { tenantId: string; releaseId: string; assignmentEpoch: number }): Promise<TenantReleaseWorkAssignmentResult> {
    if (!config.tenantPlacementReleaseId) throw Errors.serviceUnavailable('Release-aware plugin work is not configured');
    if (config.tenantPlacementReleaseId !== input.releaseId) {
      throw Errors.conflict('Release assignment must be applied through its target host release');
    }
    const dataSource = await this.dataSourceProvider();
    return dataSource.transaction(async (manager) => {
      const assignmentRepository = manager.getRepository(TenantReleaseWorkAssignment);
      const current = await assignmentRepository.findOne({
        where: { tenantRef: input.tenantId },
        lock: dataSource.options.type === 'spanner' ? undefined : { mode: 'pessimistic_write' },
      });
      if (current && Number(current.assignmentEpoch) > input.assignmentEpoch) {
        throw Errors.conflict('Tenant release assignment epoch is stale');
      }
      if (current && Number(current.assignmentEpoch) === input.assignmentEpoch) {
        if (current.releaseId !== input.releaseId) throw Errors.conflict('Tenant release assignment epoch conflicts with the current release');
        return response(input, 0, 0, true);
      }

      const activeEvents = await manager.getRepository(PluginEventDelivery).count({
        where: { tenantRef: input.tenantId, status: 'delivering' },
      });
      const activeSchedules = await manager.getRepository(PluginScheduledJob).count({
        where: { tenantRef: input.tenantId, status: 'delivering' },
      });
      if (activeEvents + activeSchedules > 0) {
        throw Errors.conflict('Tenant plugin work is still in flight; retry the release transition');
      }

      const now = Date.now();
      if (current) {
        await assignmentRepository.update({ id: current.id }, { releaseId: input.releaseId, assignmentEpoch: input.assignmentEpoch, updatedAt: now });
      } else {
        await assignmentRepository.insert({ id: randomUUID(), tenantRef: input.tenantId, releaseId: input.releaseId, assignmentEpoch: input.assignmentEpoch, updatedAt: now });
      }
      const eventResult = await manager.getRepository(PluginEventDelivery).update(
        { tenantRef: input.tenantId, status: Not(In(['delivered', 'delivering'])) },
        { releaseId: input.releaseId, assignmentEpoch: input.assignmentEpoch, updatedAt: now },
      );
      const scheduleResult = await manager.getRepository(PluginScheduledJob).update(
        { tenantRef: input.tenantId, status: Not('delivering') },
        { releaseId: input.releaseId, assignmentEpoch: input.assignmentEpoch, updatedAt: now },
      );
      return response(input, eventResult.affected || 0, scheduleResult.affected || 0, false);
    });
  }
}

function response(
  input: { tenantId: string; releaseId: string; assignmentEpoch: number },
  updatedEvents: number,
  updatedSchedules: number,
  idempotent: boolean,
): TenantReleaseWorkAssignmentResult {
  return {
    schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v1',
    ...input,
    updatedEvents,
    updatedSchedules,
    idempotent,
  };
}

export const tenantReleaseWorkAssignmentService = new TenantReleaseWorkAssignmentService();
