import { createHash, randomUUID } from 'node:crypto';

import {
  pluginFixedScheduleResponseV1Schema,
  pluginScheduledJobDeliveryV1Schema,
  pluginScheduledJobReceiptV1Schema,
  type PluginFixedScheduleResponseV1,
  type PluginId,
  type PluginScheduledJobDeliveryV1,
  type PluginScheduledJobReceiptV1,
} from '@enterpriseglue/plugin-sdk';
import type { PluginFixedScheduleStoreV1 } from '@enterpriseglue/plugin-runtime/host-broker';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginScheduleCommand,
  PluginScheduledJob,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import type { DataSource, EntityManager } from 'typeorm';

import {
  findPluginRowForUpdateV1,
  lockOraclePluginClaimCandidatesV1,
  oraclePluginClaimCandidateWindowV1,
} from './pluginDatabaseLock.js';
import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';

const MAX_CLAIM = 100;
const MAX_LEASE_SECONDS = 300;
const MAX_RETRY_SECONDS = 3_600;

type ScheduleCommandInputV1 = Parameters<
  PluginFixedScheduleStoreV1['execute']
>[0];

export type PluginScheduledJobStatusV1 =
  | 'scheduled'
  | 'delivering'
  | 'retry_wait'
  | 'paused'
  | 'cancelled';

export interface ClaimedPluginScheduledJobV1 {
  jobRef: string;
  pluginId: PluginId;
  deploymentRef: string;
  tenantRef: string;
  operationId: string;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string;
  request: PluginScheduledJobDeliveryV1;
}

export interface PluginScheduledJobSafeSummaryV1 {
  jobRef: string;
  pluginId: PluginId;
  tenantRef: string;
  jobType: string;
  status: PluginScheduledJobStatusV1;
  revision: number;
  attempt: number;
  maxAttempts: number;
  reasonCode: string;
  nextRunAt: number;
  updatedAt: number;
}

export interface PluginScheduleDeliveryStoreV1 {
  claimDue(input: {
    workerRef: string;
    limit: number;
    leaseSeconds: number;
    now?: number;
  }): Promise<ClaimedPluginScheduledJobV1[]>;
  complete(input: {
    jobRef: string;
    leaseOwner: string;
    receipt: PluginScheduledJobReceiptV1;
    now?: number;
  }): Promise<PluginScheduledJobSafeSummaryV1>;
  setPaused(input: {
    jobRef: string;
    paused: boolean;
    expectedRevision: number;
    reasonCode: string;
    now?: number;
  }): Promise<PluginScheduledJobSafeSummaryV1>;
}

/**
 * Durable fixed-schedule command and delivery store.
 *
 * A job has one stable identity per plugin/deployment/tenant/job type. Commands
 * are independently idempotent, while delivery uses leases so only one backend
 * replica owns an attempt at a time.
 */
