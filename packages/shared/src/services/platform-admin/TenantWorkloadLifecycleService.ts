import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { TenantLifecycleOperation, type TenantLifecycleCommand } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLifecycleOperation.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { canonicalizeConfigJson, hashCanonicalConfig } from './config-bundle-hash.js';
import {
  TENANT_WORKLOAD_RECEIPT_V1_SCHEMA,
  tenantWorkloadReceiptService,
  type SignedTenantWorkloadReceiptV1,
  type TenantWorkloadReceiptPayloadV1,
} from './TenantWorkloadReceiptService.js';

export interface TenantLifecycleMutationResult {
  tenantId: string;
  tenantSlug: string;
  tenantStatus: string;
  placementEpoch: number;
  routingAliases?: string[];
}

export interface ExecuteTenantLifecycleInput {
  actorId: string;
  command: TenantLifecycleCommand;
  idempotencyKey: string;
  correlationId: string;
  request: unknown;
  mutate: (manager: EntityManager) => Promise<TenantLifecycleMutationResult>;
}

function hashOpaque(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseStoredReceipt(value: string): SignedTenantWorkloadReceiptV1 {
  try {
    const parsed = JSON.parse(value) as SignedTenantWorkloadReceiptV1;
    if (parsed?.payload?.schemaVersion !== TENANT_WORKLOAD_RECEIPT_V1_SCHEMA || parsed?.signature?.algorithm !== 'ES256') {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw Errors.serviceUnavailable('Stored tenant lifecycle receipt');
  }
}

export class TenantWorkloadLifecycleService {
  async execute(input: ExecuteTenantLifecycleInput): Promise<SignedTenantWorkloadReceiptV1> {
    if (config.tenancyMode !== 'pooled') throw Errors.conflict('Tenant workload lifecycle requires pooled mode');
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
      throw Errors.validation('Idempotency-Key must contain 16-200 characters');
    }
    if (input.correlationId.length < 8 || input.correlationId.length > 160) {
      throw Errors.validation('X-Correlation-ID must contain 8-160 characters');
    }
    const idempotencyKeyHash = hashOpaque(input.idempotencyKey);
    const requestHash = hashCanonicalConfig({ command: input.command, request: input.request });
    const dataSource = await getDataSource();

    return dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(TenantLifecycleOperation);
      const operationId = generateId();
      const now = Date.now();
      await repo.createQueryBuilder()
        .insert()
        .values({
          id: operationId,
          actorId: input.actorId,
          command: input.command,
          idempotencyKeyHash,
          requestHash,
          tenantId: null,
          status: 'pending',
          receiptJson: '{}',
          createdAt: now,
          updatedAt: now,
        })
        .orIgnore()
        .execute();

      const operationQuery = repo.createQueryBuilder('tenant_lifecycle_operation')
        .where('tenant_lifecycle_operation.actor_id = :actorId', { actorId: input.actorId })
        .andWhere('tenant_lifecycle_operation.command = :command', { command: input.command })
        .andWhere('tenant_lifecycle_operation.idempotency_key_hash = :keyHash', { keyHash: idempotencyKeyHash });
      if (!['sqljs', 'sqlite', 'better-sqlite3', 'spanner'].includes(String(manager.connection.options.type))) {
        operationQuery.setLock('pessimistic_write');
      }
      const operation = await operationQuery.getOne();
      if (!operation) throw Errors.serviceUnavailable('Tenant lifecycle idempotency record');
      if (operation.requestHash !== requestHash) {
        throw Errors.conflict('Idempotency-Key was already used for a different tenant lifecycle request');
      }
      if (operation.id !== operationId) {
        if (operation.status !== 'completed') throw Errors.serviceUnavailable('Tenant lifecycle operation');
        return { ...parseStoredReceipt(operation.receiptJson), idempotent: true };
      }

      const result = await input.mutate(manager);
      const payload: TenantWorkloadReceiptPayloadV1 = {
        schemaVersion: TENANT_WORKLOAD_RECEIPT_V1_SCHEMA,
        issuer: config.tenantWorkloadReceiptIssuer!,
        audience: config.tenantPlacementV2Audience!,
        operationId,
        command: input.command,
        actorId: input.actorId,
        tenantId: result.tenantId,
        tenantSlug: result.tenantSlug,
        tenantStatus: result.tenantStatus,
        placementEpoch: result.placementEpoch,
        routingAliases: [...(result.routingAliases || [])].sort(),
        correlationId: input.correlationId,
        requestHash,
        idempotencyKeyHash,
        issuedAt: Math.floor(now / 1000),
      };
      const receipt = tenantWorkloadReceiptService.sign(payload);
      await repo.update({ id: operationId }, {
        tenantId: result.tenantId,
        status: 'completed',
        receiptJson: canonicalizeConfigJson(receipt),
        updatedAt: Date.now(),
      });
      return receipt;
    });
  }
}

export const tenantWorkloadLifecycleService = new TenantWorkloadLifecycleService();
