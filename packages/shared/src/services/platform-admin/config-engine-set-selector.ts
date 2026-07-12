import type { EngineSetSelector } from './EngineSetService.js';

export interface ConfigEngineSetSelector {
  mode: 'all' | 'engine_ids' | 'labels';
  engineKeys?: string[];
  labels?: Record<string, string>;
  labelMatch?: 'all' | 'any';
}

/** Resolves config keys after staged engine upserts and before materialization. */
export function resolveConfigEngineSetSelector(
  selector: ConfigEngineSetSelector,
  engineIdByConfigKey: Map<string, string>,
): EngineSetSelector {
  if (selector.mode === 'all') return { mode: 'all' };
  if (selector.mode === 'labels') return { mode: 'labels', labels: selector.labels || {}, labelMatch: selector.labelMatch || 'all' };
  const engineIds = (selector.engineKeys || []).map((key) => {
    const id = engineIdByConfigKey.get(key);
    if (!id) throw new Error(`Engine Set references an unresolved engine key: ${key}`);
    return id;
  });
  return { mode: 'engine_ids', engineIds };
}
