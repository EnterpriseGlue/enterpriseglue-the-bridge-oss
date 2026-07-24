import { createHash } from 'node:crypto';
import { IsNull, LessThanOrEqual, Not } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { CamundaNativeGrantImportRun } from '@enterpriseglue/shared/infrastructure/persistence/entities/CamundaNativeGrantImportRun.js';
import { decrypt, encrypt } from '@enterpriseglue/shared/services/encryption.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import {
  CamundaNativeGrantClassificationSchema,
  CamundaNativeGrantImportRunSummarySchema,
  CamundaNativeGrantSanitizedClassificationSchema,
  type CamundaNativeGrantClassification,
  type CamundaNativeGrantImportRunSummary,
  type CamundaNativeGrantSanitizedClassification,
  type CamundaNativeGrantSourceKind,
} from '../../schemas/platform-admin/camunda-native-grants.js';

export const DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS = DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS;
/**
 * The common safe limit is below Cloud Spanner STRING(MAX)'s 2.5 MiB limit.
 * It applies after encryption, so every supported database either accepts a
 * run or rejects it before any partial evidence is persisted.
 */
export const MAX_CAMUNDA_NATIVE_GRANT_ENCRYPTED_EVIDENCE_BYTES = 2 * 1024 * 1024;
export const MAX_CAMUNDA_NATIVE_GRANT_CLASSIFICATIONS_BYTES = 2 * 1024 * 1024;

/** A bounded import that cannot be retained safely is always rejected before persistence. */
export class CamundaNativeGrantEvidenceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CamundaNativeGrantEvidenceLimitError';
  }
}

export interface CreateCamundaNativeGrantImportRunInput {
  engineId: string;
  tenantId?: string | null;
  sourceKind: CamundaNativeGrantSourceKind;
  inputHash: string;
  mappingCatalogVersion: string;
  inventoryTruncated: boolean;
  classifications: CamundaNativeGrantClassification[];
  /** Raw native source payload. It is encrypted at rest and never returned by summary/list APIs. */
  detailedSnapshot?: unknown;
  actorId?: string | null;
  now?: number;
  snapshotRetentionMs?: number;
}

/** Encrypted alongside the source snapshot; never included in run summaries. */
export interface CamundaNativeGrantStoredDraft {
  bundle: unknown;
  files: Record<string, unknown>;
  canonicalHash: string;
  engineReference: { key: string; engineId: string; mode: 'configured' | 'existing_registered' };
  generated: { groupCount: number; roleCount: number; runtimeResourceSetCount: number; assignmentCount: number };
  manualWorkAuthorizationIds: string[];
}