export class DatabasePluginScheduleStoreV1
implements PluginFixedScheduleStoreV1, PluginScheduleDeliveryStoreV1 {
  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> =
      getDataSource,
    private readonly clock: () => number = Date.now,
  ) {}

  async execute(
    input: ScheduleCommandInputV1,
  ): Promise<PluginFixedScheduleResponseV1> {
    if (
      input.request.action === 'upsert' &&
      !input.allowedIntervalsSeconds.includes(input.request.intervalSeconds)
    ) {
      throw new Error('plugin_schedule_interval_denied');
    }
    const keyHash = hash(
      [
        input.pluginId,
        input.deploymentRef,
        input.tenantRef,
        input.request.idempotencyKey,
      ].join('\0'),
    );
    const requestHash = hash(JSON.stringify(input.request));
    const jobRef = `job-${hash(
      [
        input.pluginId,
        input.deploymentRef,
        input.tenantRef,
        input.request.jobType,
      ].join('\0'),
    )}`;
    const dataSource = await this.dataSourceProvider();
    try {
      return await runPluginTransactionV1(dataSource, async (manager) => {
        const commandRepository = manager.getRepository(PluginScheduleCommand);
        const existingCommand = await findPluginRowForUpdateV1(
          commandRepository,
          { idempotencyKeyHash: keyHash },
        );
        if (existingCommand) {
          if (existingCommand.requestHash !== requestHash) {
            throw new Error('plugin_schedule_idempotency_conflict');
          }
          return duplicate(existingCommand.responseJson);
        }
        const now = this.clock();
        const jobRepository = manager.getRepository(PluginScheduledJob);
        const current = await findPluginRowForUpdateV1(jobRepository, {
          jobRef,
        });
        const revision = current ? integer(current.revision) + 1 : 1;
        const result =
          input.request.action === 'upsert'
            ? fixedScheduleResponse({
                jobRef,
                status: 'scheduled',
                nextRunAt: new Date(
                  now + input.request.intervalSeconds * 1_000,
                ).toISOString(),
                revision,
              })
            : fixedScheduleResponse({
                jobRef,
                status: 'cancelled',
                revision,
              });
        const values = {
          pluginId: input.pluginId,
          deploymentRef: input.deploymentRef,
          tenantRef: input.tenantRef,
          jobType: input.request.jobType,
          operationId: input.deliveryOperationId,
          intervalSeconds:
            input.request.action === 'upsert'
              ? input.request.intervalSeconds
              : current?.intervalSeconds ?? 0,
          maxAttempts: input.maxAttempts,
          status:
            input.request.action === 'upsert' ? 'scheduled' : 'cancelled',
          revision,
          attempt: 0,
          nextRunAt:
            input.request.action === 'upsert'
              ? now + input.request.intervalSeconds * 1_000
              : 0,
          leaseOwner: null,
          leaseExpiresAt: null,
          reasonCode:
            input.request.action === 'upsert' ? 'scheduled' : 'cancelled',
          scheduledByRef: input.subjectRef,
          updatedAt: now,
        };
        if (current) {
          await jobRepository.update({ id: current.id }, values);
        } else {
          await jobRepository.insert({
            id: randomUUID(),
            jobRef,
            ...values,
            createdAt: now,
          });
        }
        await commandRepository.insert({
          id: randomUUID(),
          idempotencyKeyHash: keyHash,
          requestHash,
          responseJson: JSON.stringify(result),
          pluginId: input.pluginId,
          deploymentRef: input.deploymentRef,
          tenantRef: input.tenantRef,
          createdAt: now,
        });
        return result;
      });
    } catch (error) {
      const existing = await dataSource
        .getRepository(PluginScheduleCommand)
        .findOne({ where: { idempotencyKeyHash: keyHash } });
      if (existing && existing.requestHash === requestHash) {
        return duplicate(existing.responseJson);
      }
      throw error;
    }
  }

  async claimDue(input: {
    workerRef: string;
    limit: number;
    leaseSeconds: number;
    now?: number;
  }): Promise<ClaimedPluginScheduledJobV1[]> {
    assertClaim(input);
    const dataSource = await this.dataSourceProvider();
    const now = input.now ?? this.clock();
    return runPluginTransactionV1(dataSource, async (manager) => {
      await recoverExpiredLeases(manager, now);
      const repository = manager.getRepository(PluginScheduledJob);
      const query = repository
        .createQueryBuilder('job')
        .where('job.status IN (:...statuses)', {
          statuses: ['scheduled', 'retry_wait'],
        })
        .andWhere('job.next_run_at <= :now', { now })
        .andWhere(
          '(job.lease_expires_at IS NULL OR job.lease_expires_at <= :now)',
          { now },
        )
        .orderBy('job.next_run_at', 'ASC')
        .addOrderBy('job.created_at', 'ASC');
      const records =
        dataSource.options.type === 'oracle'
          ? await lockOraclePluginClaimCandidatesV1(
              repository,
              await query
                .take(oraclePluginClaimCandidateWindowV1(input.limit))
                .getMany(),
              input.limit,
              (record) => scheduleClaimEligible(record, now),
            )
          : dataSource.options.type === 'spanner'
            ? await query.take(input.limit).getMany()
            : await query
              .setLock('pessimistic_write')
              .take(input.limit)
              .getMany();
      const claimed: ClaimedPluginScheduledJobV1[] = [];
      for (const record of records) {
        const attempt = integer(record.attempt) + 1;
        await manager.getRepository(PluginScheduledJob).update(
          { id: record.id },
          {
            status: 'delivering',
            attempt,
            leaseOwner: input.workerRef,
            leaseExpiresAt: now + input.leaseSeconds * 1_000,
            reasonCode: 'delivering',
            updatedAt: now,
          },
        );
        const deliveryId = deliveryRef(record.jobRef, record.nextRunAt);
        claimed.push({
          jobRef: record.jobRef,
          pluginId: record.pluginId as PluginId,
          deploymentRef: record.deploymentRef,
          tenantRef: record.tenantRef,
          operationId: record.operationId,
          attempt,
          maxAttempts: integer(record.maxAttempts),
          leaseOwner: input.workerRef,
          request: pluginScheduledJobDeliveryV1Schema.parse({
            apiVersion:
              'scheduled-job-delivery.plugin.enterpriseglue.io/v1',
            deliveryId,
            jobRef: record.jobRef,
            jobType: record.jobType,
            operationId: record.operationId,
            scheduledFor: new Date(integer(record.nextRunAt)).toISOString(),
            attempt,
          }),
        });
      }
      return claimed;
    });
  }

  async complete(input: {
    jobRef: string;
    leaseOwner: string;
    receipt: PluginScheduledJobReceiptV1;
    now?: number;
  }): Promise<PluginScheduledJobSafeSummaryV1> {
    const receipt = pluginScheduledJobReceiptV1Schema.parse(input.receipt);
    const dataSource = await this.dataSourceProvider();
    const now = input.now ?? this.clock();
    return runPluginTransactionV1(dataSource, async (manager) => {
      const repository = manager.getRepository(PluginScheduledJob);
      const record = await findPluginRowForUpdateV1(repository, {
        jobRef: input.jobRef,
      });
      if (
        !record ||
        record.status !== 'delivering' ||
        record.leaseOwner !== input.leaseOwner ||
        integer(record.leaseExpiresAt ?? 0) <= now ||
        receipt.deliveryId !== deliveryRef(record.jobRef, record.nextRunAt)
      ) {
        throw new Error('plugin_schedule_lease_lost');
      }
      const accepted =
        receipt.status === 'accepted' || receipt.status === 'duplicate';
      const exhausted = integer(record.attempt) >= integer(record.maxAttempts);
      const paused =
        receipt.status === 'permanent_rejected' || (!accepted && exhausted);
      const status: PluginScheduledJobStatusV1 = accepted
        ? 'scheduled'
        : paused
          ? 'paused'
          : 'retry_wait';
      const nextRunAt = accepted
        ? now + integer(record.intervalSeconds) * 1_000
        : status === 'retry_wait'
          ? now + retryDelayMs(integer(record.attempt))
          : integer(record.nextRunAt);
      const revision = integer(record.revision) + 1;
      await repository.update(
        { id: record.id },
        {
          status,
          revision,
          attempt: accepted ? 0 : record.attempt,
          nextRunAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          reasonCode: receipt.reasonCode,
          updatedAt: now,
        },
      );
      return summary({
        ...record,
        status,
        revision,
        attempt: accepted ? 0 : record.attempt,
        nextRunAt,
        reasonCode: receipt.reasonCode,
        updatedAt: now,
      });
    });
  }

  async setPaused(input: {
    jobRef: string;
    paused: boolean;
    expectedRevision: number;
    reasonCode: string;
    now?: number;
  }): Promise<PluginScheduledJobSafeSummaryV1> {
    const dataSource = await this.dataSourceProvider();
    const now = input.now ?? this.clock();
    return runPluginTransactionV1(dataSource, async (manager) => {
      const repository = manager.getRepository(PluginScheduledJob);
      const record = await findPluginRowForUpdateV1(repository, {
        jobRef: input.jobRef,
      });
      if (
        !record ||
        record.status === 'cancelled' ||
        integer(record.revision) !== input.expectedRevision
      ) {
        throw new Error('plugin_schedule_revision_conflict');
      }
      const revision = integer(record.revision) + 1;
      const status = input.paused ? 'paused' : 'scheduled';
      const nextRunAt = input.paused
        ? integer(record.nextRunAt)
        : now + integer(record.intervalSeconds) * 1_000;
      await repository.update(
        { id: record.id },
        {
          status,
          revision,
          attempt: input.paused ? record.attempt : 0,
          nextRunAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          reasonCode: input.reasonCode,
          updatedAt: now,
        },
      );
      return summary({
        ...record,
        status,
        revision,
        attempt: input.paused ? record.attempt : 0,
        nextRunAt,
        reasonCode: input.reasonCode,
        updatedAt: now,
      });
    });
  }
}

