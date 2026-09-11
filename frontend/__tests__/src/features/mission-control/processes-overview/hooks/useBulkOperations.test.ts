import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBulkOperations } from '@src/features/mission-control/processes-overview/hooks/useBulkOperations';
import {
  createBulkActivateBatch,
  createBulkDeleteBatch,
  createBulkRetryBatch,
  createBulkSuspendBatch,
} from '@src/features/mission-control/batches/api/batches';
import { apiClient } from '@src/shared/api/client';

const tenantNavigate = vi.hoisted(() => vi.fn());

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({ tenantNavigate }),
}));

vi.mock('@src/features/mission-control/batches/api/batches', () => ({
  createBulkRetryBatch: vi.fn(),
  createBulkDeleteBatch: vi.fn(),
  createBulkSuspendBatch: vi.fn(),
  createBulkActivateBatch: vi.fn(),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: { put: vi.fn(), delete: vi.fn() },
}));

type Deferred = {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderBulkHook() {
  const setSelectedMap = vi.fn();
  const showAlert = vi.fn();
  const view = renderHook(
    ({ engineId }) => useBulkOperations({
      selectedMap: { 'instance-a': true },
      setSelectedMap,
      instQRefetch: vi.fn(),
      showAlert,
      engineId,
    }),
    { initialProps: { engineId: 'engine-a' as string | null } },
  );
  return { ...view, setSelectedMap, showAlert };
}

describe('useBulkOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['retry', 'bulkRetry', createBulkRetryBatch, ['instance-a'], 'engine-a', 'approved'],
    ['delete', 'bulkDelete', createBulkDeleteBatch, ['instance-a'], 'approved', 'engine-a'],
    ['suspend', 'bulkSuspend', createBulkSuspendBatch, ['instance-a'], 'engine-a', 'approved'],
    ['activate', 'bulkActivate', createBulkActivateBatch, ['instance-a'], 'engine-a', 'approved'],
  ] as const)('keeps an in-flight %s request on A but suppresses its completion after A to B to A', async (
    _label,
    operation,
    api,
    expectedIds,
    expectedSecond,
    expectedThird,
  ) => {
    const response = deferred();
    vi.mocked(api).mockReturnValue(response.promise as never);
    const { result, rerender, setSelectedMap, showAlert } = renderBulkHook();

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current[operation]('approved');
      await Promise.resolve();
    });
    expect(api).toHaveBeenCalledWith(expectedIds, expectedSecond, expectedThird);

    rerender({ engineId: 'engine-b' });
    rerender({ engineId: 'engine-a' });
    await act(async () => {
      response.resolve({ id: 'batch-a' });
      await pending;
    });

    expect(tenantNavigate).not.toHaveBeenCalled();
    expect(setSelectedMap).not.toHaveBeenCalled();
    expect(showAlert).not.toHaveBeenCalled();
    expect(result.current.bulkRetryBusy).toBe(false);
    expect(result.current.bulkDeleteBusy).toBe(false);
    expect(result.current.bulkSuspendBusy).toBe(false);
    expect(result.current.bulkActivateBusy).toBe(false);
  });

  it('suppresses a stale failure notification after A to B to A', async () => {
    const response = deferred();
    vi.mocked(createBulkRetryBatch).mockReturnValue(response.promise as never);
    const { result, rerender, showAlert } = renderBulkHook();

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.bulkRetry('approved');
      await Promise.resolve();
    });
    rerender({ engineId: 'engine-b' });
    rerender({ engineId: 'engine-a' });
    await act(async () => {
      response.reject(new Error('old A failed'));
      await pending;
    });

    expect(showAlert).not.toHaveBeenCalled();
    expect(tenantNavigate).not.toHaveBeenCalled();
  });

  it('reports a deferred row action as stale after A to B to A so callers skip refetch effects', async () => {
    const response = deferred();
    vi.mocked(apiClient.put).mockReturnValue(response.promise as never);
    const { result, rerender, showAlert } = renderBulkHook();

    let pending!: Promise<boolean>;
    await act(async () => {
      pending = result.current.callAction(
        'PUT',
        '/mission-control-api/process-instances/instance-a/activate?engineId=engine-a',
      );
      await Promise.resolve();
    });
    expect(apiClient.put).toHaveBeenCalledWith(
      '/mission-control-api/process-instances/instance-a/activate?engineId=engine-a',
      {},
      { credentials: 'include' },
    );

    rerender({ engineId: 'engine-b' });
    rerender({ engineId: 'engine-a' });
    await act(async () => response.resolve(undefined));

    await expect(pending).resolves.toBe(false);
    expect(showAlert).not.toHaveBeenCalled();
  });
});
