import { randomUUID } from 'node:crypto';

import {
  pluginContributionAvailabilityProjectionV1Schema,
  type PluginContributionAvailabilityProjectionV1,
  type PluginId,
} from '@enterpriseglue/plugin-sdk';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PluginContributionAvailabilityState } from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import { LessThanOrEqual, type DataSource } from 'typeorm';

export interface PluginContributionAvailabilityTargetV1 {
  deploymentRef: string;
  tenantRef: string;
  pluginId: PluginId;
  pluginVersion: string;
  installerRevision: number;
  refreshIntervalSeconds: number;
  maximumStalenessSeconds: number;
}

export interface ClaimedPluginContributionAvailabilityV1
  extends PluginContributionAvailabilityTargetV1 {
  stateId: string;
  stateRevision: number;
  workerRef: string;
  consecutiveFailures: number;
}

export interface PluginContributionAvailabilityStoreV1 {
  reconcileTargets(
    targets: readonly PluginContributionAvailabilityTargetV1[],
    now: number,
  ): Promise<void>;
  claimDue(input: {
    workerRef: string;
    now: number;
    leaseMs: number;
    limit: number;
  }): Promise<ClaimedPluginContributionAvailabilityV1[]>;
  completeSuccess(
    claim: ClaimedPluginContributionAvailabilityV1,
    projection: PluginContributionAvailabilityProjectionV1,
    nextRefreshAt: number,
    now: number,
  ): Promise<boolean>;
  completeFailure(
    claim: ClaimedPluginContributionAvailabilityV1,
    reasonCode: string,
    nextRefreshAt: number,
    now: number,
  ): Promise<boolean>;
  readCurrent(input: {
    deploymentRef: string;
    tenantRef: string;
    pluginId: PluginId;
    pluginVersion: string;
    installerRevision: number;
    now: number;
  }): Promise<PluginContributionAvailabilityProjectionV1 | null>;
}

interface MemoryState extends PluginContributionAvailabilityTargetV1 {
  stateId: string;
  stateRevision: number;
  projection: PluginContributionAvailabilityProjectionV1 | null;
  nextRefreshAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  reasonCode: string;
  consecutiveFailures: number;
}

export class MemoryPluginContributionAvailabilityStoreV1
implements PluginContributionAvailabilityStoreV1 {
  private readonly states = new Map<string, MemoryState>();

  async reconcileTargets(
    targets: readonly PluginContributionAvailabilityTargetV1[],
    now: number,
  ): Promise<void> {
    for (const target of targets) {
      const key = targetKey(target);
      const existing = this.states.get(key);
      if (!existing) {
        this.states.set(key, {
          ...target,
          stateId: randomUUID(),
          stateRevision: 0,
          projection: null,
          nextRefreshAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          reasonCode: 'never_refreshed',
          consecutiveFailures: 0,
        });
      } else if (
        existing.pluginVersion !== target.pluginVersion ||
        existing.installerRevision !== target.installerRevision
      ) {
        this.states.set(key, {
          ...target,
          stateId: existing.stateId,
          stateRevision: existing.stateRevision + 1,
          projection: null,
          nextRefreshAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          reasonCode: 'source_changed',
          consecutiveFailures: 0,
        });
      } else {
        existing.refreshIntervalSeconds = target.refreshIntervalSeconds;
        existing.maximumStalenessSeconds = target.maximumStalenessSeconds;
      }
    }
  }

  async claimDue(input: {
    workerRef: string;
    now: number;
    leaseMs: number;
    limit: number;
  }): Promise<ClaimedPluginContributionAvailabilityV1[]> {
    const result: ClaimedPluginContributionAvailabilityV1[] = [];
    for (const state of [...this.states.values()].sort(
      (left, right) =>
        left.nextRefreshAt - right.nextRefreshAt ||
        left.pluginId.localeCompare(right.pluginId) ||
        left.tenantRef.localeCompare(right.tenantRef),
    )) {
      if (
        result.length >= input.limit ||
        state.nextRefreshAt > input.now ||
        (state.leaseExpiresAt !== null && state.leaseExpiresAt > input.now)
      ) {
        continue;
      }
      state.leaseOwner = input.workerRef;
      state.leaseExpiresAt = input.now + input.leaseMs;
      state.stateRevision += 1;
      result.push(toClaim(state, input.workerRef));
    }
    return result;
  }

  async completeSuccess(
    claim: ClaimedPluginContributionAvailabilityV1,
    projection: PluginContributionAvailabilityProjectionV1,
    nextRefreshAt: number,
    _now: number,
  ): Promise<boolean> {
    const state = this.states.get(targetKey(claim));
    if (!matchesClaim(state, claim)) return false;
    state.projection = structuredClone(
      pluginContributionAvailabilityProjectionV1Schema.parse(projection),
    );
    state.nextRefreshAt = nextRefreshAt;
    state.leaseOwner = null;
    state.leaseExpiresAt = null;
    state.reasonCode = 'current';
    state.consecutiveFailures = 0;
    state.stateRevision += 1;
    return true;
  }

  async completeFailure(
    claim: ClaimedPluginContributionAvailabilityV1,
    reasonCode: string,
    nextRefreshAt: number,
    _now: number,
  ): Promise<boolean> {
    const state = this.states.get(targetKey(claim));
    if (!matchesClaim(state, claim)) return false;
    state.nextRefreshAt = nextRefreshAt;
    state.leaseOwner = null;
    state.leaseExpiresAt = null;
    state.reasonCode = safeReason(reasonCode);
    state.consecutiveFailures += 1;
    state.stateRevision += 1;
    return true;
  }

  async readCurrent(input: {
    deploymentRef: string;
    tenantRef: string;
    pluginId: PluginId;
    pluginVersion: string;
    installerRevision: number;
    now: number;
  }): Promise<PluginContributionAvailabilityProjectionV1 | null> {
    const state = this.states.get(targetKey(input));
    if (
      !state?.projection ||
      state.pluginVersion !== input.pluginVersion ||
      state.installerRevision !== input.installerRevision ||
      Date.parse(state.projection.validUntil) <= input.now
    ) {
      return null;
    }
    return structuredClone(state.projection);
  }
}

