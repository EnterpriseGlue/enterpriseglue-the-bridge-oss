import { createHash, randomUUID } from 'node:crypto';

import {
  pluginEventDeliveryV1Schema,
  pluginEventReceiptV1Schema,
  pluginHostEventV1Schema,
  type PluginEventDeliveryV1,
  type PluginEventReceiptV1,
  type PluginEventTypeV1,
  type PluginHostEventV1,
  type PluginId,
} from '@enterpriseglue/plugin-sdk';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginEventDelivery,
  PluginEventQueueState,
  PluginEventSubscriptionState,
  PluginPlatformAudit,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import type { DataSource, EntityManager } from 'typeorm';

import {
  findPluginRowForUpdateV1,
  lockOraclePluginClaimCandidatesV1,
  oraclePluginClaimCandidateWindowV1,
} from './pluginDatabaseLock.js';
import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';
import type { PluginEventMetricsRegistryV1 } from './pluginEventMetrics.js';

const MAX_EVENT_BYTES = 64 * 1024;
const MAX_CLAIM = 100;
const MAX_LEASE_SECONDS = 300;
const MAX_RETRY_SECONDS = 3_600;
const DEFAULT_MAX_OUTSTANDING_PER_PLUGIN = 10_000;
const DEFAULT_MAX_OUTSTANDING_PER_SUBSCRIPTION = 1_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_OPEN_MILLISECONDS = 60_000;
const MAX_BACKLOG_LIMIT = 1_000_000;
const MAX_CIRCUIT_FAILURE_THRESHOLD = 100;
const MAX_CIRCUIT_OPEN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const MAX_ENQUEUE_ATTEMPTS = 3;
const OUTSTANDING_EVENT_STATUSES = [
  'pending',
  'delivering',
  'retry_wait',
] as const;

export type PluginEventDeliveryStatusV1 =
  | 'pending'
  | 'delivering'
  | 'retry_wait'
  | 'delivered'
  | 'dead_letter';

export interface EnqueuePluginEventV1 {
  pluginId: PluginId;
  deploymentRef: string;
  tenantRef: string;
  subscriptionType: PluginEventTypeV1;
  operationId: string;
  maxAttempts: number;
  event: PluginHostEventV1;
  now?: number;
}

export interface ClaimedPluginEventV1 {
  deliveryId: string;
  pluginId: PluginId;
  deploymentRef: string;
  tenantRef: string;
  attempt: number;
  maxAttempts: number;
  leaseOwner: string;
  request: PluginEventDeliveryV1;
}

export interface CompletePluginEventV1 {
  deliveryId: string;
  leaseOwner: string;
  receipt: PluginEventReceiptV1;
  now?: number;
}

export interface PluginEventSafeSummaryV1 {
  deliveryId: string;
  pluginId: PluginId;
  tenantRef: string;
  subscriptionType: PluginEventTypeV1;
  status: PluginEventDeliveryStatusV1;
  attempt: number;
  maxAttempts: number;
  reasonCode: string;
  nextAttemptAt: number;
  updatedAt: number;
}

export interface PluginEventDeliveryStoreV1 {
  enqueue(input: EnqueuePluginEventV1): Promise<{ deliveryId: string }>;
  claimDue(input: {
    workerRef: string;
    limit: number;
    leaseSeconds: number;
    now?: number;
  }): Promise<ClaimedPluginEventV1[]>;
  complete(input: CompletePluginEventV1): Promise<PluginEventSafeSummaryV1>;
  requeueDeadLetter(input: {
    pluginId: PluginId;
    deliveryId: string;
    expectedAttempt: number;
    actorRef: string;
    correlationId: string;
    now?: number;
  }): Promise<PluginEventSafeSummaryV1>;
}

export interface PluginEventDeadLetterSafeSummaryV1 {
  deliveryId: string;
  pluginId: PluginId;
  subscriptionType: PluginEventTypeV1;
  attempt: number;
  maxAttempts: number;
  reasonCode: string;
  createdAt: number;
  updatedAt: number;
}

export interface PluginEventDeadLetterPageV1 {
  items: PluginEventDeadLetterSafeSummaryV1[];
  nextCursor: string | null;
}

export interface PluginEventOperationsStoreV1 {
  listDeadLetters(input: {
    limit: number;
    cursor?: string;
  }): Promise<PluginEventDeadLetterPageV1>;
  requeueDeadLetter(
    input: Parameters<PluginEventDeliveryStoreV1['requeueDeadLetter']>[0],
  ): Promise<PluginEventSafeSummaryV1>;
}

export interface PluginEventBacklogPolicyV1 {
  maxOutstandingPerPlugin: number;
  maxOutstandingPerSubscription: number;
}

