import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import {
  getEngineTenancyDefaultFallbackMetrics,
  recordEngineTenancyDefaultFallback,
  resetEngineTenancyOperationalMetricsForTests,
} from '@enterpriseglue/shared/engine-tenancy/operational-metrics.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { getEngineTenancyMetrics } from '../../../packages/backend-host/src/services/engineTenancyMetrics.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/logger.js', () => ({
  logger: { warn: vi.fn() },
}));

describe('engine tenancy operational metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEngineTenancyOperationalMetricsForTests();
  });

  it('exports bounded aggregate topology, resolution, and fallback metrics without resource identifiers', async () => {
    const engineFind = vi.fn().mockResolvedValue([
      {
        id: 'engine-sensitive-id',
        tenantId: 'tenant-sensitive-id',
        tenancyMode: 'dedicated',
        tenantResolutionStatus: 'ready',
      },
      { tenancyMode: 'shared', tenantResolutionStatus: 'incomplete' },
      { tenancyMode: 'broken', tenantResolutionStatus: 'broken' },
    ]);
    const resourceFind = vi.fn().mockResolvedValue([
      { tenantResolutionStatus: 'resolved' },
      { tenantResolutionStatus: 'unmapped' },
      { tenantResolutionStatus: 'conflict' },
      { tenantResolutionStatus: 'broken' },
    ]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository(entity: unknown) {
        if (entity === Engine) return { find: engineFind };
        if (entity === RuntimeResource) return { find: resourceFind };
        throw new Error('Unexpected repository');
      },
    });
    recordEngineTenancyDefaultFallback({ principalType: 'api_client', declaration: 'omitted' });
    recordEngineTenancyDefaultFallback({ principalType: 'api_client', declaration: 'omitted' });
    recordEngineTenancyDefaultFallback({ principalType: 'user', declaration: 'explicit_request_context' });

    const metrics = await getEngineTenancyMetrics();

    expect(metrics).toContain('enterpriseglue_engine_tenancy_metrics_collection_success 1');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_engines{mode="dedicated",resolution_status="ready"} 1');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_engines{mode="shared",resolution_status="incomplete"} 1');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_engines{mode="unknown",resolution_status="unknown"} 1');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_engines{mode="shared",resolution_status="ready"} 0');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_runtime_resources{resolution_status="resolved"} 1');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_runtime_resources{resolution_status="stale"} 0');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_runtime_resources{resolution_status="unknown"} 1');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_default_fallback_total{principal_type="api_client",declaration="omitted"} 2');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_default_fallback_total{principal_type="user",declaration="explicit_request_context"} 1');
    expect(metrics).not.toContain('engine-sensitive-id');
    expect(metrics).not.toContain('tenant-sensitive-id');
    expect(engineFind).toHaveBeenCalledWith({ select: ['tenancyMode', 'tenantResolutionStatus'] });
    expect(resourceFind).toHaveBeenCalledWith({
      where: { isActive: true },
      select: ['tenantResolutionStatus'],
    });
    expect(getEngineTenancyDefaultFallbackMetrics()).toHaveLength(8);
  });

  it('keeps the scrape available with a failure gauge and process-local counters when persistence collection fails', async () => {
    (getDataSource as unknown as Mock).mockRejectedValue(new Error('database unavailable'));
    recordEngineTenancyDefaultFallback({ principalType: 'system', declaration: 'omitted' });

    const metrics = await getEngineTenancyMetrics();

    expect(metrics).toContain('enterpriseglue_engine_tenancy_metrics_collection_success 0');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_default_fallback_total{principal_type="system",declaration="omitted"} 1');
    expect(metrics).not.toContain('enterpriseglue_engine_tenancy_engines{');
    expect(logger.warn).toHaveBeenCalledWith('Failed to collect engine tenancy metrics', {
      error: expect.any(Error),
    });
  });
});
