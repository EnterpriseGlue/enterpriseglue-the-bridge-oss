import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { getEngineTenancyDefaultFallbackMetrics } from '@enterpriseglue/shared/engine-tenancy/operational-metrics.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';

const ENGINE_MODES = ['dedicated', 'shared', 'unknown'] as const;
const ENGINE_RESOLUTION_STATUSES = ['ready', 'incomplete', 'conflict', 'migration_required', 'unknown'] as const;
const RUNTIME_RESOLUTION_STATUSES = ['resolved', 'unmapped', 'conflict', 'stale', 'unknown'] as const;

function counterKey(...values: string[]): string {
  return values.join(':');
}

function countBy<T>(values: T[], keyFor: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function normalizeEngineMode(value: string | null | undefined): typeof ENGINE_MODES[number] {
  return value === 'dedicated' || value === 'shared' ? value : 'unknown';
}

function normalizeEngineResolutionStatus(
  value: string | null | undefined,
): typeof ENGINE_RESOLUTION_STATUSES[number] {
  return ENGINE_RESOLUTION_STATUSES.includes(value as typeof ENGINE_RESOLUTION_STATUSES[number])
    ? value as typeof ENGINE_RESOLUTION_STATUSES[number]
    : 'unknown';
}

function normalizeRuntimeResolutionStatus(
  value: string | null | undefined,
): typeof RUNTIME_RESOLUTION_STATUSES[number] {
  return RUNTIME_RESOLUTION_STATUSES.includes(value as typeof RUNTIME_RESOLUTION_STATUSES[number])
    ? value as typeof RUNTIME_RESOLUTION_STATUSES[number]
    : 'unknown';
}

function fallbackMetricLines(): string[] {
  return [
    '# HELP enterpriseglue_engine_tenancy_default_fallback_total Number of request-context tenancy decisions that actually fell through to the canonical default tenant since process start.',
    '# TYPE enterpriseglue_engine_tenancy_default_fallback_total counter',
    ...getEngineTenancyDefaultFallbackMetrics().map((metric) =>
      `enterpriseglue_engine_tenancy_default_fallback_total{principal_type="${metric.principalType}",declaration="${metric.declaration}"} ${metric.count}`),
  ];
}

export async function getEngineTenancyMetrics(): Promise<string> {
  try {
    const dataSource = await getDataSource();
    const [engines, runtimeResources] = await Promise.all([
      dataSource.getRepository(Engine).find({
        select: ['tenancyMode', 'tenantResolutionStatus'],
      }),
      dataSource.getRepository(RuntimeResource).find({
        where: { isActive: true },
        select: ['tenantResolutionStatus'],
      }),
    ]);
    const engineCounts = countBy(engines, (engine) => counterKey(
      normalizeEngineMode(engine.tenancyMode),
      normalizeEngineResolutionStatus(engine.tenantResolutionStatus),
    ));
    const runtimeCounts = countBy(runtimeResources, (resource) =>
      normalizeRuntimeResolutionStatus(resource.tenantResolutionStatus));

    return [
      '# HELP enterpriseglue_engine_tenancy_metrics_collection_success Whether the current scrape collected tenancy persistence gauges.',
      '# TYPE enterpriseglue_engine_tenancy_metrics_collection_success gauge',
      'enterpriseglue_engine_tenancy_metrics_collection_success 1',
      '# HELP enterpriseglue_engine_tenancy_engines Current engines by topology and tenant-resolution status.',
      '# TYPE enterpriseglue_engine_tenancy_engines gauge',
      ...ENGINE_MODES.flatMap((mode) => ENGINE_RESOLUTION_STATUSES.map((resolutionStatus) =>
        `enterpriseglue_engine_tenancy_engines{mode="${mode}",resolution_status="${resolutionStatus}"} ${engineCounts.get(counterKey(mode, resolutionStatus)) || 0}`)),
      '# HELP enterpriseglue_engine_tenancy_runtime_resources Current active runtime resources by tenant-resolution status.',
      '# TYPE enterpriseglue_engine_tenancy_runtime_resources gauge',
      ...RUNTIME_RESOLUTION_STATUSES.map((resolutionStatus) =>
        `enterpriseglue_engine_tenancy_runtime_resources{resolution_status="${resolutionStatus}"} ${runtimeCounts.get(resolutionStatus) || 0}`),
      ...fallbackMetricLines(),
      '',
    ].join('\n');
  } catch (error) {
    logger.warn('Failed to collect engine tenancy metrics', { error });
    return [
      '# HELP enterpriseglue_engine_tenancy_metrics_collection_success Whether the current scrape collected tenancy persistence gauges.',
      '# TYPE enterpriseglue_engine_tenancy_metrics_collection_success gauge',
      'enterpriseglue_engine_tenancy_metrics_collection_success 0',
      ...fallbackMetricLines(),
      '',
    ].join('\n');
  }
}
