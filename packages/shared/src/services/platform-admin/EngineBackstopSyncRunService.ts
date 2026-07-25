import { IsNull, LessThanOrEqual, Not } from 'typeorm';
import { getDataSource } from '../../db/data-source.js';
import { EngineBackstopSyncRun } from '../../infrastructure/persistence/entities/EngineBackstopSyncRun.js';
import { decrypt, encrypt, hash } from '../encryption.js';
import { generateId } from '../../utils/id.js';
import {
  EngineBackstopProjectionSchema,
  EngineBackstopSanitizedClassificationSchema,
  EngineBackstopSyncRunSummarySchema,
  type EngineBackstopProjection,
  type EngineBackstopSanitizedClassification,
  type EngineBackstopSyncRunSummary,
} from '../../schemas/platform-admin/engine-backstop.js';

export const ENGINE_BACKSTOP_CATALOG_VERSION = 'camunda7-mirrored-backstop-v1';
export const DEFAULT_ENGINE_BACKSTOP_SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ENGINE_BACKSTOP_HISTORY_LIMIT = 100;
export const MAX_ENGINE_BACKSTOP_EVIDENCE_BYTES = 2 * 1024 * 1024;

export class EngineBackstopEvidenceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineBackstopEvidenceLimitError';
  }
}

export interface CreateEngineBackstopPreviewInput {
  engineId: string;
  tenantId?: string | null;
  sourceHash: string;
  desiredHash: string;
  projection: EngineBackstopProjection;
  capability?: Record<string, boolean>;
  actorId?: string | null;
  now?: number;
  snapshotRetentionMs?: number;
}

function optionalId(value?: string | null): string | null {
  return value?.trim() || null;
}