export interface PluginEventCircuitPolicyV1 {
  failureThreshold: number;
  openMilliseconds: number;
}

export class DatabasePluginEventDeliveryStoreV1
implements PluginEventDeliveryStoreV1 {
  private readonly backlogPolicy: PluginEventBacklogPolicyV1;
  private readonly circuitPolicy: PluginEventCircuitPolicyV1;

  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> =
      getDataSource,
    backlogPolicy: Partial<PluginEventBacklogPolicyV1> = {},
    circuitPolicy: Partial<PluginEventCircuitPolicyV1> = {},
    private readonly metrics?: Pick<
      PluginEventMetricsRegistryV1,
      'recordEnqueue' | 'recordDelivery' | 'recordCircuit'
    >,
  ) {
    this.backlogPolicy = {
      maxOutstandingPerPlugin:
        backlogPolicy.maxOutstandingPerPlugin ??
        positiveEnvironmentInteger(
          'ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_PLUGIN',
          DEFAULT_MAX_OUTSTANDING_PER_PLUGIN,
        ),
      maxOutstandingPerSubscription:
        backlogPolicy.maxOutstandingPerSubscription ??
        positiveEnvironmentInteger(
          'ENTERPRISEGLUE_PLUGIN_EVENT_MAX_OUTSTANDING_PER_SUBSCRIPTION',
          DEFAULT_MAX_OUTSTANDING_PER_SUBSCRIPTION,
        ),
    };
    this.circuitPolicy = {
      failureThreshold:
        circuitPolicy.failureThreshold ??
        boundedEnvironmentInteger(
          'ENTERPRISEGLUE_PLUGIN_EVENT_CIRCUIT_FAILURE_THRESHOLD',
          DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
          MAX_CIRCUIT_FAILURE_THRESHOLD,
        ),
      openMilliseconds:
        circuitPolicy.openMilliseconds ??
        boundedEnvironmentInteger(
          'ENTERPRISEGLUE_PLUGIN_EVENT_CIRCUIT_OPEN_SECONDS',
          DEFAULT_CIRCUIT_OPEN_MILLISECONDS / 1_000,
          MAX_CIRCUIT_OPEN_MILLISECONDS / 1_000,
        ) * 1_000,
    };
    for (const value of Object.values(this.backlogPolicy)) {
      if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > MAX_BACKLOG_LIMIT
      ) {
        throw new Error('plugin_event_backlog_policy_invalid');
      }
    }
    if (
      !Number.isSafeInteger(this.circuitPolicy.failureThreshold) ||
      this.circuitPolicy.failureThreshold < 1 ||
      this.circuitPolicy.failureThreshold >
        MAX_CIRCUIT_FAILURE_THRESHOLD ||
      !Number.isSafeInteger(this.circuitPolicy.openMilliseconds) ||
      this.circuitPolicy.openMilliseconds < 1 ||
      this.circuitPolicy.openMilliseconds >
        MAX_CIRCUIT_OPEN_MILLISECONDS
    ) {
      throw new Error('plugin_event_circuit_policy_invalid');
    }
  }

  async enqueue(input: EnqueuePluginEventV1) {
    let event: PluginHostEventV1;
    try {
      event = pluginHostEventV1Schema.parse(input.event);
      if (
        event.type !== input.subscriptionType ||
        event.tenantRef !== input.tenantRef ||
        !Number.isSafeInteger(input.maxAttempts) ||
        input.maxAttempts < 1 ||
        input.maxAttempts > 100
      ) {
        throw new Error('plugin_event_invalid');
      }
    } catch (error) {
      recordMetric(() =>
        this.metrics?.recordEnqueue({
          pluginId: input.pluginId,
          subscriptionType: input.subscriptionType,
          outcome: 'rejected',
          reasonCode: 'event_invalid',
        }),
      );
      throw error;
    }
    const eventJson = JSON.stringify(event);
    if (Buffer.byteLength(eventJson, 'utf8') > MAX_EVENT_BYTES) {
      recordMetric(() =>
        this.metrics?.recordEnqueue({
          pluginId: input.pluginId,
          subscriptionType: input.subscriptionType,
          outcome: 'rejected',
          reasonCode: 'event_too_large',
        }),
      );
      throw new Error('plugin_event_too_large');
    }
    const eventSha256 = hash(eventJson);
    const deliveryId = `event-${hash(
      [
        input.pluginId,
        input.deploymentRef,
        input.tenantRef,
        input.subscriptionType,
        input.operationId,
        event.id,
      ].join('\0'),
    )}`;
    let dataSource: DataSource;
    try {
      dataSource = await this.dataSourceProvider();
    } catch (error) {
      recordMetric(() =>
        this.metrics?.recordEnqueue({
          pluginId: input.pluginId,
          subscriptionType: input.subscriptionType,
          outcome: 'rejected',
          reasonCode: 'enqueue_unavailable',
        }),
      );
      throw error;
    }
    const now = input.now ?? Date.now();
    try {
      for (
        let attempt = 1;
        attempt <= MAX_ENQUEUE_ATTEMPTS;
        attempt += 1
      ) {
        try {
          const result = await runPluginTransactionV1(
            dataSource,
            async (manager) => {
            const repository = manager.getRepository(PluginEventDelivery);
            const existing = await repository.findOne({
              where: { deliveryId },
            });
            if (existing) {
              if (
                existing.eventSha256 !== eventSha256 ||
                existing.operationId !== input.operationId
              ) {
                throw new Error('plugin_event_idempotency_conflict');
              }
              return {
                deliveryId,
                outcome: 'duplicate' as const,
              };
            }

            const queueStateRepository =
              manager.getRepository(PluginEventQueueState);
            let queueState = await findPluginRowForUpdateV1(
              queueStateRepository,
              { pluginId: input.pluginId },
            );
            if (!queueState) {
              await queueStateRepository.insert({
                id: randomUUID(),
                pluginId: input.pluginId,
                updatedAt: now,
              });
              queueState = await findPluginRowForUpdateV1(
                queueStateRepository,
                { pluginId: input.pluginId },
              );
              if (!queueState) {
                throw new Error('plugin_event_queue_state_insert_failed');
              }
            }
            const subscriptionState = await ensureSubscriptionState(
              manager,
              subscriptionIdentity(input),
              now,
            );
            if (circuitBlocksEnqueue(subscriptionState, now)) {
              throw new Error('plugin_event_circuit_open');
            }

            const pluginOutstanding = await repository
              .createQueryBuilder('delivery')
              .where('delivery.plugin_id = :pluginId', {
                pluginId: input.pluginId,
              })
              .andWhere('delivery.status IN (:...statuses)', {
                statuses: OUTSTANDING_EVENT_STATUSES,
              })
              .getCount();
            if (
              pluginOutstanding >=
              this.backlogPolicy.maxOutstandingPerPlugin
            ) {
              throw new Error(
                'plugin_event_backlog_plugin_quota_exceeded',
              );
            }
            const subscriptionOutstanding = await repository
              .createQueryBuilder('delivery')
              .where('delivery.plugin_id = :pluginId', {
                pluginId: input.pluginId,
              })
              .andWhere('delivery.deployment_ref = :deploymentRef', {
                deploymentRef: input.deploymentRef,
              })
              .andWhere('delivery.tenant_ref = :tenantRef', {
                tenantRef: input.tenantRef,
              })
              .andWhere('delivery.subscription_type = :subscriptionType', {
                subscriptionType: input.subscriptionType,
              })
              .andWhere('delivery.status IN (:...statuses)', {
                statuses: OUTSTANDING_EVENT_STATUSES,
              })
              .getCount();
            if (
              subscriptionOutstanding >=
              this.backlogPolicy.maxOutstandingPerSubscription
            ) {
              throw new Error(
                'plugin_event_backlog_subscription_quota_exceeded',
              );
            }

            await repository.insert({
              id: randomUUID(),
              deliveryId,
              pluginId: input.pluginId,
              deploymentRef: input.deploymentRef,
              tenantRef: input.tenantRef,
              subscriptionType: input.subscriptionType,
              operationId: input.operationId,
              eventId: event.id,
              eventSha256,
              eventJson,
              status: 'pending',
              attempt: 0,
              maxAttempts: input.maxAttempts,
              nextAttemptAt: now,
              leaseOwner: null,
              leaseExpiresAt: null,
              reasonCode: 'queued',
              deliveredAt: null,
              createdAt: now,
              updatedAt: now,
            });
            await queueStateRepository.update(
              { id: queueState.id },
              { updatedAt: now },
            );
            return { deliveryId, outcome: 'queued' as const };
          });
          recordMetric(() =>
            this.metrics?.recordEnqueue({
              pluginId: input.pluginId,
              subscriptionType: input.subscriptionType,
              outcome: result.outcome,
              reasonCode: result.outcome,
            }),
          );
          return { deliveryId: result.deliveryId };
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.startsWith('plugin_event_backlog_') ||
              error.message === 'plugin_event_idempotency_conflict' ||
              error.message === 'plugin_event_circuit_open')
          ) {
            throw error;
          }
          if (attempt === MAX_ENQUEUE_ATTEMPTS) throw error;
        }
      }
      throw new Error('plugin_event_enqueue_unavailable');
    } catch (error) {
      recordMetric(() =>
        this.metrics?.recordEnqueue({
          pluginId: input.pluginId,
          subscriptionType: input.subscriptionType,
          outcome: 'rejected',
          reasonCode: enqueueMetricReason(error),
        }),
      );
      throw error;
    }
  }

  async claimDue(input: {
    workerRef: string;
    limit: number;
    leaseSeconds: number;
    now?: number;
  }): Promise<ClaimedPluginEventV1[]> {
    if (
      !/^[A-Za-z0-9._:-]{1,256}$/.test(input.workerRef) ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_CLAIM ||
      !Number.isSafeInteger(input.leaseSeconds) ||
      input.leaseSeconds < 1 ||
      input.leaseSeconds > MAX_LEASE_SECONDS
    ) {
      throw new Error('plugin_event_claim_invalid');
    }
    const dataSource = await this.dataSourceProvider();
    const now = input.now ?? Date.now();
    const result = await runPluginTransactionV1(
      dataSource,
      async (manager) => {
      await manager
        .getRepository(PluginEventDelivery)
        .createQueryBuilder()
        .update()
        .set({
          status: 'retry_wait',
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: now,
          reasonCode: 'lease_expired',
          updatedAt: now,
        })
        .where('status = :status', { status: 'delivering' })
        .andWhere('lease_expires_at <= :now', { now })
        .execute();
      const repository = manager.getRepository(PluginEventDelivery);
      const query = repository
        .createQueryBuilder('delivery')
        .where('delivery.status IN (:...statuses)', {
          statuses: ['pending', 'retry_wait'],
        })
        .andWhere('delivery.next_attempt_at <= :now', { now })
        .andWhere(
          '(delivery.lease_expires_at IS NULL OR delivery.lease_expires_at <= :now)',
          { now },
        )
        .orderBy('delivery.next_attempt_at', 'ASC')
        .addOrderBy('delivery.created_at', 'ASC');
      const records =
        dataSource.options.type === 'oracle'
          ? await lockOraclePluginClaimCandidatesV1(
              repository,
              await query
                .take(oraclePluginClaimCandidateWindowV1(input.limit))
                .getMany(),
              input.limit,
              (record) => eventClaimEligible(record, now),
            )
          : dataSource.options.type === 'spanner'
            ? await query.take(input.limit).getMany()
            : await query
              .setLock('pessimistic_write')
              .take(input.limit)
              .getMany();
      const claimed: ClaimedPluginEventV1[] = [];
      const circuitObservations: PluginEventCircuitObservationV1[] = [];
      for (const record of records) {
        const claimDecision = await subscriptionClaimAllowed(
          manager,
          record,
          now,
        );
        if (claimDecision.circuitObservation) {
          circuitObservations.push({
            pluginId: record.pluginId as PluginId,
            subscriptionType:
              record.subscriptionType as PluginEventTypeV1,
            ...claimDecision.circuitObservation,
          });
        }
        if (!claimDecision.allowed) continue;
        const attempt = number(record.attempt) + 1;
        await manager.getRepository(PluginEventDelivery).update(
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
        const event = pluginHostEventV1Schema.parse(
          JSON.parse(record.eventJson),
        );
        claimed.push({
          deliveryId: record.deliveryId,
          pluginId: record.pluginId as PluginId,
          deploymentRef: record.deploymentRef,
          tenantRef: record.tenantRef,
          attempt,
          maxAttempts: number(record.maxAttempts),
          leaseOwner: input.workerRef,
          request: pluginEventDeliveryV1Schema.parse({
            apiVersion: 'event-delivery.plugin.enterpriseglue.io/v1',
            deliveryId: record.deliveryId,
            operationId: record.operationId,
            subscriptionType: record.subscriptionType,
            attempt,
            event,
          }),
        });
      }
      return { claimed, circuitObservations };
    });
    for (const observation of result.circuitObservations) {
      recordMetric(() => this.metrics?.recordCircuit(observation));
    }
    return result.claimed;
  }

  async complete(
    input: CompletePluginEventV1,
  ): Promise<PluginEventSafeSummaryV1> {
    const receipt = pluginEventReceiptV1Schema.parse(input.receipt);
    if (receipt.deliveryId !== input.deliveryId) {
      throw new Error('plugin_event_receipt_mismatch');
    }
    const dataSource = await this.dataSourceProvider();
    const now = input.now ?? Date.now();
    const result = await runPluginTransactionV1(
      dataSource,
      async (manager) => {
      const repository = manager.getRepository(PluginEventDelivery);
      const record = await findPluginRowForUpdateV1(repository, {
        deliveryId: input.deliveryId,
      });
      if (
        !record ||
        record.status !== 'delivering' ||
        record.leaseOwner !== input.leaseOwner ||
        number(record.leaseExpiresAt ?? 0) <= now
      ) {
        throw new Error('plugin_event_lease_lost');
      }
      const delivered =
        receipt.status === 'accepted' || receipt.status === 'duplicate';
      const deadLetter =
        receipt.status === 'permanent_rejected' ||
        number(record.attempt) >= number(record.maxAttempts);
      const status: PluginEventDeliveryStatusV1 = delivered
        ? 'delivered'
        : deadLetter
          ? 'dead_letter'
          : 'retry_wait';
      const nextAttemptAt =
        status === 'retry_wait'
          ? now + retryDelayMs(number(record.attempt))
          : now;
      await repository.update(
        { id: record.id },
        {
          status,
          eventJson: delivered ? '{}' : record.eventJson,
          nextAttemptAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          reasonCode: receipt.reasonCode,
          deliveredAt: delivered ? now : null,
          updatedAt: now,
        },
      );
      const circuitObservation = await updateSubscriptionCircuit(
        manager,
        record,
        receipt.status === 'retryable_rejected',
        now,
        this.circuitPolicy,
      );
      return {
        eventSummary: summary({
          ...record,
          status,
          nextAttemptAt,
          reasonCode: receipt.reasonCode,
          updatedAt: now,
        }),
        circuitObservation: {
          pluginId: record.pluginId as PluginId,
          subscriptionType:
            record.subscriptionType as PluginEventTypeV1,
          ...circuitObservation,
        },
      };
    });
    recordMetric(() =>
      this.metrics?.recordDelivery({
        pluginId: result.eventSummary.pluginId,
        subscriptionType: result.eventSummary.subscriptionType,
        outcome: result.eventSummary.status as
          | 'delivered'
          | 'retry_wait'
          | 'dead_letter',
        receiptStatus: receipt.status,
        reasonCode: receipt.reasonCode,
        attempt: result.eventSummary.attempt,
        maxAttempts: result.eventSummary.maxAttempts,
      }),
    );
    recordMetric(() =>
      this.metrics?.recordCircuit(result.circuitObservation),
    );
    return result.eventSummary;
  }

  async requeueDeadLetter(input: {
    pluginId: PluginId;
    deliveryId: string;
    expectedAttempt: number;
    actorRef: string;
    correlationId: string;
    now?: number;
  }): Promise<PluginEventSafeSummaryV1> {
    if (
      !Number.isSafeInteger(input.expectedAttempt) ||
      input.expectedAttempt < 1 ||
      input.expectedAttempt > 100 ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(input.actorRef) ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(input.correlationId)
    ) {
      throw new Error('plugin_event_requeue_invalid');
    }
    const dataSource = await this.dataSourceProvider();
    const now = input.now ?? Date.now();
    const eventSummary = await runPluginTransactionV1(
      dataSource,
      async (manager) => {
      const repository = manager.getRepository(PluginEventDelivery);
      const record = await findPluginRowForUpdateV1(repository, {
        deliveryId: input.deliveryId,
      });
      if (
        !record ||
        record.pluginId !== input.pluginId ||
        record.status !== 'dead_letter' ||
        number(record.attempt) !== input.expectedAttempt ||
        record.eventJson === '{}'
      ) {
        throw new Error('plugin_event_requeue_conflict');
      }
      await repository.update(
        { id: record.id, status: 'dead_letter' },
        {
          status: 'pending',
          attempt: 0,
          nextAttemptAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          reasonCode: 'administrator_requeued',
          deliveredAt: null,
          updatedAt: now,
        },
      );
      await manager.getRepository(PluginPlatformAudit).insert({
        id: randomUUID(),
        eventType: 'event_dead_letter_requeued',
        pluginId: input.pluginId,
        tenantRef: record.tenantRef,
        actorRef: input.actorRef,
        correlationId: input.correlationId,
        fromState: 'dead_letter',
        toState: 'pending',
        reasonCode: 'none',
        occurredAt: now,
      });
      return summary({
        ...record,
        status: 'pending',
        attempt: 0,
        nextAttemptAt: now,
        reasonCode: 'administrator_requeued',
        updatedAt: now,
      });
    });
    recordMetric(() =>
      this.metrics?.recordDelivery({
        pluginId: eventSummary.pluginId,
        subscriptionType: eventSummary.subscriptionType,
        outcome: 'requeued',
        receiptStatus: 'none',
        reasonCode: 'administrator_requeued',
      }),
    );
    return eventSummary;
  }

  async listDeadLetters(input: {
    limit: number;
    cursor?: string;
  }): Promise<PluginEventDeadLetterPageV1> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    ) {
      throw new Error('plugin_event_dead_letter_query_invalid');
    }
    const cursor = input.cursor
      ? parseDeadLetterCursor(input.cursor)
      : undefined;
    const dataSource = await this.dataSourceProvider();
    const query = dataSource
      .getRepository(PluginEventDelivery)
      .createQueryBuilder('delivery')
      .where('delivery.status = :status', { status: 'dead_letter' });
    if (cursor) {
      query.andWhere(
        '(delivery.updated_at < :updatedAt OR (delivery.updated_at = :updatedAt AND delivery.delivery_id < :deliveryId))',
        cursor,
      );
    }
    const records = await query
      .orderBy('delivery.updated_at', 'DESC')
      .addOrderBy('delivery.delivery_id', 'DESC')
      .take(input.limit + 1)
      .getMany();
    const page = records.slice(0, input.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((record) => ({
        deliveryId: record.deliveryId,
        pluginId: record.pluginId as PluginId,
        subscriptionType:
          record.subscriptionType as PluginEventTypeV1,
        attempt: number(record.attempt),
        maxAttempts: number(record.maxAttempts),
        reasonCode: record.reasonCode,
        createdAt: number(record.createdAt),
        updatedAt: number(record.updatedAt),
      })),
      nextCursor:
        records.length > input.limit && last
          ? deadLetterCursor(last.updatedAt, last.deliveryId)
          : null,
    };
  }

  async setPaused(input: {
    pluginId: PluginId;
    deploymentRef: string;
    tenantRef: string;
    subscriptionType: PluginEventTypeV1;
    paused: boolean;
    expectedRevision: number;
    reasonCode: string;
    now?: number;
  }): Promise<{ paused: boolean; revision: number }> {
    const dataSource = await this.dataSourceProvider();
    return runPluginTransactionV1(dataSource, async (manager) => {
      const repository = manager.getRepository(PluginEventSubscriptionState);
      const where = {
        pluginId: input.pluginId,
        deploymentRef: input.deploymentRef,
        tenantRef: input.tenantRef,
        subscriptionType: input.subscriptionType,
      };
      const current = await findPluginRowForUpdateV1(repository, where);
      const revision = current ? number(current.revision) : 0;
      if (revision !== input.expectedRevision) {
        throw new Error('plugin_event_revision_conflict');
      }
      const nextRevision = revision + 1;
      if (current) {
        await repository.update(
          { id: current.id, revision },
          {
            paused: input.paused,
            revision: nextRevision,
            reasonCode: input.reasonCode,
            updatedAt: input.now ?? Date.now(),
          },
        );
      } else {
        await repository.insert({
          id: randomUUID(),
          ...where,
          paused: input.paused,
          revision: nextRevision,
          reasonCode: input.reasonCode,
          updatedAt: input.now ?? Date.now(),
        });
      }
      return { paused: input.paused, revision: nextRevision };
    });
  }
}

