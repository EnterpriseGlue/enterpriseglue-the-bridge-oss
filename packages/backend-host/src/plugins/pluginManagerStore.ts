import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  pluginInstallApprovalV1Schema,
  pluginInstallReviewV1Schema,
  pluginInstallationIntentV1Schema,
  pluginInstallationObservationV1Schema,
  pluginManagerCapabilityV1Schema,
  type PluginInstallApprovalV1,
  type PluginInstallReviewV1,
  type PluginInstallationIntentV1,
  type PluginInstallationObservationV1,
  type PluginManagerCapabilityV1,
} from '@enterpriseglue/plugin-sdk/manager';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginInstallationApproval,
  PluginInstallationIntent,
  PluginInstallationObservation,
  PluginInstallationReview,
  PluginManagerCapability,
  PluginManagerAdmission,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { In, IsNull, LessThanOrEqual, type DataSource, type EntityManager } from 'typeorm';

import { findPluginRowForUpdateV1 } from './pluginDatabaseLock.js';
import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';

export type PluginManagerStoreErrorCodeV1 =
  | 'installation_not_found'
  | 'revision_conflict'
  | 'idempotency_conflict'
  | 'lease_invalid'
  | 'state_invalid'
  | 'review_not_found'
  | 'review_not_approvable'
  | 'approval_conflict'
  | 'operation_in_progress';

export class PluginManagerStoreErrorV1 extends Error {
  constructor(
    public readonly status: 404 | 409,
    public readonly code: PluginManagerStoreErrorCodeV1,
  ) {
    super(code);
    this.name = 'PluginManagerStoreErrorV1';
  }
}

export interface PluginManagerClaimV1 {
  intent: PluginInstallationIntentV1;
  leaseToken: string;
  revision: number;
  leaseExpiresAt: string;
  review?: PluginInstallReviewV1;
}

export interface PluginManagerInstallationSummaryV1 {
  intent: PluginInstallationIntentV1;
  state: string;
  reasonCode: string;
  revision: number;
  review: PluginInstallReviewV1 | null;
  approval: PluginInstallApprovalV1 | null;
  latestObservation: PluginInstallationObservationV1 | null;
  updatedAt: string;
}

export interface PluginManagerStoreV1 {
  createIntent(intent: PluginInstallationIntentV1): Promise<PluginInstallationIntentV1>;
  listInstallations(input: {
    limit: number;
    offset: number;
  }): Promise<{ items: PluginManagerInstallationSummaryV1[]; total: number }>;
  getInstallation(installationId: string): Promise<PluginManagerInstallationSummaryV1>;
  approve(approval: PluginInstallApprovalV1): Promise<{ approval: PluginInstallApprovalV1; revision: number }>;
  cancel(input: { installationId: string; expectedRevision: number; occurredAt: string }): Promise<{ revision: number }>;
  retry(input: { installationId: string; expectedRevision: number; occurredAt: string }): Promise<{ revision: number }>;
  advertiseCapability(capability: PluginManagerCapabilityV1): Promise<void>;
  latestCapability(): Promise<PluginManagerCapabilityV1 | null>;
  claim(input: {
    managerId: string;
    leaseDurationMs: number;
    occurredAt: string;
    currentPlatformRevision?: number;
  }): Promise<PluginManagerClaimV1 | null>;
  renew(input: {
    installationId: string;
    leaseToken: string;
    expectedRevision: number;
    leaseDurationMs: number;
    occurredAt: string;
  }): Promise<{ revision: number; leaseExpiresAt: string }>;
  publishReview(input: {
    leaseToken: string;
    expectedRevision: number;
    review: PluginInstallReviewV1;
  }): Promise<{ revision: number; leaseRetained: boolean }>;
  readApproval(input: {
    installationId: string;
    reviewSha256: string;
    planSha256: string;
  }): Promise<{ approval: PluginInstallApprovalV1; revision: number } | null>;
  publishObservation(input: {
    leaseToken: string;
    expectedRevision: number;
    observation: PluginInstallationObservationV1;
  }): Promise<{ revision: number }>;
}

