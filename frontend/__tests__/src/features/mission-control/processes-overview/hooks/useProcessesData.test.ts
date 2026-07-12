import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProcessesData } from '@src/features/mission-control/processes-overview/hooks/useProcessesData';
import {
  fetchActivityCountsByState,
  fetchPreviewCount,
  fetchProcessDefinitionXml,
  getActiveActivityCounts,
  listProcessDefinitions,
  listProcessInstances,
} from '@src/features/mission-control/processes-overview/api/processDefinitions';

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@src/features/mission-control/processes-overview/api/processDefinitions', () => ({
  listProcessDefinitions: vi.fn(),
  fetchProcessDefinitionXml: vi.fn(),
  getActiveActivityCounts: vi.fn(),
  fetchActivityCountsByState: vi.fn(),
  listProcessInstances: vi.fn(),
  fetchPreviewCount: vi.fn(),
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

function renderProcessesData(options: Partial<Parameters<typeof useProcessesData>[0]> = {}) {
  return renderHook(() => useProcessesData({
    selectedProcess: { key: 'order-process', label: 'Order Process' },
    selectedVersion: null,
    setSelectedVersion: vi.fn(),
    active: true,
    suspended: false,
    incidents: false,
    completed: false,
    canceled: false,
    flowNode: '',
    dateFrom: '',
    dateTo: '',
    timeFrom: '',
    timeTo: '',
    varName: '',
    varType: 'String',
    varOp: 'equals',
    varValue: '',
    advancedOpen: true,
    ...options,
  }), {
    wrapper: createWrapper(),
  });
}

describe('useProcessesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProcessDefinitions).mockResolvedValue([]);
    vi.mocked(fetchProcessDefinitionXml).mockResolvedValue('');
    vi.mocked(getActiveActivityCounts).mockResolvedValue({});
    vi.mocked(fetchActivityCountsByState).mockResolvedValue({
      active: {},
      incidents: {},
      suspended: {},
      canceled: {},
      completed: {},
    });
    vi.mocked(listProcessInstances).mockResolvedValue([]);
    vi.mocked(fetchPreviewCount).mockResolvedValue({ count: 0 });
  });

  it('does not fetch definitions or instances when read actions are denied', () => {
    renderProcessesData({
      processDefinitionsEnabled: false,
      processInstancesEnabled: false,
    });

    expect(listProcessDefinitions).not.toHaveBeenCalled();
    expect(fetchProcessDefinitionXml).not.toHaveBeenCalled();
    expect(getActiveActivityCounts).not.toHaveBeenCalled();
    expect(fetchActivityCountsByState).not.toHaveBeenCalled();
    expect(listProcessInstances).not.toHaveBeenCalled();
    expect(fetchPreviewCount).not.toHaveBeenCalled();
  });
});
