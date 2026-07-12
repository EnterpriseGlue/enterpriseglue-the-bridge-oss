import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import { ExecutionTrailPanel } from '@src/features/mission-control/process-instance-detail/components/ExecutionTrailPanel';
import { buildActivityGroups, buildHistoryContext } from '@src/features/mission-control/process-instance-detail/components/activityDetailUtils';

function renderExecutionTrail({
  onActivityClick = () => {},
  executionDetailsAllowed = true,
  historyTasksAllowed = true,
  historyUserOperationsAllowed = true,
}: {
  onActivityClick?: (activityId: string) => void;
  executionDetailsAllowed?: boolean;
  historyTasksAllowed?: boolean;
  historyUserOperationsAllowed?: boolean;
} = {}) {
  const sortedActs = [
    {
      id: 'hist-1',
      activityInstanceId: 'act-inst-1',
      activityId: 'approveTask',
      activityName: 'Approve request',
      activityType: 'userTask',
      executionId: 'exec-1',
      taskId: 'task-1',
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-01T00:00:05Z',
      durationInMillis: 5000,
    },
  ];

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const execGroups = buildActivityGroups({
    sortedActs,
    incidentActivityIds: new Set(),
    clickableActivityIds: new Set(['approveTask']),
    selectedActivityId: null,
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ExecutionTrailPanel
        instanceId="instance-1"
        engineId="engine-1"
        actQ={{ isLoading: false, data: sortedActs }}
        sortedActs={sortedActs}
        processName="Approval Process"
        selectedActivityId={null}
        setSelectedActivityId={() => {}}
        selectedActivityInstanceId={null}
        setSelectedActivityInstanceId={() => {}}
        fmt={(value) => value || '—'}
        isModMode={false}
        moveSourceActivityId={null}
        showTokenPassCounts={false}
        setShowTokenPassCounts={() => {}}
        execGroups={execGroups}
        resolveBpmnIconVisual={() => ({ iconClass: '', kind: 'shape' })}
        resolveBpmnLoopMarkerVisual={() => null}
        buildHistoryContext={buildHistoryContext}
        onActivityClick={onActivityClick}
        executionDetailsReadDecision={{
          actionId: 'engine.runtime.process-instances.execution-details.read',
          permissionId: 'engine:instance:view',
          resourceType: 'engine',
          resourceId: 'engine-1',
          allowed: executionDetailsAllowed,
          state: executionDetailsAllowed ? 'allowed' : 'redacted',
          reason: executionDetailsAllowed ? 'Allowed by current permission snapshot' : 'Missing permission engine:instance:view',
        }}
        historyTasksReadDecision={{
          actionId: 'engine.runtime.history.tasks.read',
          permissionId: 'engine:instance:view',
          resourceType: 'engine',
          resourceId: 'engine-1',
          allowed: historyTasksAllowed,
          state: historyTasksAllowed ? 'allowed' : 'hidden',
          reason: historyTasksAllowed ? 'Allowed by current permission snapshot' : 'Missing permission engine:instance:view',
        }}
        historyUserOperationsReadDecision={{
          actionId: 'engine.runtime.history.user-operations.read',
          permissionId: 'engine:instance:view',
          resourceType: 'engine',
          resourceId: 'engine-1',
          allowed: historyUserOperationsAllowed,
          state: historyUserOperationsAllowed ? 'allowed' : 'redacted',
          reason: historyUserOperationsAllowed ? 'Allowed by current permission snapshot' : 'Missing permission engine:instance:view',
        }}
      />
    </QueryClientProvider>
  );
}

describe('ExecutionTrailPanel', () => {
  let requestCount = 0;

  beforeEach(() => {
    requestCount = 0;
    server.use(
      http.get('/t/default/mission-control-api/process-instances/instance-1/execution-details', () => {
        requestCount += 1;
        return HttpResponse.json({
          activityInstanceId: 'act-inst-1',
          executionId: 'exec-1',
          taskId: 'task-1',
          variables: [
            {
              id: 'var-1',
              name: 'approvalReason',
              type: 'String',
              value: 'Need manager sign-off',
              createTime: '2024-01-01T00:00:02Z',
            },
          ],
          tasks: [
            {
              id: 'task-1',
              name: 'Approve request',
              assignee: 'demo',
              startTime: '2024-01-01T00:00:00Z',
              endTime: '2024-01-01T00:00:05Z',
            },
          ],
          decisions: [],
          userOperations: [
            {
              id: 'operation-1',
              operationType: 'Assign',
              property: 'assignee',
              newValue: 'demo',
              timestamp: '2024-01-01T00:00:04Z',
            },
          ],
        });
      })
    );
  });

  it('loads execution drilldown lazily only after the details action is opened', async () => {
    const user = userEvent.setup();

    renderExecutionTrail();

    expect(requestCount).toBe(0);

    const overflowMenuTrigger = document.querySelector('.cds--overflow-menu') as HTMLElement | null;
    expect(overflowMenuTrigger).not.toBeNull();
    await user.click(overflowMenuTrigger!);
    await user.click(await screen.findByText('Details'));

    await waitFor(() => {
      expect(requestCount).toBe(1);
    });

    expect(await screen.findByText('approvalReason')).toBeInTheDocument();
    expect(screen.getByText('Need manager sign-off')).toBeInTheDocument();
    expect(screen.getAllByText('Historic tasks').length).toBeGreaterThan(0);
    expect(screen.getByText('Assign')).toBeInTheDocument();
  });

  it('withholds historic task and user-operation sections when their specific actions are denied', async () => {
    const user = userEvent.setup();

    renderExecutionTrail({ historyTasksAllowed: false, historyUserOperationsAllowed: false });

    const overflowMenuTrigger = document.querySelector('.cds--overflow-menu') as HTMLElement | null;
    expect(overflowMenuTrigger).not.toBeNull();
    await user.click(overflowMenuTrigger!);
    await user.click(await screen.findByText('Details'));

    expect(await screen.findByText('Historic tasks unavailable')).toBeInTheDocument();
    expect(screen.getByText('User operations redacted')).toBeInTheDocument();
    expect(screen.getAllByText('Missing permission engine:instance:view').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('demo')).not.toBeInTheDocument();
    expect(screen.queryByText('Assign')).not.toBeInTheDocument();
  });

  it('selects an execution when clicking the row body up to the kebab menu', async () => {
    const user = userEvent.setup();
    const onActivityClick = vi.fn();

    renderExecutionTrail({ onActivityClick });

    expect(screen.getByRole('button', { name: 'Select Approve request' })).toHaveStyle({ alignSelf: 'stretch' });

    await user.click(screen.getByText('5 sec'));

    expect(onActivityClick).toHaveBeenCalledWith('approveTask');
  });

  it('keeps execution drilldown visible but disabled when the read action is denied', async () => {
    const user = userEvent.setup();

    renderExecutionTrail({ executionDetailsAllowed: false });

    const overflowMenuTrigger = document.querySelector('.cds--overflow-menu') as HTMLElement | null;
    expect(overflowMenuTrigger).not.toBeNull();
    await user.click(overflowMenuTrigger!);

    const detailsItem = await screen.findByText('Details');
    const detailsButton = detailsItem.closest('button');
    expect(detailsButton).toBeDisabled();
    expect(requestCount).toBe(0);
  });
});
