import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { useProcessesModalData } from '@src/features/mission-control/processes-overview/hooks/useProcessesModalData';
import {
  fetchInstanceVariables,
  listInstanceActivityHistory,
  listInstanceExternalTasks,
  listInstanceJobs,
} from '@src/features/mission-control/processes-overview/api/processDefinitions';

vi.mock('@src/features/mission-control/processes-overview/api/processDefinitions', () => ({
  fetchInstanceVariables: vi.fn(),
  listInstanceActivityHistory: vi.fn(),
  listInstanceJobs: vi.fn(),
  listInstanceExternalTasks: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useProcessesModalData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchInstanceVariables).mockResolvedValue({});
    vi.mocked(listInstanceActivityHistory).mockResolvedValue([]);
    vi.mocked(listInstanceJobs).mockResolvedValue([]);
    vi.mocked(listInstanceExternalTasks).mockResolvedValue([]);
  });

  it('exports a hook function', () => {
    expect(typeof useProcessesModalData).toBe('function');
  });

  it('does not fetch failed external tasks when external task read is denied', async () => {
    renderHook(() => useProcessesModalData({
      detailsModalInstanceId: null,
      detailsModalOpen: false,
      retryModalInstanceId: 'pi-1',
      engineId: 'engine-1',
      externalTasksEnabled: false,
    }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listInstanceJobs).toHaveBeenCalledWith('pi-1', 'engine-1');
    });
    expect(listInstanceExternalTasks).not.toHaveBeenCalled();
  });

  it('does not fetch failed jobs when job read is denied', async () => {
    renderHook(() => useProcessesModalData({
      detailsModalInstanceId: null,
      detailsModalOpen: false,
      retryModalInstanceId: 'pi-1',
      engineId: 'engine-1',
      jobsEnabled: false,
    }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listInstanceExternalTasks).toHaveBeenCalledWith('pi-1', 'engine-1');
    });
    expect(listInstanceJobs).not.toHaveBeenCalled();
  });

  it('does not fetch detail variables or activity history when detail reads are denied', async () => {
    renderHook(() => useProcessesModalData({
      detailsModalInstanceId: 'pi-1',
      detailsModalOpen: true,
      retryModalInstanceId: null,
      engineId: 'engine-1',
      variablesEnabled: false,
      activityHistoryEnabled: false,
    }), {
      wrapper: createWrapper(),
    });

    expect(fetchInstanceVariables).not.toHaveBeenCalled();
    expect(listInstanceActivityHistory).not.toHaveBeenCalled();
  });
});
