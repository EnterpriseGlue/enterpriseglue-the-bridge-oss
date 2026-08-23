import { createHash, randomUUID } from 'node:crypto';

import type {
  PluginGatewayAdmissionInputV1,
  PluginGatewayAdmissionLeaseV1,
  PluginGatewayAdmissionPolicyV1,
  PluginGatewayAdmissionV1,
} from '@enterpriseglue/plugin-runtime/gateway';
import { PluginGatewayError } from '@enterpriseglue/plugin-runtime/gateway';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import {
  PluginGatewayAdmissionState,
  PluginGatewayConcurrencyLease,
  PluginGatewaySubjectBucket,
} from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import type { DataSource, EntityManager } from 'typeorm';

import { findPluginRowForUpdateV1 } from './pluginDatabaseLock.js';
import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';

const MIN_LEASE_TTL_MS = 1_000;
const MAX_LEASE_TTL_MS = 10 * 60_000;
const DEFAULT_LEASE_TTL_MS = 60_000;
const MAX_ACQUIRE_ATTEMPTS = 3;

/**
 * Deployment-wide plugin gateway admission backed by the EnterpriseGlue
 * database.
 *
 * One plugin state row is the transaction mutex for all of that plugin's rate
 * and concurrency mutations. Subject and tenant references are never stored;
 * only a one-way bucket hash is durable. Concurrency is represented by
 * expiring leases so a crashed host cannot hold capacity indefinitely.
 */