export class PluginEventDeliveryCoordinatorV1 {
  constructor(private readonly store: PluginEventDeliveryStoreV1) {}

  async runOnce(input: {
    workerRef: string;
    limit?: number;
    leaseSeconds?: number;
    now?: number;
    deliver: (
      delivery: ClaimedPluginEventV1,
    ) => Promise<PluginEventReceiptV1>;
  }): Promise<PluginEventSafeSummaryV1[]> {
    const claimed = await this.store.claimDue({
      workerRef: input.workerRef,
      limit: input.limit ?? 20,
      leaseSeconds: input.leaseSeconds ?? 30,
      now: input.now,
    });
    return Promise.all(
      claimed.map(async (delivery) => {
        let receipt: PluginEventReceiptV1;
        try {
          receipt = pluginEventReceiptV1Schema.parse(
            await input.deliver(delivery),
          );
        } catch {
          receipt = {
            apiVersion: 'event-receipt.plugin.enterpriseglue.io/v1',
            deliveryId: delivery.deliveryId,
            status: 'retryable_rejected',
            reasonCode: 'delivery_unavailable',
          };
        }
        return this.store.complete({
          deliveryId: delivery.deliveryId,
          leaseOwner: delivery.leaseOwner,
          receipt,
          now: input.now,
        });
      }),
    );
  }
}