const claimableStates = [
  'requested',
  'planning',
  'awaiting_approval',
  'approved',
] as const;
const activeMutationStates = [
  ...claimableStates,
  'acquiring',
  'verified',
  'staged_disabled',
  'upgrading',
  'rollback_pending',
  'uninstalling',
] as const;
const deploymentAdmissionScope = 'deployment';

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function integer(value: number | string | null): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('plugin_manager_persistence_integer_invalid');
  }
  return parsed;
}

function leaseExpiry(occurredAt: string, durationMs: number): number {
  const start = Date.parse(occurredAt);
  if (
    !Number.isFinite(start) ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 5_000 ||
    durationMs > 300_000
  ) {
    throw new Error('plugin_manager_lease_duration_invalid');
  }
  return start + durationMs;
}

function parseJson<T>(serialized: string, parser: { parse(value: unknown): T }): T {
  return parser.parse(JSON.parse(serialized));
}

function intentIdempotencyPayload(intent: PluginInstallationIntentV1): string {
  return JSON.stringify({
    pluginId: intent.pluginId,
    release: intent.release,
    operation: intent.operation,
    fromVersion: intent.fromVersion,
    currentEnabled: intent.currentEnabled,
    source: intent.source,
    deploymentMode: intent.deploymentMode,
    requesterRef: intent.requesterRef,
    expectedPlatformRevision: intent.expectedPlatformRevision,
    idempotencyKey: intent.idempotencyKey,
  });
}

function assertLease(
  record: PluginInstallationIntent,
  token: string,
  occurredAt: number,
): void {
  if (
    !record.leaseTokenHash ||
    record.leaseTokenHash !== hash(token) ||
    record.leaseExpiresAt === null ||
    integer(record.leaseExpiresAt) <= occurredAt
  ) {
    throw new PluginManagerStoreErrorV1(409, 'lease_invalid');
  }
}

export class DatabasePluginManagerStoreV1 implements PluginManagerStoreV1 {
  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> = getDataSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createIntent(intentInput: PluginInstallationIntentV1) {
    const intent = pluginInstallationIntentV1Schema.parse(intentInput);
    const idempotencyKeyHash = hash(intent.idempotencyKey);
    const serialized = JSON.stringify(intent);
    const source = await this.dataSourceProvider();
    await this.ensureAdmission(source);
    const repository = source.getRepository(PluginInstallationIntent);
    const existing = await repository.findOne({ where: { idempotencyKeyHash } });
    if (existing) {
      const existingIntent = parseJson(
        existing.intentJson,
        pluginInstallationIntentV1Schema,
      );
      if (
        intentIdempotencyPayload(existingIntent) !==
        intentIdempotencyPayload(intent)
      ) {
        throw new PluginManagerStoreErrorV1(409, 'idempotency_conflict');
      }
      return existingIntent;
    }
    try {
      await runPluginTransactionV1(source, async (manager) => {
        const admissions = manager.getRepository(PluginManagerAdmission);
        const admission = await findPluginRowForUpdateV1(admissions, {
          scope: deploymentAdmissionScope,
        });
        if (!admission) throw new Error('plugin_manager_admission_missing');
        const intents = manager.getRepository(PluginInstallationIntent);
        const repeated = await intents.findOne({ where: { idempotencyKeyHash } });
        if (repeated) {
          const repeatedIntent = parseJson(
            repeated.intentJson,
            pluginInstallationIntentV1Schema,
          );
          if (
            intentIdempotencyPayload(repeatedIntent) !==
            intentIdempotencyPayload(intent)
          ) {
            throw new PluginManagerStoreErrorV1(409, 'idempotency_conflict');
          }
          return;
        }
        if (
          await intents.findOne({
            where: { state: In([...activeMutationStates]) },
          })
        ) {
          throw new PluginManagerStoreErrorV1(409, 'operation_in_progress');
        }
        const now = Date.parse(intent.requestedAt);
        await intents.insert({
          id: randomUUID(),
          installationId: intent.installationId,
          pluginId: intent.pluginId,
          releaseDigest: intent.release,
          source: intent.source,
          deploymentMode: intent.deploymentMode,
          requesterRef: intent.requesterRef,
          expectedPlatformRevision: intent.expectedPlatformRevision,
          idempotencyKeyHash,
          intentJson: serialized,
          state: 'requested',
          reasonCode: 'none',
          revision: 0,
          leaseOwner: null,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          createdAt: now,
          updatedAt: now,
        });
      });
      return intent;
    } catch (error) {
      const repeated = await repository.findOne({ where: { idempotencyKeyHash } });
      if (repeated) {
        const repeatedIntent = parseJson(
          repeated.intentJson,
          pluginInstallationIntentV1Schema,
        );
        if (
          intentIdempotencyPayload(repeatedIntent) ===
          intentIdempotencyPayload(intent)
        ) {
          return repeatedIntent;
        }
      }
      throw error;
    }
  }