export class PluginScheduleDeliveryCoordinatorV1 {
  constructor(private readonly store: PluginScheduleDeliveryStoreV1) {}

  async runOnce(input: {
    workerRef: string;
    limit?: number;
    leaseSeconds?: number;
    now?: number;
    deliver: (
      job: ClaimedPluginScheduledJobV1,
    ) => Promise<PluginScheduledJobReceiptV1>;
  }): Promise<PluginScheduledJobSafeSummaryV1[]> {
    const claimed = await this.store.claimDue({
      workerRef: input.workerRef,
      limit: input.limit ?? 20,
      leaseSeconds: input.leaseSeconds ?? 30,
      now: input.now,
    });
    return Promise.all(
      claimed.map(async (job) => {
        let receipt: PluginScheduledJobReceiptV1;
        try {
          receipt = pluginScheduledJobReceiptV1Schema.parse(
            await input.deliver(job),
          );
        } catch {
          receipt = pluginScheduledJobReceiptV1Schema.parse({
            apiVersion:
              'scheduled-job-receipt.plugin.enterpriseglue.io/v1',
            deliveryId: job.request.deliveryId,
            status: 'retryable_rejected',
            reasonCode: 'delivery_unavailable',
          });
        }
        return this.store.complete({
          jobRef: job.jobRef,
          leaseOwner: job.leaseOwner,
          receipt,
          now: input.now,
        });
      }),
    );
  }
}

