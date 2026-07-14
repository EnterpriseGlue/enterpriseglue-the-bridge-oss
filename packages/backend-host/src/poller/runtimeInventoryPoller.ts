import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export interface RuntimeInventoryPollerOptions {
  intervalMs?: number;
  tenantIds?: Array<string | null>;
  runOnStart?: boolean;
}

export interface RuntimeInventoryReconciliationResult {
  engineId: string;
  tenantId: string | null;
  status: 'reconciled' | 'failed';
  created?: number;
  updated?: number;
  deactivated?: number;
  materializedSets?: number;
  deploymentsCreated?: number;
  deploymentsUpdated?: number;
  deploymentArtifactsCreated?: number;
}

function parsePositiveInterval(value: string | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function parseTenantIds(value: string | undefined): Array<string | null> {
  const normalized = value?.trim();
  if (!normalized) return [null];
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
 * Reconciles central/resource-aware engines only. Distributed engine-wide
 * engines do not require this inventory for authorization and are excluded to
 * keep the scheduled work bounded.
 */
export async function runScheduledRuntimeInventoryReconciliationOnce(
  options: Pick<RuntimeInventoryPollerOptions, 'tenantIds'> = {},
): Promise<RuntimeInventoryReconciliationResult[]> {
  const tenantIds = options.tenantIds?.length ? options.tenantIds : [null];
  const engineRepo = (await getDataSource()).getRepository(Engine);
  const engines = await engineRepo.find({ where: { runtimeAccessScope: 'resource_aware' } });
  const now = Date.now();
  const candidates = engines.filter((engine) => engine.runtimeAccessScope === 'resource_aware'
    && engine.metadataDiscoveryEnabled !== false
    && tenantIds.includes(engine.tenantId || null)
    && (engine.lifecycleStatus || 'active') === 'active'
    && (!engine.lastMetadataReconciledAt
      || now - Number(engine.lastMetadataReconciledAt) >= Number(engine.reconciliationIntervalSeconds || 300) * 1000));
  const results: RuntimeInventoryReconciliationResult[] = [];

  for (const engine of candidates) {
    const tenantId = engine.tenantId || null;
    try {
      const { deployments, ...result } = await engineMetadataReconciliationService.reconcileEngine(engine.id, tenantId);
      results.push({ engineId: engine.id, tenantId, status: 'reconciled', ...result,
        deploymentsCreated: deployments.created, deploymentsUpdated: deployments.updated, deploymentArtifactsCreated: deployments.artifactsCreated });
    } catch (error) {
      logger.warn('Scheduled runtime inventory reconciliation failed', { engineId: engine.id, tenantId, error });
      results.push({ engineId: engine.id, tenantId, status: 'failed' });
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
