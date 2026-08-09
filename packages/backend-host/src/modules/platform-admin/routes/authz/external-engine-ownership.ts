import { z } from 'zod';
import { parseExternalEngineJson } from './external-engine-serialization.js';

export const engineManagementModeSchema = z.enum(['external_managed', 'hybrid']);
export const engineFieldOwnerSchema = z.enum(['manual', 'external']);
export const engineFieldOwnershipSchema = z.record(z.string().min(1).max(128), engineFieldOwnerSchema);
export type EngineFieldOwnership = z.infer<typeof engineFieldOwnershipSchema>;

export const DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP: EngineFieldOwnership = {
  identity: 'external',
  connection: 'external',
  metadata: 'external',
  labels: 'external',
  auth: 'external',
  version: 'external',
  display: 'manual',
  environment: 'manual',
};

export function normalizeExternalEngineFieldOwnership(ownership?: EngineFieldOwnership | null): EngineFieldOwnership {
  return {
    ...DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP,
    ...(ownership || {}),
  };
}

export function externalEngineFieldOwnershipToJson(ownership?: EngineFieldOwnership | null): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(normalizeExternalEngineFieldOwnership(ownership))
      .sort(([left], [right]) => left.localeCompare(right))
  ));
}

export function parseExternalEngineFieldOwnership(value: string | null | undefined): EngineFieldOwnership {
  const parsed = parseExternalEngineJson(value);
  if (!parsed) return { ...DEFAULT_EXTERNAL_ENGINE_FIELD_OWNERSHIP };
  return normalizeExternalEngineFieldOwnership(Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, 'manual' | 'external'] => entry[1] === 'manual' || entry[1] === 'external')
  ));
}