function requiredHash(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a SHA-256 hex digest`);
  return normalized;
}

function opaqueReference(prefix: string, value: string): string {
  return `${prefix}-${hash(value).slice(0, 24)}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function withinLimit(value: string, label: string): string {
  if (byteLength(value) > MAX_ENGINE_BACKSTOP_EVIDENCE_BYTES) {
    throw new EngineBackstopEvidenceLimitError(`${label} exceeds the cross-database secure evidence limit; narrow the authorization scope before retrying`);
  }
  return value;
}

function encryptedDetail(value: unknown): string {
  return withinLimit(encrypt(JSON.stringify(value)), 'Encrypted backstop evidence');
}

function epoch(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return number;
}

function snapshotAvailable(run: EngineBackstopSyncRun, now = Date.now()): boolean {
  const expiresAt = epoch(run.detailedSnapshotExpiresAt, 'Detailed snapshot expiry');
  return Boolean(run.encryptedDetailedSnapshot) && (expiresAt === null || expiresAt > now);
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Backstop receipt JSON is invalid');
  return parsed as Record<string, unknown>;
}

function parseClassifications(value: string): EngineBackstopSanitizedClassification[] {
  return EngineBackstopSanitizedClassificationSchema.array().parse(JSON.parse(value));
}

function sanitizeProjection(projection: EngineBackstopProjection): EngineBackstopSanitizedClassification[] {
  return projection.classifications.map((classification) => EngineBackstopSanitizedClassificationSchema.parse({
    sourceAssignmentReference: opaqueReference('backstop-assignment', classification.sourceAssignmentId),
    disposition: classification.disposition,
    reasonCodes: classification.reasonCodes,
    principalType: classification.principalType,
    nativeGroupReference: classification.nativeGroupId ? opaqueReference('camunda-group', classification.nativeGroupId) : null,
    resourceKind: classification.resourceKind,
    resourceReference: classification.resourceKey
      ? opaqueReference('backstop-resource', `${classification.resourceKind || 'unknown'}\u0000${classification.resourceKey}`)
      : null,
    camundaResourceType: classification.camundaResourceType,
    permissions: classification.permissions,
  })).sort((left, right) => left.sourceAssignmentReference.localeCompare(right.sourceAssignmentReference));
}

function countsFor(classifications: EngineBackstopSanitizedClassification[], proposedGrantCount: number): Record<string, number> {
  const counts: Record<string, number> = { total: classifications.length, proposed: 0, manual_required: 0, blocked: 0, proposedGrantCount };
  for (const classification of classifications) counts[classification.disposition] += 1;
  return counts;
}

function summaryFor(run: EngineBackstopSyncRun, now = Date.now()): EngineBackstopSyncRunSummary {
  const capability = parseObject(run.capabilityJson);
  const counts = parseObject(run.countsJson);
  return EngineBackstopSyncRunSummarySchema.parse({
    id: run.id,
    engineId: run.engineId,
    tenantId: run.tenantId || null,
    status: run.status,
    sourceHash: run.sourceHash,
    desiredHash: run.desiredHash,
    resultHash: run.resultHash || null,
    catalogVersion: run.catalogVersion,
    capability,
    counts,
    classifications: parseClassifications(run.classificationsJson),
    rollbackOfRunId: run.rollbackOfRunId || null,
    observedOfRunId: run.observedOfRunId || null,
    detailedSnapshotAvailable: snapshotAvailable(run, now),
    detailedSnapshotExpiresAt: epoch(run.detailedSnapshotExpiresAt, 'Detailed snapshot expiry'),
    completedAt: epoch(run.completedAt, 'Completed timestamp'),
    createdAt: epoch(run.createdAt, 'Created timestamp')!,
    updatedAt: epoch(run.updatedAt, 'Updated timestamp')!,
  });
}

/** Persists sanitized preview receipts; native operations are handled separately. */
export class EngineBackstopSyncRunService {
  async createPreview(input: CreateEngineBackstopPreviewInput): Promise<EngineBackstopSyncRunSummary> {
    const engineId = input.engineId.trim();
    if (!engineId) throw new Error('Engine id is required');
    const retention = input.snapshotRetentionMs ?? DEFAULT_ENGINE_BACKSTOP_SNAPSHOT_RETENTION_MS;
    if (!Number.isInteger(retention) || retention < 1 || retention > DEFAULT_ENGINE_BACKSTOP_SNAPSHOT_RETENTION_MS) {
      throw new Error('Snapshot retention must be between 1 millisecond and 30 days');
    }
    const projection = EngineBackstopProjectionSchema.parse(input.projection);
    const now = input.now ?? Date.now();
    const classifications = sanitizeProjection(projection);
    const classificationsJson = withinLimit(JSON.stringify(classifications), 'Backstop classification evidence');
    const run = {
      id: generateId(),
      engineId,
      tenantId: optionalId(input.tenantId),
      status: 'previewed' as const,
      sourceHash: requiredHash(input.sourceHash, 'Source hash'),
      desiredHash: requiredHash(input.desiredHash, 'Desired hash'),
      resultHash: null,
      catalogVersion: ENGINE_BACKSTOP_CATALOG_VERSION,
      capabilityJson: JSON.stringify(input.capability || {}),
      countsJson: JSON.stringify(countsFor(classifications, projection.desiredGrants.length)),
      classificationsJson,
      encryptedDetailedSnapshot: encryptedDetail({ version: 1, projection }),
      detailedSnapshotExpiresAt: now + retention,
      rollbackOfRunId: null,
      observedOfRunId: null,
      createdById: optionalId(input.actorId),
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await (await getDataSource()).getRepository(EngineBackstopSyncRun).insert(run);
    return summaryFor(run as EngineBackstopSyncRun, now);
  }

  async getSummary(id: string): Promise<EngineBackstopSyncRunSummary | null> {
    const run = await (await getDataSource()).getRepository(EngineBackstopSyncRun).findOne({ where: { id: id.trim() } });
    return run ? summaryFor(run) : null;
  }

  async listForEngine(input: { engineId: string; tenantId?: string | null; limit?: number }): Promise<EngineBackstopSyncRunSummary[]> {
    const engineId = input.engineId.trim();
    const limit = input.limit ?? 50;
    if (!engineId) throw new Error('Engine id is required');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ENGINE_BACKSTOP_HISTORY_LIMIT) throw new Error(`History limit must be between 1 and ${MAX_ENGINE_BACKSTOP_HISTORY_LIMIT}`);
    const tenantId = optionalId(input.tenantId);
    const runs = await (await getDataSource()).getRepository(EngineBackstopSyncRun).find({
      where: { engineId, tenantId: tenantId === null ? IsNull() : tenantId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    return runs.map(summaryFor);
  }

  /** Caller must enforce the dedicated native-detail permission before use. */
  async getDetailedSnapshot(id: string, now = Date.now()): Promise<unknown | null> {
    const run = await (await getDataSource()).getRepository(EngineBackstopSyncRun).findOne({ where: { id: id.trim() } });
    if (!run?.encryptedDetailedSnapshot || !snapshotAvailable(run, now)) return null;
    return JSON.parse(decrypt(run.encryptedDetailedSnapshot));
  }

  async updateRun(input: { id: string; status: EngineBackstopSyncRun['status']; resultHash?: string | null; detailedSnapshot?: unknown; rollbackOfRunId?: string | null; observedOfRunId?: string | null; completed?: boolean; now?: number }): Promise<EngineBackstopSyncRunSummary | null> {
    const id = input.id.trim();
    const repository = (await getDataSource()).getRepository(EngineBackstopSyncRun);
    const current = await repository.findOne({ where: { id } });
    if (!current) return null;
    const now = input.now ?? Date.now();
    const values = {
      status: input.status,
      ...(input.resultHash === undefined ? {} : { resultHash: input.resultHash === null ? null : requiredHash(input.resultHash, 'Result hash') }),
      ...(input.detailedSnapshot === undefined ? {} : { encryptedDetailedSnapshot: encryptedDetail(input.detailedSnapshot) }),
      ...(input.rollbackOfRunId === undefined ? {} : { rollbackOfRunId: optionalId(input.rollbackOfRunId) }),
      ...(input.observedOfRunId === undefined ? {} : { observedOfRunId: optionalId(input.observedOfRunId) }),
      ...(input.completed ? { completedAt: now } : {}),
      updatedAt: now,
    };
    await repository.update({ id }, values);
    return summaryFor({ ...current, ...values } as EngineBackstopSyncRun, now);
  }

  async purgeExpiredDetailedSnapshots(now = Date.now()): Promise<number> {
    const result = await (await getDataSource()).getRepository(EngineBackstopSyncRun).update({
      detailedSnapshotExpiresAt: LessThanOrEqual(now),
      encryptedDetailedSnapshot: Not(IsNull()),
    }, { encryptedDetailedSnapshot: null, updatedAt: now });
    return result.affected || 0;
  }
}

export const engineBackstopSyncRunService = new EngineBackstopSyncRunService();
