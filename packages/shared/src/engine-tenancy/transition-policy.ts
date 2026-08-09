import type {
  EngineTenancyTopologyState,
  EngineTenancyTransitionAcknowledgement,
  EngineTenancyTransitionEffects,
  EngineTenancyTransitionKind,
} from '../schemas/mission-control/engine.js';

export interface EngineTenancyTransitionRuntimeResource {
  tenantId: string | null;
  tenantResolutionStatus: 'resolved' | 'unmapped' | 'conflict' | 'stale';
}

export interface EngineTenancyTransitionInventory {
  roleAssignments: number;
  activeTenantMappings: number;
  runtimeResources: EngineTenancyTransitionRuntimeResource[];
  engineSetMemberships: number;
  deploymentTargets: number;
  deploymentReceipts: number;
}

export interface EngineTenancyTransitionPlan {
  kind: EngineTenancyTransitionKind;
  effects: EngineTenancyTransitionEffects;
  requiredAcknowledgements: EngineTenancyTransitionAcknowledgement[];
}

export function getEngineTenancyTransitionKind(
  current: EngineTenancyTopologyState,
  proposed: EngineTenancyTopologyState,
): EngineTenancyTransitionKind | null {
  if (current.mode === 'dedicated' && proposed.mode === 'shared') return 'dedicated_to_shared';
  if (current.mode === 'shared' && proposed.mode === 'dedicated') return 'shared_to_dedicated';
  if (
    current.mode === 'shared'
    && proposed.mode === 'shared'
    && current.mappingStrategy !== proposed.mappingStrategy
  ) {
    return 'shared_strategy_change';
  }
  if (
    current.mode === 'dedicated'
    && proposed.mode === 'dedicated'
    && current.tenantId !== proposed.tenantId
  ) {
    return 'dedicated_tenant_move';
  }
  return null;
}

export function buildEngineTenancyTransitionPlan(
  current: EngineTenancyTopologyState,
  proposed: EngineTenancyTopologyState,
  inventory: EngineTenancyTransitionInventory,
): EngineTenancyTransitionPlan | null {
  const kind = getEngineTenancyTransitionKind(current, proposed);
  if (!kind) return null;

  const replacesSharedMappings = current.mode === 'shared'
    && (proposed.mode === 'dedicated' || current.mappingStrategy !== proposed.mappingStrategy);
  const becomeUnmapped = proposed.mode === 'shared' ? inventory.runtimeResources.length : 0;
  const becomeHidden = proposed.mode === 'shared'
    ? inventory.runtimeResources.filter((resource) => resource.tenantResolutionStatus === 'resolved').length
    : inventory.runtimeResources.filter((resource) =>
        resource.tenantResolutionStatus === 'resolved'
        && resource.tenantId !== proposed.tenantId
      ).length;
  const becomeVisible = proposed.mode === 'dedicated'
    ? inventory.runtimeResources.filter((resource) =>
        resource.tenantResolutionStatus !== 'resolved'
        || resource.tenantId !== proposed.tenantId
      ).length
    : 0;
  const effects: EngineTenancyTransitionEffects = {
    roleAssignments: inventory.roleAssignments,
    tenantMappings: replacesSharedMappings ? inventory.activeTenantMappings : 0,
    runtimeResources: inventory.runtimeResources.length,
    engineSetMemberships: inventory.engineSetMemberships,
    deploymentTargets: inventory.deploymentTargets,
    deploymentReceipts: inventory.deploymentReceipts,
    visibility: {
      becomeVisible,
      becomeHidden,
      becomeUnmapped,
      becomeConflicting: 0,
    },
  };
  const requiredAcknowledgements: EngineTenancyTransitionAcknowledgement[] = [
    'acknowledge_topology_change',
  ];
  if (effects.tenantMappings > 0) {
    requiredAcknowledgements.push('acknowledge_mapping_deactivation');
  }
  if (effects.visibility.becomeUnmapped > 0) {
    requiredAcknowledgements.push('acknowledge_resource_quarantine');
  }
  if (
    effects.roleAssignments > 0
    || effects.visibility.becomeVisible > 0
    || effects.visibility.becomeHidden > 0
  ) {
    requiredAcknowledgements.push('acknowledge_access_change');
  }

  return { kind, effects, requiredAcknowledgements };
}
