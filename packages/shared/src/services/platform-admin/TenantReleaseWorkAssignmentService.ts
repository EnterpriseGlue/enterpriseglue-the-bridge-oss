import { randomUUID } from 'node:crypto';
import { In, Not, type EntityManager } from 'typeorm';

import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginEventDelivery,
  PluginScheduledJob,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';

interface AssignmentInput {
  tenantId: string;
  releaseId: string;
  assignmentEpoch: number;
  expectedPlacementEpoch?: number;
}

type AssignmentState = {
  schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v1';
} | {
  schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v2';
  tenantStatus: 'active';
  placementEpoch: number;
};

export type TenantReleaseWorkAssignmentResult = AssignmentState & {
  tenantId: string;
  releaseId: string;
  assignmentEpoch: number;
  updatedEvents: number;
  updatedSchedules: number;
  idempotent: boolean;
}

export class TenantReleaseWorkAssignmentService {
  constructor(private readonly dataSourceProvider = getDataSource) {}

  async assign(input: AssignmentInput, transactionManager?: EntityManager): Promise<TenantReleaseWorkAssignmentResult> {
    if (!config.tenantPlacementReleaseId) throw Errors.serviceUnavailable('Release-aware plugin work is not configured');
    if (config.tenantPlacementReleaseId !== input.releaseId) {
      throw Errors.conflict('Release assignment must be applied through its target host release');
    }
    const apply = async (manager: EntityManager, databaseType: string) => {
      if (input.expectedPlacementEpoch !== undefined) {
        // Acquire the Tenant write fence BEFORE assignment/event/schedule locks.
        // Same-value conditional DML also works on Spanner and SQLite, where
        // TypeORM does not support SELECT FOR UPDATE. Do not advance the epoch:
        // activation verifies placement; it does not perform a placement change.
        const guard = await manager.getRepository(Tenant).update(
          { id: input.tenantId, status: 'active', placementEpoch: input.expectedPlacementEpoch },
          { placementEpoch: input.expectedPlacementEpoch },
        );
        if (guard.affected !== 1) {
          throw Errors.conflict('Tenant must exist, be active, and match the expected placement epoch');
        }
      }
      const assignmentRepository = manager.getRepository(TenantReleaseWorkAssignment);
      // Oracle rejects FOR UPDATE on the row-limited view that findOne adds.
      // tenantRef is unique, so getOne needs no limiting wrapper here.
      const current = databaseType === 'oracle'
        ? await assignmentRepository.createQueryBuilder('assignment')
          .where({ tenantRef: input.tenantId })
          .setLock('pessimistic_write')
          .getOne()
        : await assignmentRepository.findOne({
          where: { tenantRef: input.tenantId },
          lock: ['spanner', 'sqljs', 'sqlite', 'better-sqlite3'].includes(databaseType)
            ? undefined : { mode: 'pessimistic_write' },
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
    };
    if (transactionManager) {
      if (!transactionManager.queryRunner?.isTransactionActive) throw Errors.conflict('Release assignment requires an active transaction');
      return apply(transactionManager, String(transactionManager.connection.options.type));
    }
    const dataSource = await this.dataSourceProvider();
    return dataSource.transaction((manager) => apply(manager, String(dataSource.options.type)));
  }
}

function response(
  input: AssignmentInput,
  updatedEvents: number,
  updatedSchedules: number,
  idempotent: boolean,
): TenantReleaseWorkAssignmentResult {
  return {
    ...(input.expectedPlacementEpoch === undefined
      ? { schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v1' as const }
      : {
        schemaVersion: 'tenant-release-work-assignment.enterpriseglue.io/v2' as const,
        tenantStatus: 'active' as const,
        placementEpoch: input.expectedPlacementEpoch,
      }),
    tenantId: input.tenantId,
    releaseId: input.releaseId,
    assignmentEpoch: input.assignmentEpoch,
    updatedEvents,
    updatedSchedules,
    idempotent,
  };
}

export const tenantReleaseWorkAssignmentService = new TenantReleaseWorkAssignmentService();
