import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { getTenantDatabaseContext } from '@enterpriseglue/shared/services/tenant-database-context.js';
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
  const originalTenancyMode = config.tenancyMode;
  beforeEach(() => {
    config.tenancyMode = 'single';
    vi.clearAllMocks();
    resetEngineTenancyOperationalMetricsForTests();
  });
  afterEach(() => { config.tenancyMode = originalTenancyMode; });

  it('sums real pooled tenant scopes and explicitly excludes unsupported global inventory', async () => {
    config.tenancyMode = 'pooled';
    const tenantFind = vi.fn().mockResolvedValue([
      { id: 'a', slug: 'alpha', status: 'active' }, { id: 'b', slug: 'beta', status: 'active' },
      { id: 'disabled', slug: 'disabled', status: 'suspended' },
    ]);
    const resourceFind = vi.fn().mockImplementation(async ({ where }) => {
      expect(getTenantDatabaseContext()).toEqual({ tenantId: where.tenantId, tenantSlug: where.tenantId === 'a' ? 'alpha' : 'beta' });
      expect(where).toEqual({ isActive: true, tenantId: where.tenantId });
      return where.tenantId === 'a' ? [{ tenantResolutionStatus: 'resolved' }] : [{ tenantResolutionStatus: 'resolved' }, { tenantResolutionStatus: 'stale' }];
    });
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === Tenant) return { find: tenantFind };
      if (entity === RuntimeResource) return { find: resourceFind };
      if (entity === Engine) return { find: vi.fn().mockResolvedValue([]) };
      throw new Error('Unexpected repository');
    } } as any);
    const metrics = await getEngineTenancyMetrics();
    expect(metrics).toContain('enterpriseglue_engine_tenancy_metrics_collection_success 1');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_global_runtime_collection_supported 0');
    expect(metrics).toContain('global and unowned resources are unsupported and excluded');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_runtime_resources{resolution_status="resolved"} 2');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_runtime_resources{resolution_status="stale"} 1');
    expect(tenantFind).toHaveBeenCalledWith({ where: { status: 'active' }, select: ['id', 'slug', 'status'] });
    expect(resourceFind).toHaveBeenCalledTimes(2);
    expect(getTenantDatabaseContext()).toBeUndefined();
  });

  it('fails the whole persistence scrape when one tenant scan fails, rather than publishing a partial healthy count', async () => {
    config.tenancyMode = 'pooled';
    const resourceFind = vi.fn().mockImplementation(async ({ where }) => {
      expect(getTenantDatabaseContext()?.tenantId).toBe(where.tenantId);
      if (where.tenantId === 'b') throw new Error('tenant unavailable');
      return [{ tenantResolutionStatus: 'resolved' }];
    });
    vi.mocked(getDataSource).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === Tenant) return { find: vi.fn().mockResolvedValue([{ id: 'a', slug: 'alpha', status: 'active' }, { id: 'b', slug: 'beta', status: 'active' }]) };
      if (entity === RuntimeResource) return { find: resourceFind };
      if (entity === Engine) return { find: vi.fn().mockResolvedValue([]) };
      throw new Error('Unexpected repository');
    } } as any);
    const metrics = await getEngineTenancyMetrics();
    expect(metrics).toContain('enterpriseglue_engine_tenancy_metrics_collection_success 0');
    expect(metrics).toContain('enterpriseglue_engine_tenancy_global_runtime_collection_supported 0');
    expect(metrics).not.toContain('enterpriseglue_engine_tenancy_runtime_resources{');
    expect(metrics).not.toContain('enterpriseglue_engine_tenancy_engines{');
    expect(resourceFind).toHaveBeenCalledTimes(2);
    expect(getTenantDatabaseContext()).toBeUndefined();
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
