import { In, IsNull } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineTenantMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineTenantMapping.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js';
import type { ScheduledRuntimeInventoryReconciliationResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

const mappingSnapshot = (rows: EngineTenantMapping[]) => JSON.stringify(rows.map(row => [row.id, row.strategy, row.externalTenantId, row.enterpriseTenantId, row.isActive]).sort());
const tenantSnapshot = (rows: Tenant[]) => JSON.stringify(rows.map(row => [row.id, row.slug, row.status]).sort());
const discoverySnapshot = (engine: Engine) => JSON.stringify([
  engine.runtimeAccessScope, engine.metadataDiscoveryEnabled ?? null, engine.deploymentDiscoveryEnabled ?? null, engine.lifecycleStatus ?? null,
]);

/** Only a whole canonical cohort may publish a shared engine's readiness.
 * Network work is outside the final short transaction; tenant inventory reads
 * remain scoped even while the shared registry row is locked for publication. */
export async function reconcileSharedEngineInventory(
  engine: Engine, selectedTenantIds?: Array<string | null>,
): Promise<ScheduledRuntimeInventoryReconciliationResult[]> {
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const runtimeEnabled = engine.runtimeAccessScope === 'resource_aware' && engine.metadataDiscoveryEnabled !== false;
  // A monotonic marker + prior-value CAS admits only one attempt, including
  // simultaneous workers in the same millisecond. Failed is conservative while
  // work is incomplete and stays within the existing public status contract.
  const attemptedAt = Math.max(Date.now(), Number(engine.lastMetadataReconciledAt || 0) + 1);
  const fence = { id: engine.id, tenancyMode: 'shared', tenantMappingVersion: engine.tenantMappingVersion,
    tenantMappingStrategy: engine.tenantMappingStrategy ?? IsNull() };
  const claim = await engineRepo.update({ ...fence, lastMetadataReconciledAt: engine.lastMetadataReconciledAt ?? IsNull() }, {
    lastMetadataReconciledAt: attemptedAt, lastMetadataReconciliationStatus: 'failed', tenantResolutionStatus: 'incomplete',
  });
  if (claim.affected !== 1) throw new Error('Shared inventory reconciliation snapshot changed');
  // Claim before catalogue reads: a failed initial scan must not leave an old
  // ready/succeeded marker presented as this attempt's outcome.
  const mappings = await dataSource.getRepository(EngineTenantMapping).find({ where: { engineId: engine.id, isActive: true } });
  const ids = [...new Set(mappings.map(row => row.enterpriseTenantId))].sort();
  const tenants = ids.length ? await dataSource.getRepository(Tenant).find({ where: { id: In(ids) } }) : [];
  const duplicateMappings = new Set(mappings.map(row => JSON.stringify([row.strategy, row.externalTenantId]))).size !== mappings.length;
  const validCohort = ids.length > 0 && !duplicateMappings && mappings.every(row => row.strategy === engine.tenantMappingStrategy)
    && tenants.length === ids.length && ids.every(id => tenants.some(row => row.id === id && row.slug && row.status === 'active'));
  const complete = validCohort && (!selectedTenantIds || ids.every(id => selectedTenantIds.includes(id)));
  const results: ScheduledRuntimeInventoryReconciliationResult[] = [];
  for (const id of ids) {
    if (selectedTenantIds && !selectedTenantIds.includes(id)) continue;
    const tenant = tenants.find(row => row.id === id);
    try {
      if (!tenant || tenant.status !== 'active' || !tenant.slug) throw new Error('Shared inventory tenant is not active');
      const { deployments, ...result } = await runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, () =>
        engineMetadataReconciliationService.reconcileEngine(engine.id, id, {
          runtimeMetadataDiscoveryEnabled: runtimeEnabled, deploymentDiscoveryEnabled: engine.deploymentDiscoveryEnabled !== false,
        }));
      results.push({ engineId: engine.id, tenantId: id, status: 'reconciled', ...result,
        deploymentsCreated: deployments.created, deploymentsUpdated: deployments.updated, deploymentArtifactsCreated: deployments.artifactsCreated });
    } catch (error) {
      logger.warn('Shared engine tenant inventory reconciliation failed', { engineId: engine.id, tenantId: id, error });
      results.push({ engineId: engine.id, tenantId: id, status: 'failed' });
    }
  }
  const allSucceeded = complete && results.length === ids.length && results.every(row => row.status === 'reconciled');
  const aggregateSucceeded = await dataSource.transaction(async manager => {
    const locked = await manager.getRepository(Engine).findOne({ where: { id: engine.id }, lock: { mode: 'pessimistic_write' } });
    if (!locked || locked.tenancyMode !== 'shared' || locked.tenantMappingVersion !== engine.tenantMappingVersion ||
        locked.tenantMappingStrategy !== engine.tenantMappingStrategy || Number(locked.lastMetadataReconciledAt) !== attemptedAt ||
        locked.lastMetadataReconciliationStatus !== 'failed' || discoverySnapshot(locked) !== discoverySnapshot(engine)) return false;
    const currentMappings = await manager.getRepository(EngineTenantMapping).find({ where: { engineId: engine.id, isActive: true } });
    const currentTenants: Tenant[] = [];
    for (const id of ids) {
      const tenant = await manager.getRepository(Tenant).findOne({ where: { id }, lock: { mode: 'pessimistic_read' } });
      if (tenant) currentTenants.push(tenant);
    }
    const unchanged = mappingSnapshot(currentMappings) === mappingSnapshot(mappings) && tenantSnapshot(currentTenants) === tenantSnapshot(tenants);
    let ready = allSucceeded && runtimeEnabled && unchanged;
    let conflict = duplicateMappings;
    if (ready) {
      for (const tenant of currentTenants) {
        const resources = await runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, () =>
          manager.getRepository(RuntimeResource).find({ where: { engineId: engine.id, tenantId: tenant.id, isActive: true } }));
        for (const resource of resources) {
          const key = engine.tenantMappingStrategy === 'deployment_target' ? resource.projectId || '' : resource.runtimeTenantId || '';
          const matches = mappings.filter(row => row.enterpriseTenantId === tenant.id && row.externalTenantId === key);
          conflict ||= resource.tenantResolutionStatus === 'conflict' || matches.length > 1;
          if (resource.tenantId !== tenant.id || resource.tenantResolutionStatus !== 'resolved' || matches.length !== 1 ||
              resource.tenantMappingId !== matches[0].id || Number(resource.tenantMappingVersion) !== engine.tenantMappingVersion) ready = false;
        }
      }
    }
    const succeeded = allSucceeded && unchanged && (!runtimeEnabled || ready);
    const update = await manager.getRepository(Engine).update({ ...fence, lastMetadataReconciledAt: attemptedAt, lastMetadataReconciliationStatus: 'failed' }, {
      tenantResolutionStatus: conflict ? 'conflict' : ready ? 'ready' : 'incomplete',
      lastMetadataReconciliationStatus: succeeded ? 'succeeded' : 'failed',
      ...(ready ? { lastTenantReconciledAt: Date.now() } : {}), updatedAt: Date.now(),
    });
    return update.affected === 1 && succeeded;
  });
  if (!aggregateSucceeded) {
    logger.warn('Shared engine inventory aggregate is incomplete', { engineId: engine.id });
    // Preserve concrete tenant successes while exposing the failed global
    // aggregate. This is diagnostic only, never global database authority.
    results.push({ engineId: engine.id, tenantId: null, status: 'failed' });
  }
  return results;
}
