import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { useInstanceData } from '@src/features/mission-control/process-instance-detail/components/hooks/useInstanceData';
import {
  getHistoricalProcessInstance,
  getProcessInstance,
  getProcessInstanceActivityHistory,
  getProcessInstanceActivityTree,
  getProcessInstanceIncidents,
  getProcessInstanceJobs,
  listProcessDefinitions,
} from '@src/features/mission-control/process-instance-detail/api/processInstances';

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => 'engine-1',
}));

vi.mock('@src/features/mission-control/process-instance-detail/api/processInstances', () => ({
  getProcessInstance: vi.fn(),
  getProcessInstanceVariables: vi.fn(),
  getProcessInstanceActivityHistory: vi.fn(),
  getProcessInstanceActivityTree: vi.fn(),
  getProcessInstanceIncidents: vi.fn(),
  getProcessInstanceJobs: vi.fn(),
  getProcessInstanceExternalTasks: vi.fn(),
  fetchProcessDefinitionXml: vi.fn(),
  getHistoricalProcessInstance: vi.fn(),
  getHistoricalVariableInstances: vi.fn(),
  getCalledProcessInstances: vi.fn(),
  listProcessDefinitions: vi.fn(),
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

describe('useInstanceData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProcessDefinitions).mockResolvedValue([]);
    vi.mocked(getProcessInstance).mockResolvedValue({
      id: 'pi-1',
      processDefinitionId: 'process:1:def',
      processDefinitionKey: 'process',
      startTime: '2026-06-09T10:00:00.000Z',
      state: 'ACTIVE',
      suspended: false,
    });
    vi.mocked(getProcessInstanceActivityHistory).mockResolvedValue([]);
    vi.mocked(getProcessInstanceActivityTree).mockResolvedValue({ id: 'root', childActivityInstances: [] });
    vi.mocked(getProcessInstanceIncidents).mockResolvedValue([]);
    vi.mocked(getProcessInstanceJobs).mockResolvedValue([]);
    vi.mocked(getHistoricalProcessInstance).mockResolvedValue({
      id: 'pi-1',
      processDefinitionId: 'process:1:def',
      processDefinitionKey: 'process',
    });
  });

  it('exports useInstanceData hook', () => {
    expect(useInstanceData).toBeDefined();
    expect(typeof useInstanceData).toBe('function');
  });

  it('does not fetch historical process instance details when history read is denied', async () => {
    renderHook(() => useInstanceData('pi-1', {
      historyProcessInstanceEnabled: false,
      variablesEnabled: false,
      historicVariablesEnabled: false,
      activityTreeEnabled: false,
      activityHistoryEnabled: false,
      incidentsEnabled: false,
      jobsEnabled: false,
      externalTasksEnabled: false,
    }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(listProcessDefinitions).toHaveBeenCalledWith('engine-1');
    });
    expect(getHistoricalProcessInstance).not.toHaveBeenCalled();
    expect(getProcessInstanceActivityTree).not.toHaveBeenCalled();
    expect(getProcessInstanceActivityHistory).not.toHaveBeenCalled();
    expect(getProcessInstanceIncidents).not.toHaveBeenCalled();
    expect(getProcessInstanceJobs).not.toHaveBeenCalled();
  });

  it('does not fetch runtime activity tree when activity tree read is denied', async () => {
    renderHook(() => useInstanceData('pi-1', {
      variablesEnabled: false,
      historicVariablesEnabled: false,
      activityTreeEnabled: false,
      activityHistoryEnabled: false,
      incidentsEnabled: false,
      jobsEnabled: false,
      externalTasksEnabled: false,
    }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getHistoricalProcessInstance).toHaveBeenCalledWith('pi-1', 'engine-1');
    });
    expect(getProcessInstanceActivityTree).not.toHaveBeenCalled();
  });

  it('flattens runtime activity tree rows into activity lookup data', async () => {
    vi.mocked(getProcessInstanceActivityTree).mockResolvedValue({
      id: 'root',
      childActivityInstances: [
        {
          id: 'activity-instance-1',
          activityId: 'reviewTask',
          activityName: 'Review order',
          activityType: 'userTask',
          executionIds: ['execution-1'],
          childActivityInstances: [
            {
              id: 'activity-instance-2',
              activityId: 'approveTask',
              activityName: 'Approve order',
              activityType: 'userTask',
              executionIds: ['execution-2'],
            },
          ],
        },
      ],
    });

    const { result } = renderHook(() => useInstanceData('pi-1', {
      variablesEnabled: false,
      historicVariablesEnabled: false,
      activityTreeEnabled: true,
      activityHistoryEnabled: false,
      incidentsEnabled: false,
      jobsEnabled: false,
      externalTasksEnabled: false,
    }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(getProcessInstanceActivityTree).toHaveBeenCalledWith('pi-1', 'engine-1');
    });

    await waitFor(() => {
      expect(result.current.runtimeActivityInstances).toHaveLength(2);
    });
    expect(result.current.runtimeActivityInstances[0]).toMatchObject({
      id: 'activity-instance-1',
      activityId: 'reviewTask',
      activityName: 'Review order',
      executionId: 'execution-1',
    });
    expect(result.current.activityIdToInstances.get('approveTask')).toEqual(['activity-instance-2']);
    expect(result.current.clickableActivityIds.has('reviewTask')).toBe(true);
  });
});
