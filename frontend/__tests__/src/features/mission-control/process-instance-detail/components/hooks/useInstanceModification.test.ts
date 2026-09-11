import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstanceModification } from '@src/features/mission-control/process-instance-detail/components/hooks/useInstanceModification';
import { apiClient } from '@src/shared/api/client';

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock('@src/shared/api/client', () => ({
  apiClient: { post: vi.fn() },
}));

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({ notify }),
}));

describe('useInstanceModification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockResolvedValue(undefined);
  });

  it('exports useInstanceModification hook', () => {
    expect(useInstanceModification).toBeDefined();
    expect(typeof useInstanceModification).toBe('function');
  });

  it('discards a prepared modification instead of retargeting it after selection changes', async () => {
    const actQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const incidentsQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const runtimeQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const { result, rerender } = renderHook(
      ({ engineId }) => useInstanceModification({
        instanceId: 'pi-1',
        status: 'ACTIVE',
        actQ,
        incidentsQ,
        runtimeQ,
        engineId,
      }),
      { initialProps: { engineId: 'engine-1' } },
    );

    act(() => result.current.setSelectedActivityId('reviewTask'));
    act(() => result.current.addPlanOperation('add'));
    rerender({ engineId: 'engine-2' });

    await act(async () => {
      await result.current.applyModifications();
    });

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(result.current.modPlan).toEqual([]);
    expect(result.current.isModMode).toBe(false);
  });

  it('submits a prepared modification only to the engine where it originated', async () => {
    const actQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const incidentsQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const runtimeQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const { result } = renderHook(() => useInstanceModification({
      instanceId: 'pi-1',
      status: 'ACTIVE',
      actQ,
      incidentsQ,
      runtimeQ,
      engineId: 'engine-1',
    }));

    act(() => result.current.setSelectedActivityId('reviewTask'));
    act(() => result.current.addPlanOperation('add'));
    await act(async () => result.current.applyModifications());

    expect(apiClient.post).toHaveBeenCalledWith(
      '/mission-control-api/process-instances/pi-1/modify',
      { engineId: 'engine-1', instructions: [{ type: 'startBeforeActivity', activityId: 'reviewTask' }] },
      { credentials: 'include' },
    );
  });

  it('does not clear a new A plan when an old A request completes after A to B to A', async () => {
    let resolveRequest!: () => void;
    vi.mocked(apiClient.post).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveRequest = resolve; }),
    );
    const actQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const incidentsQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const runtimeQ = { refetch: vi.fn().mockResolvedValue(undefined) };
    const { result, rerender } = renderHook(
      ({ engineId }) => useInstanceModification({
        instanceId: 'pi-1',
        status: 'ACTIVE',
        actQ,
        incidentsQ,
        runtimeQ,
        engineId,
      }),
      { initialProps: { engineId: 'engine-1' } },
    );

    act(() => result.current.setSelectedActivityId('oldTask'));
    act(() => result.current.addPlanOperation('add'));
    let submitPromise!: Promise<void>;
    act(() => { submitPromise = result.current.applyModifications(); });
    await vi.waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());

    rerender({ engineId: 'engine-2' });
    rerender({ engineId: 'engine-1' });
    act(() => result.current.setSelectedActivityId('newTask'));
    act(() => result.current.addPlanOperation('add'));
    await act(async () => {
      resolveRequest();
      await submitPromise;
    });

    expect(actQ.refetch).not.toHaveBeenCalled();
    expect(incidentsQ.refetch).not.toHaveBeenCalled();
    expect(runtimeQ.refetch).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(result.current.modPlan).toEqual([{ kind: 'add', activityId: 'newTask' }]);
  });
});
