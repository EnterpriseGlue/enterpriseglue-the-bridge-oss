import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProcessesOverviewPage from '@src/features/mission-control/processes-overview/ProcessesOverviewPage';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import { PlatformPermission } from '@src/shared/auth/permissions';
import {
  createSavedProcessFilter,
  deleteSavedProcessFilter,
  listSavedProcessFilters,
} from '@src/features/mission-control/processes-overview/api/processDefinitions';
import { useProcessesFilterStore } from '@src/features/mission-control/shared/stores/processesFilterStore';

vi.mock('@carbon/react', async () => {
  const actual = await vi.importActual<any>('@carbon/react');
  return {
    ...actual,
    Checkbox: ({ id, checked, indeterminate, labelText, onChange }: any) => (
      <input
        id={id}
        aria-label={labelText || id}
        type="checkbox"
        checked={Boolean(checked)}
        data-indeterminate={indeterminate ? 'true' : undefined}
        onClick={(event) => onChange?.(event, { checked: !Boolean(checked) })}
        onChange={() => {}}
      />
    ),
  };
});

vi.mock('react-split-pane', () => ({
  SplitPane: ({ children }: any) => <div>{children}</div>,
  Pane: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@src/features/mission-control/processes-overview/api/processDefinitions', () => ({
  listSavedProcessFilters: vi.fn(),
  createSavedProcessFilter: vi.fn(),
  deleteSavedProcessFilter: vi.fn(),
}));

const deniedAuthContext: AuthContextValue = {
  user: null,
  permissions: {
    userId: 'user-1',
    platform: [],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
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

const bulkAuthContext: AuthContextValue = {
  ...deniedAuthContext,
  permissions: {
    userId: 'user-1',
    platform: [PlatformPermission.AUTHZ_ROLES_VIEW],
    projects: [],
    engines: [
      {
        resourceId: 'engine-1',
        permissions: [
          'engine:instance:view',
          'engine:instance:delete',
          'engine:instance:retry',
          'engine:process:modify',
        ],
      },
    ],
    generatedAt: 1,
  },
};

vi.mock('@src/features/mission-control/processes-overview/hooks', async () => {
  const splitPane = await vi.importActual<typeof import('@src/features/mission-control/shared/hooks/useSplitPaneState')>('@src/features/mission-control/shared/hooks/useSplitPaneState');
  return {
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
            id: 'inst-1',
            processDefinitionKey: 'order-process',
            state: 'ACTIVE',
            startTime: new Date().toISOString(),
          },
          {
            id: 'inst-2',
            processDefinitionKey: 'order-process',
            state: 'ACTIVE',
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
    useSplitPaneState: splitPane.useSplitPaneState,
  };
});

describe('ProcessesOverviewPage selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProcessesFilterStore.getState().reset();
    vi.mocked(listSavedProcessFilters).mockResolvedValue([]);
    vi.mocked(createSavedProcessFilter).mockResolvedValue({
      id: 'filter-1',
      name: 'Saved filter',
      engineId: 'engine-1',
      defKeys: ['order-process'],
      version: '1',
      active: true,
      incidents: true,
      completed: false,
      canceled: false,
      createdAt: 1,
    });
    vi.mocked(deleteSavedProcessFilter).mockResolvedValue(undefined);
  }, 30000);

  it('updates selection count when rows selected', async () => {
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

    fireEvent.click(screen.getByRole('checkbox', { name: 'select-inst-1' }), { target: { checked: true } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'select-inst-2' }), { target: { checked: true } });

    await waitFor(() => {
      expect(screen.getByText('2 of 2 Process Instances selected')).toBeInTheDocument();
    });
  });

  it('disables process start when start permission is missing', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <AuthContext.Provider value={deniedAuthContext}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/mission-control/processes?process=order-process']}>
            <ProcessesOverviewPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>
    );

    const startButton = await screen.findByRole('button', { name: /^Start$/i });
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute('title', 'Missing permission engine:process:start');
  });

  it('saves the current process filter when saved-filter manage is allowed', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();

    render(
      <AuthContext.Provider value={bulkAuthContext}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/mission-control/processes?process=order-process']}>
            <ProcessesOverviewPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>
    );

    await screen.findByRole('button', { name: /^Start$/i });
    await user.click(await screen.findByRole('button', { name: /save current filter/i }));

    const nameInput = await screen.findByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Operations incidents');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => {
      expect(createSavedProcessFilter).toHaveBeenCalled();
      expect(vi.mocked(createSavedProcessFilter).mock.calls[0]?.[0]).toEqual({
        name: 'Operations incidents',
        engineId: 'engine-1',
        defKeys: ['order-process'],
        version: null,
        active: true,
        incidents: true,
        completed: false,
        canceled: false,
      });
    });
  }, 30000);

  it('shows partial-denial diagnostics for selected bulk actions', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <AuthContext.Provider value={bulkAuthContext}>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/mission-control/processes']}>
            <ProcessesOverviewPage />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthContext.Provider>
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'select-inst-1' }), { target: { checked: true } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'select-inst-2' }), { target: { checked: true } });

    await screen.findByText('2 of 2 Process Instances selected');

    const retryButton = await screen.findByRole('button', { name: /retry failed jobs \(batch\)/i });
    const activateButton = screen.getByRole('button', { name: /activate \(batch\)/i });
    const suspendButton = screen.getByRole('button', { name: /suspend \(batch\)/i });
    const cancelButton = screen.getByRole('button', { name: /cancel \(batch\)/i });

    expect(retryButton).toBeDisabled();
    expect(retryButton).toHaveAttribute(
      'title',
      'Unavailable: 2 of 2 selected instances cannot be retried. First reason: instance has no incident.'
    );
    expect(activateButton).toBeDisabled();
    expect(activateButton).toHaveAttribute(
      'title',
      'Unavailable: 2 of 2 selected instances cannot be activated. First reason: instance is already active.'
    );
    expect(suspendButton).toBeEnabled();
    expect(cancelButton).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Why unavailable' })).toHaveAttribute(
      'href',
      '/admin/access-control?tab=effective-access&actionId=engine.runtime.batches.process-instances.activate&permissionId=engine%3Aprocess%3Amodify&resourceType=engine&resourceId=engine-1'
    );
  });
});