export class DatabasePluginGatewayAdmissionV1
implements PluginGatewayAdmissionV1 {
  private readonly policy: Required<PluginGatewayAdmissionPolicyV1>;

  constructor(
    policy: PluginGatewayAdmissionPolicyV1,
    private readonly dataSourceProvider: () => Promise<DataSource> =
      getDataSource,
  ) {
    for (const [name, value] of Object.entries(policy)) {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value <= 0)
      ) {
        throw new Error(`Plugin gateway admission ${name} must be positive`);
      }
    }
    this.policy = {
      ...policy,
      maxTrackedBuckets: policy.maxTrackedBuckets ?? 100_000,
    };
  }

  async acquire(
    input: PluginGatewayAdmissionInputV1,
  ): Promise<PluginGatewayAdmissionLeaseV1> {
    const now = input.nowMs ?? Date.now();
    const leaseTtlMs = input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(leaseTtlMs) ||
      leaseTtlMs < MIN_LEASE_TTL_MS ||
      leaseTtlMs > MAX_LEASE_TTL_MS ||
      !/^[A-Za-z0-9._:-]{1,256}$/.test(input.operationId) ||
      !/^[^\u0000]{1,512}$/.test(input.subjectRef) ||
      (input.tenantRef !== undefined &&
        !/^[^\u0000]{1,512}$/.test(input.tenantRef))
    ) {
      throw new PluginGatewayError(
        'admission_unavailable',
        'Plugin gateway admission input is invalid',
      );
    }

    const dataSource = await this.dataSourceProvider().catch(() => {
      throw new PluginGatewayError(
        'admission_unavailable',
        'Plugin gateway admission store is unavailable',
      );
    });
    for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
      try {
        const leaseId = await runPluginTransactionV1(dataSource, (manager) =>
          this.acquireInTransaction(manager, input, now, leaseTtlMs),
        );
        let released = false;
        return Object.freeze({
          release: async (): Promise<void> => {
            if (released) return;
            released = true;
            try {
              await (await this.dataSourceProvider())
                .getRepository(PluginGatewayConcurrencyLease)
                .delete({ leaseId });
            } catch {
              // The bounded lease expires automatically after a host or
              // database interruption; release must not corrupt a response
              // that the sidecar already completed.
            }
          },
        });
      } catch (error) {
        if (error instanceof PluginGatewayError) throw error;
        if (attempt === MAX_ACQUIRE_ATTEMPTS) {
          throw new PluginGatewayError(
            'admission_unavailable',
            'Plugin gateway admission store is unavailable',
          );
        }
      }
    }
    throw new PluginGatewayError(
      'admission_unavailable',
      'Plugin gateway admission store is unavailable',
    );
  }

  private async acquireInTransaction(
    manager: EntityManager,
    input: PluginGatewayAdmissionInputV1,
    now: number,
    leaseTtlMs: number,
  ): Promise<string> {
    const stateRepository = manager.getRepository(
      PluginGatewayAdmissionState,
    );
    let state = await findPluginRowForUpdateV1(stateRepository, {
      pluginId: input.pluginId,
    });
    const windowStartedAt =
      Math.floor(now / this.policy.windowMs) * this.policy.windowMs;
    if (!state) {
      await stateRepository.insert({
        id: randomUUID(),
        pluginId: input.pluginId,
        windowStartedAt,
        requestCount: 0,
        updatedAt: now,
      });
      state = await findPluginRowForUpdateV1(stateRepository, {
        pluginId: input.pluginId,
      });
      if (!state) throw new Error('plugin_gateway_state_insert_failed');
    }

    const subjectRepository = manager.getRepository(
      PluginGatewaySubjectBucket,
    );
    const leaseRepository = manager.getRepository(
      PluginGatewayConcurrencyLease,
    );
    await subjectRepository
      .createQueryBuilder()
      .delete()
      .where('plugin_id = :pluginId', { pluginId: input.pluginId })
      .andWhere('updated_at <= :cutoff', {
        cutoff: windowStartedAt - this.policy.windowMs,
      })
      .execute();
    await leaseRepository
      .createQueryBuilder()
      .delete()
      .where('plugin_id = :pluginId', { pluginId: input.pluginId })
      .andWhere('expires_at <= :now', { now })
      .execute();

    const bucketHash = hash([
      'subject',
      input.pluginId,
      input.operationId,
      input.tenantRef ?? 'deployment',
      input.subjectRef,
    ]);
    const subject = await subjectRepository.findOne({
      where: { bucketHash },
    });
    const pluginCount =
      number(state.windowStartedAt) === windowStartedAt
        ? number(state.requestCount)
        : 0;
    const subjectCount =
      subject && number(subject.windowStartedAt) === windowStartedAt
        ? number(subject.requestCount)
        : 0;
    if (
      pluginCount >= this.policy.maxRequestsPerPlugin ||
      subjectCount >= this.policy.maxRequestsPerSubjectOperation
    ) {
      throw new PluginGatewayError(
        'rate_limited',
        'Plugin operation rate limit exceeded',
      );
    }

    const concurrent = await leaseRepository
      .createQueryBuilder('lease')
      .where('lease.plugin_id = :pluginId', { pluginId: input.pluginId })
      .andWhere('lease.operation_id = :operationId', {
        operationId: input.operationId,
      })
      .andWhere('lease.expires_at > :now', { now })
      .getCount();
    if (concurrent >= this.policy.maxConcurrentPerOperation) {
      throw new PluginGatewayError(
        'concurrency_limited',
        'Plugin operation concurrency limit exceeded',
      );
    }

    if (!subject) {
      const tracked = await subjectRepository.count({
        where: { pluginId: input.pluginId },
      });
      if (tracked >= this.policy.maxTrackedBuckets) {
        throw new PluginGatewayError(
          'rate_limited',
          'Plugin operation rate state is at capacity',
        );
      }
      await subjectRepository.insert({
        id: randomUUID(),
        bucketHash,
        pluginId: input.pluginId,
        operationId: input.operationId,
        windowStartedAt,
        requestCount: 1,
        updatedAt: now,
      });
    } else {
      await subjectRepository.update(
        { id: subject.id },
        {
          operationId: input.operationId,
          windowStartedAt,
          requestCount: subjectCount + 1,
          updatedAt: now,
        },
      );
    }
    await stateRepository.update(
      { id: state.id },
      {
        windowStartedAt,
        requestCount: pluginCount + 1,
        updatedAt: now,
      },
    );

    const leaseId = randomUUID();
    await leaseRepository.insert({
      id: randomUUID(),
      leaseId,
      pluginId: input.pluginId,
      operationId: input.operationId,
      expiresAt: now + leaseTtlMs,
      createdAt: now,
    });
    return leaseId;
  }
}

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex');
}

function number(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('plugin_gateway_admission_numeric_state_invalid');
  }
  return parsed;
}