type PluginEventSubscriptionIdentityV1 = Pick<
  EnqueuePluginEventV1,
  'pluginId' | 'deploymentRef' | 'tenantRef' | 'subscriptionType'
>;

interface PluginEventCircuitStateObservationV1 {
  readonly state: 'closed' | 'open' | 'half_open';
  readonly reasonCode:
    | 'none'
    | 'delivery_failure'
    | 'circuit_open'
    | 'half_open_probe'
    | 'delivery_recovered';
}

interface PluginEventCircuitObservationV1
  extends PluginEventCircuitStateObservationV1 {
  readonly pluginId: PluginId;
  readonly subscriptionType: PluginEventTypeV1;
}

interface PluginEventSubscriptionClaimDecisionV1 {
  readonly allowed: boolean;
  readonly circuitObservation?: PluginEventCircuitStateObservationV1;
}

function subscriptionIdentity(
  value:
    | PluginEventSubscriptionIdentityV1
    | PluginEventDelivery,
): PluginEventSubscriptionIdentityV1 {
  return {
    pluginId: value.pluginId as PluginId,
    deploymentRef: value.deploymentRef,
    tenantRef: value.tenantRef,
    subscriptionType: value.subscriptionType as PluginEventTypeV1,
  };
}

async function ensureSubscriptionState(
  manager: EntityManager,
  identity: PluginEventSubscriptionIdentityV1,
  now: number,
): Promise<PluginEventSubscriptionState> {
  const repository = manager.getRepository(PluginEventSubscriptionState);
  let state = await findPluginRowForUpdateV1(repository, identity);
  if (state) return state;
  await repository.insert({
    id: randomUUID(),
    ...identity,
    paused: false,
    revision: 0,
    reasonCode: 'none',
    circuitState: 'closed',
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    probeDeliveryId: null,
    circuitReasonCode: 'none',
    updatedAt: now,
  });
  state = await findPluginRowForUpdateV1(repository, identity);
  if (!state) throw new Error('plugin_event_subscription_state_insert_failed');
  return state;
}

