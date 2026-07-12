import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BulkOperationModals } from '@src/features/mission-control/processes-overview/components/modals/BulkOperationModals';

vi.mock('@src/shared/components/ConfirmModal', () => ({
  default: ({ open, title, requireReason }: any) => open ? (
    <div>
      <span>{title}</span>
      <span>{requireReason ? 'reason-required' : 'reason-not-required'}</span>
    </div>
  ) : null,
}));

const baseProps = {
  bulkRetryOpen: false,
  bulkRetryBusy: false,
  onBulkRetryClose: vi.fn(),
  onBulkRetryConfirm: vi.fn(),
  selectedCount: 2,
  bulkDeleteOpen: false,
  bulkDeleteBusy: false,
  onBulkDeleteClose: vi.fn(),
  onBulkDeleteConfirm: vi.fn(),
  bulkSuspendOpen: false,
  bulkSuspendBusy: false,
  onBulkSuspendClose: vi.fn(),
  onBulkSuspendConfirm: vi.fn(),
  bulkActivateOpen: false,
  bulkActivateBusy: false,
  onBulkActivateClose: vi.fn(),
  onBulkActivateConfirm: vi.fn(),
  terminateOpen: false,
  onTerminateClose: vi.fn(),
  onTerminateConfirm: vi.fn(),
};

describe('BulkOperationModals', () => {
  it('exports BulkOperationModals component', () => {
    expect(BulkOperationModals).toBeDefined();
    expect(typeof BulkOperationModals).toBe('function');
  });

  it('requires audit reasons for bulk runtime operations', () => {
    render(<BulkOperationModals {...baseProps} bulkRetryOpen bulkDeleteOpen bulkSuspendOpen bulkActivateOpen />);
    expect(screen.getAllByText('reason-required')).toHaveLength(4);
  });
});
