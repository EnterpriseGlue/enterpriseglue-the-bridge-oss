import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserRouter, useLocation } from 'react-router-dom';
import {
  EngineSelector,
  useEngineSelection,
} from '@src/components/EngineSelector';
import { useEngineSelectorStore } from '@src/stores/engineSelectorStore';
import { getAccessibleEngines } from '@src/features/mission-control/engines/api/engines';
import { AuthContext } from '@src/contexts/AuthContext';

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

function createWrapper(options?: { queryClient?: QueryClient; user?: any }) {
  const queryClient = options?.queryClient || new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>
      <AuthContext.Provider value={{ user: options?.user || null } as any}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </AuthContext.Provider>
      <LocationProbe />
    </BrowserRouter>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="engine-location">{`${location.pathname}${location.search}`}</output>;
}

describe('EngineSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
    useEngineSelectorStore.setState({ selectedEngineId: undefined, activeScope: undefined, selectedEngineIdsByScope: {} });
  });

  it('resolves a missing selection to the first accessible engine in stable order', async () => {
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-a'));
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-a'));
    expect(result.current.engines.map((engine) => engine.id)).toEqual(['engine-a', 'engine-z']);
  });

  it('retains a persisted selection while it remains accessible', async () => {
    useEngineSelectorStore.getState().setSelectedEngineIdForScope('anonymous:root:root', 'engine-z');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-z'));
    expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-z');
  });

  it('uses an accessible deep-link engine before the persisted selection', async () => {
    window.history.replaceState(null, '', '/t/default/mission-control/processes?engineId=engine-z');
    useEngineSelectorStore.getState().setSelectedEngineIdForScope('anonymous:default:default', 'engine-a');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-z'));
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-z'));
  });

  it('fails closed and preserves an explicit deep link to an unavailable engine', async () => {
    window.history.replaceState(null, '', '/t/default/mission-control/processes?engineId=removed-engine');
    useEngineSelectorStore.getState().setSelectedEngineIdForScope('anonymous:default:default', 'engine-a');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isRequestedEngineUnavailable).toBe(true));
    expect(result.current.requestedEngineId).toBe('removed-engine');
    expect(result.current.selectedEngineId).toBeUndefined();
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBeUndefined());
    expect(window.location.search).toBe('?engineId=removed-engine');
  });

  it('replaces a stale persisted selection with an accessible engine', async () => {
    useEngineSelectorStore.getState().setSelectedEngineIdForScope('anonymous:root:root', 'removed-engine');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-a'));
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-a'));
  });

  it('clears a stale selection and reports an empty authorized inventory', async () => {
    useEngineSelectorStore.getState().setSelectedEngineIdForScope('anonymous:root:root', 'removed-engine');
    vi.mocked(getAccessibleEngines).mockResolvedValue([]);

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isEmpty).toBe(true));
    await waitFor(() => expect(useEngineSelectorStore.getState().selectedEngineId).toBeUndefined());
    expect(result.current.selectedEngineId).toBeUndefined();
  });

  it('fails closed when the accessible-engine inventory cannot be loaded', async () => {
    useEngineSelectorStore.getState().setSelectedEngineIdForScope('anonymous:root', 'engine-z');
    vi.mocked(getAccessibleEngines).mockRejectedValue(new Error('inventory unavailable'));

    const { result } = renderHook(() => useEngineSelection(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.selectedEngineId).toBeUndefined();
    expect(result.current.error).toEqual(expect.objectContaining({ message: 'inventory unavailable' }));
  });

  it('does not request tenant engines when its route context is unavailable', async () => {
    const { result } = renderHook(() => useEngineSelection(false), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(getAccessibleEngines).not.toHaveBeenCalled();
    expect(result.current.selectedEngineId).toBeUndefined();
    expect(result.current.isEmpty).toBe(false);
  });

  it('hides cached tenant engine data when the route context becomes unavailable', async () => {
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);
    const { result, rerender } = renderHook(
      ({ enabled }) => useEngineSelection(enabled),
      { wrapper: createWrapper(), initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.selectedEngineId).toBe('engine-a'));
    rerender({ enabled: false });

    expect(result.current.engines).toEqual([]);
    expect(result.current.selectedEngineId).toBeUndefined();
    expect(result.current.isEmpty).toBe(false);
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

  it('updates the shareable engine context when the operator changes engines', async () => {
    window.history.replaceState(null, '', '/t/default/mission-control/processes?process=orders&engineId=engine-a');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    render(<EngineSelector />, { wrapper: createWrapper() });

    expect(await screen.findByTestId('engine-dropdown')).toBeInTheDocument();
    const props = dropdownSpy.mock.calls[dropdownSpy.mock.calls.length - 1]?.[0];
    act(() => props.onChange({ selectedItem: { id: 'engine-z' } }));

    expect(screen.getByTestId('engine-location')).toHaveTextContent(
      '/t/default/mission-control/processes?process=orders&engineId=engine-z',
    );
    expect(useEngineSelectorStore.getState().selectedEngineId).toBe('engine-z');
  });

  it('does not add Mission Control query state to unrelated product routes', async () => {
    window.history.replaceState(null, '', '/t/default/starbase?project=orders');
    vi.mocked(getAccessibleEngines).mockResolvedValue(engines);

    render(<EngineSelector />, { wrapper: createWrapper() });

    expect(await screen.findByTestId('engine-dropdown')).toBeInTheDocument();
    const props = dropdownSpy.mock.calls[dropdownSpy.mock.calls.length - 1]?.[0];
    act(() => props.onChange({ selectedItem: { id: 'engine-z' } }));

    expect(screen.getByTestId('engine-location')).toHaveTextContent('/t/default/starbase?project=orders');
  });

  it('does not reuse an accessible-engine inventory across tenant or principal scopes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    vi.mocked(getAccessibleEngines).mockResolvedValueOnce([engines[0]]);
    const userA = { id: 'user-a', session: { principal: { id: 'user-a' }, tenant: { id: 'tenant-a' } } };
    const first = renderHook(() => useEngineSelection(), { wrapper: createWrapper({ queryClient, user: userA }) });
    await waitFor(() => expect(first.result.current.selectedEngineId).toBe('engine-z'));
    first.unmount();

    vi.mocked(getAccessibleEngines).mockResolvedValueOnce([engines[1]]);
    const userB = { id: 'user-b', session: { principal: { id: 'user-b' }, tenant: { id: 'tenant-b' } } };
    const second = renderHook(() => useEngineSelection(), { wrapper: createWrapper({ queryClient, user: userB }) });
    await waitFor(() => expect(second.result.current.selectedEngineId).toBe('engine-a'));

    expect(getAccessibleEngines).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryCache().find({ queryKey: ['engines-selector', 'user-a:tenant-a:root'], exact: true })).toBeDefined();
    expect(queryClient.getQueryCache().find({ queryKey: ['engines-selector', 'user-b:tenant-b:root'], exact: true })).toBeDefined();
  });

  it('does not reuse inventory while a tenant route changes ahead of the session tenant', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const user = { id: 'user-a', session: { principal: { id: 'user-a' }, tenant: { id: 'tenant-a' } } };
    window.history.replaceState(null, '', '/t/tenant-a/mission-control/processes');
    vi.mocked(getAccessibleEngines).mockResolvedValueOnce([engines[0]]);
    const first = renderHook(() => useEngineSelection(), { wrapper: createWrapper({ queryClient, user }) });
    await waitFor(() => expect(first.result.current.selectedEngineId).toBe('engine-z'));
    first.unmount();

    window.history.replaceState(null, '', '/t/tenant-b/mission-control/processes');
    vi.mocked(getAccessibleEngines).mockResolvedValueOnce([engines[1]]);
    const second = renderHook(() => useEngineSelection(), { wrapper: createWrapper({ queryClient, user }) });
    await waitFor(() => expect(second.result.current.selectedEngineId).toBe('engine-a'));

    expect(getAccessibleEngines).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryCache().find({ queryKey: ['engines-selector', 'user-a:tenant-a:tenant-a'], exact: true })).toBeDefined();
    expect(queryClient.getQueryCache().find({ queryKey: ['engines-selector', 'user-a:tenant-a:tenant-b'], exact: true })).toBeDefined();
  });
});
