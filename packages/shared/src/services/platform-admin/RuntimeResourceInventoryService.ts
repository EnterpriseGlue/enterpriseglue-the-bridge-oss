import { createHash } from 'node:crypto';
import { In } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { RuntimeResourceSet } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSet.js';
import { RuntimeResourceSetMaterialization } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResourceSetMaterialization.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { camundaGet, getDecisionDefinitions } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { RuntimeResourceObservationSchema, type RuntimeResourceKind, type RuntimeResourceObservation } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';

export type { RuntimeResourceKind, RuntimeResourceObservation } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';
export type RuntimeResourceSetSelector =
  | { mode: 'keys'; keys: string[] }
  | { mode: 'prefix'; prefix: string }
  | { mode: 'labels'; labels: Record<string, string>; labelMatch?: 'all' | 'any' }
  | { mode: 'project_lineage'; projectRef: { id?: string; key?: string } };

export interface RuntimeResourceMaterializationResult {
  runtimeResourceSetId: string;
  matched: number;
  created: number;
  updated: number;
  removed: number;
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function selectorFingerprint(selector: RuntimeResourceSetSelector): string {
  return createHash('sha256').update(stableJson(selector)).digest('hex');
}

function parseSelector(value: string): RuntimeResourceSetSelector {
  const parsed = parseObject(value) as RuntimeResourceSetSelector;
  if (!parsed?.mode || !['keys', 'prefix', 'labels', 'project_lineage'].includes(parsed.mode)) throw new Error('Invalid Runtime Resource Set selector');
  return parsed;
}

export function matchRuntimeResourceSetSelector(resource: RuntimeResource, selector: RuntimeResourceSetSelector): Record<string, unknown> | null {
  if (selector.mode === 'keys') return selector.keys.includes(resource.resourceKey) ? { mode: 'keys', resourceKey: resource.resourceKey } : null;
  if (selector.mode === 'prefix') return resource.resourceKey.startsWith(selector.prefix) ? { mode: 'prefix', prefix: selector.prefix, resourceKey: resource.resourceKey } : null;
  if (selector.mode === 'labels') {
    const labels = parseObject(resource.labelsJson);
    const matches = Object.entries(selector.labels).filter(([key, value]) => labels[key] === value);
    const allowed = (selector.labelMatch || 'all') === 'all' ? matches.length === Object.keys(selector.labels).length : matches.length > 0;
    return allowed ? { mode: 'labels', labels: selector.labels, labelMatch: selector.labelMatch || 'all', matchedLabels: Object.fromEntries(matches) } : null;
  }
  // Project keys are intentionally unsupported until projects have config keys.
  return selector.projectRef.id && resource.projectId === selector.projectRef.id ? { mode: 'project_lineage', projectId: resource.projectId } : null;
}

/** Shared reconciliation boundary for discovered/reported runtime metadata. */
class RuntimeResourceInventoryService {
  async reconcileEngine(engineId: string, tenantId?: string | null): Promise<{ created: number; updated: number; deactivated: number; materializedSets: number }> {
    const [processes, decisions] = await Promise.all([
      camundaGet<Array<{ id?: string; key?: string; version?: number; tenantId?: string | null; deploymentId?: string | null }>>(engineId, '/process-definition'),
      getDecisionDefinitions<Array<{ id?: string; key?: string; version?: number; tenantId?: string | null; deploymentId?: string | null }>>(engineId),
    ]);
    const observations: RuntimeResourceObservation[] = [
      ...(processes || []).filter((item) => item.key).map((item) => ({ resourceKind: 'process_definition' as const, resourceKey: item.key!, engineResourceId: item.id || null, version: item.version || null, runtimeTenantId: item.tenantId || null, deploymentId: item.deploymentId || null })),
      ...(decisions || []).filter((item) => item.key).map((item) => ({ resourceKind: 'decision_definition' as const, resourceKey: item.key!, engineResourceId: item.id || null, version: item.version || null, runtimeTenantId: item.tenantId || null, deploymentId: item.deploymentId || null })),
    ];
    const observed = await this.observe(engineId, tenantId, observations);
    const deactivated = await this.deactivateMissing(engineId, tenantId, observations);
    const materializations = await this.materializeForEngine(engineId, tenantId);
    return { ...observed, deactivated, materializedSets: materializations.length };
  }
  async observe(engineId: string, tenantId: string | null | undefined, observations: RuntimeResourceObservation[]): Promise<{ created: number; updated: number }> {
    const validatedObservations = RuntimeResourceObservationSchema.array().parse(observations);
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(RuntimeResource);
    const now = Date.now();
    let created = 0;
    let updated = 0;
    for (const observation of validatedObservations) {
      const resourceKey = observation.resourceKey.trim();
      if (!resourceKey) throw new Error('Runtime resource key is required');
      const runtimeTenantId = observation.runtimeTenantId?.trim() || '';
      const existing = await repo.findOne({ where: { engineId, resourceKind: observation.resourceKind, resourceKey, runtimeTenantId } });
      // Discovery confirms the engine's current state but must never erase
      // richer pipeline/proxy project and file lineage already recorded here.
      const source = observation.source || 'engine_discovery';
      const preservesExistingLineage = source === 'engine_discovery' && Boolean(existing);
      const values = {
        tenantId: tenantId || null, engineId, resourceKind: observation.resourceKind, resourceKey, runtimeTenantId,
        engineResourceId: observation.engineResourceId || existing?.engineResourceId || null,
        deploymentId: observation.deploymentId || existing?.deploymentId || null,
        projectId: observation.projectId || (preservesExistingLineage ? existing?.projectId : null) || null,
        fileId: observation.fileId || (preservesExistingLineage ? existing?.fileId : null) || null,
        version: observation.version ?? existing?.version ?? null,
        labelsJson: stableJson({ ...(preservesExistingLineage ? parseObject(existing?.labelsJson) : {}), ...(observation.labels || {}) }),
        lineageJson: stableJson(preservesExistingLineage ? parseObject(existing?.lineageJson) : (observation.lineage || {})),
        source: preservesExistingLineage ? existing!.source : source,
        sourceRef: preservesExistingLineage ? existing!.sourceRef : (observation.sourceRef || null),
        observedAt: now, isActive: true, updatedAt: now,
      };
      if (existing) { await repo.update({ id: existing.id }, values); updated += 1; }
      else { await repo.insert({ id: generateId(), ...values, createdAt: now }); created += 1; }
    }
    return { created, updated };
  }

