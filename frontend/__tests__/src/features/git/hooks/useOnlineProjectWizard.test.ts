import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { canImportFromEngineRow, formatImportPreviewSummary, useOnlineProjectWizard } from '@src/features/git/hooks/useOnlineProjectWizard';
import { EnginePermission } from '@src/shared/auth/permissions';
import { apiClient } from '@src/shared/api/client';
import { gitApi } from '@src/features/git/api/gitApi';

const authState = vi.hoisted(() => ({
  permissions: {
    platform: ['project:create'],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:deploy:view'] }],
  },
  hasEnginePermission: vi.fn((engineId: string | null | undefined, permission: string) =>
    engineId === 'engine-1' && permission === 'engine:deploy:view'
  ),
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    permissions: authState.permissions,
    hasEnginePermission: authState.hasEnginePermission,
  }),
}));

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@src/features/git/api/gitApi', () => ({
  gitApi: {
    getProviders: vi.fn(),
    getRepositoryByProject: vi.fn(),
    listProviderRepos: vi.fn(),
    initRepository: vi.fn(),
    cloneRepository: vi.fn(),
    cloneFromGit: vi.fn(),
  },
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient },
      React.createElement(MemoryRouter, { initialEntries: ['/'] }, children)
    )
  );
  return Wrapper;
};

const renderWizard = () => renderHook(() => useOnlineProjectWizard({
  open: true,
  onClose: vi.fn(),
}), { wrapper: createWrapper() });

const setAuthPermissions = (permissions: typeof authState.permissions) => {
  authState.permissions = permissions;
};

describe('useOnlineProjectWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuthPermissions({
      platform: ['project:create'],
      projects: [],
      engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.DEPLOY_VIEW] }],
    });
    authState.hasEnginePermission.mockImplementation((engineId: string | null | undefined, permission: string) =>
      engineId === 'engine-1' && permission === EnginePermission.DEPLOY_VIEW
    );
    (gitApi.getProviders as unknown as Mock).mockResolvedValue([{ id: 'github', name: 'GitHub' }]);
    (gitApi.listProviderRepos as unknown as Mock).mockResolvedValue([{ name: 'repo', fullName: 'org/repo', url: 'https://github.com/org/repo.git' }]);
    (apiClient.get as unknown as Mock).mockImplementation((url: string) => {
      if (url === '/engines-api/engines') {
        return Promise.resolve([{ id: 'engine-1', name: 'Dev Engine', myRole: null }]);
      }
      return Promise.resolve([]);
    });
    (apiClient.post as unknown as Mock).mockResolvedValue({
      engineId: 'engine-1',
      allowed: true,
      targetAction: 'create_import_target',
      counts: { bpmn: 1, dmn: 0 },
      files: [],
      warnings: [],
    });
  });

  it('exports useOnlineProjectWizard hook', () => {
    expect(useOnlineProjectWizard).toBeDefined();
    expect(typeof useOnlineProjectWizard).toBe('function');
  });

  it('allows engine import from legacy engine roles or scoped deploy-view permission', () => {
    const noScopedPermission = () => false;
    const deployViewPermission = (_engineId: string | null | undefined, permission: string) =>
      permission === EnginePermission.DEPLOY_VIEW;

    expect(canImportFromEngineRow({ id: 'engine-1', myRole: 'deployer' }, noScopedPermission)).toBe(true);
    expect(canImportFromEngineRow({ id: 'engine-1', myRole: null }, deployViewPermission)).toBe(true);
    expect(canImportFromEngineRow({ id: 'engine-1', myRole: null }, noScopedPermission)).toBe(false);
  });

  it('formats import preview summaries for selected source engines', () => {
    expect(formatImportPreviewSummary({
      engineId: 'engine-1',
      allowed: true,
      targetAction: 'create_import_target',
      counts: { bpmn: 2, dmn: 1 },
      files: [],
      warnings: [],
    })).toBe('2 BPMN and 1 DMN definitions found. The project-engine import target will be created.');

    expect(formatImportPreviewSummary({
      engineId: 'engine-1',
      allowed: true,
      targetAction: 'create_import_target',
      counts: { bpmn: 0, dmn: 0 },
      files: [],
      warnings: ['No latest BPMN or DMN definitions were found on this engine.'],
    })).toBe('No latest BPMN or DMN definitions found. The project-engine import target will be created.');
  });

  it('does not fetch import preview when the selected engine import action is denied', async () => {
    setAuthPermissions({ platform: ['project:create'], projects: [], engines: [] });
    authState.hasEnginePermission.mockReturnValue(false);

    const { result } = renderWizard();

    act(() => {
      result.current.setImportFromEngine(true);
      result.current.setSelectedImportEngineId('engine-1');
    });

    await waitFor(() => {
      expect(result.current.importPreviewDeniedReason).toBe('Missing permission engine:deploy:view');
    });

    expect(apiClient.post).not.toHaveBeenCalledWith('/starbase-api/projects/import-preview', expect.anything());
  });

  it('keeps legacy engine role compatibility for import preview', async () => {
    setAuthPermissions({ platform: ['project:create'], projects: [], engines: [] });
    authState.hasEnginePermission.mockReturnValue(false);
    (apiClient.get as unknown as Mock).mockImplementation((url: string) => {
      if (url === '/engines-api/engines') {
        return Promise.resolve([{ id: 'engine-1', name: 'Dev Engine', myRole: 'deployer' }]);
      }
      return Promise.resolve([]);
    });

    const { result } = renderWizard();

    act(() => {
      result.current.setImportFromEngine(true);
      result.current.setSelectedImportEngineId('engine-1');
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/starbase-api/projects/import-preview', { engineId: 'engine-1' });
    });
  });

  it('does not create a Git-backed project when Git create action is denied', async () => {
    setAuthPermissions({ platform: [], projects: [], engines: [] });

    const { result } = renderWizard();
    (apiClient.post as unknown as Mock).mockClear();

    act(() => {
      result.current.createMutation.mutate();
    });

    await waitFor(() => {
      expect(result.current.generalError).toBe('Missing permission project:create');
    });

    expect(apiClient.post).not.toHaveBeenCalledWith('/git-api/create-online', expect.anything());
  });

  it('does not list existing Git repositories when Git inspect action is denied', async () => {
    setAuthPermissions({ platform: [], projects: [], engines: [] });

    const { result } = renderWizard();

    act(() => {
      result.current.setConnectToGit(true);
      result.current.setProviderId('github');
      result.current.setRepoMode('existing');
    });

    await waitFor(() => {
      expect(result.current.gitInspectDeniedReason).toBe('Missing permission project:create');
    });

    expect(result.current.repoFetchError).toBe('Missing permission project:create');
    expect(gitApi.listProviderRepos).not.toHaveBeenCalled();
  });

  it('blocks existing Git clone submission when Git inspect action is denied', async () => {
    setAuthPermissions({ platform: [], projects: [], engines: [] });

    const { result } = renderWizard();

    act(() => {
      result.current.setProjectName('Imported project');
      result.current.setConnectToGit(true);
      result.current.setProviderId('github');
      result.current.setRepoMode('existing');
      result.current.setCustomRepoUrl('https://github.com/org/repo.git');
    });

    act(() => {
      result.current.handleSubmit();
    });

    await waitFor(() => {
      expect(result.current.generalError).toBe('Missing permission project:create');
    });

    expect(gitApi.cloneFromGit).not.toHaveBeenCalled();
  });
});
