import { describe, expect, it } from 'vitest';
import {
  buildEngineTenancyTransitionPlan,
  getEngineTenancyTransitionKind,
} from '@enterpriseglue/shared/engine-tenancy/transition-policy.js';
import type { EngineTenancyTopologyState } from '@enterpriseglue/shared/schemas/mission-control/engine.js';

function state(overrides: Partial<EngineTenancyTopologyState> = {}): EngineTenancyTopologyState {
  return {
    mode: 'dedicated',
    tenantId: 'tenant-a',
    mappingStrategy: null,
    mappingVersion: 0,
    resolutionStatus: 'ready',
    runtimeAccessScope: 'engine_wide',
    ...overrides,
  };
}

const emptyInventory = {
  roleAssignments: 0,
  activeTenantMappings: 0,
  runtimeResources: [],
  engineSetMemberships: 0,
  deploymentTargets: 0,
  deploymentReceipts: 0,
};

describe('engine tenancy transition policy', () => {
  it('classifies every supported transition and rejects equivalent topology', () => {
    expect(getEngineTenancyTransitionKind(
      state(),
      state({ mode: 'shared', tenantId: null, mappingStrategy: 'explicit', runtimeAccessScope: 'resource_aware' }),
    )).toBe('dedicated_to_shared');
    expect(getEngineTenancyTransitionKind(
      state({ mode: 'shared', tenantId: null, mappingStrategy: 'explicit', runtimeAccessScope: 'resource_aware' }),
      state(),
    )).toBe('shared_to_dedicated');
    expect(getEngineTenancyTransitionKind(
      state({ mode: 'shared', tenantId: null, mappingStrategy: 'explicit', runtimeAccessScope: 'resource_aware' }),
      state({ mode: 'shared', tenantId: null, mappingStrategy: 'engine_tenant_id', runtimeAccessScope: 'resource_aware' }),
    )).toBe('shared_strategy_change');
    expect(getEngineTenancyTransitionKind(state(), state({ tenantId: 'tenant-b' })))
      .toBe('dedicated_tenant_move');
    expect(getEngineTenancyTransitionKind(state(), state())).toBeNull();
  });

  it('quarantines all runtime resources when a dedicated engine becomes shared', () => {
    const plan = buildEngineTenancyTransitionPlan(
      state(),
      state({
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'engine_tenant_id',
        mappingVersion: 1,
        resolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      }),
      {
        roleAssignments: 3,
        activeTenantMappings: 2,
        runtimeResources: [
          { tenantId: 'tenant-a', tenantResolutionStatus: 'resolved' },
          { tenantId: null, tenantResolutionStatus: 'unmapped' },
          { tenantId: null, tenantResolutionStatus: 'conflict' },
        ],
        engineSetMemberships: 4,
        deploymentTargets: 5,
        deploymentReceipts: 6,
      },
    );

    expect(plan).toEqual({
      kind: 'dedicated_to_shared',
      effects: {
        roleAssignments: 3,
        tenantMappings: 0,
        runtimeResources: 3,
        engineSetMemberships: 4,
        deploymentTargets: 5,
        deploymentReceipts: 6,
        visibility: {
          becomeVisible: 0,
          becomeHidden: 1,
          becomeUnmapped: 3,
          becomeConflicting: 0,
        },
      },
      requiredAcknowledgements: [
        'acknowledge_topology_change',
        'acknowledge_resource_quarantine',
        'acknowledge_access_change',
      ],
    });
  });

  it('moves shared resources to one tenant and requires mapping/access acknowledgements', () => {
    const plan = buildEngineTenancyTransitionPlan(
      state({
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'explicit',
        mappingVersion: 7,
        runtimeAccessScope: 'resource_aware',
      }),
      state({ tenantId: 'tenant-a', runtimeAccessScope: 'resource_aware' }),
      {
        ...emptyInventory,
        activeTenantMappings: 2,
        runtimeResources: [
          { tenantId: 'tenant-a', tenantResolutionStatus: 'resolved' },
          { tenantId: 'tenant-b', tenantResolutionStatus: 'resolved' },
          { tenantId: null, tenantResolutionStatus: 'unmapped' },
        ],
      },
    );

    expect(plan?.effects.visibility).toEqual({
      becomeVisible: 2,
      becomeHidden: 1,
      becomeUnmapped: 0,
      becomeConflicting: 0,
    });
    expect(plan?.effects.tenantMappings).toBe(2);
    expect(plan?.requiredAcknowledgements).toEqual([
      'acknowledge_topology_change',
      'acknowledge_mapping_deactivation',
      'acknowledge_access_change',
    ]);
  });

  it('requires only topology acknowledgement for an empty shared strategy change', () => {
    const current = state({
      mode: 'shared',
      tenantId: null,
      mappingStrategy: 'explicit',
      runtimeAccessScope: 'resource_aware',
    });
    const plan = buildEngineTenancyTransitionPlan(
      current,
      { ...current, mappingStrategy: 'deployment_target' },
      emptyInventory,
    );
    expect(plan).toMatchObject({
      kind: 'shared_strategy_change',
      effects: {
        tenantMappings: 0,
        visibility: {
          becomeVisible: 0,
          becomeHidden: 0,
          becomeUnmapped: 0,
          becomeConflicting: 0,
        },
      },
      requiredAcknowledgements: ['acknowledge_topology_change'],
    });
  });

  it('returns no plan for an equivalent topology', () => {
    expect(buildEngineTenancyTransitionPlan(state(), state(), emptyInventory)).toBeNull();
  });
});
