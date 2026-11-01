import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { canImportFromEngineRow, formatImportPreviewSummary, useOnlineProjectWizard } from '@src/features/git/hooks/useOnlineProjectWizard';
import { EnginePermission } from '@src/shared/auth/permissions';
import { apiClient } from '@src/shared/api/client';
import { gitApi } from '@src/features/git/api/gitApi';
import { gitCredentialFixture as credential, gitOAuthStateFixture as oauthState, gitProviderFixture } from '@test/fixtures/gitCredentials';
import { GIT_OAUTH_COMPLETED } from '@src/features/git/api/gitOAuthPopup';

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
    user: { id: 'user-1' },
    permissions: authState.permissions,
    hasEnginePermission: authState.hasEnginePermission,
  }),
}));

vi.mock('@src/shared/api/client', async original => ({
  ...await original<typeof import('@src/shared/api/client')>(),
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
    (gitApi.getProviders as unknown as Mock).mockResolvedValue([gitProviderFixture]);
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

  it('requires scoped deploy-view permission for engine import', () => {
    const noScopedPermission = () => false;
    const deployViewPermission = (_engineId: string | null | undefined, permission: string) =>
      permission === EnginePermission.DEPLOY_VIEW;

    expect(canImportFromEngineRow({ id: 'engine-1', name: 'Engine One' }, noScopedPermission)).toBe(false);
    expect(canImportFromEngineRow({ id: 'engine-1', name: 'Engine One' }, deployViewPermission)).toBe(true);
    expect(canImportFromEngineRow({ id: 'engine-1', name: 'Engine One' }, noScopedPermission)).toBe(false);
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

  it('allows import preview from the engine action snapshot', async () => {
    setAuthPermissions({ platform: ['project:create'], projects: [], engines: [{ resourceId: 'engine-1', permissions: [EnginePermission.DEPLOY_VIEW] }] });
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
  it('binds a verified PAT credential to the selected provider and populates its selected credential id', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(credential);
    const { result } = renderWizard();
    act(() => { result.current.setProviderId('github'); });
    await waitFor(() => expect(result.current.connectionStatus).toBe('disconnected'));
    act(() => { result.current.setToken('synthetic-token'); result.current.setConnectionName('Work'); });
    await act(async () => { await result.current.connectWithPAT(); });
    expect(result.current.connectionStatus).toBe('connected'); expect(result.current.selectedCredentialId).toBe(credential.id);
    expect(result.current.token).toBe('');
    expect(apiClient.post).toHaveBeenCalledWith('/git-api/credentials',{providerId:'github',token:'synthetic-token',name:'Work'});
  });
  it('does not use an empty or foreign credential receipt as a connected wizard state', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({...credential,userId:'foreign'});
    const { result } = renderWizard(); act(() => { result.current.setProviderId('github'); });
    await waitFor(() => expect(result.current.connectionStatus).toBe('disconnected'));
    act(() => { result.current.setToken('synthetic-token'); });
    await act(async () => { await result.current.connectWithPAT(); });
    expect(result.current.connectionStatus).toBe('error'); expect(result.current.selectedCredentialId).toBe('');
  });
  it('does not apply a late credential response to a changed provider', async () => {
    let finish!: (raw: unknown) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderWizard(); act(() => { result.current.setProviderId('github'); });
    await waitFor(() => expect(result.current.connectionStatus).toBe('disconnected'));
    act(() => { result.current.setToken('synthetic-token'); });
    let operation!: Promise<void>; act(() => { operation = result.current.connectWithPAT(); });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    act(() => { result.current.setProviderId('gitlab'); });
    await act(async () => { finish(credential); await operation; });
    expect(result.current.selectedCredentialId).toBe(''); expect(result.current.connectionStatus).not.toBe('connected');
  });
  it('does not let an older credential-list read replace a newly verified PAT selection', async () => {
    let finishList!: (raw: unknown) => void;
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => url === '/git-api/credentials' ? new Promise(resolve => { finishList = resolve; }) : []);
    vi.mocked(apiClient.post).mockResolvedValue(credential);
    const { result } = renderWizard(); act(() => { result.current.setProviderId('github'); });
    await waitFor(() => expect(finishList).toBeDefined());
    act(() => { result.current.setToken('synthetic-token'); });
    await act(async () => { await result.current.connectWithPAT(); });
    await act(async () => { finishList([]); });
    expect(result.current.connectionStatus).toBe('connected'); expect(result.current.selectedCredentialId).toBe(credential.id); expect(result.current.connectionMode).toBe('select');
  });
  it('connects the wizard to the OAuth credential id after owned-popup and authenticated readback verification', async () => {
    const popup = { closed: false, location: { replace: vi.fn() }, close: vi.fn() } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const oauthCredential = { ...credential, authType: 'oauth' };
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/git-api/oauth/github/authorize') return { authUrl: `https://github.com/login/oauth/authorize?state=${oauthState}`, state: oauthState };
      if (url === '/git-api/credentials/github') return oauthCredential;
      return [];
    });
    const { result } = renderWizard(); act(() => { result.current.setProviderId('github'); });
    await waitFor(() => expect(result.current.connectionStatus).toBe('disconnected'));
    act(() => { result.current.setAuthMethod('oauth'); });
    let operation!: Promise<void>; act(() => { operation = result.current.connectWithOAuth(); });
    await waitFor(() => expect(popup.location.replace).toHaveBeenCalled());
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: popup,
        data: { type: GIT_OAUTH_COMPLETED, state: oauthState, credential: oauthCredential } }));
      await operation;
    });
    expect(result.current.selectedCredentialId).toBe(credential.id); expect(result.current.connectionStatus).toBe('connected');
    expect(popup.close).toHaveBeenCalledTimes(1); open.mockRestore();
  });

});
