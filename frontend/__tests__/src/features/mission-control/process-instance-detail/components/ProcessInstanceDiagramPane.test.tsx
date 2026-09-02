import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProcessInstanceDiagramPane } from '@src/features/mission-control/process-instance-detail/components/ProcessInstanceDiagramPane';

vi.mock('@src/features/shared/components/Viewer', () => ({
  default: () => <div>Viewer</div>,
}));

describe('ProcessInstanceDiagramPane', () => {
  it('renders viewer when xml is provided', async () => {
    render(
      <ProcessInstanceDiagramPane
        instanceId="pi1"
        xml="<bpmndi:BPMNDiagram><bpmndi:BPMNPlane><bpmndi:BPMNShape /></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>"
        onReady={vi.fn()}
        onDiagramReset={vi.fn()}
        onElementNavigate={vi.fn()}
      />
    );

    expect(await screen.findByText('Viewer')).toBeInTheDocument();
  });

  it('explains when executable BPMN has no diagram layout', () => {
    render(
      <ProcessInstanceDiagramPane
        instanceId="pi1"
        xml={'<bpmn:definitions><bpmn:process isExecutable="true" /></bpmn:definitions>'}
        onReady={vi.fn()}
        onDiagramReset={vi.fn()}
        onElementNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Diagram layout unavailable');
    expect(screen.getByRole('status')).toHaveTextContent('BPMN DI layout coordinates');
    expect(screen.queryByText('Viewer')).not.toBeInTheDocument();
  });

  it('shows the engine error when diagram XML cannot be loaded', () => {
    render(
      <ProcessInstanceDiagramPane
        instanceId="pi1"
        error={new Error('Engine unavailable')}
        onReady={vi.fn()}
        onDiagramReset={vi.fn()}
        onElementNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Diagram could not be loaded');
    expect(screen.getByRole('alert')).toHaveTextContent('Engine unavailable');
  });
});
