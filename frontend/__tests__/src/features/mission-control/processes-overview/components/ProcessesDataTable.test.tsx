import React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProcessesDataTable } from '../../../../../../../packages/frontend-host/src/features/mission-control/processes-overview/components/ProcessesDataTable';

type ProcessesDataTableData = React.ComponentProps<typeof ProcessesDataTable>['data'];

const deniedDecision = (actionId: string, permissionId: string) => ({
  actionId,
  permissionId,
  resourceType: 'engine' as const,
  resourceId: 'engine-1',
  allowed: false,
  state: 'disabled' as const,
  reason: `Missing permission ${permissionId}`,
});

function renderTable(
  searchValue: string,
  data?: ProcessesDataTableData,
  actionDecisions?: {
    retry?: { allowed: boolean; reason?: string }
    suspension?: { allowed: boolean; reason?: string }
    terminate?: { allowed: boolean; reason?: string }
  }
) {
  const onActivate = vi.fn(async () => undefined);
  const onSuspend = vi.fn(async () => undefined);
  const rows = data || [
    {
      id: 'pi-1',
      processDefinitionKey: 'invoice-receipt',
      superProcessInstanceId: 'parent-123',
      state: 'ACTIVE',
    },
    {
      id: 'pi-2',
      processDefinitionKey: 'order-process',
      superProcessInstanceId: null,
      state: 'ACTIVE',
    },
  ];
  const tableData = (actionDecisions
    ? rows.map((row) => ({ ...row, runtimeActionDecisions: actionDecisions }))
    : rows) as ProcessesDataTableData;

  render(
    <MemoryRouter>
      <ProcessesDataTable
        data={tableData}
        onTerminate={vi.fn()}
        onRetry={vi.fn()}
        onActivate={onActivate}
        onSuspend={onSuspend}
        selectedMap={{}}
        setSelectedMap={vi.fn() as React.Dispatch<React.SetStateAction<Record<string, boolean>>>}
        retryingMap={{}}
        hoveredRowId={null}
        setHoveredRowId={vi.fn()}
        processNameMap={{
          'invoice-receipt': 'Invoice Receipt',
          'order-process': 'Order Process',
        }}
        searchValue={searchValue}
      />
    </MemoryRouter>
  );
}

describe('ProcessesDataTable', () => {
  it('filters by resolved process name', () => {
    renderTable('recei');

    expect(screen.getByText('Invoice Receipt')).toBeInTheDocument();
    expect(screen.queryByText('Order Process')).not.toBeInTheDocument();
  });

  it('filters by parent instance id', () => {
    renderTable('parent-123');

    expect(screen.getByText('parent-123')).toBeInTheDocument();
    expect(screen.queryByText('Order Process')).not.toBeInTheDocument();
  });

  it('renders duration using the shared execution-trail format', () => {
    renderTable('', [
      {
        id: 'pi-1',
        processDefinitionKey: 'invoice-receipt',
        superProcessInstanceId: 'parent-123',
        state: 'COMPLETED',
        startTime: '2026-03-08T10:00:00.000Z',
        endTime: '2026-03-08T10:01:01.000Z',
      },
    ]);

    expect(screen.getByText('1 min 1 sec')).toBeInTheDocument();
  });

  it('does not crash when an instance row is missing an id', () => {
    renderTable('', [
      {
        processDefinitionKey: 'invoice-receipt',
        state: 'ACTIVE',
      } as any,
    ]);

    expect(screen.getByText('Invoice Receipt')).toBeInTheDocument();
    expect(screen.getAllByText('--').length).toBeGreaterThan(0);
  });

  it('keeps denied runtime row actions visible but disabled with reasons', () => {
    renderTable('', [
      {
        id: 'pi-1',
        processDefinitionKey: 'invoice-receipt',
        state: 'ACTIVE',
        hasIncident: true,
      },
    ], {
      retry: deniedDecision('engine.runtime.process-instances.retry', 'engine:instance:retry'),
      suspension: deniedDecision('engine.runtime.process-instances.suspension.update', 'engine:process:modify'),
      terminate: deniedDecision('engine.runtime.process-instances.delete', 'engine:instance:delete'),
    });

    expect(screen.getByLabelText('Retry')).toBeDisabled();
    expect(screen.getByLabelText('Retry')).toHaveAttribute('title', 'Missing permission engine:instance:retry');
    expect(screen.getByLabelText('Suspend')).toBeDisabled();
    expect(screen.getByLabelText('Suspend')).toHaveAttribute('title', 'Missing permission engine:process:modify');
    expect(screen.getByLabelText('Cancel')).toBeDisabled();
    expect(screen.getByLabelText('Cancel')).toHaveAttribute('title', 'Missing permission engine:instance:delete');
  });

  it('fails closed when a visible runtime row has no server action decision', () => {
    renderTable('', [
      {
        id: 'pi-1',
        processDefinitionKey: 'invoice-receipt',
        state: 'ACTIVE',
        hasIncident: true,
      },
    ]);

    for (const action of ['Retry', 'Suspend', 'Cancel']) {
      expect(screen.getByLabelText(action)).toBeDisabled();
      expect(screen.getByLabelText(action)).toHaveAttribute('title', 'Action unavailable');
    }
  });
});
