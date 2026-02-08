import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityHistoryPanel } from '@src/features/mission-control/process-instance-detail/components/ActivityHistoryPanel';

describe('ActivityHistoryPanel', () => {
  it('renders empty history message when no activities', () => {
    render(
      <ActivityHistoryPanel
        actQ={{ isLoading: false }}
        sortedActs={[]}
        processName="Process"
        incidentActivityIds={new Set()}
        execCounts={new Map()}
        clickableActivityIds={new Set()}
        selectedActivityId={null}
        setSelectedActivityId={vi.fn()}
        fmt={(ts) => String(ts || '')}
        isModMode={false}
        moveSourceActivityId={null}
        activeActivityIds={new Set()}
        execGroups={[]}
        resolveBpmnIconVisual={() => ({ iconClass: 'bpmn-icon-process', kind: 'marker' })}
        buildHistoryContext={vi.fn()}
      />
    );

    expect(screen.getByText('No activity history.')).toBeInTheDocument();
  });
});
