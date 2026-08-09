import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InstanceInfoBar } from '@src/features/mission-control/process-instance-detail/components/InstanceInfoBar';

describe('InstanceInfoBar', () => {
  const deniedDecision = (actionId: string, permissionId: string) => ({
    actionId,
    permissionId,
    resourceType: 'engine' as const,
    resourceId: 'engine-1',
    allowed: false,
    state: 'disabled' as const,
    reason: `Missing permission ${permissionId}`,
  });

  it('renders instance info when no history context', () => {
    render(
      <InstanceInfoBar
        historyContext={null}
        defName="Order Process"
        instanceId="inst-1"
        defs={[{ key: 'order', version: 2 }]}
        defKey="order"
        histData={{ startTime: new Date('2024-01-01T00:00:00Z').toISOString() }}
        parentId={null}
        status="ACTIVE"
        showModifyAction={true}
        fmt={(ts) => String(ts || '')}
        onNavigate={vi.fn()}
        onCopy={vi.fn()}
        onSuspend={vi.fn()}
        onResume={vi.fn()}
        onModify={vi.fn()}
        onTerminate={vi.fn()}
      />
    );

    expect(screen.getByText('Order Process')).toBeInTheDocument();
    expect(screen.getByText('inst-1')).toBeInTheDocument();
    expect(screen.getByText('ver.')).toBeInTheDocument();
  });

  it('disables runtime mutation actions when the engine-scoped decisions are denied', () => {
    render(
      <InstanceInfoBar
        historyContext={null}
        defName="Order Process"
        instanceId="inst-1"
        defs={[{ key: 'order', version: 2 }]}
        defKey="order"
        histData={{ startTime: new Date('2024-01-01T00:00:00Z').toISOString() }}
        parentId={null}
        status="ACTIVE"
        showModifyAction={true}
        fmt={(ts) => String(ts || '')}
        onNavigate={vi.fn()}
        onCopy={vi.fn()}
        onSuspend={vi.fn()}
        onResume={vi.fn()}
        onModify={vi.fn()}
        onTerminate={vi.fn()}
        onRetry={vi.fn()}
        incidentCount={1}
        suspensionDecision={deniedDecision('engine.runtime.process-instances.suspension.update', 'engine:process:modify')}
        retryDecision={deniedDecision('engine.runtime.process-instances.retry', 'engine:instance:retry')}
        modifyDecision={deniedDecision('engine.runtime.process-instances.modify', 'engine:process:modify')}
        terminateDecision={deniedDecision('engine.runtime.process-instances.delete', 'engine:instance:delete')}
      />
    );

    expect(screen.getByRole('button', { name: /retry failed jobs/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /suspend process instance/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /modify/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel process instance/i })).toBeDisabled();
  });
});
