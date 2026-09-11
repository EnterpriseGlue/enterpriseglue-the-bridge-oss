import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RetryModal } from '@src/features/mission-control/processes-overview/components/modals/RetryModal';
import { apiClient } from '@src/shared/api/client';

vi.mock('@src/shared/api/client', () => ({ apiClient: { post: vi.fn() } }));

vi.mock('@carbon/react', () => ({
  Modal: ({ open, modalHeading, primaryButtonText, primaryButtonDisabled, onRequestSubmit, children }: any) => open ? (
    <div role="dialog" aria-label={modalHeading}>
      <h2>{modalHeading}</h2>
      <button disabled={primaryButtonDisabled} onClick={onRequestSubmit}>{primaryButtonText}</button>
      {children}
    </div>
  ) : null,
  InlineNotification: ({ title, subtitle }: any) => <div>{title}: {subtitle}</div>,
  Checkbox: ({ id, checked, indeterminate, onChange }: any) => (
    <input
      id={id}
      type="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      checked={checked}
      onChange={(event) => onChange?.(event, { checked: event.currentTarget.checked })}
    />
  ),
  Loading: () => null,
}));

const baseProps = {
  open: true,
  instanceId: 'pi-1',
  onClose: vi.fn(),
  allRetryItems: [{ id: 'job-1', itemType: 'job', activityId: 'task', retries: 0 }],
  retryJobsQLoading: false,
  retryExtTasksQLoading: false,
  retryJobsQError: null,
  retryExtTasksQError: null,
  retrySelectionMap: { 'job-1': true },
  setRetrySelectionMap: vi.fn(),
  retryDueMode: 'keep' as const,
  setRetryDueMode: vi.fn(),
  retryDueInput: '',
  setRetryDueInput: vi.fn(),
  retryModalBusy: false,
  setRetryModalBusy: vi.fn(),
  retryModalError: null,
  setRetryModalError: vi.fn(),
  retryModalSuccess: false,
  setRetryModalSuccess: vi.fn(),
  retryJobsQRefetch: vi.fn(),
  retryExtTasksQRefetch: vi.fn(),
  instQRefetch: vi.fn(),
  engineId: 'engine-1',
  interactionKey: 'engine-1:0:pi-1',
};

describe('ProcessesOverview RetryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockResolvedValue(undefined);
  });

  it('exports RetryModal', () => {
    expect(RetryModal).toBeDefined();
    expect(typeof RetryModal).toBe('function');
  });

  it('disables submit when retry permission is denied', () => {
    render(
      <RetryModal
        {...baseProps}
        retryDecision={{
          actionId: 'engine.runtime.process-instances.retry',
          permissionId: 'engine:instance:retry',
          resourceType: 'engine',
          resourceId: 'engine-1',
          allowed: false,
          state: 'disabled',
          reason: 'Missing permission engine:instance:retry',
        }}
      />
    );

    expect(screen.getByText(/Retry unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Missing permission engine:instance:retry/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });

  it('ignores an in-flight result after the engine interaction changes', async () => {
    let resolveRequest!: () => void;
    vi.mocked(apiClient.post).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveRequest = resolve; }),
    );
    const setRetryModalSuccess = vi.fn();
    const retryJobsQRefetch = vi.fn();
    const retryExtTasksQRefetch = vi.fn();
    const instQRefetch = vi.fn();
    const view = render(
      <RetryModal
        {...baseProps}
        setRetryModalSuccess={setRetryModalSuccess}
        retryJobsQRefetch={retryJobsQRefetch}
        retryExtTasksQRefetch={retryExtTasksQRefetch}
        instQRefetch={instQRefetch}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
    view.rerender(<RetryModal {...baseProps} interactionKey="engine-2:1:pi-1" open={false} />);
    view.rerender(<RetryModal {...baseProps} interactionKey="engine-1:2:pi-1" />);
    await act(async () => resolveRequest());

    expect(retryJobsQRefetch).not.toHaveBeenCalled();
    expect(retryExtTasksQRefetch).not.toHaveBeenCalled();
    expect(instQRefetch).not.toHaveBeenCalled();
    expect(setRetryModalSuccess).not.toHaveBeenCalledWith(true);
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });
});
