import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProcessesOverviewPage from '@src/features/mission-control/processes-overview/ProcessesOverviewPage';

const instanceState = vi.hoisted(() => ({ empty: false }));

vi.mock('react-split-pane', () => ({
  SplitPane: ({ children }: any) => <div>{children}</div>,
  Pane: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@src/features/mission-control/processes-overview/hooks', async () => {
  const actual = await vi.importActual<typeof import('@src/features/mission-control/processes-overview/hooks')>('@src/features/mission-control/processes-overview/hooks');
  return {
    ...actual,
    useProcessesData: () => ({
      defsQ: { data: [{ id: 'def-1', key: 'order-process', name: 'Order Process', version: 1 }] },
      defItems: [{ id: 'order-process', label: 'Order Process', key: 'order-process', version: 1 }],
      versions: [1],
      currentKey: 'order-process',
      defIdForVersion: 'def-1',
      xmlQ: { data: null, isLoading: false },
      countsQ: { data: null, isLoading: false },
      countsByStateQ: { data: null, isLoading: false },
      previewCountQ: { data: null, isLoading: false },
      instQ: {
        data: instanceState.empty ? [] : [
          {
            id: 'inst-1',
            processDefinitionKey: 'order-process',
            state: 'ACTIVE',
            startTime: new Date().toISOString(),
          },
        ],
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch: vi.fn(),
      },
      defIdQ: { data: 'def-1', isLoading: false },
    }),
    useProcessesModalData: () => ({
      allRetryItems: [],
      retryJobsQ: { data: [], isLoading: false, error: null, refetch: vi.fn() },
      retryExtTasksQ: { data: [], isLoading: false, error: null, refetch: vi.fn() },
      varsQ: { data: [], isLoading: false },
      histQ: { data: [], isLoading: false },
    }),
    useBulkOperations: () => ({
      bulkDeleteModal: { isOpen: false, data: null },
      bulkRetryModal: { isOpen: false },
      bulkSuspendModal: { isOpen: false },
      bulkActivateModal: { isOpen: false },
      bulkRetryBusy: false,
      bulkActivateBusy: false,
      bulkSuspendBusy: false,
      bulkDeleteBusy: false,
      bulkRetry: vi.fn(),
      bulkDelete: vi.fn(),
      bulkSuspend: vi.fn(),
      bulkActivate: vi.fn(),
      callAction: vi.fn().mockResolvedValue(null),
    }),
    useRetryModal: () => ({
      retryItems: [],
      retrySelectionMap: {},
      setRetrySelectionMap: vi.fn(),
      retryDueMode: 'relative',
      setRetryDueMode: vi.fn(),
      retryDueInput: '',
      setRetryDueInput: vi.fn(),
      retryModalBusy: false,
      setRetryModalBusy: vi.fn(),
      retryModalError: null,
      setRetryModalError: vi.fn(),
      retryModalSuccess: null,
      setRetryModalSuccess: vi.fn(),
    }),
    useSplitPaneState: actual.useSplitPaneState,
  };
});

describe('ProcessesOverviewPage instances', () => {
  beforeEach(() => { instanceState.empty = false; });

  it('shows only the table empty state when the engine returns no instances', async () => {
    instanceState.empty = true;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/mission-control/processes']}>
          <ProcessesOverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(screen.getAllByText('No results found')).toHaveLength(1);
    expect(screen.getByText('Try adjusting your filters or search criteria.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Instance ID' })).toBeInTheDocument();
    expect(screen.queryByText('No visible process instances')).not.toBeInTheDocument();
    expect(screen.queryByText(/No authorized instances match/)).not.toBeInTheDocument();
  });

  it('renders instance row', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/mission-control/processes']}>
          <ProcessesOverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Order Process')).toBeInTheDocument();
    });
  });
});