function circuitBlocksEnqueue(
  state: PluginEventSubscriptionState,
  now: number,
): boolean {
  const circuitState = parseCircuitState(state.circuitState);
  if (circuitState === 'closed') return false;
  if (circuitState === 'half_open') return true;
  return (
    state.circuitOpenUntil === null ||
    number(state.circuitOpenUntil) > now
  );
}

async function subscriptionClaimAllowed(
  manager: EntityManager,
  delivery: PluginEventDelivery,
  now: number,
): Promise<PluginEventSubscriptionClaimDecisionV1> {
  const repository = manager.getRepository(PluginEventSubscriptionState);
  const state = await ensureSubscriptionState(
    manager,
    subscriptionIdentity(delivery),
    now,
  );
  if (state.paused) return { allowed: false };
  const circuitState = parseCircuitState(state.circuitState);
  if (circuitState === 'closed') return { allowed: true };
  if (circuitState === 'half_open') {
    return { allowed: state.probeDeliveryId === delivery.deliveryId };
  }
  if (
    state.circuitOpenUntil === null ||
    number(state.circuitOpenUntil) > now
  ) {
    return { allowed: false };
  }
  await repository.update(
    { id: state.id },
    {
      circuitState: 'half_open',
      probeDeliveryId: delivery.deliveryId,
      circuitReasonCode: 'half_open_probe',
      updatedAt: now,
    },
  );
  return {
    allowed: true,
    circuitObservation: {
      state: 'half_open',
      reasonCode: 'half_open_probe',
    },
  };
}

