import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminateConfirmModal } from '@src/features/mission-control/process-instance-detail/components/modals/TerminateConfirmModal';

vi.mock('@carbon/react', () => ({
  Modal: ({ open, modalHeading, primaryButtonText, primaryButtonDisabled, onRequestSubmit, children }: any) => open ? (
    <div role="dialog">
      <h2>{modalHeading}</h2>
      <button disabled={primaryButtonDisabled} onClick={onRequestSubmit}>{primaryButtonText}</button>
      {children}
    </div>
  ) : null,
  TextArea: ({ labelText, value, onChange, ...props }: any) => (
    <label>
      {labelText}
      <textarea value={value} onChange={onChange} {...props} />
    </label>
  ),
  InlineNotification: ({ title, subtitle }: any) => <div>{title}: {subtitle}</div>,
}));

describe('TerminateConfirmModal', () => {
  it('exports TerminateConfirmModal component', () => {
    expect(TerminateConfirmModal).toBeDefined();
    expect(typeof TerminateConfirmModal).toBe('function');
  });

  it('requires and submits a cancel reason', async () => {
    const onTerminate = vi.fn().mockResolvedValue(undefined);
    render(
      <TerminateConfirmModal
        open
        instanceId="pi-1"
        onClose={vi.fn()}
        onTerminate={onTerminate}
      />
    );

    const submit = screen.getByRole('button', { name: 'Cancel Instance' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Cancel reason'), { target: { value: 'Duplicate instance' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(onTerminate).toHaveBeenCalledWith('pi-1', 'Duplicate instance');
  });
});
