import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ActivityDetailsPanel } from '@src/features/mission-control/process-instance-detail/components/ActivityDetailsPanel';

describe('ActivityDetailsPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('exports ActivityDetailsPanel component', () => {
    expect(ActivityDetailsPanel).toBeDefined();
    expect(typeof ActivityDetailsPanel).toBe('function');
  });

  it('shows decision input and output redaction reasons when payload reads are denied', () => {
    render(
      <ActivityDetailsPanel
        rightTab="variables"
        setRightTab={vi.fn()}
        varsQ={{ isLoading: false, data: {} }}
        selectedActivityId="activity-1"
        selectedActivityInstanceId="activity-instance-1"
        selectedActivityName="Decision task"
        selectedNodeVariables={[]}
        globalVariableHistoryTargetsByName={{}}
        shouldShowDecisionPanel
        status="ACTIVE"
        openVariableEditor={vi.fn()}
        openVariableHistory={vi.fn()}
        showAlert={vi.fn()}
        selectedDecisionInstance={{
          id: 'decision-1',
          decisionDefinitionKey: 'approve',
        } as any}
        decisionInputs={[]}
        decisionOutputs={[]}
        decisionInputsReadDecision={{
          actionId: 'engine.runtime.history.decisions.inputs.read',
          permissionId: 'engine:instance:view',
          resourceType: 'engine',
          resourceId: 'engine-1',
          allowed: false,
          state: 'redacted',
          reason: 'Missing permission engine:instance:view',
        }}
        decisionOutputsReadDecision={{
          actionId: 'engine.runtime.history.decisions.outputs.read',
          permissionId: 'engine:instance:view',
          resourceType: 'engine',
          resourceId: 'engine-1',
          allowed: false,
          state: 'redacted',
          reason: 'Missing permission engine:instance:view',
        }}
        selectedNodeInputMappings={[]}
        selectedNodeOutputMappings={[]}
        formatMappingType={(value) => String(value)}
        formatMappingValue={(value) => String(value)}
        isModMode={false}
      />
    );

    expect(screen.getByText('Decision inputs redacted')).toBeInTheDocument();
    expect(screen.getByText('Decision outputs redacted')).toBeInTheDocument();
  });
});
