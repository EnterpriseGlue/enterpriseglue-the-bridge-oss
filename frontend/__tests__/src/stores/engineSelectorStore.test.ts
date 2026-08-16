import { describe, it, expect, beforeEach } from 'vitest';
import { useEngineSelectorStore } from '@src/stores/engineSelectorStore';

describe('engineSelectorStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useEngineSelectorStore.setState({ selectedEngineId: undefined });
  });

  it('defaults to no engine until the accessible inventory resolves', () => {
    expect(useEngineSelectorStore.getState().selectedEngineId).toBeUndefined();
  });

  it('updates selected engine', () => {
    useEngineSelectorStore.getState().setSelectedEngineId('engine-1');
    expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-1');
    useEngineSelectorStore.setState({ selectedEngineId: undefined });
    expect(useEngineSelectorStore.getState().selectedEngineId).toBeUndefined();
  });

  it('clears an inaccessible persisted engine', () => {
    useEngineSelectorStore.getState().setSelectedEngineId('engine-1');
    useEngineSelectorStore.getState().setSelectedEngineId(undefined);
    expect(useEngineSelectorStore.getState().selectedEngineId).toBeUndefined();
  });
});
