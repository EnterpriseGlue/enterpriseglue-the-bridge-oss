import { createHash } from 'node:crypto';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { TenantLifecycleOperation } from '@enterpriseglue/shared/infrastructure/persistence/entities/TenantLifecycleOperation.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import {
  TenantReleaseActivationInputSchema, SignedTenantReleaseActivationReceiptSchema,
  type TenantReleaseActivationInput, type SignedTenantReleaseActivationReceipt,
} from '@enterpriseglue/shared/schemas/platform-admin/tenant-release-activation.js';
import { canonicalizeConfigJson, hashCanonicalConfig } from './config-bundle-hash.js';
import { TenantReleaseWorkAssignmentService } from './TenantReleaseWorkAssignmentService.js';
import { tenantWorkloadReceiptService } from './TenantWorkloadReceiptService.js';

const actorId = 'tenant-release-controller' as const;
const command = 'assign_release' as const;

/** Historical completion proof, not current tenant/readiness or worker status.
 * The unique ledger fence and receipt must be retained for late duplicates. */
export class TenantReleaseActivationService {
  constructor(private readonly dataSourceProvider = getDataSource) {}

  async execute(input: TenantReleaseActivationInput): Promise<SignedTenantReleaseActivationReceipt> {
    if (config.tenancyMode !== 'pooled') throw Errors.conflict('Release activation receipts require pooled mode');
    const parsed = TenantReleaseActivationInputSchema.parse(input);
    const { idempotencyKey, ...intent } = parsed;
    const idempotencyKeyHash = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
    const requestHash = hashCanonicalConfig({ command, ...intent });
    const source = await this.dataSourceProvider();
    const key = { actorId, command, idempotencyKeyHash };
    const readCompleted = async () => {
      const stored = await source.getRepository(TenantLifecycleOperation).findOneBy(key);
      if (!stored) return undefined;
      if (stored.requestHash !== requestHash) throw Errors.conflict('Idempotency-Key was already used for a different release activation');
      if (stored.status !== 'completed') throw Errors.serviceUnavailable('Release activation operation is unresolved');
      let receipt: SignedTenantReleaseActivationReceipt;
      try { receipt = SignedTenantReleaseActivationReceiptSchema.parse(JSON.parse(stored.receiptJson)); }
      catch { throw Errors.serviceUnavailable('Stored release activation receipt'); }
      const payload = receipt.payload;
      if (payload.operationId !== stored.id || payload.actorId !== actorId || payload.requestHash !== requestHash ||
        payload.idempotencyKeyHash !== idempotencyKeyHash || payload.tenantId !== parsed.tenantId || stored.tenantId !== parsed.tenantId ||
        payload.releaseId !== parsed.releaseId || payload.assignmentEpoch !== parsed.assignmentEpoch ||
        payload.placementEpoch !== parsed.expectedPlacementEpoch || payload.correlationId !== parsed.correlationId) {
        throw Errors.serviceUnavailable('Stored release activation receipt binding');
      }
      return receipt; // Same signed envelope, no replay flag or current-state mutation.
    };
    const existing = await readCompleted();
    if (existing) return existing;

    const assignment = new TenantReleaseWorkAssignmentService(this.dataSourceProvider);
    try {
      return await source.transaction(async (manager) => {
        const operations = manager.getRepository(TenantLifecycleOperation);
        const operationId = generateId();
        const now = Date.now();
        // Plain unique insert: no adapter-specific ignore semantics. A loser
        // rolls back before reading the winner's committed receipt below.
        await operations.insert({ id: operationId, ...key, requestHash,
          tenantId: parsed.tenantId, status: 'pending', receiptJson: '{}', createdAt: now, updatedAt: now });
        await assignment.assign({ tenantId: parsed.tenantId, releaseId: parsed.releaseId,
          assignmentEpoch: parsed.assignmentEpoch, expectedPlacementEpoch: parsed.expectedPlacementEpoch }, manager);
        const receipt = tenantWorkloadReceiptService.signReleaseActivation({
          schemaVersion: 'tenant-release-activation-receipt.enterpriseglue.io/v1',
          issuer: config.tenantWorkloadReceiptIssuer!, audience: config.tenantPlacementV2Audience!,
          operationId, command, actorId, tenantId: parsed.tenantId, releaseId: parsed.releaseId,
          assignmentEpoch: parsed.assignmentEpoch, placementEpoch: parsed.expectedPlacementEpoch,
          correlationId: parsed.correlationId, requestHash, idempotencyKeyHash, issuedAt: Math.floor(now / 1000),
        });
        const saved = await operations.update({ id: operationId, status: 'pending' }, {
          status: 'completed', receiptJson: canonicalizeConfigJson(receipt), updatedAt: Date.now(),
        });
        if (saved.affected !== 1) throw Errors.serviceUnavailable('Release activation receipt persistence');
        return receipt;
      });
    } catch (error) {
      // Also handles a lost COMMIT response. This is a read, never a mutating
      // retry or error-code-based assumption of success. Only the exact durable
      // completed receipt can resolve the failed attempt; otherwise retain error.
      const completed = await readCompleted();
      if (completed) return completed;
      throw error;
    }
  }
}

export const tenantReleaseActivationService = new TenantReleaseActivationService();
