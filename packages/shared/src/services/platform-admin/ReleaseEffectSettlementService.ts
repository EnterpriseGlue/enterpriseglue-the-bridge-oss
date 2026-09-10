import { createHash, randomUUID } from 'node:crypto';

import { config } from '@enterpriseglue/shared/config/index.js';
import {
  RELEASE_EFFECT_INVENTORY_VERSION,
  RELEASE_EFFECT_SOURCES_V1,
  type ReleaseEffectSourceV1,
} from '@enterpriseglue/shared/contracts/release-effect-inventory.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginEventDelivery,
  PluginScheduledJob,
  ReleaseEffectCohort,
  TenantReleaseWorkAssignment,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type { DataSource, EntityManager } from 'typeorm';

const EVENT_UNRESOLVED = ['pending', 'delivering', 'retry_wait'] as const;
const SCHEDULE_UNRESOLVED = ['scheduled', 'delivering', 'retry_wait'] as const;
export const SIGNED_CANDIDATE_RECEIPT_RELEASE_ID = /^sha256:[a-f0-9]{64}$/;

export function assertSignedCandidateReceiptReleaseId(releaseId: string): void {
  if (!SIGNED_CANDIDATE_RECEIPT_RELEASE_ID.test(releaseId)) {
    throw new Error('Managed release identity does not match the sha256 digest of the verified signed candidate receipt');
  }
}

export interface ReleaseEffectSourceStatusV1 extends ReleaseEffectSourceV1 {
  readonly outstanding: number | null;
  readonly reasonCode: 'settled' | 'outstanding' | 'uncovered' | 'observation_only';
}

export interface ReleaseEffectSettlementStatusV1 {
  readonly schemaVersion: 'release-effect-settlement.enterpriseglue.io/v1';
  readonly releaseId: string;
  readonly cohortEpoch: number;
  readonly state: 'open' | 'closing' | 'settled';
  readonly revision: number;
  readonly inventoryVersion: string;
  readonly configuredInventoryVersion: typeof RELEASE_EFFECT_INVENTORY_VERSION;
  readonly inventorySha256: string;
  readonly configuredInventorySha256: string;
  readonly inventoryComplete: boolean;
  readonly releaseAssignmentsOutstanding: number;
  readonly coveredSourcesSettled: boolean;
  readonly settled: boolean;
  readonly eligibleForShutdown: boolean;
  readonly openedAt: number;
  readonly closedAt: number | null;
  readonly settledAt: number | null;
  readonly updatedAt: number;
  readonly sources: readonly ReleaseEffectSourceStatusV1[];
}

export interface ReleaseEffectRuntimeBindingV1 {
  releaseId?: string;
  cohortEpoch?: number;
  managedPooledCloud?: boolean;
}

export interface ReleaseEffectProducerAdmissionV1 {
  sourceId: string;
  releaseId: string | null;
}

export class ReleaseEffectAdmissionError extends Error {
  constructor(readonly code:
    | 'release_effect_admission_source_uncovered'
    | 'release_effect_admission_release_mismatch'
    | 'release_effect_admission_not_configured'
    | 'release_effect_admission_closed') {
    super(code);
    this.name = 'ReleaseEffectAdmissionError';
  }
}

type RuntimeBindingProvider = () => ReleaseEffectRuntimeBindingV1;
type ReleaseEffectCohortRecord = Pick<ReleaseEffectCohort,
  'id' | 'releaseId' | 'cohortEpoch' | 'state' | 'revision' |
  'inventoryVersion' | 'inventorySha256' | 'openedAt' | 'closedAt' |
  'settledAt' | 'updatedAt'>;

export function releaseEffectInventorySha256(
  sources: readonly ReleaseEffectSourceV1[] = RELEASE_EFFECT_SOURCES_V1,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ version: RELEASE_EFFECT_INVENTORY_VERSION, sources }), 'utf8')
    .digest('hex');
}

