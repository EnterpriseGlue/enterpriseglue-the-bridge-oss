import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProcessesOverviewPage from '@src/features/mission-control/processes-overview/ProcessesOverviewPage';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';

vi.mock('react-split-pane', () => ({
  SplitPane: ({ children }: any) => <div>{children}</div>,
  Pane: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@src/features/mission-control/processes-overview/components/ProcessesDataTable', () => ({
  ProcessesDataTable: ({ setSelectedMap }: { setSelectedMap: (selection: Record<string, boolean>) => void }) => (
    <div>
      <span>Order Process</span>
      <button type="button" onClick={() => setSelectedMap({ 'inst-retry': true })}>
        Select retry instance
      </button>
    </div>
  ),
}));

const authContextValue: AuthContextValue = {
  user: null,
  permissions: {
    userId: 'user-1',
    platform: [],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view', 'engine:instance:retry'] }],
    generatedAt: 1,
  },
  isAuthenticated: true,
  isLoading: false,
  login: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
  refreshUser: vi.fn(),
  setAuthenticatedUser: vi.fn(),
  refreshPermissions: vi.fn(),
  hasPlatformPermission: vi.fn(),
  hasAnyPlatformPermission: vi.fn(),
  hasProjectPermission: vi.fn(),
  hasAnyProjectPermission: vi.fn(),
  hasAnyEnginePermission: vi.fn(),
  hasEnginePermission: vi.fn(),
  hasAnyScopedEnginePermission: vi.fn(),
};

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
        data: [
          {
            id: 'inst-retry',
            processDefinitionKey: 'order-process',
            state: 'ACTIVE',
            hasIncident: true,
            startTime: new Date().toISOString(),
          },
        ],
        isLoading: false,
        isError: false,
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

describe('ProcessesOverviewPage retry', () => {
  it('enables retry when an incident instance is selected', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <AuthContext.Provider value={authContextValue}>
          <MemoryRouter initialEntries={['/mission-control/processes']}>
            <ProcessesOverviewPage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Order Process')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /select retry instance/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry failed jobs/i })).toBeEnabled();
    });
  });
});
