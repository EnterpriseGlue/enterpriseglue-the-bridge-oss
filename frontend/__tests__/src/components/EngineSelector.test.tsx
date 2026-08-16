import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EngineSelector,
  useEngineSelection,
} from '@src/components/EngineSelector';
import { useEngineSelectorStore } from '@src/stores/engineSelectorStore';
import { getAccessibleEngines } from '@src/features/mission-control/engines/api/engines';

const dropdownSpy = vi.fn();

vi.mock('@src/features/mission-control/engines/api/engines', () => ({
  getAccessibleEngines: vi.fn(),
}));

vi.mock('@carbon/react', () => ({
  Dropdown: (props: any) => {
    dropdownSpy(props);
    return <div data-testid="engine-dropdown" />;
  },
}));

const engines = [
  { id: 'engine-z', name: 'Zulu', baseUrl: 'http://zulu.test' },
  { id: 'engine-a', name: 'Alpha', baseUrl: 'http://alpha.test' },
] as any[];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('EngineSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useEngineSelectorStore.setState({ selectedEngineId: undefined });
  });

  it('resolves a missing selection to the first accessible engine in stable order', async () => {
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-a'));
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-a'));
    expect(result.current.engines.map((engine) => engine.id)).toEqual(['engine-a', 'engine-z']);
  });

  it('retains a persisted selection while it remains accessible', async () => {
    useEngineSelectorStore.getState().setSelectedEngineId('engine-z');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-z'));
    expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-z');
  });

  it('replaces a stale persisted selection with an accessible engine', async () => {
    useEngineSelectorStore.getState().setSelectedEngineId('removed-engine');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-a'));
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-a'));
  });

  it('clears a stale selection and reports an empty authorized inventory', async () => {
    useEngineSelectorStore.getState().setSelectedEngineId('removed-engine');
    vi.mocked(getAccessibleEngines).mockResolvedValue([]);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBeUndefined());
    expect(result.current.selectedEngineId).toBeUndefined();
  });

  it('fails closed when the accessible-engine inventory cannot be loaded', async () => {
    useEngineSelectorStore.getState().setSelectedEngineId('engine-z');
    vi.mocked(getAccessibleEngines).mockRejectedValue(new Error('inventory unavailable'));

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.selectedEngineId).toBeUndefined();
    expect(result.current.error).toEqual(expect.objectContaining({ message: 'inventory unavailable' }));
  });

  it('renders the dropdown from the same resolved inventory', async () => {
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    render(<EngineSelector />, { wrapper: createWrapper() });

    expect(await screen.findByTestId('engine-dropdown')).toBeInTheDocument();
    const props = dropdownSpy.mock.calls[dropdownSpy.mock.calls.length - 1]?.[0];
    expect(props.items).toEqual([
      expect.objectContaining({ id: 'engine-a', label: 'Alpha', technicalId: 'engine-a' }),
      expect.objectContaining({ id: 'engine-z', label: 'Zulu', technicalId: 'engine-z' }),
    ]);
    expect(props.selectedItem).toEqual(expect.objectContaining({ id: 'engine-a' }));
  });
});