export function configuredReleaseEffectRuntimeBinding(): ReleaseEffectRuntimeBindingV1 {
  if (config.tenancyMode === 'pooled' && config.tenancyCloudRequired && config.tenantPlacementReleaseId) {
    assertSignedCandidateReceiptReleaseId(config.tenantPlacementReleaseId);
  }
  return {
    releaseId: config.tenantPlacementReleaseId,
    cohortEpoch: config.tenantReleaseEffectCohortEpoch,
    managedPooledCloud: config.tenancyMode === 'pooled' && config.tenancyCloudRequired,
  };
}

/**
 * Transactional admission fence used by every covered durable producer.
 *
 * The same-value conditional update is deliberate. It takes the database row
 * write fence without dialect-specific SELECT FOR UPDATE syntax. A concurrent
 * close either waits for this transaction or wins first and makes admission
 * fail. Missing configuration preserves self-host compatibility but can never
 * produce shutdown eligibility.
 */
export async function assertReleaseEffectAdmission(
  manager: EntityManager,
  input: ReleaseEffectProducerAdmissionV1,
  runtime: ReleaseEffectRuntimeBindingV1 = configuredReleaseEffectRuntimeBinding(),
): Promise<void> {
  if (runtime.managedPooledCloud && runtime.releaseId) {
    assertSignedCandidateReceiptReleaseId(runtime.releaseId);
  }
  if (!runtime.cohortEpoch) {
    if (runtime.releaseId && runtime.managedPooledCloud) {
      throw new ReleaseEffectAdmissionError('release_effect_admission_not_configured');
    }
    return;
  }
  const source = RELEASE_EFFECT_SOURCES_V1.find((candidate) => candidate.sourceId === input.sourceId);
  if (!source || source.coverage !== 'authoritative' || !source.settlementRequired) {
    throw new ReleaseEffectAdmissionError('release_effect_admission_source_uncovered');
  }
  if (!runtime.releaseId || input.releaseId !== runtime.releaseId) {
    throw new ReleaseEffectAdmissionError('release_effect_admission_release_mismatch');
  }
  const repository = manager.getRepository(ReleaseEffectCohort);
  const current = await repository.findOneBy({ releaseId: input.releaseId });
  const inventorySha256 = releaseEffectInventorySha256();
  if (
    !current ||
    Number(current.cohortEpoch) !== runtime.cohortEpoch ||
    current.state !== 'open' ||
    current.inventoryVersion !== RELEASE_EFFECT_INVENTORY_VERSION ||
    current.inventorySha256 !== inventorySha256
  ) {
    throw new ReleaseEffectAdmissionError('release_effect_admission_closed');
  }
  const fenced = await repository.update(
    {
      id: current.id,
      releaseId: input.releaseId,
      cohortEpoch: runtime.cohortEpoch,
      state: 'open',
      revision: current.revision,
      inventorySha256,
    },
    { updatedAt: current.updatedAt },
  );
  if (fenced.affected !== 1) {
    throw new ReleaseEffectAdmissionError('release_effect_admission_closed');
  }
}

