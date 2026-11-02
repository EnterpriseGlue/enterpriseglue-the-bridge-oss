import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@src/contexts/AuthContext';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { apiClient } from '@src/shared/api/client';
import { useStartProcess } from '@src/features/mission-control/processes-overview/hooks/useStartProcess';
import { startProcessDefinition } from '@src/features/mission-control/processes-overview/api/startProcess';

vi.mock('@src/shared/api/client', async original => ({ ...await original<typeof import('@src/shared/api/client')>(), apiClient: { post: vi.fn() } }));
const target = { id: 'invoice:3/a', key: 'invoice', version: 3 };
const receipt = { id: 'instance-1', definitionId: target.id };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(apiClient.post).mockResolvedValue(receipt); });
function fixture() {
  const options = { engineId: 'engine-A', target: { ...target }, allowed: true, onStarted: vi.fn(async (_receipt: any, check: () => void) => check()) };
  const auth = { isAuthenticated: true, isLoading: false, user: { id: 'actor-A', session: { principal: { id: 'actor-A' }, tenant: { id: 'tenant-A' } } }, sessionRevision: 1,
    permissions: { userId: 'actor-A', platform: [], projects: [], engines: [], generatedAt: 1 } } as any;
  let navigate!: ReturnType<typeof useNavigate>;
  function Route() { navigate = useNavigate(); return null; }
  const hook = renderHook(() => useStartProcess(options), { wrapper: ({ children }) => <AuthContext.Provider value={auth}><MemoryRouter initialEntries={['/t/a/mission-control/processes?engineId=engine-A']}><Route />{children}</MemoryRouter></AuthContext.Provider> });
  act(() => hook.result.current.open());
  return { ...hook, options, auth, navigate: (path: string) => navigate(path) };
}

it('submits one exact definition with private form inputs and a verified receipt', async () => {
  const f = fixture();
  act(() => { f.result.current.setBusinessKey('  case-1  '); f.result.current.setVariablesJson('{"amount":{"type":"Integer","value":42}}'); });
  await act(async () => f.result.current.submit());
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/mission-control-api/process-definitions/invoice%3A3%2Fa/start', { engineId: 'engine-A', businessKey: 'case-1', variables: { amount: { type: 'Integer', value: 42 } } }, { credentials: 'include' });
  expect(f.options.onStarted).toHaveBeenCalledOnce();
  expect(f.result.current.isOpen).toBe(false);
  expect(f.result.current.variablesJson).toBe('');
});

it.each(['{', '[]', 'null', '42', '"text"', '{"__proto__":{"value":"private"}}', '{"amount":{"value":1e999}}'])('rejects invalid variables %s before dispatch', async input => {
  const f = fixture(); act(() => f.result.current.setVariablesJson(input));
  await act(async () => f.result.current.submit());
  expect(apiClient.post).not.toHaveBeenCalled(); expect(f.result.current.error).toBeTruthy();
});

it('prevents duplicate submit and cancel/reopen while the start is in flight', async () => {
  let settle!: (value: any) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const f = fixture(); let first!: Promise<void>;
  act(() => { first = f.result.current.submit(); void f.result.current.submit(); f.result.current.close(); f.result.current.open(); });
  expect(apiClient.post).toHaveBeenCalledOnce(); expect(f.result.current.isOpen).toBe(true);
  await act(async () => { settle(receipt); await first; });
  expect(f.options.onStarted).toHaveBeenCalledOnce();
});

it.each([{}, { id: '' }, { id: ' ', definitionId: target.id }, { id: 'instance-1' }, { id: 'instance-1', definitionId: 'other-definition' }, null])('blocks resubmission after unverified acknowledgement %j', async value => {
  vi.mocked(apiClient.post).mockResolvedValue(value);
  const f = fixture(); await act(async () => f.result.current.submit());
  expect(f.result.current.blocked).toBe(true);
  expect(f.result.current.error).toContain('Check instances');
  await act(async () => f.result.current.submit());
  act(() => { f.result.current.close(); f.result.current.open(); });
  expect(apiClient.post).toHaveBeenCalledOnce(); expect(f.options.onStarted).not.toHaveBeenCalled(); expect(f.result.current.isOpen).toBe(false);
});

it('does not replay a start after response loss or after a successful start whose refresh fails', async () => {
  const f = fixture(); vi.mocked(apiClient.post).mockRejectedValue(new Error('private provider body'));
  await act(async () => f.result.current.submit());
  expect(f.result.current.blocked).toBe(true); expect(f.result.current.error).not.toContain('private');
  const next = fixture(); vi.mocked(apiClient.post).mockResolvedValue(receipt); next.options.onStarted.mockRejectedValue(new Error('refresh failed'));
  await act(async () => next.result.current.submit());
  expect(next.result.current.error).toContain('process started');
  await act(async () => next.result.current.submit());
  expect(apiClient.post).toHaveBeenCalledTimes(2);
});

it.each(['engine', 'definition', 'version', 'key', 'permission', 'actor', 'tenant', 'session', 'snapshot', 'route', 'browser', 'unmount', 'logout', 'loading'])('revokes an old pending start completion after %s replacement', async change => {
  let settle!: (value: any) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const f = fixture(); let first!: Promise<void>;
  act(() => { first = f.result.current.submit(); });
  act(() => {
    if (change === 'engine') f.options.engineId = 'engine-B';
    if (change === 'definition') f.options.target = { ...target, id: 'new-definition' };
    if (change === 'version') f.options.target = { ...target, version: 4 };
    if (change === 'key') f.options.target = { ...target, key: 'other' };
    if (change === 'permission') f.options.allowed = false;
    if (change === 'logout') f.auth.isAuthenticated = false;
    if (change === 'loading') f.auth.isLoading = true;
    if (change === 'actor') f.auth.user.session.principal.id = 'actor-B';
    if (change === 'tenant') f.auth.user.session.tenant.id = 'tenant-B';
    if (change === 'session') f.auth.sessionRevision++;
    if (change === 'snapshot') f.auth.permissions = { ...f.auth.permissions, authorizationVersion: 'new-version' };
    if (change === 'route') f.navigate('/t/b/mission-control/processes');
    if (change === 'browser') advanceBrowserSessionRevision();
    if (change === 'unmount') f.unmount(); else f.rerender();
  });
  await act(async () => { settle(receipt); await first; });
  expect(f.options.onStarted).not.toHaveBeenCalled(); expect(apiClient.post).toHaveBeenCalledOnce();
});

it('clears cancelled private inputs and rejects callbacks from an earlier dialog', async () => {
  const f = fixture(); act(() => { f.result.current.setBusinessKey('private'); f.result.current.setVariablesJson('{}'); });
  const old = f.result.current; act(() => old.close()); act(() => f.result.current.open());
  expect(f.result.current.businessKey).toBe(''); expect(f.result.current.variablesJson).toBe('');
  await act(async () => { old.close(); await old.submit(); });
  expect(f.result.current.isOpen).toBe(true); expect(apiClient.post).not.toHaveBeenCalled();
});

it('copies nested input before awaiting the HTTP acknowledgement', async () => {
  const input = { engineId: 'engine-A', variables: { amount: { value: 1 } } };
  const promise = startProcessDefinition(target.id, input); input.variables.amount.value = 99;
  await promise;
  expect(vi.mocked(apiClient.post).mock.calls[0][1]).toMatchObject({ variables: { amount: { value: 1 } } });
});