export class DatabasePluginContributionAvailabilityStoreV1
implements PluginContributionAvailabilityStoreV1 {
  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> =
      getDataSource,
  ) {}

  async reconcileTargets(
    targets: readonly PluginContributionAvailabilityTargetV1[],
    now: number,
  ): Promise<void> {
    const repository = (
      await this.dataSourceProvider()
    ).getRepository(PluginContributionAvailabilityState);
    for (const target of targets) {
      const where = {
        deploymentRef: target.deploymentRef,
        tenantRef: target.tenantRef,
        pluginId: target.pluginId,
      };
      const existing = await repository.findOne({ where });
      if (!existing) {
        try {
          await repository.insert({
            id: randomUUID(),
            ...target,
            projectionJson: null,
            evaluatedAt: null,
            validUntil: null,
            nextRefreshAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            reasonCode: 'never_refreshed',
            consecutiveFailures: 0,
            revision: 0,
            createdAt: now,
            updatedAt: now,
          });
        } catch {
          // Another replica may have inserted the same target.
          if (!(await repository.findOne({ where }))) throw new Error(
            'plugin_contribution_availability_reconcile_failed',
          );
        }
        continue;
      }
      if (
        existing.pluginVersion !== target.pluginVersion ||
        integer(existing.installerRevision) !== target.installerRevision
      ) {
        await repository.update(
          { id: existing.id, revision: existing.revision },
          {
            pluginVersion: target.pluginVersion,
            installerRevision: target.installerRevision,
            projectionJson: null,
            evaluatedAt: null,
            validUntil: null,
            nextRefreshAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
            reasonCode: 'source_changed',
            consecutiveFailures: 0,
            revision: integer(existing.revision) + 1,
            updatedAt: now,
          },
        );
      } else if (
        existing.refreshIntervalSeconds !== target.refreshIntervalSeconds ||
        existing.maximumStalenessSeconds !== target.maximumStalenessSeconds
      ) {
        await repository.update(
          { id: existing.id, revision: existing.revision },
          {
            refreshIntervalSeconds: target.refreshIntervalSeconds,
            maximumStalenessSeconds: target.maximumStalenessSeconds,
            revision: integer(existing.revision) + 1,
            updatedAt: now,
          },
        );
      }
    }
  }

  async claimDue(input: {
    workerRef: string;
    now: number;
    leaseMs: number;
    limit: number;
  }): Promise<ClaimedPluginContributionAvailabilityV1[]> {
    const repository = (
      await this.dataSourceProvider()
    ).getRepository(PluginContributionAvailabilityState);
    const candidates = await repository.find({
      where: { nextRefreshAt: LessThanOrEqual(input.now) },
      order: { nextRefreshAt: 'ASC', pluginId: 'ASC', tenantRef: 'ASC' },
      take: Math.min(input.limit * 4, 400),
    });
    const claims: ClaimedPluginContributionAvailabilityV1[] = [];
    for (const candidate of candidates) {
      if (
        claims.length >= input.limit ||
        (candidate.leaseExpiresAt !== null &&
          integer(candidate.leaseExpiresAt) > input.now)
      ) {
        continue;
      }
      const revision = integer(candidate.revision);
      const updated = await repository.update(
        { id: candidate.id, revision },
        {
          leaseOwner: input.workerRef,
          leaseExpiresAt: input.now + input.leaseMs,
          revision: revision + 1,
          updatedAt: input.now,
        },
      );
      if (updated.affected !== 1) continue;
      claims.push({
        stateId: candidate.id,
        stateRevision: revision + 1,
        workerRef: input.workerRef,
        deploymentRef: candidate.deploymentRef,
        tenantRef: candidate.tenantRef,
        pluginId: candidate.pluginId as PluginId,
        pluginVersion: candidate.pluginVersion,
        installerRevision: integer(candidate.installerRevision),
        refreshIntervalSeconds: candidate.refreshIntervalSeconds,
        maximumStalenessSeconds: candidate.maximumStalenessSeconds,
        consecutiveFailures: candidate.consecutiveFailures,
      });
    }
    return claims;
  }

  async completeSuccess(
    claim: ClaimedPluginContributionAvailabilityV1,
    projection: PluginContributionAvailabilityProjectionV1,
    nextRefreshAt: number,
    now: number,
  ): Promise<boolean> {
    const parsed =
      pluginContributionAvailabilityProjectionV1Schema.parse(projection);
    const updated = await (
      await this.dataSourceProvider()
    ).getRepository(PluginContributionAvailabilityState).update(
      {
        id: claim.stateId,
        revision: claim.stateRevision,
        leaseOwner: claim.workerRef,
      },
      {
        projectionJson: JSON.stringify(parsed),
        evaluatedAt: Date.parse(parsed.evaluatedAt),
        validUntil: Date.parse(parsed.validUntil),
        nextRefreshAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        reasonCode: 'current',
        consecutiveFailures: 0,
        revision: claim.stateRevision + 1,
        updatedAt: now,
      },
    );
    return updated.affected === 1;
  }

  async completeFailure(
    claim: ClaimedPluginContributionAvailabilityV1,
    reasonCode: string,
    nextRefreshAt: number,
    now: number,
  ): Promise<boolean> {
    const updated = await (
      await this.dataSourceProvider()
    ).getRepository(PluginContributionAvailabilityState).update(
      {
        id: claim.stateId,
        revision: claim.stateRevision,
        leaseOwner: claim.workerRef,
      },
      {
        nextRefreshAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        reasonCode: safeReason(reasonCode),
        consecutiveFailures: claim.consecutiveFailures + 1,
        revision: claim.stateRevision + 1,
        updatedAt: now,
      },
    );
    return updated.affected === 1;
  }

  async readCurrent(input: {
    deploymentRef: string;
    tenantRef: string;
    pluginId: PluginId;
    pluginVersion: string;
    installerRevision: number;
    now: number;
  }): Promise<PluginContributionAvailabilityProjectionV1 | null> {
    const record = await (
      await this.dataSourceProvider()
    ).getRepository(PluginContributionAvailabilityState).findOne({
      where: {
        deploymentRef: input.deploymentRef,
        tenantRef: input.tenantRef,
        pluginId: input.pluginId,
      },
    });
    if (
      !record?.projectionJson ||
      record.pluginVersion !== input.pluginVersion ||
      integer(record.installerRevision) !== input.installerRevision ||
      record.validUntil === null ||
      integer(record.validUntil) <= input.now
    ) {
      return null;
    }
    try {
      return pluginContributionAvailabilityProjectionV1Schema.parse(
        JSON.parse(record.projectionJson),
      );
    } catch {
      return null;
    }
  }
}