async function updateSubscriptionCircuit(
  manager: EntityManager,
  delivery: PluginEventDelivery,
  failed: boolean,
  now: number,
  policy: PluginEventCircuitPolicyV1,
): Promise<PluginEventCircuitStateObservationV1> {
  const repository = manager.getRepository(PluginEventSubscriptionState);
  const state = await ensureSubscriptionState(
    manager,
    subscriptionIdentity(delivery),
    now,
  );
  const circuitState = parseCircuitState(state.circuitState);
  if (!failed) {
    const reasonCode =
      circuitState === 'closed' &&
      number(state.consecutiveFailures) === 0
        ? 'none'
        : 'delivery_recovered';
    await repository.update(
      { id: state.id },
      {
        circuitState: 'closed',
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        probeDeliveryId: null,
        circuitReasonCode: reasonCode,
        updatedAt: now,
      },
    );
    return { state: 'closed', reasonCode };
  }
  const consecutiveFailures = Math.min(
    MAX_CIRCUIT_FAILURE_THRESHOLD,
    number(state.consecutiveFailures) + 1,
  );
  const open =
    circuitState !== 'closed' ||
    consecutiveFailures >= policy.failureThreshold;
  await repository.update(
    { id: state.id },
    {
      circuitState: open ? 'open' : 'closed',
      consecutiveFailures,
      circuitOpenUntil: open ? now + policy.openMilliseconds : null,
      probeDeliveryId: null,
      circuitReasonCode: open ? 'circuit_open' : 'delivery_failure',
      updatedAt: now,
    },
  );
  return {
    state: open ? 'open' : 'closed',
    reasonCode: open ? 'circuit_open' : 'delivery_failure',
  };
}

