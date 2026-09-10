import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js';
import type { ScheduledRuntimeInventoryReconciliationResult } from '@enterpriseglue/shared/schemas/platform-admin/deployment-receipt.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { runWithTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
import { reconcileSharedEngineInventory } from '../services/sharedEngineInventoryReconciliation.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export interface RuntimeInventoryPollerOptions {
  intervalMs?: number;
  tenantIds?: Array<string | null>;
  runOnStart?: boolean;
}

export type RuntimeInventoryReconciliationResult = ScheduledRuntimeInventoryReconciliationResult;

function parsePositiveInterval(value: string | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseTenantIds(value: string | undefined): Array<string | null> {
  const normalized = value?.trim();
  if (!normalized) return config.tenancyMode === 'pooled' ? [] : [null];
  const ids = normalized.split(',').map((item) => item.trim()).filter(Boolean)
    .map((item) => item === '*' || item.toLowerCase() === 'global' || item.toLowerCase() === 'null' ? null : item);
  return ids.length ? ids : [null];
}

function readOptionsFromEnv(): Required<RuntimeInventoryPollerOptions> {
  return {
    intervalMs: parsePositiveInterval(process.env.RUNTIME_INVENTORY_RECONCILIATION_INTERVAL_MS),
    tenantIds: parseTenantIds(process.env.RUNTIME_INVENTORY_RECONCILIATION_TENANT_IDS),
    runOnStart: process.env.RUNTIME_INVENTORY_RECONCILIATION_RUN_ON_START === 'true',
  };
}

/**
 * Runtime definition discovery remains limited to resource-aware engines.
 * Deployment-history discovery is independent and may run for any active engine.
 */
export async function runScheduledRuntimeInventoryReconciliationOnce(
  options: Pick<RuntimeInventoryPollerOptions, 'tenantIds'> = {},
): Promise<RuntimeInventoryReconciliationResult[]> {
  const pooled = config.tenancyMode === 'pooled';
  const tenantIds = options.tenantIds?.length ? options.tenantIds : pooled ? undefined : [null];
  if (pooled && tenantIds?.includes(null)) throw new Error('Global runtime inventory scheduling is unavailable in pooled tenancy');
  const dataSource = await getDataSource();
  const engineRepo = dataSource.getRepository(Engine);
  const tenants = pooled ? await dataSource.getRepository(Tenant).find() : [];
  if (pooled && tenantIds?.some(id => id !== null && !tenants.some(t => t.id === id))) throw new Error('Scheduled inventory tenant is not registered');
  const engines = await engineRepo.find();
  const now = Date.now();
  const candidates = engines.filter((engine) => ((engine.runtimeAccessScope === 'resource_aware' && engine.metadataDiscoveryEnabled !== false)
      || engine.deploymentDiscoveryEnabled !== false)
    && (pooled || tenantIds!.includes(engine.tenantId || null))
    && (engine.lifecycleStatus || 'active') === 'active'
    && (!engine.lastMetadataReconciledAt
      || now - Number(engine.lastMetadataReconciledAt) >= Number(engine.reconciliationIntervalSeconds || 300) * 1000));
  const results: RuntimeInventoryReconciliationResult[] = [];

  for (const engine of candidates) {
    if (pooled && engine.tenancyMode === 'shared') {
      try { results.push(...await reconcileSharedEngineInventory(engine, tenantIds)); }
      catch (error) {
        logger.warn('Shared engine inventory aggregate failed', { engineId: engine.id, error });
        results.push({ engineId: engine.id, tenantId: null, status: 'failed' });
      }
      continue;
    }
    const scopeIds: Array<string | null> = [engine.tenantId || null];
    for (const tenantId of scopeIds) {
      if (tenantIds && !tenantIds.includes(tenantId)) continue;
      const tenant = pooled ? tenants.find(t => t.id === tenantId) : undefined;
      if (tenant && tenant.status !== 'active') continue;
      try {
        if (pooled && !tenant) throw new Error('Global or unregistered runtime inventory is unavailable in pooled tenancy');
        const work = () => engineMetadataReconciliationService.reconcileEngine(engine.id, tenantId, {
          runtimeMetadataDiscoveryEnabled: engine.runtimeAccessScope === 'resource_aware' && engine.metadataDiscoveryEnabled !== false,
          deploymentDiscoveryEnabled: engine.deploymentDiscoveryEnabled !== false,
        });
        const { deployments, ...result } = await (tenant
          ? runWithTenantDatabaseContext({ tenantId: tenant.id, tenantSlug: tenant.slug }, work) : work());
        results.push({ engineId: engine.id, tenantId, status: 'reconciled', ...result,
          deploymentsCreated: deployments.created, deploymentsUpdated: deployments.updated, deploymentArtifactsCreated: deployments.artifactsCreated });
      } catch (error) {
        logger.warn('Scheduled runtime inventory reconciliation failed', { engineId: engine.id, tenantId, error });
        results.push({ engineId: engine.id, tenantId, status: 'failed' });
      }
    }
  }
  return results;
}

export async function startRuntimeInventoryPollerIfEnabled(options: RuntimeInventoryPollerOptions = {}) {
  const envOptions = readOptionsFromEnv();
  const intervalMs = options.intervalMs ?? envOptions.intervalMs;
  if (timer || !Number.isFinite(intervalMs) || intervalMs <= 0) return timer;
  const tenantIds = options.tenantIds ?? envOptions.tenantIds;
  const runOnStart = options.runOnStart ?? envOptions.runOnStart;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledRuntimeInventoryReconciliationOnce({ tenantIds });
    } catch (error) {
      logger.warn('Scheduled runtime inventory reconciliation scan failed', { error });
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => { void tick(); }, intervalMs);
  if (runOnStart) void tick();
  return timer;
}

export function stopRuntimeInventoryPoller() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