  async listInstallations(input: { limit: number; offset: number }) {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0
    ) {
      throw new Error('plugin_manager_pagination_invalid');
    }
    const source = await this.dataSourceProvider();
    const [records, total] = await source.getRepository(PluginInstallationIntent).findAndCount({
      order: { createdAt: 'DESC', installationId: 'ASC' },
      take: input.limit,
      skip: input.offset,
    });
    return {
      items: await Promise.all(records.map((record) => this.summary(source.manager, record))),
      total,
    };
  }

  async getInstallation(installationId: string) {
    const source = await this.dataSourceProvider();
    const record = await source.getRepository(PluginInstallationIntent).findOne({
      where: { installationId },
    });
    if (!record) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
    return this.summary(source.manager, record);
  }

  async approve(approvalInput: PluginInstallApprovalV1) {
    const approval = pluginInstallApprovalV1Schema.parse(approvalInput);
    return runPluginTransactionV1(await this.dataSourceProvider(), async (manager) => {
      const intents = manager.getRepository(PluginInstallationIntent);
      const intent = await findPluginRowForUpdateV1(intents, {
        installationId: approval.installationId,
      });
      if (!intent) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
      const revision = integer(intent.revision);
      const approvals = manager.getRepository(PluginInstallationApproval);
      const existing = await approvals.findOne({
        where: { installationId: approval.installationId },
      });
      if (existing) {
        const current = this.toApproval(existing);
        if (JSON.stringify(current) !== JSON.stringify(approval)) {
          throw new PluginManagerStoreErrorV1(409, 'approval_conflict');
        }
        return { approval: current, revision };
      }
      if (revision !== approval.expectedRevision) {
        throw new PluginManagerStoreErrorV1(409, 'revision_conflict');
      }
      if (intent.state !== 'awaiting_approval') {
        throw new PluginManagerStoreErrorV1(409, 'state_invalid');
      }
      const review = await manager.getRepository(PluginInstallationReview).findOne({
        where: { installationId: approval.installationId },
      });
      if (!review) throw new PluginManagerStoreErrorV1(404, 'review_not_found');
      if (!review.approvable && approval.decision === 'approve') {
        throw new PluginManagerStoreErrorV1(409, 'review_not_approvable');
      }
      if (
        review.reviewSha256 !== approval.reviewSha256 ||
        review.planSha256 !== approval.planSha256 ||
        integer(review.expiresAt) <= Date.parse(approval.decidedAt)
      ) {
        throw new PluginManagerStoreErrorV1(409, 'approval_conflict');
      }
      await approvals.insert({
        id: randomUUID(),
        installationId: approval.installationId,
        decision: approval.decision,
        reviewSha256: approval.reviewSha256,
        planSha256: approval.planSha256,
        approverRef: approval.approverRef,
        expectedRevision: approval.expectedRevision,
        decidedAt: Date.parse(approval.decidedAt),
        expiresAt: Date.parse(approval.expiresAt),
      });
      const nextRevision = revision + 1;
      await intents.update(
        { id: intent.id, revision: intent.revision },
        {
          state: approval.decision === 'approve' ? 'approved' : 'cancelled',
          reasonCode:
            approval.decision === 'approve' ? 'none' : 'administrator_cancelled',
          revision: nextRevision,
          updatedAt: Date.parse(approval.decidedAt),
        },
      );
      return { approval, revision: nextRevision };
    });
  }

  async cancel(input: { installationId: string; expectedRevision: number; occurredAt: string }) {
    return runPluginTransactionV1(await this.dataSourceProvider(), async (manager) => {
      const repository = manager.getRepository(PluginInstallationIntent);
      const intent = await findPluginRowForUpdateV1(repository, { installationId: input.installationId });
      if (!intent) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
      if (integer(intent.revision) !== input.expectedRevision) throw new PluginManagerStoreErrorV1(409, 'revision_conflict');
      if (!['requested', 'awaiting_approval', 'failed', 'manual_intervention'].includes(intent.state)) {
        throw new PluginManagerStoreErrorV1(409, 'state_invalid');
      }
      const now = this.now().getTime();
      if (intent.leaseExpiresAt !== null && integer(intent.leaseExpiresAt) > now) {
        throw new PluginManagerStoreErrorV1(409, 'state_invalid');
      }
      const revision = integer(intent.revision) + 1;
      await repository.update({ id: intent.id, revision: intent.revision }, {
        state: 'cancelled', reasonCode: 'administrator_cancelled', revision,
        leaseOwner: null, leaseTokenHash: null, leaseExpiresAt: null,
        updatedAt: Date.parse(input.occurredAt),
      });
      return { revision };
    });
  }

  async retry(input: { installationId: string; expectedRevision: number; occurredAt: string }) {
    return runPluginTransactionV1(await this.dataSourceProvider(), async (manager) => {
      const repository = manager.getRepository(PluginInstallationIntent);
      const intent = await findPluginRowForUpdateV1(repository, { installationId: input.installationId });
      if (!intent) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
      if (integer(intent.revision) !== input.expectedRevision) throw new PluginManagerStoreErrorV1(409, 'revision_conflict');
      if (!['failed', 'manual_intervention'].includes(intent.state)) {
        throw new PluginManagerStoreErrorV1(409, 'state_invalid');
      }
      const now = this.now().getTime();
      if (intent.leaseExpiresAt !== null && integer(intent.leaseExpiresAt) > now) {
        throw new PluginManagerStoreErrorV1(409, 'state_invalid');
      }
      const active = await repository.findOne({
        where: { state: In([...activeMutationStates]) },
      });
      if (active && active.installationId !== input.installationId) {
        throw new PluginManagerStoreErrorV1(409, 'operation_in_progress');
      }
      await Promise.all([
        manager.getRepository(PluginInstallationApproval).delete({ installationId: input.installationId }),
        manager.getRepository(PluginInstallationReview).delete({ installationId: input.installationId }),
      ]);
      const revision = integer(intent.revision) + 1;
      await repository.update({ id: intent.id, revision: intent.revision }, {
        state: 'requested', reasonCode: 'none', revision,
        leaseOwner: null, leaseTokenHash: null, leaseExpiresAt: null,
        updatedAt: Date.parse(input.occurredAt),
      });
      return { revision };
    });
  }

  async advertiseCapability(capabilityInput: PluginManagerCapabilityV1) {
    const capability = pluginManagerCapabilityV1Schema.parse(capabilityInput);
    const source = await this.dataSourceProvider();
    const repository = source.getRepository(PluginManagerCapability);
    const existing = await repository.findOne({ where: { managerId: capability.managerId } });
    const values = {
      managerVersion: capability.managerVersion,
      state: capability.state,
      capabilityJson: JSON.stringify(capability),
      lastSeenAt: Date.parse(capability.observedAt),
    };
    if (existing) await repository.update({ id: existing.id }, values);
    else await repository.insert({ id: randomUUID(), managerId: capability.managerId, ...values });
  }

  async latestCapability(): Promise<PluginManagerCapabilityV1 | null> {
    const source = await this.dataSourceProvider();
    const record = await source.getRepository(PluginManagerCapability).findOne({
      order: { lastSeenAt: 'DESC', managerId: 'ASC' },
    });
    return record
      ? parseJson(record.capabilityJson, pluginManagerCapabilityV1Schema)
      : null;
  }

  async claim(input: {
    managerId: string;
    leaseDurationMs: number;
    occurredAt: string;
    currentPlatformRevision?: number;
  }) {
    const source = await this.dataSourceProvider();
    await this.ensureAdmission(source);
    const occurredAt = this.now().getTime();
    const candidates = await source.getRepository(PluginInstallationIntent).find({
      where: [
        { state: In([...claimableStates]), leaseExpiresAt: IsNull() },
        { state: In([...claimableStates]), leaseExpiresAt: LessThanOrEqual(occurredAt) },
      ],
      order: { createdAt: 'ASC', installationId: 'ASC' },
      take: 10,
    });
    for (const candidate of candidates) {
      const claim = await runPluginTransactionV1(source, async (manager) => {
        const admissions = manager.getRepository(PluginManagerAdmission);
        const admission = await findPluginRowForUpdateV1(admissions, {
          scope: deploymentAdmissionScope,
        });
        if (!admission) throw new Error('plugin_manager_admission_missing');
        if (
          admission.leaseExpiresAt !== null &&
          integer(admission.leaseExpiresAt) > occurredAt
        ) {
          return null;
        }
        const repository = manager.getRepository(PluginInstallationIntent);
        const record = await findPluginRowForUpdateV1(repository, { id: candidate.id });
        if (
          !record ||
          !claimableStates.includes(record.state as (typeof claimableStates)[number]) ||
          (record.leaseExpiresAt !== null && integer(record.leaseExpiresAt) > occurredAt)
        ) {
          return null;
        }
        if (
          input.currentPlatformRevision !== undefined &&
          integer(record.expectedPlatformRevision) !==
            input.currentPlatformRevision
        ) {
          await repository.update(
            { id: record.id, revision: record.revision },
            {
              state: 'failed',
              reasonCode: 'revision_conflict',
              revision: integer(record.revision) + 1,
              leaseOwner: null,
              leaseTokenHash: null,
              leaseExpiresAt: null,
              updatedAt: occurredAt,
            },
          );
          return null;
        }
        const capabilityRecord = await manager
          .getRepository(PluginManagerCapability)
          .findOne({ where: { managerId: input.managerId } });
        const capability = capabilityRecord
          ? parseJson(
              capabilityRecord.capabilityJson,
              pluginManagerCapabilityV1Schema,
            )
          : undefined;
        const parsedIntent = parseJson(
          record.intentJson,
          pluginInstallationIntentV1Schema,
        );
        if (
          !capability ||
          !capability.protocolVersions.includes('v1') ||
          !['ready', 'planner_only'].includes(capability.state) ||
          !capability.deploymentModes.includes(parsedIntent.deploymentMode) ||
          !capability.operations.includes(parsedIntent.operation)
        ) {
          await repository.update(
            { id: record.id, revision: record.revision },
            {
              state: 'failed',
              reasonCode: 'manager_incompatible',
              revision: integer(record.revision) + 1,
              leaseOwner: null,
              leaseTokenHash: null,
              leaseExpiresAt: null,
              updatedAt: occurredAt,
            },
          );
          return null;
        }
        const leaseToken = randomBytes(32).toString('base64url');
        const expiresAt = leaseExpiry(
          new Date(occurredAt).toISOString(),
          input.leaseDurationMs,
        );
        const revision = integer(record.revision);
        const reviewRecord = await manager
          .getRepository(PluginInstallationReview)
          .findOne({ where: { installationId: record.installationId } });
        await repository.update(
          { id: record.id, revision: record.revision },
          {
            leaseOwner: input.managerId,
            leaseTokenHash: hash(leaseToken),
            leaseExpiresAt: expiresAt,
            updatedAt: occurredAt,
          },
        );
        await admissions.update(
          { id: admission.id, revision: admission.revision },
          {
            installationId: record.installationId,
            managerId: input.managerId,
            leaseTokenHash: hash(leaseToken),
            leaseExpiresAt: expiresAt,
            revision: integer(admission.revision) + 1,
            updatedAt: occurredAt,
          },
        );
        return {
          intent: parsedIntent,
          leaseToken,
          revision,
          leaseExpiresAt: new Date(expiresAt).toISOString(),
          review: reviewRecord
            ? parseJson(reviewRecord.reviewJson, pluginInstallReviewV1Schema)
            : undefined,
        };
      });
      if (claim) return claim;
    }
    return null;
  }

  async renew(input: {
    installationId: string;
    leaseToken: string;
    expectedRevision: number;
    leaseDurationMs: number;
    occurredAt: string;
  }) {
    return runPluginTransactionV1(await this.dataSourceProvider(), async (manager) => {
      const admissions = manager.getRepository(PluginManagerAdmission);
      const admission = await findPluginRowForUpdateV1(admissions, {
        scope: deploymentAdmissionScope,
      });
      if (
        !admission ||
        admission.installationId !== input.installationId ||
        admission.leaseTokenHash !== hash(input.leaseToken)
      ) {
        throw new PluginManagerStoreErrorV1(409, 'lease_invalid');
      }
      const repository = manager.getRepository(PluginInstallationIntent);
      const record = await findPluginRowForUpdateV1(repository, {
        installationId: input.installationId,
      });
      if (!record) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
      const occurredAt = this.now().getTime();
      assertLease(record, input.leaseToken, occurredAt);
      if (integer(record.revision) !== input.expectedRevision) {
        throw new PluginManagerStoreErrorV1(409, 'revision_conflict');
      }
      const revision = integer(record.revision);
      const expiresAt = leaseExpiry(
        new Date(occurredAt).toISOString(),
        input.leaseDurationMs,
      );
      await repository.update(
        { id: record.id, revision: record.revision },
        { leaseExpiresAt: expiresAt },
      );
      await admissions.update(
        { id: admission.id, revision: admission.revision },
        {
          leaseExpiresAt: expiresAt,
          revision: integer(admission.revision) + 1,
          updatedAt: occurredAt,
        },
      );
      return { revision, leaseExpiresAt: new Date(expiresAt).toISOString() };
    });
  }

  async publishReview(input: {
    leaseToken: string;
    expectedRevision: number;
    review: PluginInstallReviewV1;
  }) {
    const review = pluginInstallReviewV1Schema.parse(input.review);
    return runPluginTransactionV1(await this.dataSourceProvider(), async (manager) => {
      const intents = manager.getRepository(PluginInstallationIntent);
      const intent = await findPluginRowForUpdateV1(intents, {
        installationId: review.installationId,
      });
      if (!intent) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
      const now = this.now().getTime();
      assertLease(intent, input.leaseToken, now);
      if (integer(intent.revision) !== input.expectedRevision) {
        throw new PluginManagerStoreErrorV1(409, 'revision_conflict');
      }
      if (intent.pluginId !== review.pluginId || intent.releaseDigest !== review.release) {
        throw new PluginManagerStoreErrorV1(409, 'state_invalid');
      }
      const reviews = manager.getRepository(PluginInstallationReview);
      const existing = await reviews.findOne({ where: { installationId: review.installationId } });
      const serializedReview = JSON.stringify(review);
      if (existing?.reviewJson === serializedReview) {
        const revision = integer(intent.revision);
        if (intent.state === 'awaiting_approval') {
          await intents.update(
            { id: intent.id, revision: intent.revision },
            {
              leaseOwner: null,
              leaseTokenHash: null,
              leaseExpiresAt: null,
            },
          );
          await this.releaseAdmission(manager, intent.installationId);
        }
        return {
          revision,
          leaseRetained: intent.state !== 'awaiting_approval',
        };
      }
      if (existing) {
        const approval = await manager
          .getRepository(PluginInstallationApproval)
          .findOne({ where: { installationId: review.installationId } });
        if (approval) {
          throw new PluginManagerStoreErrorV1(409, 'approval_conflict');
        }
      }
      const values = {
        pluginId: review.pluginId,
        version: review.version,
        releaseDigest: review.release,
        planSha256: review.planSha256,
        reviewSha256: review.reviewSha256,
        reviewJson: serializedReview,
        approvable: review.approvable,
        expiresAt: Date.parse(review.expiresAt),
        updatedAt: now,
      };
      if (existing) await reviews.update({ id: existing.id }, values);
      else {
        await reviews.insert({
          id: randomUUID(),
          installationId: review.installationId,
          createdAt: now,
          ...values,
        });
      }
      const revision = integer(intent.revision) + 1;
      await intents.update(
        { id: intent.id, revision: intent.revision },
        {
          state: 'awaiting_approval',
          reasonCode: review.approvable ? 'approval_required' : review.compatibility.reasonCode,
          revision,
          leaseOwner: review.approvable ? null : intent.leaseOwner,
          leaseTokenHash: review.approvable ? null : intent.leaseTokenHash,
          leaseExpiresAt: review.approvable ? null : intent.leaseExpiresAt,
          updatedAt: now,
        },
      );
      if (review.approvable) {
        await this.releaseAdmission(manager, intent.installationId);
      }
      return { revision, leaseRetained: !review.approvable };
    });
  }

  async readApproval(input: {
    installationId: string;
    reviewSha256: string;
    planSha256: string;
  }) {
    const source = await this.dataSourceProvider();
    const [intent, approval] = await Promise.all([
      source.getRepository(PluginInstallationIntent).findOne({
        where: { installationId: input.installationId },
      }),
      source.getRepository(PluginInstallationApproval).findOne({
        where: {
          installationId: input.installationId,
          reviewSha256: input.reviewSha256,
          planSha256: input.planSha256,
        },
      }),
    ]);
    if (!intent) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
    if (!approval) return null;
    return { approval: this.toApproval(approval), revision: integer(intent.revision) };
  }

  async publishObservation(input: {
    leaseToken: string;
    expectedRevision: number;
    observation: PluginInstallationObservationV1;
  }) {
    const observation = pluginInstallationObservationV1Schema.parse(input.observation);
    return runPluginTransactionV1(await this.dataSourceProvider(), async (manager) => {
      const intents = manager.getRepository(PluginInstallationIntent);
      const intent = await findPluginRowForUpdateV1(intents, {
        installationId: observation.installationId,
      });
      if (!intent) throw new PluginManagerStoreErrorV1(404, 'installation_not_found');
      const leaseCheckAt = this.now().getTime();
      const now = Date.parse(observation.occurredAt);
      assertLease(intent, input.leaseToken, leaseCheckAt);
      if (integer(intent.revision) !== input.expectedRevision) {
        throw new PluginManagerStoreErrorV1(409, 'revision_conflict');
      }
      if (intent.pluginId !== observation.pluginId) {
        throw new PluginManagerStoreErrorV1(409, 'state_invalid');
      }
      const revision = integer(intent.revision) + 1;
      const storedObservation = { ...observation, revision };
      await manager.getRepository(PluginInstallationObservation).insert({
        id: randomUUID(),
        installationId: observation.installationId,
        pluginId: observation.pluginId,
        revision,
        state: observation.state,
        reasonCode: observation.reasonCode,
        planSha256: observation.planSha256 ?? null,
        observationJson: JSON.stringify(storedObservation),
        occurredAt: now,
      });
      await intents.update(
        { id: intent.id, revision: intent.revision },
        {
          state: observation.state,
          reasonCode: observation.reasonCode,
          revision,
          leaseOwner: null,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      );
      await this.releaseAdmission(manager, intent.installationId);
      return { revision };
    });
  }

  private async summary(
    manager: EntityManager,
    intent: PluginInstallationIntent,
  ): Promise<PluginManagerInstallationSummaryV1> {
    const [review, approval, observations] = await Promise.all([
      manager.getRepository(PluginInstallationReview).findOne({
        where: { installationId: intent.installationId },
      }),
      manager.getRepository(PluginInstallationApproval).findOne({
        where: { installationId: intent.installationId },
      }),
      manager.getRepository(PluginInstallationObservation).find({
        where: { installationId: intent.installationId },
        order: { revision: 'DESC' },
        take: 1,
      }),
    ]);
    return {
      intent: parseJson(intent.intentJson, pluginInstallationIntentV1Schema),
      state: intent.state,
      reasonCode: intent.reasonCode,
      revision: integer(intent.revision),
      review: review ? parseJson(review.reviewJson, pluginInstallReviewV1Schema) : null,
      approval: approval ? this.toApproval(approval) : null,
      latestObservation: observations[0]
        ? parseJson(observations[0].observationJson, pluginInstallationObservationV1Schema)
        : null,
      updatedAt: new Date(integer(intent.updatedAt)).toISOString(),
    };
  }

  private toApproval(record: PluginInstallationApproval): PluginInstallApprovalV1 {
    return pluginInstallApprovalV1Schema.parse({
      apiVersion: 'install-approval.plugin.enterpriseglue.io/v1',
      kind: 'EnterpriseGluePluginInstallApproval',
      installationId: record.installationId,
      decision: record.decision,
      reviewSha256: record.reviewSha256,
      planSha256: record.planSha256,
      approverRef: record.approverRef,
      expectedRevision: integer(record.expectedRevision),
      decidedAt: new Date(integer(record.decidedAt)).toISOString(),
      expiresAt: new Date(integer(record.expiresAt)).toISOString(),
    });
  }

  private async ensureAdmission(source: DataSource): Promise<void> {
    const repository = source.getRepository(PluginManagerAdmission);
    if (await repository.findOne({ where: { scope: deploymentAdmissionScope } })) {
      return;
    }
    try {
      await repository.insert({
        id: randomUUID(),
        scope: deploymentAdmissionScope,
        installationId: null,
        managerId: null,
        leaseTokenHash: null,
        leaseExpiresAt: null,
        revision: 0,
        updatedAt: this.now().getTime(),
      });
    } catch (error) {
      if (
        !(await repository.findOne({
          where: { scope: deploymentAdmissionScope },
        }))
      ) {
        throw error;
      }
    }
  }

  private async releaseAdmission(
    manager: EntityManager,
    installationId: string,
  ): Promise<void> {
    const repository = manager.getRepository(PluginManagerAdmission);
    const admission = await findPluginRowForUpdateV1(repository, {
      scope: deploymentAdmissionScope,
    });
    if (!admission || admission.installationId !== installationId) {
      throw new PluginManagerStoreErrorV1(409, 'lease_invalid');
    }
    await repository.update(
      { id: admission.id, revision: admission.revision },
      {
        installationId: null,
        managerId: null,
        leaseTokenHash: null,
        leaseExpiresAt: null,
        revision: integer(admission.revision) + 1,
        updatedAt: this.now().getTime(),
      },
    );
  }
}