function parseCircuitState(
  value: string,
): 'closed' | 'open' | 'half_open' {
  if (value === 'closed' || value === 'open' || value === 'half_open') {
    return value;
  }
  throw new Error('plugin_event_circuit_state_invalid');
}

function retryDelayMs(attempt: number): number {
  return (
    Math.min(2 ** Math.max(0, attempt - 1), MAX_RETRY_SECONDS) * 1_000
  );
}

function eventClaimEligible(
  record: PluginEventDelivery,
  now: number,
): boolean {
  return (
    (record.status === 'pending' || record.status === 'retry_wait') &&
    Number(record.nextAttemptAt) <= now &&
    (record.leaseExpiresAt === null ||
      record.leaseExpiresAt === undefined ||
      Number(record.leaseExpiresAt) <= now)
  );
}

function deadLetterCursor(
  updatedAtInput: number,
  deliveryId: string,
): string {
  return `event-cursor-${Buffer.from(
    JSON.stringify({
      updatedAt: number(updatedAtInput),
      deliveryId,
    }),
    'utf8',
  ).toString('base64url')}`;
}

function parseDeadLetterCursor(value: string): {
  updatedAt: number;
  deliveryId: string;
} {
  if (
    !/^event-cursor-[A-Za-z0-9_-]{1,220}$/.test(value)
  ) {
    throw new Error('plugin_event_dead_letter_cursor_invalid');
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value.slice('event-cursor-'.length), 'base64url').toString(
        'utf8',
      ),
    ) as { updatedAt?: unknown; deliveryId?: unknown };
    if (
      typeof parsed.updatedAt !== 'number' ||
      typeof parsed.deliveryId !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(parsed.deliveryId)
    ) {
      throw new Error('invalid');
    }
    return {
      updatedAt: number(parsed.updatedAt),
      deliveryId: parsed.deliveryId,
    };
  } catch {
    throw new Error('plugin_event_dead_letter_cursor_invalid');
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function positiveEnvironmentInteger(
  name: string,
  fallback: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_BACKLOG_LIMIT
  ) {
    throw new Error(`${name} must be between 1 and ${MAX_BACKLOG_LIMIT}`);
  }
  return parsed;
}

