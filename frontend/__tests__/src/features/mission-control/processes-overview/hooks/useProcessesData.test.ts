import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
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

let selectedEngineId = 'engine-1';

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => selectedEngineId,
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
    selectedEngineId = 'engine-1';
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

  it('isolates process previews and collection requests when the selected engine changes', async () => {
    const { rerender } = renderProcessesData();

    await waitFor(() => {
      expect(fetchPreviewCount).toHaveBeenCalledWith(expect.objectContaining({ engineId: 'engine-1' }));
      expect(listProcessInstances).toHaveBeenCalledWith(expect.objectContaining({ engineId: 'engine-1' }));
    });

    selectedEngineId = 'engine-2';
    rerender();

    await waitFor(() => {
      expect(fetchPreviewCount).toHaveBeenCalledWith(expect.objectContaining({ engineId: 'engine-2' }));
      expect(listProcessInstances).toHaveBeenCalledWith(expect.objectContaining({ engineId: 'engine-2' }));
    });
  });

  it('waits for an incoming definition link and then reads only the exact applied version and node', async () => {
    vi.mocked(listProcessDefinitions).mockResolvedValue([
      { id: 'warm:8:id', key: 'warm', version: 8 },
      { id: 'target:3:id', key: 'target', version: 3 },
      { id: 'target:4:id', key: 'target', version: 4 },
    ] as any);
    const setSelectedVersion = vi.fn();
    const options = { selectedProcess: { key: 'warm', label: 'Warm' }, selectedVersion: 8, setSelectedVersion, definitionLinkPending: true };
    const { result, rerender } = renderProcessesData(options);
    await waitFor(() => expect(result.current.defsQ.isSuccess).toBe(true));
    expect(result.current.defIdForVersion).toBeNull();
    for (const fn of [fetchProcessDefinitionXml, getActiveActivityCounts, fetchActivityCountsByState, listProcessInstances, fetchPreviewCount, setSelectedVersion]) expect(fn).not.toHaveBeenCalled();
    Object.assign(options, { selectedProcess: { key: 'target', label: 'Target' }, selectedVersion: 3, flowNode: 'Task_target', definitionLinkPending: false });
    rerender();
    await waitFor(() => expect(listProcessInstances).toHaveBeenCalledWith(expect.objectContaining({ processDefinitionId: 'target:3:id', activityId: 'Task_target', engineId: 'engine-1' })));
    expect(fetchProcessDefinitionXml).toHaveBeenCalledWith('target:3:id', 'engine-1');
    expect(getActiveActivityCounts).toHaveBeenCalledWith('target:3:id', 'engine-1');
    expect(fetchActivityCountsByState).toHaveBeenCalledWith('target:3:id', { engineId: 'engine-1' });
    expect(fetchPreviewCount).toHaveBeenCalledWith(expect.objectContaining({ processDefinitionId: 'target:3:id', engineId: 'engine-1' }));
    expect(vi.mocked(fetchPreviewCount).mock.calls.every(([body]) => body.processDefinitionId === 'target:3:id' && !body.processDefinitionKey)).toBe(true);
    expect(setSelectedVersion).not.toHaveBeenCalled();
  });

  it('reloads badge counts with the same start-time bounds as the instance table', async () => {
    vi.mocked(listProcessDefinitions).mockResolvedValue([
      { id: 'order-process:1:id', key: 'order-process', version: 1 },
    ]);
    const options = { selectedVersion: 1, dateFrom: '', timeFrom: '', dateTo: '', timeTo: '' };
    const { result, rerender } = renderProcessesData(options);
    await waitFor(() => expect(result.current.countsByStateQ.isSuccess).toBe(true));
    expect(fetchActivityCountsByState).toHaveBeenLastCalledWith('order-process:1:id', { engineId: 'engine-1' });

    Object.assign(options, { dateFrom: '2026-11-09', timeFrom: '13:50', dateTo: '2026-11-09', timeTo: '14:02' });
    rerender();
    const bounds = {
      startedAfter: new Date(2026, 10, 9, 13, 50).toISOString(),
      startedBefore: new Date(2026, 10, 9, 14, 2, 59, 999).toISOString(),
    };
    await waitFor(() => {
      expect(listProcessInstances).toHaveBeenLastCalledWith(expect.objectContaining(bounds));
      expect(fetchActivityCountsByState).toHaveBeenLastCalledWith('order-process:1:id', { engineId: 'engine-1', ...bounds });
    });

    options.dateFrom = '';
    options.dateTo = '';
    rerender();
    await waitFor(() => {
      expect(listProcessInstances).toHaveBeenLastCalledWith(expect.objectContaining({ startedAfter: undefined, startedBefore: undefined }));
      expect(fetchActivityCountsByState).toHaveBeenLastCalledWith('order-process:1:id', { engineId: 'engine-1' });
    });
  });
});
