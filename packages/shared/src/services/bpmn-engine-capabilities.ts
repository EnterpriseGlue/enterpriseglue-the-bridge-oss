import {
  normalizeEngineType,
  type EngineRuntimeQueryCapabilities,
  type EngineType,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js';

export const ENGINE_OPERATION_CAPABILITIES = [
  'engine.read',
  'engine.deploy',
  'engine.instance.mutate',
  'engine.task.mutate',
  'engine.job.mutate',
  'engine.batch.admin',
  'engine.admin',
] as const;

export type EngineOperationCapability = typeof ENGINE_OPERATION_CAPABILITIES[number];
export type EngineSupportLevel = 'certified' | 'compatible';

export type EngineCapabilities = {
  type: EngineType;
  compatibilityProfile: 'camunda7-rest';
  supportLevel: EngineSupportLevel;
  operations: EngineOperationCapability[];
  /**
   * Camunda-7-compatible adapters expose these query dimensions. `batches`
   * is intentionally false because EnterpriseGlue reads its locally recorded
   * batch lineage instead of asking an upstream batch collection to filter by
   * a process definition key.
   */
  queryCapabilities: Required<EngineRuntimeQueryCapabilities>;
};

const CAMUNDA7_RUNTIME_QUERY_CAPABILITIES: Required<EngineRuntimeQueryCapabilities> = {
  processDefinitionKey: true,
  decisionDefinitionKey: true,
  tenantFilters: true,
  instanceLineage: true,
  history: true,
  jobs: true,
  incidents: true,
  batches: false,
  counts: true,
};

const SUPPORT_LEVELS: Record<EngineType, EngineSupportLevel> = {
  ion: 'certified',
  operaton: 'compatible',
  camunda7: 'compatible',
};

export function getEngineCapabilities(type: unknown): EngineCapabilities {
  const normalizedType = normalizeEngineType(type);
  return {
    type: normalizedType,
    compatibilityProfile: 'camunda7-rest',
    supportLevel: SUPPORT_LEVELS[normalizedType],
    operations: [...ENGINE_OPERATION_CAPABILITIES],
    queryCapabilities: { ...CAMUNDA7_RUNTIME_QUERY_CAPABILITIES },
  };
}

export function withEngineCapabilities<T extends { type?: unknown }>(engine: T): T & { capabilities: EngineCapabilities } {
  return {
    ...engine,
    capabilities: getEngineCapabilities(engine.type),
  };
}
