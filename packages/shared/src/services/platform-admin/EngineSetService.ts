import { createHash } from 'node:crypto';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSet.js';
import { EngineSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineSetMaterialization.js';
import { ExternalEngineRegistration } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalEngineRegistration.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type {
  EngineSetDetail as SharedEngineSetDetail,
  EngineSetMaterializationResult as SharedEngineSetMaterializationResult,
  EngineSetPreview as SharedEngineSetPreview,
  EngineSetSelector as SharedEngineSetSelector,
  EngineSetSummary as SharedEngineSetSummary,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import { engineTenancyVisibilityWhere } from '@enterpriseglue/shared/engine-tenancy/visibility.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { In, IsNull, type DataSource, type EntityManager, type Repository } from 'typeorm';

export type EngineSetSource = SharedEngineSetSummary['source'];
export type EngineSetOwnershipMode = SharedEngineSetSummary['ownershipMode'];
export type EngineSetSelectorMode = SharedEngineSetSelector['mode'];
export type EngineSetLabelMatch = NonNullable<Extract<SharedEngineSetSelector, { mode: 'labels' }>['labelMatch']>;
export type EngineSetSelectorRiskReason = SharedEngineSetPreview['riskReasons'][number];

/** Canonical portable identity for a global or tenant-scoped Engine Set key. */
export function engineSetKeyIdentity(tenantId: string | null | undefined, key: string): string {
  return `${tenantId || 'platform'}:${key.trim()}`;
}

export type EngineSetSelector = SharedEngineSetSelector;

export interface EngineSetInput {
  tenantId?: string | null;
  key?: string;
  name: string;
  description?: string | null;
  selector: EngineSetSelector;
  source?: EngineSetSource;
  sourceRef?: string | null;
  ownershipMode?: EngineSetOwnershipMode;
  sourceHash?: string | null;
  lastAppliedAt?: number | null;
  driftStatus?: string | null;
  createdById?: string | null;
  riskAcknowledged?: boolean;
}

export interface EngineSetUpdateInput {
  tenantId?: string | null;
  name?: string;
  description?: string | null;
  selector?: EngineSetSelector;
  isArchived?: boolean;
  ownershipMode?: EngineSetOwnershipMode;
  sourceHash?: string | null;
  lastAppliedAt?: number | null;
  driftStatus?: string | null;
  /** Reserved for the configuration bundle lifecycle, which is authoritative for config-owned sets. */
  allowSourceOwnedMutation?: boolean;
  updatedById?: string | null;
  riskAcknowledged?: boolean;
}

export function isSourceOwnedEngineSet(source: string | null | undefined): boolean {
  return Boolean(source && source !== 'manual');
}

export function engineSetOwnershipReason(source: string | null | undefined, sourceRef?: string | null): string {
  const owner = source ? source.replace(/_/g, ' ') : 'source';
  return `Engine Set is managed by ${owner}${sourceRef ? ` (${sourceRef})` : ''} and cannot be changed through manual Engine Set management`;
}

export type EngineSetSummary = SharedEngineSetSummary;
export type EngineSetMaterializationView = SharedEngineSetMaterializationResult['materializations'][number];
export type EngineSetDetail = SharedEngineSetDetail;
export type EngineSetPreview = SharedEngineSetPreview;
export type EngineSetMaterializationResult = SharedEngineSetMaterializationResult;

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function keyFromName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseLabels(value: string | null | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parseJsonObject(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(',')}}`;
}

function selectorFingerprint(selector: EngineSetSelector): string {
  return createHash('sha256')
    .update(stableJson(selector))
    .digest('hex');
}

function normalizeSelector(input: EngineSetSelector): EngineSetSelector {
  if (!input || typeof input !== 'object') {
    throw Errors.validation('Engine Set selector is required');
  }

  if (input.mode === 'all') {
    return { mode: 'all' };
  }

  if (input.mode === 'engine_ids') {
    const engineIds = Array.from(new Set((input.engineIds || [])
      .map((id) => String(id).trim())
      .filter(Boolean)))
      .sort();
    if (engineIds.length === 0) {
      throw Errors.validation('engine_ids selectors require at least one engine id');
    }
    return { mode: 'engine_ids', engineIds };
  }

  if (input.mode === 'labels') {
    const labels = Object.fromEntries(
      Object.entries(input.labels || {})
        .map(([key, value]) => [key.trim(), String(value).trim()] as [string, string])
        .filter(([key, value]) => key.length > 0 && value.length > 0)
        .sort(([left], [right]) => left.localeCompare(right))
    );
    if (Object.keys(labels).length === 0) {
      throw Errors.validation('labels selectors require at least one label');
    }
    return {
      mode: 'labels',
      labels,
      labelMatch: input.labelMatch === 'any' ? 'any' : 'all',
    };
  }

  throw Errors.validation('Unsupported Engine Set selector mode');
}

function parseSelector(value: string): EngineSetSelector {
  return normalizeSelector(parseJsonObject(value) as unknown as EngineSetSelector);
}

function toSummary(set: EngineSet, materializedEngineCount: number): EngineSetSummary {
  return {
    id: set.id,
    tenantId: set.tenantId,
    key: set.key,
    name: set.name,
    description: set.description,
    selector: parseSelector(set.selectorJson),
    selectorFingerprint: set.selectorFingerprint,
    source: set.source as EngineSetSource,
    sourceRef: set.sourceRef,
    ownershipMode: (set.ownershipMode || (set.source === 'config' ? 'config_locked' : 'manual')) as EngineSetOwnershipMode,
    sourceHash: set.sourceHash || null,
    lastAppliedAt: set.lastAppliedAt === null ? null : Number(set.lastAppliedAt),
    driftStatus: set.driftStatus || null,
    isArchived: Boolean(set.isArchived),
    createdById: set.createdById,
    lastMaterializedAt: set.lastMaterializedAt === null ? null : Number(set.lastMaterializedAt),
    materializationStatus: set.materializationStatus,
    materializationError: set.materializationError,
    materializedEngineCount,
    createdAt: Number(set.createdAt),
    updatedAt: Number(set.updatedAt),
  };
}

function toMaterializationView(
  materialization: EngineSetMaterialization,
  engineNameById: Map<string, string>
): EngineSetMaterializationView {
  return {
    id: materialization.id,
    tenantId: materialization.tenantId,
    engineSetId: materialization.engineSetId,
    engineId: materialization.engineId,
    engineName: engineNameById.get(materialization.engineId) || null,
    selectorFingerprint: materialization.selectorFingerprint,
    matchedBy: parseJsonObject(materialization.matchedByJson),
    lineage: parseJsonObject(materialization.lineageJson),
    source: materialization.source,
    sourceRef: materialization.sourceRef,
    lastSeenAt: Number(materialization.lastSeenAt),
    createdAt: Number(materialization.createdAt),
    updatedAt: Number(materialization.updatedAt),
  };
}

function labelsMatch(selector: Extract<EngineSetSelector, { mode: 'labels' }>, labels: Record<string, string>): boolean {
  const requiredLabels = selector.labels;
  const entries = Object.entries(requiredLabels);
  if (selector.labelMatch === 'any') {
    return entries.some(([key, value]) => labels[key] === value);
  }
  return entries.every(([key, value]) => labels[key] === value);
}

export function getEngineSetSelectorRiskReasons(selector: EngineSetSelector): EngineSetSelectorRiskReason[] {
  const riskReasons: EngineSetSelectorRiskReason[] = [];
  if (selector.mode === 'all') {
    riskReasons.push('all_engines_selector');
  }
  if (selector.mode === 'labels' && selector.labelMatch === 'any') {
    riskReasons.push('any_label_match');
  }
  return riskReasons;
}

function engineSetSelectorWarnings(selector: EngineSetSelector, matchedCount?: number): string[] {
  const warnings: string[] = getEngineSetSelectorRiskReasons(selector).map((reason) => {
    if (reason === 'all_engines_selector') {
      return 'This selector includes every active engine visible to the tenant.';
    }
    return 'This selector uses any-label matching and can include engines that match only one configured label.';
  });
  if (matchedCount !== undefined && matchedCount >= 25) {
    warnings.push(`This selector currently matches ${matchedCount} engines.`);
  }
  return warnings;
}

function requireEngineSetSelectorRiskAcknowledgement(selector: EngineSetSelector, riskAcknowledged?: boolean): void {
  const riskReasons = getEngineSetSelectorRiskReasons(selector);
  if (riskReasons.length > 0 && riskAcknowledged !== true) {
    throw Errors.validation('High-risk Engine Set selector requires acknowledgement');
  }
}

class EngineSetServiceClass {
  async listEngineSets(filters: { tenantId?: string | null; includeArchived?: boolean } = {}): Promise<EngineSetSummary[]> {
    const dataSource = await getDataSource();
    const tenantId = normalizeTenantId(filters.tenantId);
    const setQb = dataSource.getRepository(EngineSet)
      .createQueryBuilder('engineSet')
      .orderBy('engineSet.name', 'ASC');
    if (tenantId) {
      setQb.andWhere('(engineSet.tenantId = :tenantId OR engineSet.tenantId IS NULL)', { tenantId });
    }
    if (!filters.includeArchived) {
      setQb.andWhere('engineSet.isArchived = :isArchived', { isArchived: false });
    }

    const sets = await setQb.getMany();
    const counts = await this.getMaterializationCounts(dataSource, sets.map((set) => set.id));
    return sets.map((set) => toSummary(set, counts.get(set.id) || 0));
  }

  async getEngineSet(id: string, tenantId?: string | null): Promise<EngineSetDetail | null> {
    const dataSource = await getDataSource();
    const set = await dataSource.getRepository(EngineSet).findOneBy({ id });
    if (!set || !this.isTenantVisible(set.tenantId, tenantId)) {
      return null;
    }

    const materializations = await this.getMaterializationViews(dataSource, id);
    return {
      ...toSummary(set, materializations.length),
      materializations,
    };
  }

  async createEngineSet(input: EngineSetInput, store?: DataSource | EntityManager, deferMaterialization = false): Promise<{ id: string }> {
    const name = input.name.trim();
    if (!name) throw Errors.validation('Engine Set name is required');
    const key = input.key?.trim() || keyFromName(name);
    if (!key) throw Errors.validation('Engine Set key is required');

    const selector = normalizeSelector(input.selector);
    requireEngineSetSelectorRiskAcknowledgement(selector, input.riskAcknowledged);
    const tenantId = normalizeTenantId(input.tenantId);
    const dataSource = store || await getDataSource();
    const repo = dataSource.getRepository(EngineSet);
    await this.assertUniqueKey(repo, key, tenantId);

    const id = generateId();
    const now = Date.now();
    await repo.insert({
      id,
      tenantId,
      key,
      engineSetKeyIdentity: engineSetKeyIdentity(tenantId, key),
      name,
      description: input.description?.trim() || null,
      selectorJson: stableJson(selector),
      selectorFingerprint: selectorFingerprint(selector),
      source: input.source || 'manual',
      sourceRef: input.sourceRef || null,
      ownershipMode: input.ownershipMode || (input.source === 'config' ? 'config_locked' : 'manual'),
      sourceHash: input.sourceHash || null,
      lastAppliedAt: input.lastAppliedAt || null,
      driftStatus: input.driftStatus || null,
      isArchived: false,
      createdById: input.createdById || null,
      lastMaterializedAt: null,
      materializationStatus: 'pending',
      materializationError: null,
      createdAt: now,
      updatedAt: now,
    });

    if (!deferMaterialization) await this.materializeEngineSet(id, tenantId);
    return { id };
  }

  async updateEngineSet(id: string, input: EngineSetUpdateInput, store?: DataSource | EntityManager, deferMaterialization = false): Promise<void> {
    const dataSource = store || await getDataSource();
    const repo = dataSource.getRepository(EngineSet);
    const existing = await repo.findOneBy({ id });
    if (!existing || !this.isTenantVisible(existing.tenantId, input.tenantId)) {
      throw Errors.notFound('Engine Set');
    }
    const isConfigWarn = existing.source === 'config' && existing.ownershipMode === 'config_warn';
    if (isSourceOwnedEngineSet(existing.source) && !isConfigWarn && !input.allowSourceOwnedMutation) {
      throw Errors.conflict(engineSetOwnershipReason(existing.source, existing.sourceRef));
    }

    const selector = input.selector ? normalizeSelector(input.selector) : parseSelector(existing.selectorJson);
    const isArchived = input.isArchived ?? existing.isArchived;
    if (!isArchived && input.selector) {
      requireEngineSetSelectorRiskAcknowledgement(selector, input.riskAcknowledged);
    }
    await repo.update({ id }, {
      name: input.name?.trim() || existing.name,
      description: input.description !== undefined ? input.description?.trim() || null : existing.description,
      selectorJson: stableJson(selector),
      selectorFingerprint: selectorFingerprint(selector),
      isArchived,
      ownershipMode: input.ownershipMode ?? existing.ownershipMode,
      sourceHash: input.sourceHash ?? existing.sourceHash,
      lastAppliedAt: input.lastAppliedAt ?? existing.lastAppliedAt,
      driftStatus: input.driftStatus ?? (isConfigWarn ? 'drifted' : existing.driftStatus),
      materializationStatus: isArchived ? 'archived' : 'pending',
      materializationError: null,
      updatedAt: Date.now(),
    });

    if (isArchived) {
      if (!deferMaterialization) await dataSource.getRepository(EngineSetMaterialization).delete({ engineSetId: id });
      return;
    }

    if (!deferMaterialization) await this.materializeEngineSet(id, input.tenantId ?? existing.tenantId);
  }

  async archiveEngineSet(id: string, tenantId?: string | null): Promise<void> {
    await this.updateEngineSet(id, { tenantId, isArchived: true });
  }

  async previewSelector(selectorInput: EngineSetSelector, tenantId?: string | null): Promise<EngineSetPreview> {
    const dataSource = await getDataSource();
    const selector = normalizeSelector(selectorInput);
    const matchedEngines = await this.resolveMatchingEngines(dataSource, selector, tenantId);
    return {
      selector,
      selectorFingerprint: selectorFingerprint(selector),
      riskReasons: getEngineSetSelectorRiskReasons(selector),
      warnings: engineSetSelectorWarnings(selector, matchedEngines.length),
      matchedEngines,
    };
  }

  async materializeEngineSet(id: string, tenantId?: string | null): Promise<EngineSetMaterializationResult> {
    const dataSource = await getDataSource();
    const setRepo = dataSource.getRepository(EngineSet);
    const materializationRepo = dataSource.getRepository(EngineSetMaterialization);
    const set = await setRepo.findOneBy({ id });
    if (!set || set.isArchived || !this.isTenantVisible(set.tenantId, tenantId)) {
      throw Errors.notFound('Engine Set');
    }

    const now = Date.now();
    try {
      const selector = parseSelector(set.selectorJson);
      const fingerprint = selectorFingerprint(selector);
      // The Engine Set owns the materialization boundary. The tenant argument is
      // only the caller's visibility context; using it as the selector scope can
      // partially rematerialize a platform set and delete valid memberships from
      // other tenants.
      const materializationTenantId = normalizeTenantId(set.tenantId);
      const matches = await this.resolveMatchingEngines(dataSource, selector, materializationTenantId);
      const existing = await materializationRepo.find({ where: { engineSetId: id } });
      const existingByEngineId = new Map(existing.map((row) => [row.engineId, row]));
      const matchedEngineIds = new Set(matches.map((match) => match.engineId));
      let created = 0;
      let updated = 0;

      for (const match of matches) {
        const matchedByJson = stableJson(match.matchedBy);
        const lineageJson = stableJson({
          engineSetId: id,
          engineSetKey: set.key,
          selector,
          selectorFingerprint: fingerprint,
          matchedAt: now,
          source: set.source,
          sourceRef: set.sourceRef,
          labels: match.labels,
        });
        const existingRow = existingByEngineId.get(match.engineId);
        if (existingRow) {
          await materializationRepo.update({ id: existingRow.id }, {
            tenantId: materializationTenantId,
            selectorFingerprint: fingerprint,
            matchedByJson,
            lineageJson,
            source: set.source || 'engine_set',
            sourceRef: set.sourceRef,
            lastSeenAt: now,
            updatedAt: now,
          });
          updated += 1;
        } else {
          await materializationRepo.insert({
            id: generateId(),
            tenantId: materializationTenantId,
            engineSetId: id,
            engineId: match.engineId,
            selectorFingerprint: fingerprint,
            matchedByJson,
            lineageJson,
            source: set.source || 'engine_set',
            sourceRef: set.sourceRef,
            lastSeenAt: now,
            createdAt: now,
            updatedAt: now,
          });
          created += 1;
        }
      }

      const staleIds = existing
        .filter((row) => !matchedEngineIds.has(row.engineId))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await materializationRepo.delete({ id: In(staleIds) });
      }

      await setRepo.update({ id }, {
        selectorFingerprint: fingerprint,
        lastMaterializedAt: now,
        materializationStatus: 'ok',
        materializationError: null,
        updatedAt: now,
      });

      return {
        engineSetId: id,
        selectorFingerprint: fingerprint,
        matched: matches.length,
        created,
        updated,
        removed: staleIds.length,
        materializations: await this.getMaterializationViews(dataSource, id),
      };
    } catch (error: any) {
      await setRepo.update({ id }, {
        materializationStatus: 'failed',
        materializationError: error?.message || 'Engine Set materialization failed',
        updatedAt: Date.now(),
      });
      throw error;
    }
  }

  async materializeEngineSetsForEngine(engineId: string, tenantId?: string | null): Promise<Array<EngineSetMaterializationResult | { engineSetId: string; error: string }>> {
    const dataSource = await getDataSource();
    const engine = await dataSource.getRepository(Engine).findOne({
      where: { id: engineId },
      select: ['id', 'tenantId', 'tenancyMode'],
    });
    if (!engine) return [];
    const isShared = engine.tenancyMode === 'shared';
    const effectiveTenantId = normalizeTenantId(engine.tenantId ?? tenantId);
    // A shared engine is eligible for tenant-scoped connection sets in every
    // tenant. Dedicated engines remain eligible only for their owning tenant and
    // platform sets. Each set is then materialized in its own persisted scope.
    const sets = await this.listEngineSets(isShared ? {} : { tenantId: effectiveTenantId });
    const results = [];
    for (const set of sets) {
      try {
        results.push(await this.materializeEngineSet(set.id, set.tenantId));
      } catch (error: any) {
        results.push({ engineSetId: set.id, error: error?.message || 'Engine Set materialization failed' });
      }
    }
    return results;
  }

  private async getMaterializationCounts(dataSource: DataSource, engineSetIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (engineSetIds.length === 0) return counts;
    const rows = await dataSource.getRepository(EngineSetMaterialization).find({
      where: { engineSetId: In(engineSetIds) },
      select: ['engineSetId'],
    });
    for (const row of rows) {
      counts.set(row.engineSetId, (counts.get(row.engineSetId) || 0) + 1);
    }
    return counts;
  }

  private async getMaterializationViews(dataSource: DataSource, engineSetId: string): Promise<EngineSetMaterializationView[]> {
    const materializations = await dataSource.getRepository(EngineSetMaterialization).find({
      where: { engineSetId },
      order: { engineId: 'ASC' },
    });
    if (materializations.length === 0) return [];

    const engines = await dataSource.getRepository(Engine).find({
      where: { id: In(materializations.map((row) => row.engineId)) },
      select: ['id', 'name'],
    });
    const engineNameById = new Map(engines.map((engine) => [engine.id, engine.name]));
    return materializations.map((row) => toMaterializationView(row, engineNameById));
  }

  private async resolveMatchingEngines(
    dataSource: DataSource,
    selector: EngineSetSelector,
    tenantId?: string | null
  ): Promise<EngineSetPreview['matchedEngines']> {
    const normalizedTenantId = normalizeTenantId(tenantId);
    const engineRepo = dataSource.getRepository(Engine);
    const engines = await engineRepo.find({
      where: engineTenancyVisibilityWhere({}, normalizedTenantId),
      order: { name: 'ASC' },
    });
    const registrations = engines.length > 0
      ? await dataSource.getRepository(ExternalEngineRegistration).find({
        where: { engineId: In(engines.map((engine) => engine.id)) },
        select: ['engineId', 'labelsJson', 'externalId'],
      })
      : [];
    const registrationByEngineId = new Map(registrations.map((registration) => [registration.engineId, registration]));
    const selectorEngineIds = new Set(selector.mode === 'engine_ids' ? selector.engineIds : []);
    const matched = [];

    for (const engine of engines) {
      if (engine.lifecycleStatus === 'decommissioned') {
        continue;
      }
      const registration = registrationByEngineId.get(engine.id);
      const labels = {
        ...parseLabels(engine.labelsJson),
        ...parseLabels(registration?.labelsJson),
      };

      if (selector.mode === 'engine_ids' && !selectorEngineIds.has(engine.id)) {
        continue;
      }
      if (selector.mode === 'labels' && !labelsMatch(selector, labels)) {
        continue;
      }

      matched.push({
        engineId: engine.id,
        engineName: engine.name,
        labels,
        matchedBy: selector.mode === 'labels'
          ? { mode: selector.mode, labels: selector.labels, labelMatch: selector.labelMatch || 'all' }
          : { mode: selector.mode, engineId: engine.id, externalId: registration?.externalId || engine.externalId || null },
      });
    }

    return matched.sort((left, right) => left.engineName.localeCompare(right.engineName) || left.engineId.localeCompare(right.engineId));
  }

  private isTenantVisible(resourceTenantId: string | null | undefined, tenantId?: string | null): boolean {
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (!normalizedTenantId) return !resourceTenantId;
    return !resourceTenantId || resourceTenantId === normalizedTenantId;
  }

  private async assertUniqueKey(repo: Repository<EngineSet>, key: string, tenantId: string | null): Promise<void> {
    if (await repo.findOneBy({ engineSetKeyIdentity: engineSetKeyIdentity(tenantId, key) })) {
      throw Errors.conflict('Engine Set key already exists');
    }
  }
}

export const engineSetService = new EngineSetServiceClass();