async function recoverExpiredLeases(
  manager: EntityManager,
  now: number,
): Promise<void> {
  const repository = manager.getRepository(PluginScheduledJob);
  const query = repository
    .createQueryBuilder('job')
    .where('job.status = :status', { status: 'delivering' })
    .andWhere('job.lease_expires_at <= :now', { now });
  const expired =
    manager.connection.options.type === 'spanner'
      ? await query.getMany()
      : await query.setLock('pessimistic_write').getMany();
  for (const record of expired) {
    const exhausted = integer(record.attempt) >= integer(record.maxAttempts);
    await repository.update(
      { id: record.id },
      {
        status: exhausted ? 'paused' : 'retry_wait',
        leaseOwner: null,
        leaseExpiresAt: null,
        nextRunAt: exhausted
          ? record.nextRunAt
          : now + retryDelayMs(integer(record.attempt)),
        reasonCode: exhausted ? 'attempts_exhausted' : 'lease_expired',
        updatedAt: now,
      },
    );
  }
}

function duplicate(responseJson: string): PluginFixedScheduleResponseV1 {
  const prior = pluginFixedScheduleResponseV1Schema.parse(
    JSON.parse(responseJson),
  );
  return pluginFixedScheduleResponseV1Schema.parse({
    ...prior,
    status: 'duplicate',
  });
}

function fixedScheduleResponse(input: {
  jobRef: string;
  status: 'scheduled' | 'cancelled';
  nextRunAt?: string;
  revision: number;
}): PluginFixedScheduleResponseV1 {
  return pluginFixedScheduleResponseV1Schema.parse({
    apiVersion: 'fixed-schedule-result.plugin.enterpriseglue.io/v1',
    ...input,
  });
}

function deliveryRef(jobRef: string, scheduledFor: number): string {
  return `scheduled-${hash(`${jobRef}\0${scheduledFor}`)}`;
}

function retryDelayMs(attempt: number): number {
  return Math.min(2 ** Math.max(0, attempt - 1), MAX_RETRY_SECONDS) * 1_000;
}

function assertClaim(input: {
  workerRef: string;
  limit: number;
  leaseSeconds: number;
}): void {
  if (
    !/^[A-Za-z0-9._:-]{1,256}$/.test(input.workerRef) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_CLAIM ||
    !Number.isSafeInteger(input.leaseSeconds) ||
    input.leaseSeconds < 1 ||
    input.leaseSeconds > MAX_LEASE_SECONDS
  ) {
    throw new Error('plugin_schedule_claim_invalid');
  }
}

function scheduleClaimEligible(
  record: PluginScheduledJob,
  now: number,
): boolean {
  return (
    (record.status === 'scheduled' || record.status === 'retry_wait') &&
    Number(record.nextRunAt) <= now &&
    (record.leaseExpiresAt === null ||
      record.leaseExpiresAt === undefined ||
      Number(record.leaseExpiresAt) <= now)
  );
}

function integer(value: number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('plugin_schedule_state_invalid');
  }
  return result;
}

type JobSummaryRecordV1 = Pick<
  PluginScheduledJob,
  | 'jobRef'
  | 'pluginId'
  | 'tenantRef'
  | 'jobType'
  | 'revision'
  | 'attempt'
  | 'maxAttempts'
  | 'reasonCode'
  | 'nextRunAt'
  | 'updatedAt'
> & { status: string };

function summary(record: JobSummaryRecordV1): PluginScheduledJobSafeSummaryV1 {
  return {
    jobRef: record.jobRef,
    pluginId: record.pluginId as PluginId,
    tenantRef: record.tenantRef,
    jobType: record.jobType,
    status: record.status as PluginScheduledJobStatusV1,
    revision: integer(record.revision),
    attempt: integer(record.attempt),
    maxAttempts: integer(record.maxAttempts),
    reasonCode: record.reasonCode,
    nextRunAt: integer(record.nextRunAt),
    updatedAt: integer(record.updatedAt),
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
