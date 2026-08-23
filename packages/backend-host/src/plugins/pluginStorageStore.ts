import { createHash, randomUUID } from 'node:crypto';

import {
  HostBrokerErrorV1,
  type PluginStorageStoreInputV1,
  type PluginStorageStoreV1,
} from '@enterpriseglue/plugin-runtime/host-broker';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { PluginStorageEntry } from '@enterpriseglue/shared/infrastructure/persistence/entities/PluginPlatform.js';
import type { DataSource, EntityManager } from 'typeorm';

import { findPluginRowForUpdateV1 } from './pluginDatabaseLock.js';
import { runPluginTransactionV1 } from './pluginDatabaseTransaction.js';

const MAX_NAMESPACE_BYTES = 10 * 1024 * 1024;
const MAX_NAMESPACE_KEYS = 10_000;
const DEPLOYMENT_SCOPE_KEY = '-';

export class DatabasePluginStorageStoreV1 implements PluginStorageStoreV1 {
  constructor(
    private readonly dataSourceProvider: () => Promise<DataSource> =
      getDataSource,
  ) {}

  async execute(input: PluginStorageStoreInputV1) {
    const dataSource = await this.dataSourceProvider();
    if (input.action === 'get') {
      const record = await dataSource.getRepository(PluginStorageEntry).findOne({
        where: identity(input),
      });
      if (!record) {
        return {
          apiVersion: 'storage-result.plugin.enterpriseglue.io/v1' as const,
          action: 'get' as const,
          found: false as const,
        };
      }
      return {
        apiVersion: 'storage-result.plugin.enterpriseglue.io/v1' as const,
        action: 'get' as const,
        found: true as const,
        value: parseValue(record.valueJson),
        revision: revision(record.revision),
      };
    }
    return runPluginTransactionV1(dataSource, async (manager) =>
      input.action === 'put'
        ? put(manager, input)
        : remove(manager, input),
    );
  }
}

function identity(input: PluginStorageStoreInputV1) {
  const values = {
    pluginId: input.pluginId,
    deploymentRef: input.deploymentRef,
    scope: input.scope,
    tenantRefKey:
      input.scope === 'tenant'
        ? requiredTenant(input.tenantRef)
        : DEPLOYMENT_SCOPE_KEY,
    storageKey: input.key,
  };
  return {
    identityHash: createHash('sha256')
      .update(
        [
          values.pluginId,
          values.deploymentRef,
          values.scope,
          values.tenantRefKey,
          values.storageKey,
        ].join('\0'),
        'utf8',
      )
      .digest('hex'),
    ...values,
  };
}

async function put(
  manager: EntityManager,
  input: Extract<PluginStorageStoreInputV1, { action: 'put' }>,
) {
  const repository = manager.getRepository(PluginStorageEntry);
  const where = identity(input);
  const existing = await findPluginRowForUpdateV1(repository, where);
  if (
    (existing && input.expectedRevision !== revision(existing.revision)) ||
    (!existing && input.expectedRevision !== undefined)
  ) {
    throw new HostBrokerErrorV1(409, 'storage_revision_conflict');
  }
  const valueJson = JSON.stringify(input.value);
  const valueBytes = Buffer.byteLength(valueJson, 'utf8');
  const namespace = {
    pluginId: where.pluginId,
    deploymentRef: where.deploymentRef,
    scope: where.scope,
    tenantRefKey: where.tenantRefKey,
  };
  const totals = await repository
    .createQueryBuilder('entry')
    .select('COUNT(entry.id)', 'count')
    .addSelect('COALESCE(SUM(entry.value_bytes), 0)', 'bytes')
    .where('entry.plugin_id = :pluginId', namespace)
    .andWhere('entry.deployment_ref = :deploymentRef', namespace)
    .andWhere('entry.scope = :scope', namespace)
    .andWhere('entry.tenant_ref_key = :tenantRefKey', namespace)
    .getRawOne<{ count: string; bytes: string }>();
  const nextCount = Number(totals?.count ?? 0) + (existing ? 0 : 1);
  const nextBytes =
    Number(totals?.bytes ?? 0) -
    (existing ? Number(existing.valueBytes) : 0) +
    valueBytes;
  if (
    nextCount > MAX_NAMESPACE_KEYS ||
    nextBytes > MAX_NAMESPACE_BYTES
  ) {
    throw new HostBrokerErrorV1(409, 'storage_quota_exceeded');
  }
  const now = Date.now();
  if (existing) {
    const nextRevision = integer(existing.revision) + 1;
    const updated = await repository.update(
      { id: existing.id, revision: integer(existing.revision) },
      {
        valueJson,
        valueBytes,
        revision: nextRevision,
        updatedAt: now,
      },
    );
    if (updated.affected !== 1) {
      throw new HostBrokerErrorV1(409, 'storage_revision_conflict');
    }
    return {
      apiVersion: 'storage-result.plugin.enterpriseglue.io/v1' as const,
      action: 'put' as const,
      revision: revision(nextRevision),
    };
  }
  try {
    await repository.insert({
      id: randomUUID(),
      ...where,
      valueJson,
      valueBytes,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    throw new HostBrokerErrorV1(409, 'storage_revision_conflict');
  }
  return {
    apiVersion: 'storage-result.plugin.enterpriseglue.io/v1' as const,
    action: 'put' as const,
    revision: 'r1' as const,
  };
}

async function remove(
  manager: EntityManager,
  input: Extract<PluginStorageStoreInputV1, { action: 'delete' }>,
) {
  const repository = manager.getRepository(PluginStorageEntry);
  const existing = await findPluginRowForUpdateV1(
    repository,
    identity(input),
  );
  if (
    !existing ||
    input.expectedRevision !== revision(existing.revision)
  ) {
    throw new HostBrokerErrorV1(409, 'storage_revision_conflict');
  }
  const removed = await repository.delete({
    id: existing.id,
    revision: integer(existing.revision),
  });
  if (removed.affected !== 1) {
    throw new HostBrokerErrorV1(409, 'storage_revision_conflict');
  }
  return {
    apiVersion: 'storage-result.plugin.enterpriseglue.io/v1' as const,
    action: 'delete' as const,
    deleted: true as const,
  };
}

function requiredTenant(value: string | undefined): string {
  if (!value) throw new HostBrokerErrorV1(403, 'tenant_required');
  return value;
}

function revision(value: number): `r${number}` {
  return `r${integer(value)}`;
}

function integer(value: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new HostBrokerErrorV1(503, 'storage_unavailable');
  }
  return parsed;
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new HostBrokerErrorV1(503, 'storage_unavailable');
  }
}
