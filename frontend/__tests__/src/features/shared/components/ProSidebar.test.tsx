import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProSidebar from '@src/features/shared/components/ProSidebar';

const authState = vi.hoisted(() => ({
  user: { id: 'platform-admin', capabilities: {} } as any,
  permissions: {
    userId: 'platform-admin',
    platform: ['platform:settings:manage'],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:instance:view'] }],
    generatedAt: 1,
  } as any,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('@src/shared/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => true }));
vi.mock('@src/features/shared/stores/layoutStore', () => ({
  useLayoutStore: () => ({
    sidebarOpen: true,
    sidebarCollapsed: false,
    setSidebarOpen: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  }),
}));
vi.mock('@src/components/EngineSelector', () => ({
  EngineSelector: () => <div data-testid="engine-selector" />,
  useSelectedEngine: () => 'engine-1',
}));
vi.mock('@src/features/mission-control/shared/stores/processesFilterStore', () => ({
  useProcessesFilterStore: () => ({
    selectedProcess: null, setSelectedProcess: vi.fn(),
    selectedVersion: null, setSelectedVersion: vi.fn(),
    flowNode: '', setFlowNode: vi.fn(), flowNodes: [],
    selectedStates: [], setSelectedStates: vi.fn(),
    searchValue: '', setSearchValue: vi.fn(),
    dateFrom: '', dateTo: '', timeFrom: '', timeTo: '',
    setDateRange: vi.fn(), setTimeFrom: vi.fn(), setTimeTo: vi.fn(), reset: vi.fn(),
  }),
}));
vi.mock('@src/features/mission-control/shared/stores/decisionsFilterStore', () => ({
  useDecisionsFilterStore: () => ({
    selectedDefinition: null, selectedVersion: null, selectedStates: [], searchValue: '',
    dateFrom: '', dateTo: '', timeFrom: '', timeTo: '',
    setSelectedDefinition: vi.fn(), setSelectedVersion: vi.fn(), setSelectedStates: vi.fn(),
    setSearchValue: vi.fn(), setDateRange: vi.fn(), setTimeFrom: vi.fn(), setTimeTo: vi.fn(), reset: vi.fn(),
  }),
}));
vi.mock('@src/enterprise/extensionRegistry', () => ({ isMultiTenantEnabled: () => true }));
vi.mock('@src/shared/api/client', () => ({ apiClient: { get: vi.fn().mockResolvedValue([]) } }));
vi.mock('@src/plugins/nativePluginRuntime', () => ({ getNativePluginNavigationV1: () => [] }));

describe('ProSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders Mission Control navigation for an authorized multi-tenant platform administrator', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/t/acme/mission-control/processes']}>
          <ProSidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Processes')).toBeInTheDocument();
    expect(screen.getByTestId('engine-selector')).toBeInTheDocument();
  });
});
