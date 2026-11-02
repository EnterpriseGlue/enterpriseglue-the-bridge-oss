import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@src/contexts/AuthContext';
import { resolveRuntimeDefinitionLink, useRuntimeDefinitionLink } from '@src/features/mission-control/shared/useRuntimeDefinitionLink';

const definitions = [{ id: 'target:3:id', key: 'target', version: 3, name: 'Target' }, { id: 'target:4:id', key: 'target', version: 4 }];
const resolve = (search: string, extra: Partial<Parameters<typeof resolveRuntimeDefinitionLink>[0]> = {}) => resolveRuntimeDefinitionLink({ kind: 'process', engineId: 'engine-A', definitions, ready: true, failed: false, search, ...extra });
describe('incoming runtime definition selection', () => {
  it.each(['process', 'decision'] as const)('resolves an exact %s version instead of the latest', kind => {
    expect(resolve(`${kind}=target&version=3&engineId=engine-A&node=Task_target`, { kind })).toMatchObject({ status: 'resolved', selection: { id: 'target:3:id', key: 'target', version: 3, node: 'Task_target' } });
    expect(resolve(`${kind}=target`, { kind })).toMatchObject({ status: 'resolved', selection: { id: 'target:4:id', version: 4 } });
  });
  it.each(['version=3', 'process=', 'process=%20target', 'decision=target', 'process=target&decision=target', 'process=target&process=other',
    'process=target&version=', 'process=target&version=0', 'process=target&version=-1', 'process=target&version=3.5', 'process=target&version=03',
    'process=target&version=3e0', 'process=target&version=9007199254740992', 'process=target&version=3&version=4',
    'process=target&engineId=', 'process=target&engineId=engine-A&engineId=engine-B', 'process=target&node=', 'process=target&node=x&node=y'])('rejects invalid or ambiguous link %s', search => {
    expect(resolve(search).status).toBe('invalid');
  });
  it.each(['process=missing', 'process=target&version=99'])('retains unavailable targets without substituting another version', search => expect(resolve(search).status).toBe('unavailable'));
  it('refuses duplicate exact definition identities and ignores unrelated keys', () => {
    expect(resolve('process=target&version=3', { definitions: [...definitions, { ...definitions[0], id: 'other:id' }] }).status).toBe('unavailable');
    expect(resolve('process=target', { definitions: [...definitions, { id: 'foreign', key: 'other', version: 999 }] }).selection?.version).toBe(4);
  });
  it('waits for verified definitions and the intended engine', () => {
    expect(resolve('process=target', { ready: false }).status).toBe('pending');
    expect(resolve('process=target', { engineId: undefined }).status).toBe('pending');
    expect(resolve('process=target', { failed: true }).status).toBe('unavailable');
    expect(resolve('process=target&engineId=engine-B').status).toBe('unavailable');
    expect(resolve('engineId=engine-A&node=Task_target').status).toBe('none');
  });
});

it('applies once, consumes atomically, preserves unrelated context, and revokes old clear callbacks', async () => {
  const apply = vi.fn(), clearSelection = vi.fn();
  let clear!: () => void, oldClear!: () => void, navigate!: ReturnType<typeof useNavigate>;
  function Destination() {
    navigate = useNavigate();
    const link = useRuntimeDefinitionLink({ kind: 'process', engineId: 'engine-A', definitions, ready: true, failed: false, apply, clearSelection });
    clear = link.clear;
    return <output>{useLocation().pathname + useLocation().search}</output>;
  }
  const auth = { user: { id: 'actor' }, sessionRevision: 1, permissions: null } as any;
  const ui = render(<AuthContext.Provider value={auth}><MemoryRouter initialEntries={['/t/tenant-a/mission-control/processes?process=target&version=3&node=Task_target&fromInstance=origin&extra=keep']}><Destination /></MemoryRouter></AuthContext.Provider>);
  await waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ version: 3, node: 'Task_target' }));
  expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('?fromInstance=origin&extra=keep&engineId=engine-A');
  oldClear = clear;
  await act(async () => navigate('/t/tenant-b/mission-control/processes?process=missing&version=99'));
  act(() => oldClear());
  expect(clearSelection).not.toHaveBeenCalled();
  expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('process=missing&version=99');
  await act(async () => navigate('/t/tenant-a/mission-control/processes?process=target&version=3&node=Task_target'));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  oldClear = clear;
  ui.unmount();
  act(() => oldClear());
  expect(clearSelection).not.toHaveBeenCalled();
});
