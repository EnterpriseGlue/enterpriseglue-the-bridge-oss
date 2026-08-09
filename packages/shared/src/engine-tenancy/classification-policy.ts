import type {
  EngineTenancyClassificationRow,
  EngineTenancyTopologyState,
} from '../schemas/mission-control/engine.js';

export interface EngineTenancyClassificationInput {
  engineId: string;
  engineName: string;
  current: EngineTenancyTopologyState;
  defaultTenantId: string;
  invariantConflict?: string | null;
}

export function classifyExistingEngineTenancy(
  input: EngineTenancyClassificationInput,
): EngineTenancyClassificationRow {
  const { current } = input;
  const base = {
    engineId: input.engineId,
    engineName: input.engineName,
    current,
  };

  if (input.invariantConflict) {
    return {
      ...base,
      status: 'conflict',
      reason: input.invariantConflict,
      proposed: null,
    };
  }
  if (current.mode === 'dedicated' && current.tenantId) {
    return {
      ...base,
      status: 'classified',
      reason: 'Dedicated engine has a concrete owning tenant.',
      proposed: null,
    };
  }
  if (
    current.mode === 'shared'
    && current.runtimeAccessScope === 'resource_aware'
    && current.mappingStrategy
    && current.tenantId === null
  ) {
    return {
      ...base,
      status: 'classified',
      reason: 'Shared engine has resource-aware access and an explicit mapping strategy.',
      proposed: null,
    };
  }
  if (current.mode === 'dedicated' && !current.tenantId && current.runtimeAccessScope === 'engine_wide') {
    return {
      ...base,
      status: 'ready_for_apply',
      reason: 'Engine-wide engine can be assigned to the configured default tenant after operator review.',
      proposed: {
        mode: 'dedicated',
        tenantRef: { type: 'id', id: input.defaultTenantId },
      },
    };
  }
  if (current.mode === 'dedicated' && !current.tenantId && current.runtimeAccessScope === 'resource_aware') {
    return {
      ...base,
      status: 'requires_review',
      reason: 'Resource-aware access alone does not prove whether this engine is dedicated or shared.',
      proposed: null,
    };
  }
  return {
    ...base,
    status: 'conflict',
    reason: 'Engine topology violates the dedicated/shared tenancy invariants.',
    proposed: null,
  };
}
