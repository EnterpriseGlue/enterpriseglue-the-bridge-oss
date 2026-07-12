import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmModal from '@src/shared/components/ConfirmModal';

vi.mock('@carbon/react', () => ({
  Modal: ({ open, modalHeading, primaryButtonText, secondaryButtonText, onRequestSubmit, onRequestClose, children }: any) =>
    open ? (
      <div>
        <h2>{modalHeading}</h2>
        <div>{children}</div>
        <button onClick={onRequestSubmit}>{primaryButtonText}</button>
        <button onClick={onRequestClose}>{secondaryButtonText}</button>
      </div>
    ) : null,
  InlineNotification: ({ subtitle }: any) => <div>{subtitle}</div>,
  TextArea: ({ labelText, value, onChange, ...props }: any) => (
    <label>
      {labelText}
      <textarea value={value} onChange={onChange} {...props} />
    </label>
  ),
}));

describe('ConfirmModal', () => {
  it('calls onConfirm when confirmed', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open={true}
        title="Confirm"
        description="Are you sure?"
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onClose when cancelled', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open={true}
        title="Confirm"
        description="Are you sure?"
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders warning message when enabled', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmModal
        open={true}
        title="Confirm"
        description="Are you sure?"
        onConfirm={onConfirm}
        onClose={onClose}
        showWarning
        warningMessage="Be careful"
      />
    );
    expect(screen.getByText('Be careful')).toBeInTheDocument();
  });

  it('requires an audit reason when configured', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open={true}
        title="Confirm"
        description="Are you sure?"
        onConfirm={onConfirm}
        onClose={vi.fn()}
        requireReason
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Audit reason'), { target: { value: 'Maintenance window' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith('Maintenance window');
  });
});
