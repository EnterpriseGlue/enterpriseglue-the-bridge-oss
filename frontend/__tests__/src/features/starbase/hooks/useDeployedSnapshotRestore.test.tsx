import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeployedSnapshotRestore } from '@src/features/starbase/hooks/useDeployedSnapshotRestore';
import { apiClient } from '@src/shared/api/client';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
vi.mock('@src/shared/api/client', () => ({ apiClient: { post: vi.fn() } }));
const fileId = '11111111-1111-4111-8111-111111111111';
const receipt = { restored: true, fileId, commitId: 'saved-commit', fileVersionNumber: 3, updatedAt: 1 };
function fixture(overrides: Record<string, any> = {}, strict = false) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const options = { fileId, request: { commitId: 'saved-commit', fileVersionNumber: 3 }, authority: 'owner-session-A', allowed: true,
    assertWritable: vi.fn(), onVerified: vi.fn(), onError: vi.fn(), ...overrides };
  const f = renderHook(props => useDeployedSnapshotRestore(props), { initialProps: options,
    wrapper: ({ children }) => <QueryClientProvider client={client}>{strict ? <React.StrictMode>{children}</React.StrictMode> : children}</QueryClientProvider> });
  return { ...f, options };
}
describe('owned deployed-snapshot draft restore', () => {
  beforeEach(() => vi.resetAllMocks());
  it('sends one source-bound request and acknowledges an exact receipt', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(receipt); const f = fixture(); act(() => { f.result.current.mutate(); f.result.current.mutate(); });
    await waitFor(() => expect(f.options.onVerified).toHaveBeenCalledOnce());
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith(`/starbase-api/files/${fileId}/restore-from-commit`, f.options.request); expect(f.options.assertWritable).toHaveBeenCalledOnce();
  });
  it.each([{}, { ...receipt, restored: false }, { ...receipt, fileId: '22222222-2222-4222-8222-222222222222' }, { ...receipt, commitId: 'wrong' }, { ...receipt, fileVersionNumber: 4 }, { ...receipt, xml: 'private' }])('refuses an unverified receipt and keeps replay blocked', async raw => {
    vi.mocked(apiClient.post).mockResolvedValue(raw); const f = fixture(); act(() => f.result.current.mutate());
    await waitFor(() => expect(f.options.onError).toHaveBeenCalledOnce()); expect(f.options.onVerified).not.toHaveBeenCalled(); expect(f.result.current.isBlocked).toBe(true);
    act(() => f.result.current.mutate()); expect(apiClient.post).toHaveBeenCalledOnce();
  });
  it.each(['actor-session', 'file', 'source', 'permission', 'browser', 'unmount'])('drops late completion after %s changes', async change => {
    let finish!: (value: unknown) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const f = fixture(); act(() => f.result.current.mutate()); await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
    if (change === 'browser') advanceBrowserSessionRevision(); else if (change === 'unmount') f.unmount();
    else f.rerender({ ...f.options, ...(change === 'actor-session' ? { authority: 'replaced' } : change === 'file' ? { fileId: '22222222-2222-4222-8222-222222222222' } : change === 'source' ? { request: { commitId: 'different', fileVersionNumber: 3 } } : { allowed: false }) });
    await act(async () => finish(receipt)); expect(f.options.onVerified).not.toHaveBeenCalled(); expect(f.options.onError).not.toHaveBeenCalled();
  });
  it('refuses dispatch without permission or a current write lease', async () => {
    const denied = fixture({ allowed: false }); act(() => denied.result.current.mutate()); expect(apiClient.post).not.toHaveBeenCalled(); denied.unmount();
    const f = fixture({ assertWritable: vi.fn(() => { throw new Error('read-only'); }) }); act(() => f.result.current.mutate());
    await waitFor(() => expect(f.options.onError).toHaveBeenCalledOnce()); expect(apiClient.post).not.toHaveBeenCalled();
  });
  it('reports malformed source selection without dispatching or clearing drafts', async () => {
    const f = fixture({ request: { commitId: ' ' } }); act(() => f.result.current.mutate()); expect(apiClient.post).not.toHaveBeenCalled(); expect(f.options.onError).toHaveBeenCalledOnce(); expect(f.options.onVerified).not.toHaveBeenCalled();
  });
  it('supports commit-only restore without inventing a semantic version', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ...receipt, fileVersionNumber: null }); const f = fixture({ request: { commitId: 'saved-commit' } }); act(() => f.result.current.mutate());
    await waitFor(() => expect(f.options.onVerified).toHaveBeenCalledOnce());
  });
  it('owns copied request metadata across asynchronous settlement and StrictMode', async () => {
    let finish!: (value: unknown) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; })); const f = fixture({}, true);
    act(() => f.result.current.mutate()); await waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce()); f.options.request.commitId = 'mutated';
    expect(vi.mocked(apiClient.post).mock.calls[0][1]).toMatchObject({ commitId: 'saved-commit' }); await act(async () => finish(receipt)); expect(f.options.onVerified).toHaveBeenCalledOnce();
  });
});