function targetKey(input: {
  deploymentRef: string;
  tenantRef: string;
  pluginId: string;
}): string {
  return `${input.deploymentRef}\0${input.tenantRef}\0${input.pluginId}`;
}

function toClaim(
  state: MemoryState,
  workerRef: string,
): ClaimedPluginContributionAvailabilityV1 {
  return {
    deploymentRef: state.deploymentRef,
    tenantRef: state.tenantRef,
    pluginId: state.pluginId,
    pluginVersion: state.pluginVersion,
    installerRevision: state.installerRevision,
    refreshIntervalSeconds: state.refreshIntervalSeconds,
    maximumStalenessSeconds: state.maximumStalenessSeconds,
    stateId: state.stateId,
    stateRevision: state.stateRevision,
    workerRef,
    consecutiveFailures: state.consecutiveFailures,
  };
}

function matchesClaim(
  state: MemoryState | undefined,
  claim: ClaimedPluginContributionAvailabilityV1,
): state is MemoryState {
  return Boolean(
    state &&
      state.stateId === claim.stateId &&
      state.stateRevision === claim.stateRevision &&
      state.leaseOwner === claim.workerRef,
  );
}

function integer(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('plugin_contribution_availability_integer_invalid');
  }
  return parsed;
}

function safeReason(value: string): string {
  return /^[a-z][a-z0-9_]{0,99}$/.test(value)
    ? value
    : 'refresh_failed';
}
