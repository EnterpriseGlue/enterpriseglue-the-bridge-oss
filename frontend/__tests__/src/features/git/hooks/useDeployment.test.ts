import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  useDeployment,
  useRollback,
  useDeployments,
  useCommitHistory,
} from '@src/features/git/hooks/useDeployment';
import { gitApi } from '@src/features/git/api/gitApi';
import { ProjectPermission } from '@src/shared/auth/permissions';

const authState = vi.hoisted(() => ({
  permissions: {
    platform: [],
    projects: [] as Array<{ resourceId: string; permissions: string[] }>,
    engines: [],
  },
  hasProjectPermission: vi.fn(),
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    permissions: authState.permissions,
    hasProjectPermission: authState.hasProjectPermission,
  }),
}));

vi.mock('@src/features/git/api/gitApi', () => ({
  gitApi: {
    deploy: vi.fn(),
    getDeployments: vi.fn(),
    getCommits: vi.fn(),
    rollback: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.permissions = {
      platform: [],
      projects: [],
      engines: [],
    };
    authState.hasProjectPermission.mockReturnValue(false);
  });

  it('exports git deployment hooks', () => {
    expect(typeof useDeployment).toBe('function');
    expect(typeof useRollback).toBe('function');
    expect(typeof useDeployments).toBe('function');
    expect(typeof useCommitHistory).toBe('function');
  });

  it('does not call rollback when the project rollback action is denied', async () => {
    const { result } = renderHook(() => useRollback('project-1'), { wrapper: createWrapper() });

    await act(async () => {
      await expect(result.current.mutateAsync('abc123')).rejects.toThrow('Missing permission project:versions:restore');
    });

    expect(gitApi.rollback).not.toHaveBeenCalled();
  });

  it('calls rollback when the project restore permission is present in the snapshot', async () => {
    authState.permissions = {
      platform: [],
      projects: [{ resourceId: 'project-1', permissions: [ProjectPermission.VERSIONS_RESTORE] }],
      engines: [],
    };
    (gitApi.rollback as any).mockResolvedValue({ success: true, message: 'Rolled back' });

    const { result } = renderHook(() => useRollback('project-1'), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync('abc123');
    });

    expect(gitApi.rollback).toHaveBeenCalledWith({ projectId: 'project-1', commitSha: 'abc123' });
  });
  it('uses an explicit project snapshot after hook options change and keeps its guard off the wire', async () => {
    vi.mocked(gitApi.deploy).mockResolvedValue({ deploymentId: 'd', commitSha: 'sha', filesChanged: 1 });
    const { result, rerender } = renderHook(({ id }) => useDeployment(id), { initialProps: { id: 'project-A' }, wrapper: createWrapper() });
    rerender({ id: 'project-B' });
    const guard = vi.fn();
    await act(async () => { await result.current.mutateAsync({ projectId: 'project-A', engineId: 'engine-A', message: 'reviewed', assertCurrent: guard }); });
    expect(guard).toHaveBeenCalledTimes(2);
    expect(gitApi.deploy).toHaveBeenCalledWith({ projectId: 'project-A', engineId: 'engine-A', message: 'reviewed' });
  });
  it('does not dispatch Git after the intent has expired', async () => {
    const { result } = renderHook(() => useDeployment('project-A'), { wrapper: createWrapper() });
    await act(async () => {
      await expect(result.current.mutateAsync({ message: 'reviewed', assertCurrent: () => { throw new Error('expired'); } })).rejects.toThrow('expired');
    });
    expect(gitApi.deploy).not.toHaveBeenCalled();
  });
});