function opaqueReference(prefix: string, value: string): string {
  return `${prefix}-${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)}`;
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function parseClassifications(value: string): CamundaNativeGrantSanitizedClassification[] {
  return CamundaNativeGrantSanitizedClassificationSchema.array().parse(JSON.parse(value));
}

function sanitizeClassification(input: CamundaNativeGrantClassification): CamundaNativeGrantSanitizedClassification {
  const classification = CamundaNativeGrantClassificationSchema.parse(input);
  return CamundaNativeGrantSanitizedClassificationSchema.parse({
    sourceAuthorizationRef: opaqueReference('camunda-auth', classification.sourceAuthorizationId),
    disposition: classification.disposition,
    reasonCodes: classification.reasonCodes,
    principalType: classification.principal.type,
    groupReference: classification.principal.groupId
      ? opaqueReference('camunda-group', classification.principal.groupId)
      : null,
    resourceKind: classification.resourceKind,
    resourceReference: classification.resourceId
      ? opaqueReference('camunda-resource', `${classification.resourceKind || 'unknown'}\u0000${classification.resourceId}`)
      : null,
    mappedActionIds: classification.mappedActionIds,
  });
}

function countsFor(classifications: CamundaNativeGrantSanitizedClassification[]): Record<string, number> {
  const counts: Record<string, number> = { total: classifications.length, proposed: 0, approval_required: 0, manual_required: 0, blocked: 0 };
  for (const classification of classifications) counts[classification.disposition] += 1;
  return counts;
}

function summaryFor(run: CamundaNativeGrantImportRun): CamundaNativeGrantImportRunSummary {
  return CamundaNativeGrantImportRunSummarySchema.parse({
    id: run.id,
    engineId: run.engineId,
    tenantId: run.tenantId,
    sourceKind: run.sourceKind,
    status: run.status,
    inputHash: run.inputHash,
    mappingCatalogVersion: run.mappingCatalogVersion,
    inventoryTruncated: run.inventoryTruncated,
    normalizedCounts: parseObject(run.normalizedCountsJson),
    classifications: parseClassifications(run.classificationsJson),
    draftHash: run.draftHash,
    appliedConfigBundleRunId: run.appliedConfigBundleRunId || null,
    rollbackConfigBundleRunId: run.rollbackConfigBundleRunId || null,
    rolledBackAt: run.rolledBackAt == null ? null : Number(run.rolledBackAt),
    detailedSnapshotAvailable: Boolean(run.encryptedDetailedSnapshot) && (run.detailedSnapshotExpiresAt === null || run.detailedSnapshotExpiresAt > Date.now()),
    detailedSnapshotExpiresAt: run.detailedSnapshotExpiresAt,
    createdAt: Number(run.createdAt),
    updatedAt: Number(run.updatedAt),
  });
}

function assertHash(value: string, name: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${name} must be a SHA-256 hex digest`);
  return normalized;
}

function optionalId(value?: string | null): string | null {
  return value?.trim() || null;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function assertWithinLimit(value: string, limit: number, label: string): string {
  if (byteLength(value) > limit) {
    throw new CamundaNativeGrantEvidenceLimitError(`${label} exceeds the cross-database secure evidence limit; narrow the migration scope before retrying`);
  }
  return value;
}

function encryptEvidence(value: unknown): string {
  return assertWithinLimit(
    encrypt(JSON.stringify(value)),
    MAX_CAMUNDA_NATIVE_GRANT_ENCRYPTED_EVIDENCE_BYTES,
    'Encrypted native-grant evidence',
  );
}

/**
 * Persists opaque migration evidence. This service does not make authorization
 * decisions, does not call Camunda, and does not expose a native snapshot.
 */
export class CamundaNativeGrantImportRunService {
  async createPreview(input: CreateCamundaNativeGrantImportRunInput): Promise<CamundaNativeGrantImportRunSummary> {
    const engineId = input.engineId.trim();
    if (!engineId) throw new Error('Engine id is required');
    if (input.inventoryTruncated) throw new Error('A truncated native-grant inventory cannot create an import run');
    const mappingCatalogVersion = input.mappingCatalogVersion.trim();
    if (!mappingCatalogVersion || mappingCatalogVersion.length > 128) throw new Error('Mapping catalog version is required');
    const now = input.now ?? Date.now();
    const snapshotRetentionMs = input.snapshotRetentionMs ?? DEFAULT_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS;
    if (!Number.isInteger(snapshotRetentionMs) || snapshotRetentionMs < 1 || snapshotRetentionMs > MAX_CAMUNDA_NATIVE_GRANT_SNAPSHOT_RETENTION_MS) {
      throw new Error('Snapshot retention must be between 1 millisecond and 30 days');
    }

    const classifications = input.classifications.map(sanitizeClassification)
      .sort((left, right) => left.sourceAuthorizationRef.localeCompare(right.sourceAuthorizationRef));
    const classificationsJson = assertWithinLimit(
      JSON.stringify(classifications),
      MAX_CAMUNDA_NATIVE_GRANT_CLASSIFICATIONS_BYTES,
      'Native-grant classification evidence',
    );
    const detailedSnapshot = input.detailedSnapshot === undefined ? null : encryptEvidence(input.detailedSnapshot);
    const expiresAt = detailedSnapshot ? now + snapshotRetentionMs : null;
    const run = {
      id: generateId(),
      engineId,
      tenantId: optionalId(input.tenantId),
      sourceKind: input.sourceKind,
      status: 'previewed' as const,
      inputHash: assertHash(input.inputHash, 'Input hash'),
      mappingCatalogVersion,
      inventoryTruncated: false,
      normalizedCountsJson: JSON.stringify(countsFor(classifications)),
      classificationsJson,
      encryptedDetailedSnapshot: detailedSnapshot,
      detailedSnapshotExpiresAt: expiresAt,
      draftHash: null,
      createdById: optionalId(input.actorId),
      approvedById: null,
      approvedAt: null,
      appliedConfigBundleRunId: null,
      rollbackConfigBundleRunId: null,
      rolledBackAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const repository = (await getDataSource()).getRepository(CamundaNativeGrantImportRun);
    await repository.insert(run);
    return summaryFor(run as CamundaNativeGrantImportRun);
  }

  async getSummary(id: string): Promise<CamundaNativeGrantImportRunSummary | null> {
    const run = await (await getDataSource()).getRepository(CamundaNativeGrantImportRun).findOne({ where: { id: id.trim() } });
    return run ? summaryFor(run) : null;
  }

  /** Caller must enforce the dedicated sensitive-preview permission before use. */
  async getDetailedSnapshot(id: string, now = Date.now()): Promise<unknown | null> {
    const run = await (await getDataSource()).getRepository(CamundaNativeGrantImportRun).findOne({ where: { id: id.trim() } });
    if (!run?.encryptedDetailedSnapshot) return null;
    if (run.detailedSnapshotExpiresAt !== null && run.detailedSnapshotExpiresAt <= now) return null;
    return JSON.parse(decrypt(run.encryptedDetailedSnapshot));
  }

  async setDraft(input: { id: string; draftHash: string; approverId: string; draft?: CamundaNativeGrantStoredDraft; now?: number }): Promise<CamundaNativeGrantImportRunSummary | null> {
    const id = input.id.trim();
    const approverId = input.approverId.trim();
    if (!id || !approverId) throw new Error('Import run id and approver id are required');
    const repository = (await getDataSource()).getRepository(CamundaNativeGrantImportRun);
    const run = await repository.findOne({ where: { id } });
    if (!run) return null;
    const now = input.now ?? Date.now();
    const draftHash = assertHash(input.draftHash, 'Draft hash');
    let encryptedDetailedSnapshot: string | undefined;
    if (input.draft) {
      if (!run.encryptedDetailedSnapshot || (run.detailedSnapshotExpiresAt !== null && run.detailedSnapshotExpiresAt <= now)) {
        throw new Error('Native-grant detail is unavailable; create a new preview before generating a draft');
      }
      if (input.draft.canonicalHash !== draftHash || !input.draft.engineReference?.key || !input.draft.engineReference?.engineId) {
        throw new Error('Generated draft evidence is invalid');
      }
      const detail = JSON.parse(decrypt(run.encryptedDetailedSnapshot));
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('Native-grant detail is invalid');
      encryptedDetailedSnapshot = encryptEvidence({
        ...(detail as Record<string, unknown>),
        generatedDraft: input.draft,
      });
    }
    const values = {
      status: 'draft_generated' as const,
      draftHash,
      approvedById: approverId,
      approvedAt: now,
      ...(encryptedDetailedSnapshot ? { encryptedDetailedSnapshot } : {}),
      updatedAt: now,
    };
    await repository.update({ id }, values);
    return summaryFor({ ...run, ...values } as CamundaNativeGrantImportRun);
  }

  /** Caller must enforce sensitive-preview and apply permissions before use. */
  async getGeneratedDraft(id: string, now = Date.now()): Promise<CamundaNativeGrantStoredDraft | null> {
    const detail = await this.getDetailedSnapshot(id, now);
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
    const draft = (detail as Record<string, unknown>).generatedDraft;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
    const value = draft as Partial<CamundaNativeGrantStoredDraft>;
    if (
      !value.files || typeof value.files !== 'object' || Array.isArray(value.files)
      || typeof value.canonicalHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.canonicalHash)
      || !value.engineReference || typeof value.engineReference.key !== 'string' || typeof value.engineReference.engineId !== 'string'
      || !['configured', 'existing_registered'].includes(value.engineReference.mode || '')
      || !value.generated || !Array.isArray(value.manualWorkAuthorizationIds)
    ) return null;
    return value as CamundaNativeGrantStoredDraft;
  }

  async markApplied(input: { id: string; configBundleApplyRunId: string; now?: number }): Promise<CamundaNativeGrantImportRunSummary | null> {
    const id = input.id.trim();
    const configBundleApplyRunId = input.configBundleApplyRunId.trim();
    if (!id || !configBundleApplyRunId) throw new Error('Import run id and config-bundle apply run id are required');
    const repository = (await getDataSource()).getRepository(CamundaNativeGrantImportRun);
    const run = await repository.findOne({ where: { id } });
    if (!run) return null;
    const values = { status: 'applied' as const, appliedConfigBundleRunId: configBundleApplyRunId, updatedAt: input.now ?? Date.now() };
    await repository.update({ id }, values);
    return summaryFor({ ...run, ...values } as CamundaNativeGrantImportRun);
  }

  async markRolledBack(input: { id: string; configBundleApplyRunId: string; now?: number }): Promise<CamundaNativeGrantImportRunSummary | null> {
    const id = input.id.trim();
    const configBundleApplyRunId = input.configBundleApplyRunId.trim();
    if (!id || !configBundleApplyRunId) throw new Error('Import run id and rollback config-bundle apply run id are required');
    const repository = (await getDataSource()).getRepository(CamundaNativeGrantImportRun);
    const run = await repository.findOne({ where: { id } });
    if (!run) return null;
    const now = input.now ?? Date.now();
    const values = { status: 'rolled_back' as const, rollbackConfigBundleRunId: configBundleApplyRunId, rolledBackAt: now, updatedAt: now };
    await repository.update({ id }, values);
    return summaryFor({ ...run, ...values } as CamundaNativeGrantImportRun);
  }

  /** Removes only the encrypted detail after retention; opaque audit evidence remains. */
  async purgeExpiredDetailedSnapshots(now = Date.now()): Promise<number> {
    const result = await (await getDataSource()).getRepository(CamundaNativeGrantImportRun).update({
      detailedSnapshotExpiresAt: LessThanOrEqual(now),
      encryptedDetailedSnapshot: Not(IsNull()),
    }, {
      encryptedDetailedSnapshot: null,
      updatedAt: now,
    });
    return result.affected || 0;
  }
}

export const camundaNativeGrantImportRunService = new CamundaNativeGrantImportRunService();
