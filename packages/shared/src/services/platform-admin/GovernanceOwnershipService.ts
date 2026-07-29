import type { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '../../db/data-source.js';
import { normalizeTenantIdForPersistence, OSS_DEFAULT_TENANT_ID } from '../../authz/tenant-scope.js';
import { ConfigBundleApplyRun } from '../../infrastructure/persistence/entities/ConfigBundleApplyRun.js';
import { PlatformSettings } from '../../infrastructure/persistence/entities/PlatformSettings.js';
import { Errors } from '../../middleware/errorHandler.js';
import {
  GovernanceOwnershipApplyRequestSchema,
  GovernanceOwnershipPreviewResponseSchema,
  GovernanceOwnershipReceiptSchema,
  GovernanceOwnershipRequestSchema,
  type GovernanceOwnershipAcknowledgement,
  type GovernanceOwnershipApplyRequest,
  type GovernanceOwnershipPreviewResponse,
  type GovernanceOwnershipReceipt,
  type GovernanceOwnershipRequest,
} from '../../schemas/platform-admin/config-bundle.js';
import { generateId } from '../../utils/id.js';
import { hashCanonicalConfig } from './config-bundle-hash.js';
import {
  platformSettingsService,
  type PlatformSettingsData,
} from './PlatformSettingsService.js';

const PREVIEW_TTL_MS = 10 * 60 * 1000;
export const GOVERNANCE_OWNERSHIP_RECEIPT_API_VERSION = 'governance-ownership/v1';
const AFFECTED_FIELDS = [
  'engineOnboardingMode',
  'projectEngineTargetMode',
  'engineAccessAuthority',
  'projectAccessAuthority',
  'engineRuntimeAuthorizationMode',
] as const;
const PRESERVED_OBJECT_TYPES = [
  'engines',
  'engine_sets',
  'runtime_resources',
  'runtime_resource_sets',
  'roles',
  'role_assignments',
  'groups',
  'group_memberships',
  'identity_providers',
  'identity_mappings',
  'project_engine_targets',
] as const;

type GovernanceState = GovernanceOwnershipPreviewResponse['current'];

function stateFromSettings(settings: Pick<
  PlatformSettingsData,
  | 'accessGovernanceSourceRef'
  | 'accessGovernanceOwnershipMode'
  | 'accessGovernanceSourceHash'
  | 'accessGovernanceLastAppliedAt'
  | 'accessGovernanceDriftStatus'
>): GovernanceState {
  return {
    sourceRef: settings.accessGovernanceSourceRef ?? null,
    ownershipMode: settings.accessGovernanceOwnershipMode || 'manual',
    sourceHash: settings.accessGovernanceSourceHash ?? null,
    lastAppliedAt: settings.accessGovernanceLastAppliedAt ?? null,
    driftStatus: settings.accessGovernanceDriftStatus ?? null,
  };
}

function stateFromEntity(settings: PlatformSettings): GovernanceState {
  return {
    sourceRef: settings.accessGovernanceSourceRef ?? null,
    ownershipMode: ['config_locked', 'config_warn'].includes(settings.accessGovernanceOwnershipMode)
      ? settings.accessGovernanceOwnershipMode as 'config_locked' | 'config_warn'
      : 'manual',
    sourceHash: settings.accessGovernanceSourceHash ?? null,
    lastAppliedAt: settings.accessGovernanceLastAppliedAt === null ? null : Number(settings.accessGovernanceLastAppliedAt),
    driftStatus: settings.accessGovernanceDriftStatus === 'in_sync' || settings.accessGovernanceDriftStatus === 'drifted'
      ? settings.accessGovernanceDriftStatus
      : null,
  };
}

function desiredState(request: GovernanceOwnershipRequest): GovernanceState {
  if (request.operation === 'transfer') {
    return {
      sourceRef: `config_bundle:${request.desiredBundleKey}`,
      ownershipMode: request.desiredOwnershipMode!,
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: 'drifted',
    };
  }
  return {
    sourceRef: null,
    ownershipMode: 'manual',
    sourceHash: null,
    lastAppliedAt: null,
    driftStatus: null,
  };
}

function requiredAcknowledgements(request: GovernanceOwnershipRequest): GovernanceOwnershipAcknowledgement[] {
  const operationAcknowledgement: GovernanceOwnershipAcknowledgement = request.operation === 'transfer'
    ? 'governance.transfer-to-new-bundle'
    : request.operation === 'release'
      ? 'governance.release-to-manual'
      : 'governance.retire-bundle-without-deleting-objects';
  return [
    'governance.settings-only',
    'governance.preserve-managed-objects',
    operationAcknowledgement,
  ];
}

function ownershipRequestFromApply(request: GovernanceOwnershipApplyRequest): GovernanceOwnershipRequest {
  return GovernanceOwnershipRequestSchema.parse({
    operation: request.operation,
    expectedCurrentSourceRef: request.expectedCurrentSourceRef,
    desiredBundleKey: request.desiredBundleKey,
    desiredOwnershipMode: request.desiredOwnershipMode,
    reason: request.reason,
  });
}

function buildPreview(
  request: GovernanceOwnershipRequest,
  current: GovernanceState,
  previewExpiresAt: number,
): GovernanceOwnershipPreviewResponse {
  const desired = desiredState(request);
  const conflicts: GovernanceOwnershipPreviewResponse['conflicts'] = [];
  if (current.sourceRef !== request.expectedCurrentSourceRef) {
    conflicts.push({
      code: 'governance_source_owner_mismatch',
      message: `Expected current source ${request.expectedCurrentSourceRef || 'manual'}, but found ${current.sourceRef || 'manual'}.`,
    });
  }
  if (request.operation === 'retire' && !current.sourceRef?.startsWith('config_bundle:')) {
    conflicts.push({
      code: 'governance_retire_requires_bundle_owner',
      message: 'Bundle retirement requires governance settings currently owned by a configuration bundle.',
    });
  }
  const noChanges = current.sourceRef === desired.sourceRef
    && current.ownershipMode === desired.ownershipMode
    && current.sourceHash === desired.sourceHash
    && current.lastAppliedAt === desired.lastAppliedAt
    && current.driftStatus === desired.driftStatus;
  const withoutHash = {
    operation: request.operation,
    current,
    desired,
    affectedFields: [...AFFECTED_FIELDS],
    preservedObjectTypes: [...PRESERVED_OBJECT_TYPES],
    conflicts,
    requiredAcknowledgements: requiredAcknowledgements(request),
    noChanges,
    previewExpiresAt,
  };
  return GovernanceOwnershipPreviewResponseSchema.parse({
    ...withoutHash,
    previewHash: hashCanonicalConfig({
      request,
      ...withoutHash,
    }),
  });
}

function receiptFromRow(row: ConfigBundleApplyRun): GovernanceOwnershipReceipt {
  if (row.bundleApiVersion !== GOVERNANCE_OWNERSHIP_RECEIPT_API_VERSION || !row.resultJson) {
    throw Errors.conflict('Idempotency key belongs to a different configuration operation');
  }
  const parsed = GovernanceOwnershipReceiptSchema.parse(JSON.parse(row.resultJson));
  return parsed;
}

function supportsPessimisticWrite(dataSource: DataSource): boolean {
  return !['sqlite', 'better-sqlite3', 'sqljs'].includes(String(dataSource.options.type));
}

async function loadLockedSettings(manager: EntityManager, dataSource: DataSource, actorId: string): Promise<PlatformSettings> {
  const repo = manager.getRepository(PlatformSettings);
  let existing = await repo.findOneBy({ id: 'default' });
  if (!existing) {
    await platformSettingsService.update({}, actorId, {
      store: manager,
      sourceRef: null,
      ownershipMode: 'manual',
      sourceHash: null,
      lastAppliedAt: null,
      driftStatus: null,
      bypassOwnership: true,
    });
  }
  const query = repo.createQueryBuilder('settings').where('settings.id = :id', { id: 'default' });
  if (supportsPessimisticWrite(dataSource)) query.setLock('pessimistic_write');
  existing = await query.getOne();
  if (!existing) throw Errors.internal('Platform settings row could not be locked');
  return existing;
}

function receiptBundleKey(receipt: GovernanceOwnershipReceipt): string {
  return receipt.desired.sourceRef || receipt.current.sourceRef || 'governance:manual';
}

export class GovernanceOwnershipService {
  async getCurrentState(): Promise<GovernanceState> {
    return stateFromSettings(await platformSettingsService.get());
  }

  async preview(input: GovernanceOwnershipRequest): Promise<GovernanceOwnershipPreviewResponse> {
    const request = GovernanceOwnershipRequestSchema.parse(input);
    const settings = await platformSettingsService.get();
    return buildPreview(request, stateFromSettings(settings), Date.now() + PREVIEW_TTL_MS);
  }

  async apply(
    input: GovernanceOwnershipApplyRequest,
    context: { tenantId?: string | null; actorId: string },
  ): Promise<GovernanceOwnershipReceipt> {
    const request = GovernanceOwnershipApplyRequestSchema.parse(input);
    if (request.previewExpiresAt < Date.now()) {
      throw Errors.conflict('Governance ownership preview expired; create a new preview');
    }
    const dataSource = await getDataSource();
    const tenantId = normalizeTenantIdForPersistence(context.tenantId) || OSS_DEFAULT_TENANT_ID;
    const scopeKey = tenantId;
    const runRepo = dataSource.getRepository(ConfigBundleApplyRun);
    const existing = await runRepo.findOne({ where: { tenantScopeKey: scopeKey, idempotencyKey: request.idempotencyKey } });
    if (existing) {
      if (existing.canonicalHash !== request.previewHash) {
        throw Errors.conflict('Idempotency key was already used for a different governance ownership preview');
      }
      return { ...receiptFromRow(existing), idempotent: true };
    }

    try {
      return await dataSource.transaction(async (manager) => {
        const currentEntity = await loadLockedSettings(manager, dataSource, context.actorId);
        const previewRequest = ownershipRequestFromApply(request);
        const preview = buildPreview(previewRequest, stateFromEntity(currentEntity), request.previewExpiresAt);
        if (preview.previewHash !== request.previewHash) {
          throw Errors.conflict('Governance ownership state changed after preview; create a new preview');
        }
        if (preview.conflicts.length > 0) {
          throw Errors.conflict('Governance ownership preview contains conflicts', { conflicts: preview.conflicts });
        }
        const acknowledgements = new Set(request.acknowledgements);
        const missing = preview.requiredAcknowledgements.filter((item) => !acknowledgements.has(item));
        if (missing.length > 0) {
          throw Errors.validation(`Governance ownership apply requires acknowledgement: ${missing.join(', ')}`);
        }

        const appliedAt = Date.now();
        await platformSettingsService.update({}, context.actorId, {
          store: manager,
          sourceRef: preview.desired.sourceRef,
          ownershipMode: preview.desired.ownershipMode,
          sourceHash: preview.desired.sourceHash,
          lastAppliedAt: preview.desired.lastAppliedAt,
          driftStatus: preview.desired.driftStatus,
          bypassOwnership: true,
        });
        const receipt = GovernanceOwnershipReceiptSchema.parse({
          id: generateId(),
          tenantId,
          operation: request.operation,
          actorId: context.actorId,
          reason: request.reason,
          idempotencyKey: request.idempotencyKey,
          previewHash: preview.previewHash,
          current: preview.current,
          desired: preview.desired,
          affectedFields: preview.affectedFields,
          preservedObjectTypes: preview.preservedObjectTypes,
          appliedAt,
        });
        await manager.getRepository(ConfigBundleApplyRun).insert({
          id: receipt.id,
          tenantId,
          tenantScopeKey: scopeKey,
          bundleKey: receiptBundleKey(receipt),
          bundleApiVersion: GOVERNANCE_OWNERSHIP_RECEIPT_API_VERSION,
          canonicalHash: preview.previewHash,
          idempotencyKey: request.idempotencyKey,
          actorId: context.actorId,
          status: 'succeeded',
          resultJson: JSON.stringify(receipt),
          errorMessage: null,
          completedAt: appliedAt,
          createdAt: appliedAt,
          updatedAt: appliedAt,
        });
        return receipt;
      });
    } catch (error) {
      const concurrent = await runRepo.findOne({ where: { tenantScopeKey: scopeKey, idempotencyKey: request.idempotencyKey } });
      if (concurrent) {
        if (concurrent.canonicalHash !== request.previewHash) {
          throw Errors.conflict('Idempotency key was already used for a different governance ownership preview');
        }
        return { ...receiptFromRow(concurrent), idempotent: true };
      }
      throw error;
    }
  }

  async listReceipts(tenantIdInput?: string | null, limit = 25): Promise<GovernanceOwnershipReceipt[]> {
    const tenantId = normalizeTenantIdForPersistence(tenantIdInput) || OSS_DEFAULT_TENANT_ID;
    const rows = await (await getDataSource()).getRepository(ConfigBundleApplyRun).find({
      where: { tenantId, bundleApiVersion: GOVERNANCE_OWNERSHIP_RECEIPT_API_VERSION },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map(receiptFromRow);
  }

  async getReceipt(id: string, tenantIdInput?: string | null): Promise<GovernanceOwnershipReceipt | null> {
    const tenantId = normalizeTenantIdForPersistence(tenantIdInput) || OSS_DEFAULT_TENANT_ID;
    const row = await (await getDataSource()).getRepository(ConfigBundleApplyRun).findOne({
      where: { id, tenantId, bundleApiVersion: GOVERNANCE_OWNERSHIP_RECEIPT_API_VERSION },
    });
    return row ? receiptFromRow(row) : null;
  }
}

export const governanceOwnershipService = new GovernanceOwnershipService();
