import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from '@src/pages/Dashboard';
import { apiClient } from '@src/shared/api/client';
import { PlatformPermission } from '@src/shared/auth/permissions';
import { useDashboardFilterStore } from '@src/stores/dashboardFilterStore';

const authMocks = vi.hoisted(() => ({
  hasPlatformPermission: vi.fn(),
  hasAnyEnginePermission: vi.fn(),
  permissions: {
    platform: ['platform:dashboard:view'],
    projects: [],
    engines: [],
  },
}));

const engineSelectorMocks = vi.hoisted(() => ({ selectedEngineId: null as string | null }));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    permissions: authMocks.permissions,
    hasPlatformPermission: authMocks.hasPlatformPermission,
    hasAnyEnginePermission: authMocks.hasAnyEnginePermission,
  }),
}));

vi.mock('@src/components/EngineSelector', () => ({
  EngineSelector: () => <div data-testid="engine-selector" />,
  useEngineSelection: () => ({ engines: [], selectedEngineId: engineSelectorMocks.selectedEngineId, scope: 'dashboard-test' }),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

function mockDashboardApi({ totalFiles, fileTypes = { bpmn: 0, dmn: 0, form: 0 } }: { totalFiles: number; fileTypes?: { bpmn: number; dmn: number; form: number } }) {
  ;(apiClient.get as unknown as Mock).mockImplementation((url: string) => {
    if (url === '/api/dashboard/context') {
      return Promise.resolve({
        isPlatformAdmin: false,
        canViewActiveUsers: false,
        canViewEngines: true,
        canViewProcessData: false,
        canViewDeployments: false,
        canViewMetrics: false,
        projectMemberships: [],
      });
    }

    if (url === '/api/dashboard/stats') {
      return Promise.resolve({
        totalProjects: 0,
        totalFiles,
        fileTypes,
      });
    }

    if (url === '/engines-api/engines') {
      return Promise.resolve([]);
    }

    if (url === '/api/users') {
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  });
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useDashboardFilterStore.setState({ timePeriod: 7 });
    authMocks.permissions = {
      platform: ['platform:dashboard:view'],
      projects: [],
      engines: [],
    };
    authMocks.hasPlatformPermission.mockReturnValue(false);
    authMocks.hasAnyEnginePermission.mockReturnValue(false);
    engineSelectorMocks.selectedEngineId = null;
  });

  it('does not fetch dashboard data when dashboard read permission is missing', async () => {
    authMocks.permissions = {
      platform: [],
      projects: [],
      engines: [],
    };

    renderDashboard();

    expect(await screen.findByText('Dashboard unavailable')).toBeInTheDocument();
    expect(screen.getByText('You don’t have permission to view this dashboard.')).toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('hides the file structure section when there are no files to report', async () => {
    mockDashboardApi({ totalFiles: 0 });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    expect(screen.queryByText('File Structure')).not.toBeInTheDocument();
    expect(screen.queryByText('No files yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Total: 0 files')).not.toBeInTheDocument();
  });

  it('fails closed when the dashboard authorization context cannot be loaded and can retry', async () => {
    let contextAttempts = 0;
    ;(apiClient.get as unknown as Mock).mockImplementation((url: string) => {
      if (url === '/api/dashboard/context') {
        contextAttempts += 1;
        if (contextAttempts === 1) return Promise.reject(new Error('context unavailable'));
        return Promise.resolve({
          isPlatformAdmin: false,
          canViewActiveUsers: false,
          canViewEngines: true,
          canViewProcessData: false,
          canViewDeployments: false,
          canViewMetrics: false,
          projectMemberships: [],
        });
      }
      if (url === '/api/dashboard/stats') return Promise.resolve({ totalProjects: 0, totalFiles: 0, fileTypes: { bpmn: 0, dmn: 0, form: 0 } });
      return Promise.resolve([]);
    });

    renderDashboard();

    expect(await screen.findByText('Dashboard context could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());
    expect(contextAttempts).toBe(2);
  });

  it('shows a degraded-state notification when project statistics fail', async () => {
    ;(apiClient.get as unknown as Mock).mockImplementation((url: string) => {
      if (url === '/api/dashboard/context') return Promise.resolve({
        isPlatformAdmin: false,
        canViewActiveUsers: false,
        canViewEngines: true,
        canViewProcessData: false,
        canViewDeployments: false,
        canViewMetrics: false,
        projectMemberships: [],
      });
      if (url === '/api/dashboard/stats') return Promise.reject(new Error('stats unavailable'));
      return Promise.resolve([]);
    });

    renderDashboard();

    expect(await screen.findByText('Project statistics are unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Get started')).not.toBeInTheDocument();
  });

  it('shows the file structure section when files exist', async () => {
    mockDashboardApi({
      totalFiles: 3,
      fileTypes: { bpmn: 2, dmn: 1, form: 0 },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('File Structure')).toBeInTheDocument();
    });

    expect(screen.getAllByText('BPMN')).toHaveLength(2);
    expect(screen.getAllByText('DMN')).toHaveLength(2);
    expect(screen.getByText('Total: 3 files')).toBeInTheDocument();
  });

  it('shows active users from scoped platform permission even when legacy context is false', async () => {
    authMocks.hasPlatformPermission.mockImplementation((permission: string) =>
      permission === PlatformPermission.USERS_VIEW
    );
    mockDashboardApi({ totalFiles: 0 });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Active Users')).toBeInTheDocument();
    });

    expect(apiClient.get).toHaveBeenCalledWith('/api/users');
  });

  it('builds runtime counters from the authorized process-instance collection for the selected engine', async () => {
    engineSelectorMocks.selectedEngineId = 'engine-central';
    authMocks.hasAnyEnginePermission.mockReturnValue(true);
    (apiClient.get as unknown as Mock).mockImplementation((url: string, query?: Record<string, unknown>) => {
      if (url === '/api/dashboard/context') return Promise.resolve({
        isPlatformAdmin: false,
        runtimeScopedEngineIds: ['engine-central'],
        canViewActiveUsers: false,
        canViewEngines: true,
        canViewProcessData: true,
        canViewDeployments: false,
        canViewMetrics: true,
        projectMemberships: [],
      });
      if (url === '/api/dashboard/stats') return Promise.resolve({ totalProjects: 1, totalFiles: 0, fileTypes: { bpmn: 0, dmn: 0, form: 0 } });
      if (url === '/engines-api/engines') return Promise.resolve([{ id: 'engine-central' }]);
      if (url === '/mission-control-api/process-instances') {
        expect(query).toMatchObject({ engineId: 'engine-central', active: true, completed: true, canceled: true });
        return Promise.resolve([
          { id: 'visible-active', state: 'ACTIVE' },
          { id: 'visible-completed', state: 'COMPLETED', startTime: '2026-07-14T00:00:00.000Z', endTime: '2026-07-14T00:01:00.000Z' },
        ]);
      }
      return Promise.resolve([]);
    });

    renderDashboard();

    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/mission-control-api/process-instances',
      expect.objectContaining({ engineId: 'engine-central' }),
    ));
    await waitFor(() => {
      expect(screen.getByText('Showing the processes you can access')).toBeInTheDocument();
      expect(screen.getByText('Process States')).toBeInTheDocument();
      expect(screen.getByText('Summary')).toBeInTheDocument();
    });
  });

  it.each([
    [[], '0%', 'eg-dashboard-kpi__icon--red'],
    [[{ id: 'canceled', state: 'CANCELED' }], '0%', 'eg-dashboard-kpi__icon--red'],
  ])('retains zero success rates for empty and canceled process collections', async (instances, value, tone) => {
    engineSelectorMocks.selectedEngineId = 'engine-central';
    authMocks.hasAnyEnginePermission.mockReturnValue(true);
    mockDashboardApi({ totalFiles: 0 });
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation((url: string) => url === '/mission-control-api/process-instances'
      ? Promise.resolve(instances) : original(url));
    renderDashboard();
    const card = (await screen.findByText('Success Rate')).closest('.eg-dashboard-kpi') as HTMLElement;
    await waitFor(() => expect(within(card).getByText(value as string)).toBeInTheDocument());
    expect(card.querySelector('svg')).toHaveClass(tone as string);
    expect(screen.queryByText(/Filters apply to process activity/)).not.toBeInTheDocument();
    expect(screen.queryByText('No finished processes in this period.')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Time period' })).toBeInTheDocument();
  });

  it('recovers project statistics without refetching the dashboard authorization context', async () => {
    let attempts = 0;
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/api/dashboard/context') return { canViewActiveUsers: false, canViewProcessData: false, canViewMetrics: false };
      if (url === '/api/dashboard/stats') {
        if (++attempts === 1) throw new Error('Temporary outage');
        return { totalProjects: 7, totalFiles: 0, fileTypes: {} };
      }
      return [];
    });
    renderDashboard();
    await screen.findByText('Project statistics are unavailable');
    screen.getByRole('button', { name: 'Retry project statistics' }).click();
    await waitFor(() => expect(screen.queryByText('Project statistics are unavailable')).not.toBeInTheDocument());
    expect(attempts).toBe(2);
    expect(vi.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/api/dashboard/context')).toHaveLength(1);
  });
});