function boundedEnvironmentInteger(
  name: string,
  fallback: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function enqueueMetricReason(error: unknown):
  | 'idempotency_conflict'
  | 'circuit_open'
  | 'plugin_backlog_full'
  | 'subscription_backlog_full'
  | 'enqueue_unavailable' {
  if (!(error instanceof Error)) return 'enqueue_unavailable';
  switch (error.message) {
    case 'plugin_event_idempotency_conflict':
      return 'idempotency_conflict';
    case 'plugin_event_circuit_open':
      return 'circuit_open';
    case 'plugin_event_backlog_plugin_quota_exceeded':
      return 'plugin_backlog_full';
    case 'plugin_event_backlog_subscription_quota_exceeded':
      return 'subscription_backlog_full';
    default:
      return 'enqueue_unavailable';
  }
}

/** Telemetry must never change collection, delivery, retry, or recovery behavior. */
function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // A malformed or saturated metric series is intentionally non-blocking.
  }
}

function number(value: number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error('plugin_event_state_invalid');
  }
  return result;
}

type EventSummaryRecordV1 = Pick<
  PluginEventDelivery,
  | 'deliveryId'
  | 'pluginId'
  | 'tenantRef'
  | 'subscriptionType'
  | 'attempt'
  | 'maxAttempts'
  | 'reasonCode'
  | 'nextAttemptAt'
  | 'updatedAt'
> & { status: string };

function summary(record: EventSummaryRecordV1): PluginEventSafeSummaryV1 {
  return {
    deliveryId: record.deliveryId,
    pluginId: record.pluginId as PluginId,
    tenantRef: record.tenantRef,
    subscriptionType: record.subscriptionType as PluginEventTypeV1,
    status: record.status as PluginEventDeliveryStatusV1,
    attempt: number(record.attempt),
    maxAttempts: number(record.maxAttempts),
    reasonCode: record.reasonCode,
    nextAttemptAt: number(record.nextAttemptAt),
    updatedAt: number(record.updatedAt),
  };
}