  /** Mark only successfully listed runtime definitions as stale; failed fetches never revoke access. */
  private async deactivateMissing(engineId: string, tenantId: string | null | undefined, observations: RuntimeResourceObservation[]): Promise<number> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(RuntimeResource);
    const observed = new Set(observations.map((item) => `${item.resourceKind}|${item.resourceKey.trim()}|${item.runtimeTenantId?.trim() || ''}`));
    const active = await repo.find({ where: { engineId, isActive: true } });
    const stale = active.filter((resource) => (resource.tenantId || null) === (tenantId || null)
      && ['process_definition', 'decision_definition'].includes(resource.resourceKind)
      && !observed.has(`${resource.resourceKind}|${resource.resourceKey}|${resource.runtimeTenantId || ''}`));
    if (stale.length) {
      const now = Date.now();
      await Promise.all(stale.map((resource) => repo.update({ id: resource.id }, { isActive: false, updatedAt: now })));
    }
    return stale.length;
  }

  async materialize(runtimeResourceSetId: string, tenantId?: string | null): Promise<RuntimeResourceMaterializationResult> {
    const dataSource = await getDataSource();
    const setRepo = dataSource.getRepository(RuntimeResourceSet);
    const resourceRepo = dataSource.getRepository(RuntimeResource);
    const materializationRepo = dataSource.getRepository(RuntimeResourceSetMaterialization);
    const set = await setRepo.findOne({ where: { id: runtimeResourceSetId } });
    if (!set || set.isArchived || (tenantId !== undefined && (set.tenantId || null) !== (tenantId || null))) throw new Error('Runtime Resource Set not found');
    const selector = parseSelector(set.selectorJson);
    const fingerprint = selectorFingerprint(selector);
    const resources = await resourceRepo.find({ where: { engineId: set.engineId, resourceKind: set.resourceKind, isActive: true } });
    // A runtime-tenant constrained set is the assignment boundary for every
    // matching resource in that tenant. Keep the constraint here, at the
    // materialization boundary, so set-based grants cannot cross tenants.
    const matches = resources
      .filter((resource) => !set.runtimeTenantId || resource.runtimeTenantId === set.runtimeTenantId)
      .map((resource) => ({ resource, matchedBy: matchRuntimeResourceSetSelector(resource, selector) }))
      .filter((match): match is { resource: RuntimeResource; matchedBy: Record<string, unknown> } => Boolean(match.matchedBy));
    const existing = await materializationRepo.find({ where: { runtimeResourceSetId } });
    const existingByResource = new Map(existing.map((row) => [row.runtimeResourceId, row]));
    const now = Date.now();
    let created = 0;
    let updated = 0;
    for (const { resource, matchedBy } of matches) {
      const values = { tenantId: set.tenantId, selectorFingerprint: fingerprint, matchedByJson: stableJson(matchedBy), lineageJson: stableJson({ runtimeResourceSetId, runtimeResourceId: resource.id, engineId: resource.engineId, resourceKey: resource.resourceKey, resourceKind: resource.resourceKind, source: resource.source, sourceRef: resource.sourceRef }), lastSeenAt: now, updatedAt: now };
      const existingRow = existingByResource.get(resource.id);
      if (existingRow) { await materializationRepo.update({ id: existingRow.id }, values); updated += 1; }
      else { await materializationRepo.insert({ id: generateId(), runtimeResourceSetId, runtimeResourceId: resource.id, ...values, createdAt: now }); created += 1; }
    }
    const matchedIds = new Set(matches.map(({ resource }) => resource.id));
    const staleIds = existing.filter((row) => !matchedIds.has(row.runtimeResourceId)).map((row) => row.id);
    if (staleIds.length) await materializationRepo.delete({ id: In(staleIds) });
    return { runtimeResourceSetId, matched: matches.length, created, updated, removed: staleIds.length };
  }

  async materializeForEngine(engineId: string, tenantId?: string | null): Promise<RuntimeResourceMaterializationResult[]> {
    const dataSource = await getDataSource();
    const sets = await dataSource.getRepository(RuntimeResourceSet).find({ where: { engineId, isArchived: false } });
    const visible = sets.filter((set) => tenantId === undefined || (set.tenantId || null) === (tenantId || null));
    const results: RuntimeResourceMaterializationResult[] = [];
    for (const set of visible) results.push(await this.materialize(set.id, tenantId));
    return results;
  }
}

export const runtimeResourceInventoryService = new RuntimeResourceInventoryService();
