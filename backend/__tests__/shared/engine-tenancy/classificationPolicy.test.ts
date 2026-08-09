import { describe, expect, it } from 'vitest';
import { classifyExistingEngineTenancy } from '@enterpriseglue/shared/engine-tenancy/classification-policy.js';
import type { EngineTenancyTopologyState } from '@enterpriseglue/shared/schemas/mission-control/engine.js';

function classify(current: Partial<EngineTenancyTopologyState>) {
  return classifyExistingEngineTenancy({
    engineId: 'engine-1',
    engineName: 'Engine 1',
    defaultTenantId: 'tenant-default',
    current: {
      mode: 'dedicated',
      tenantId: null,
      mappingStrategy: null,
      mappingVersion: 0,
      resolutionStatus: 'migration_required',
      runtimeAccessScope: 'engine_wide',
      ...current,
    },
  });
}

describe('existing engine tenancy classification policy', () => {
  it('accepts explicit valid dedicated and shared topology', () => {
    expect(classify({ tenantId: 'tenant-a', resolutionStatus: 'ready' })).toMatchObject({
      status: 'classified',
      proposed: null,
      reason: 'Dedicated engine has a concrete owning tenant.',
    });
    expect(classify({
      mode: 'shared',
      tenantId: null,
      mappingStrategy: 'engine_tenant_id',
      runtimeAccessScope: 'resource_aware',
      resolutionStatus: 'incomplete',
    })).toMatchObject({
      status: 'classified',
      proposed: null,
      reason: 'Shared engine has resource-aware access and an explicit mapping strategy.',
    });
  });

  it('proposes the default tenant only for an unowned engine-wide engine', () => {
    expect(classify({})).toMatchObject({
      status: 'ready_for_apply',
      proposed: {
        mode: 'dedicated',
        tenantRef: { type: 'id', id: 'tenant-default' },
      },
    });
  });

  it('requires review instead of inferring shared topology from resource-aware access', () => {
    expect(classify({ runtimeAccessScope: 'resource_aware' })).toMatchObject({
      status: 'requires_review',
      proposed: null,
    });
  });

  it('reports every other invalid topology as a conflict', () => {
    expect(classify({
      mode: 'shared',
      tenantId: 'tenant-a',
      mappingStrategy: null,
      runtimeAccessScope: 'engine_wide',
    })).toMatchObject({
      status: 'conflict',
      proposed: null,
    });
    expect(classifyExistingEngineTenancy({
      engineId: 'engine-invalid',
      engineName: 'Invalid',
      defaultTenantId: 'tenant-default',
      current: {
        mode: 'dedicated',
        tenantId: 'tenant-a',
        mappingStrategy: null,
        mappingVersion: 0,
        resolutionStatus: 'ready',
        runtimeAccessScope: 'engine_wide',
      },
      invariantConflict: 'Persisted mode is unsupported.',
    })).toMatchObject({
      status: 'conflict',
      reason: 'Persisted mode is unsupported.',
      proposed: null,
    });
  });
});
