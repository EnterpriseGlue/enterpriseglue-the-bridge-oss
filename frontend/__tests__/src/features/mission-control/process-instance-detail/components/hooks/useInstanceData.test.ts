import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { useInstanceData } from '@src/features/mission-control/process-instance-detail/components/hooks/useInstanceData';
import {
  fetchProcessDefinitionXml,
  getHistoricalProcessInstance,
  getHistoricalVariableInstances,
  getProcessInstance,
  getProcessInstanceActivityHistory,
  getProcessInstanceActivityTree,
  getProcessInstanceIncidents,
  getProcessInstanceJobs,
  getProcessInstanceVariables,
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
    vi.mocked(getProcessInstanceVariables).mockResolvedValue({});
    vi.mocked(getHistoricalVariableInstances).mockResolvedValue([]);
    vi.mocked(fetchProcessDefinitionXml).mockResolvedValue(null as any);
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

  it('uses runtime variables while the process instance is active', async () => {
    vi.mocked(getProcessInstanceVariables).mockResolvedValue({
      amount: { type: 'Integer', value: 42 },
    });

    const { result } = renderHook(() => useInstanceData('pi-1', {
      variablesEnabled: true,
      historicVariablesEnabled: true,
      activityTreeEnabled: false,
      activityHistoryEnabled: false,
      incidentsEnabled: false,
      jobsEnabled: false,
      externalTasksEnabled: false,
    }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.varsQ.data).toEqual({ amount: { type: 'Integer', value: 42 } });
    });
    expect(getProcessInstanceVariables).toHaveBeenCalledWith('pi-1', 'engine-1');
  });

  it('derives breadcrumb identity from the opened instance instead of overview state', async () => {
    vi.mocked(getHistoricalProcessInstance).mockResolvedValue({
      id: 'pi-1',
      processDefinitionId: 'process:2:def',
      processDefinitionKey: 'process',
      processDefinitionName: 'Actual process',
      processDefinitionVersion: 2,
    });
    vi.mocked(listProcessDefinitions).mockResolvedValue([
      { id: 'process:1:old', key: 'process', name: 'Old process', version: 1 },
      { id: 'process:2:def', key: 'process', name: 'Actual process', version: 2 },
    ]);

    const { result } = renderHook(() => useInstanceData('pi-1', {
      variablesEnabled: false,
      historicVariablesEnabled: false,
      activityTreeEnabled: false,
      activityHistoryEnabled: false,
      incidentsEnabled: false,
      jobsEnabled: false,
      externalTasksEnabled: false,
    }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.defName).toBe('Actual process');
      expect(result.current.defVersion).toBe(2);
    });
  });

  it('uses the process-scope historic snapshot after the instance completes', async () => {
    vi.mocked(getHistoricalProcessInstance).mockResolvedValue({
      id: 'pi-1',
      processDefinitionId: 'process:1:def',
      processDefinitionKey: 'process',
      startTime: '2026-06-09T10:00:00.000Z',
      endTime: '2026-06-09T10:05:00.000Z',
      state: 'COMPLETED',
    });
    vi.mocked(getHistoricalVariableInstances).mockResolvedValue([
      {
        id: 'var-global',
        name: 'approved',
        type: 'Boolean',
        value: true,
        processInstanceId: 'pi-1',
        executionId: 'pi-1',
      },
      {
        id: 'var-redacted',
        name: 'customerNote',
        type: 'String',
        value: null,
        valueRedacted: true,
        processInstanceId: 'pi-1',
        executionId: 'pi-1',
      },
      {
        id: 'var-local',
        name: 'taskOnly',
        type: 'String',
        value: 'local',
        processInstanceId: 'pi-1',
        executionId: 'child-execution',
        activityInstanceId: 'task-activity',
      },
    ]);

    const { result } = renderHook(() => useInstanceData('pi-1', {
      variablesEnabled: true,
      historicVariablesEnabled: true,
      activityTreeEnabled: false,
      activityHistoryEnabled: false,
      incidentsEnabled: false,
      jobsEnabled: false,
      externalTasksEnabled: false,
    }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.varsQ.data).toEqual({
        approved: { type: 'Boolean', value: true },
        customerNote: { type: 'String', value: null, valueRedacted: true },
      });
    });
    expect(getProcessInstanceVariables).not.toHaveBeenCalled();
  });
});
