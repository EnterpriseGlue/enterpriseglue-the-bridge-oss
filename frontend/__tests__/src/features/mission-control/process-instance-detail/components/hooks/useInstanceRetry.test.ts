import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useInstanceRetry } from '@src/features/mission-control/process-instance-detail/components/hooks/useInstanceRetry';
import { apiClient } from '@src/shared/api/client';

const hookMocks = vi.hoisted(() => ({
  showAlert: vi.fn(),
}));

vi.mock('@src/shared/hooks/useAlert', () => ({
  useAlert: () => ({ showAlert: hookMocks.showAlert }),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    post: vi.fn(),
  },
}));

const queryRef = { refetch: vi.fn() };

describe('useInstanceRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports useInstanceRetry hook', () => {
    expect(useInstanceRetry).toBeDefined();
    expect(typeof useInstanceRetry).toBe('function');
  });

  it('does not submit retries when retry permission is denied', async () => {
    const { result } = renderHook(() =>
      useInstanceRetry({
        instanceId: 'pi-1',
        allRetryItems: [{ id: 'job-1', itemType: 'job', activityId: 'task' }],
        retryJobsQ: queryRef,
        retryExtTasksQ: queryRef,
        incidentsQ: queryRef,
        actQ: queryRef,
        engineId: 'engine-1',
        retryDecision: {
          actionId: 'engine.runtime.process-instances.retry',
          permissionId: 'engine:instance:retry',
          resourceType: 'engine',
          resourceId: 'engine-1',
          allowed: false,
          state: 'disabled',
          reason: 'Missing permission engine:instance:retry',
        },
      })
    );

    await act(async () => {
      result.current.openRetryModal();
      result.current.setRetrySelectionMap({ 'job-1': true });
    });

    await act(async () => {
      await result.current.submitRetrySelection();
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(hookMocks.showAlert).toHaveBeenCalledWith('Missing permission engine:instance:retry', 'warning');
  });

  it('closes a prepared retry and refuses to retarget it after an engine switch', async () => {
    const { result, rerender } = renderHook(
      ({ engineId }) => useInstanceRetry({
        instanceId: 'pi-1',
        allRetryItems: [{ id: 'job-1', itemType: 'job', activityId: 'task' }],
        retryJobsQ: queryRef,
        retryExtTasksQ: queryRef,
        incidentsQ: queryRef,
        actQ: queryRef,
        engineId,
        retryDecision: { allowed: true } as any,
      }),
      { initialProps: { engineId: 'engine-1' } },
    );

    act(() => result.current.openRetryModal());
    act(() => result.current.setRetrySelectionMap({ 'job-1': true }));
    rerender({ engineId: 'engine-2' });
    await act(async () => result.current.submitRetrySelection());

    expect(result.current.retryModalOpen).toBe(false);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('keeps an in-flight retry on its origin engine and ignores it after A to B to A', async () => {
    let resolveRequest: (() => void) | undefined;
    vi.mocked(apiClient.post).mockImplementation(() => new Promise<void>((resolve) => { resolveRequest = resolve; }));
    const localQueryRef = { refetch: vi.fn() };
    const { result, rerender } = renderHook(
      ({ engineId }) => useInstanceRetry({
        instanceId: 'pi-1',
        allRetryItems: [{ id: 'job-1', itemType: 'job', activityId: 'task' }],
        retryJobsQ: localQueryRef,
        retryExtTasksQ: localQueryRef,
        incidentsQ: localQueryRef,
        actQ: localQueryRef,
        engineId,
        retryDecision: { allowed: true } as any,
      }),
      { initialProps: { engineId: 'engine-1' } },
    );

    act(() => result.current.openRetryModal());
    act(() => result.current.setRetrySelectionMap({ 'job-1': true }));
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.submitRetrySelection();
      await Promise.resolve();
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/mission-control-api/process-instances/pi-1/retry',
      { jobIds: ['job-1'], engineId: 'engine-1' },
      { credentials: 'include' },
    );

    rerender({ engineId: 'engine-2' });
    rerender({ engineId: 'engine-1' });
    act(() => result.current.openRetryModal('task'));
    await act(async () => {
      resolveRequest?.();
      await pending;
    });

    expect(localQueryRef.refetch).not.toHaveBeenCalled();
    expect(result.current.retryModalOpen).toBe(true);
    expect(result.current.retryActivityFilter).toBe('task');
  });
});