export class ReleaseEffectSettlementService {
  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> = getDataSource,
    private readonly runtimeBinding: RuntimeBindingProvider = configuredReleaseEffectRuntimeBinding,
    private readonly sources: readonly ReleaseEffectSourceV1[] = RELEASE_EFFECT_SOURCES_V1,
    private readonly clock: () => number = Date.now,
  ) {}

  async open(input: {
    releaseId: string;
    cohortEpoch: number;
    expectedRevision: number;
  }): Promise<ReleaseEffectSettlementStatusV1> {
    this.assertRuntimeBinding(input.releaseId, input.cohortEpoch);
    if (input.expectedRevision !== 0) {
      throw Errors.conflict('A new release effect cohort must start at revision zero');
    }
    const source = await this.dataSourceProvider();
    const now = this.clock();
    try {
      await source.getRepository(ReleaseEffectCohort).insert({
        id: randomUUID(),
        releaseId: input.releaseId,
        cohortEpoch: input.cohortEpoch,
        state: 'open',
        revision: 1,
        inventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
        inventorySha256: releaseEffectInventorySha256(this.sources),
        openedAt: now,
        closedAt: null,
        settledAt: null,
        updatedAt: now,
      });
    } catch (error) {
      const existing = await source.getRepository(ReleaseEffectCohort).findOneBy({
        releaseId: input.releaseId,
      });
      if (!existing) throw error;
      if (Number(existing.cohortEpoch) !== input.cohortEpoch) {
        throw Errors.conflict('Release effect cohort epoch is immutable for this release');
      }
    }
    return this.status(input);
  }

  async close(input: {
    releaseId: string;
    cohortEpoch: number;
    expectedRevision: number;
  }): Promise<ReleaseEffectSettlementStatusV1> {
    this.assertRuntimeBinding(input.releaseId, input.cohortEpoch);
    const source = await this.dataSourceProvider();
    const current = await this.requireCohort(source.manager, input);
    if (current.state === 'closing' || current.state === 'settled') {
      if (![input.expectedRevision, input.expectedRevision + 1].includes(Number(current.revision))) {
        throw Errors.conflict('Release effect cohort revision is stale');
      }
      return this.status(input);
    }
    const now = this.clock();
    const updated = await source.getRepository(ReleaseEffectCohort).update(
      { id: current.id, state: 'open', revision: input.expectedRevision },
      { state: 'closing', revision: input.expectedRevision + 1, closedAt: now, updatedAt: now },
    );
    if (updated.affected !== 1) throw Errors.conflict('Release effect cohort revision is stale');
    return this.status(input);
  }

  async status(input: {
    releaseId: string;
    cohortEpoch: number;
  }): Promise<ReleaseEffectSettlementStatusV1> {
    this.assertRuntimeBinding(input.releaseId, input.cohortEpoch);
    const source = await this.dataSourceProvider();
    const current = await this.requireCohort(source.manager, input);
    return this.snapshot(source.manager, current);
  }

  async verify(input: {
    releaseId: string;
    cohortEpoch: number;
    expectedRevision: number;
  }): Promise<ReleaseEffectSettlementStatusV1> {
    this.assertRuntimeBinding(input.releaseId, input.cohortEpoch);
    const source = await this.dataSourceProvider();
    return source.transaction(async (manager) => {
      const current = await this.requireCohort(manager, input);
      const currentRevision = Number(current.revision);
      if (current.state === 'settled' && currentRevision === input.expectedRevision + 1) {
        return this.snapshot(manager, current);
      }
      if (currentRevision !== input.expectedRevision) {
        throw Errors.conflict('Release effect cohort revision is stale');
      }
      const snapshot = await this.snapshot(manager, current);
      const settlementReady = current.state !== 'open'
        && snapshot.inventoryVersion === snapshot.configuredInventoryVersion
        && snapshot.inventorySha256 === snapshot.configuredInventorySha256
        && snapshot.inventoryComplete
        && snapshot.coveredSourcesSettled;
      if (current.state === 'settled' || !settlementReady) return snapshot;
      if (current.state !== 'closing') {
        throw Errors.conflict('Release effect cohort admission must be closed before verification');
      }
      const now = this.clock();
      const updated = await manager.getRepository(ReleaseEffectCohort).update(
        { id: current.id, state: 'closing', revision: input.expectedRevision },
        { state: 'settled', revision: input.expectedRevision + 1, settledAt: now, updatedAt: now },
      );
      if (updated.affected !== 1) throw Errors.conflict('Release effect cohort revision is stale');
      return this.snapshot(manager, {
        ...current,
        state: 'settled',
        revision: input.expectedRevision + 1,
        settledAt: now,
        updatedAt: now,
      });
    });
  }

  private assertRuntimeBinding(releaseId: string, cohortEpoch: number): void {
    const runtime = this.runtimeBinding();
    if (runtime.managedPooledCloud) assertSignedCandidateReceiptReleaseId(releaseId);
    if (!runtime.releaseId || !runtime.cohortEpoch) {
      throw Errors.serviceUnavailable('Release effect cohort tracking is not configured');
    }
    if (runtime.releaseId !== releaseId || runtime.cohortEpoch !== cohortEpoch) {
      throw Errors.conflict('Release effect cohort does not match this runtime');
    }
  }

  private async requireCohort(
    manager: EntityManager,
    input: { releaseId: string; cohortEpoch: number },
  ): Promise<ReleaseEffectCohort> {
    const current = await manager.getRepository(ReleaseEffectCohort).findOneBy({
      releaseId: input.releaseId,
    });
    if (!current || Number(current.cohortEpoch) !== input.cohortEpoch) {
      throw Errors.notFound('Release effect cohort');
    }
    return current;
  }

  private async snapshot(
    manager: EntityManager,
    cohort: ReleaseEffectCohortRecord,
  ): Promise<ReleaseEffectSettlementStatusV1> {
    const events = await manager.getRepository(PluginEventDelivery).createQueryBuilder('effect_event')
        .where('effect_event.releaseId = :releaseId', { releaseId: cohort.releaseId })
        .andWhere('effect_event.status IN (:...statuses)', { statuses: EVENT_UNRESOLVED })
        .getCount();
    const schedules = await manager.getRepository(PluginScheduledJob).createQueryBuilder('effect_schedule')
        .where('effect_schedule.releaseId = :releaseId', { releaseId: cohort.releaseId })
        .andWhere('effect_schedule.status IN (:...statuses)', { statuses: SCHEDULE_UNRESOLVED })
        .getCount();
    const assignments = await manager.getRepository(TenantReleaseWorkAssignment)
      .count({ where: { releaseId: cohort.releaseId } });
    const counts = new Map<string, number>([
      ['tenant_release_assignment', assignments],
      ['plugin_event_delivery', events],
      ['plugin_schedule_delivery', schedules],
    ]);
    const sources = this.sources.map((source): ReleaseEffectSourceStatusV1 => {
      if (source.coverage === 'uncovered') {
        return { ...source, outstanding: null, reasonCode: 'uncovered' };
      }
      if (source.coverage === 'observation_only') {
        return { ...source, outstanding: null, reasonCode: 'observation_only' };
      }
      const outstanding = counts.get(source.sourceId);
      if (outstanding === undefined) {
        return { ...source, coverage: 'uncovered', outstanding: null, reasonCode: 'uncovered' };
      }
      return { ...source, outstanding, reasonCode: outstanding === 0 ? 'settled' : 'outstanding' };
    });
    const configuredInventorySha256 = releaseEffectInventorySha256(this.sources);
    const inventoryComplete = sources.every(
      (source) => !source.settlementRequired || source.coverage === 'authoritative',
    );
    const coveredSourcesSettled = sources.every(
      (source) => source.coverage !== 'authoritative' || source.outstanding === 0,
    ) && assignments === 0;
    const proofReady = cohort.state !== 'open'
      && cohort.inventoryVersion === RELEASE_EFFECT_INVENTORY_VERSION
      && cohort.inventorySha256 === configuredInventorySha256
      && inventoryComplete
      && coveredSourcesSettled;
    return {
      schemaVersion: 'release-effect-settlement.enterpriseglue.io/v1',
      releaseId: cohort.releaseId,
      cohortEpoch: Number(cohort.cohortEpoch),
      state: cohort.state,
      revision: Number(cohort.revision),
      inventoryVersion: cohort.inventoryVersion,
      configuredInventoryVersion: RELEASE_EFFECT_INVENTORY_VERSION,
      inventorySha256: cohort.inventorySha256,
      configuredInventorySha256,
      inventoryComplete,
      releaseAssignmentsOutstanding: assignments,
      coveredSourcesSettled,
      settled: cohort.state === 'settled' && proofReady,
      eligibleForShutdown: cohort.state === 'settled' && proofReady,
      openedAt: Number(cohort.openedAt),
      closedAt: cohort.closedAt === null ? null : Number(cohort.closedAt),
      settledAt: cohort.settledAt === null ? null : Number(cohort.settledAt),
      updatedAt: Number(cohort.updatedAt),
      sources,
    };
  }
}

export const releaseEffectSettlementService = new ReleaseEffectSettlementService();
