import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ApplyMigrationModal } from '@src/features/mission-control/migration-wizard/components/ApplyMigrationModal';

vi.mock('@carbon/react', () => ({
  Modal: ({ open, modalHeading, primaryButtonText, primaryButtonDisabled, onRequestSubmit, children }: any) => open ? (
    <div role="dialog">
      <h2>{modalHeading}</h2>
      <button disabled={primaryButtonDisabled} onClick={onRequestSubmit}>{primaryButtonText}</button>
      {children}
    </div>
  ) : null,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Checkbox: ({ labelText, checked, onChange, id }: any) => (
    <label htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange?.(event, { checked: event.currentTarget.checked })} />
      {labelText}
    </label>
  ),
  TextArea: ({ labelText, value, onChange, ...props }: any) => (
    <label>
      {labelText}
      <textarea value={value} onChange={onChange} {...props} />
    </label>
  ),
  Toggletip: ({ children }: any) => <span>{children}</span>,
  ToggletipButton: ({ children }: any) => <span>{children}</span>,
  ToggletipContent: ({ children }: any) => <span>{children}</span>,
  InlineNotification: ({ title, subtitle }: any) => <div>{title}: {subtitle}</div>,
}));

vi.mock('@carbon/icons-react', () => ({
  Information: () => <span aria-hidden="true">i</span>,
}));

vi.mock('@src/features/shared/components/ExecutionOptionsPanel', () => ({
  ExecutionOptionsPanel: () => <div>Execution options</div>,
}));

const baseProps = {
  open: true,
  instanceCount: 2,
  instructionCount: 1,
  mappedCount: 1,
  unmappedCount: 0,
  unmappedWithActiveTokens: 0,
  affectedCount: 2,
  variableCount: 0,
  skipCustomListeners: false,
  onSkipCustomListenersChange: vi.fn(),
  skipIoMappings: false,
  onSkipIoMappingsChange: vi.fn(),
  updateEventTriggers: false,
  onUpdateEventTriggersChange: vi.fn(),
  eventInstructionCount: 0,
  payload: {},
  onClose: vi.fn(),
  onExecuteBatch: vi.fn(),
  onExecuteDirect: vi.fn(),
  batchPending: false,
  directPending: false,
};

describe('ApplyMigrationModal', () => {
  it('disables denied execution modes with reasons', () => {
    const onExecuteBatch = vi.fn();
    const onExecuteDirect = vi.fn();

    render(
      <ApplyMigrationModal
        {...baseProps}
        onExecuteBatch={onExecuteBatch}
        onExecuteDirect={onExecuteDirect}
        batchDeniedReason="Missing permission engine:process:modify"
        directDeniedReason="Missing permission engine:process:modify"
      />
    );

    expect(screen.getByText(/Execution mode unavailable/)).toBeInTheDocument();
    const batchButton = screen.getByRole('button', { name: /Create migration batch/i });
    expect(batchButton).toBeDisabled();
    fireEvent.click(batchButton);
    expect(onExecuteBatch).not.toHaveBeenCalled();

    const directButton = screen.getByRole('button', { name: /Run directly/i });
    expect(directButton).toBeDisabled();
    expect(directButton).toHaveAttribute('title', 'Missing permission engine:process:modify');
    fireEvent.click(directButton);
    expect(onExecuteDirect).not.toHaveBeenCalled();
  });

  it('executes available modes', () => {
    const onExecuteBatch = vi.fn();
    const onExecuteDirect = vi.fn();

    render(
      <ApplyMigrationModal
        {...baseProps}
        onExecuteBatch={onExecuteBatch}
        onExecuteDirect={onExecuteDirect}
      />
    );

    fireEvent.change(screen.getByLabelText('Audit reason'), { target: { value: 'Migrate hotfixed process instances' } });

    fireEvent.click(screen.getByRole('button', { name: /Create migration batch/i }));
    expect(onExecuteBatch).toHaveBeenCalledWith('Migrate hotfixed process instances');

    fireEvent.click(screen.getByRole('button', { name: /Run directly/i }));
    expect(onExecuteDirect).toHaveBeenCalledWith('Migrate hotfixed process instances');
  });
});
