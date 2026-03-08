import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@test/mocks/server';
import { ExecutionTrailPanel } from '@src/features/mission-control/process-instance-detail/components/ExecutionTrailPanel';
import { buildActivityGroups, buildHistoryContext } from '@src/features/mission-control/process-instance-detail/components/activityDetailUtils';

function renderExecutionTrail() {
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
          userOperations: [],
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
  });
});
