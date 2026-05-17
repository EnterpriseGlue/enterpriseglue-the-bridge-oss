import { normalizeEngineType, type EngineType } from '@enterpriseglue/shared/schemas/mission-control/engine.js';

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
  };
}

export function withEngineCapabilities<T extends { type?: unknown }>(engine: T): T & { capabilities: EngineCapabilities } {
  return {
    ...engine,
    capabilities: getEngineCapabilities(engine.type),
  };
}
