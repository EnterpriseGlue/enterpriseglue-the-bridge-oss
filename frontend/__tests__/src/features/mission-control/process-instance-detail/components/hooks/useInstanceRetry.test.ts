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
      result.current.setRetrySelectionMap({ 'job-1': true });
    });

    await act(async () => {
      await result.current.submitRetrySelection();
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(hookMocks.showAlert).toHaveBeenCalledWith('Missing permission engine:instance:retry', 'warning');
  });
});
