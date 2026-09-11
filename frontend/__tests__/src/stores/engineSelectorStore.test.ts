import { describe, it, expect, beforeEach } from 'vitest';
import { useEngineSelectorStore } from '@src/stores/engineSelectorStore';

describe('engineSelectorStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useEngineSelectorStore.setState({ selectedEngineId: undefined, activeScope: undefined, selectedEngineIdsByScope: {} });
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

  it('keeps persisted selections isolated by principal and tenant scope', () => {
    const store = useEngineSelectorStore.getState();
    store.setSelectedEngineIdForScope('user-a:tenant-a', 'engine-a');
    store.setSelectedEngineIdForScope('user-b:tenant-b', 'engine-b');

    useEngineSelectorStore.getState().setActiveEngineScope('user-a:tenant-a');
    expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-a');
    useEngineSelectorStore.getState().setActiveEngineScope('user-b:tenant-b');
    expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-b');
  });
});
