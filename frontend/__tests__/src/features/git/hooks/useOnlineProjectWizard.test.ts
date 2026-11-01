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
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { GIT_OAUTH_COMPLETED } from '@src/features/git/api/gitOAuthPopup';

const authState = vi.hoisted(() => ({
  userId: 'user-1', sessionRevision: 0, navigate: vi.fn(),
  refreshPermissions: vi.fn(),
  permissions: {
    platform: ['project:create'],
    projects: [],
    engines: [{ resourceId: 'engine-1', permissions: ['engine:deploy:view'] }],
  },
  hasEnginePermission: vi.fn((engineId: string | null | undefined, permission: string) =>
    engineId === 'engine-1' && permission === 'engine:deploy:view'
  ),
}));

vi.mock('react-router-dom', async original => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => authState.navigate }));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: authState.userId },
    sessionRevision: authState.sessionRevision,
    permissions: authState.permissions,
    refreshPermissions: authState.refreshPermissions,
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
    authState.userId = 'user-1'; authState.sessionRevision = 0;
    authState.refreshPermissions.mockImplementation(async () => ({ ...authState.permissions, userId: authState.userId, tenantId: null }));
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
      files: [{ name: 'Order.bpmn', type: 'bpmn', bpmnProcessId: 'order', dmnDecisionId: null }],
      warnings: [],
    });
  });

  const receipt = { id: 'created-project', name: 'Reviewed project', ownerId: 'user-1', createdAt: 1, updatedAt: 2 };
  const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done; }); return { promise, resolve }; };
  const creating = () => {
    const onClose = vi.fn();
    const rendered = renderHook(({ open }) => useOnlineProjectWizard({ open, onClose }), { initialProps: { open: true }, wrapper: createWrapper() });
    act(() => rendered.result.current.setProjectName('Reviewed project'));
    return { ...rendered, onClose };
  };

  it('acknowledges one local creation and navigates after its own permission refresh advances the browser revision', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(receipt);
    authState.refreshPermissions.mockImplementation(async () => { advanceBrowserSessionRevision(); return { ...authState.permissions, userId: 'user-1', tenantId: null, projects: [{ resourceId: receipt.id, permissions: ['project:view'] }] }; });
    const f = creating(); act(() => { f.result.current.handleSubmit(); f.result.current.handleSubmit(); });
    await waitFor(() => expect(f.onClose).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/starbase-api/projects', { name: 'Reviewed project', importFromEngine: undefined });
    expect(authState.navigate).toHaveBeenCalledWith('/starbase/project/created-project', { state: { name: 'Reviewed project' } });
  });

  it.each(['close', 'hidden', 'unmount', 'name', 'actor', 'session', 'browser'])('discards a pending creation after %s changes without replaying', async change => {
    const pending = deferred(); vi.mocked(apiClient.post).mockReturnValue(pending.promise);
    const f = creating(); act(() => f.result.current.handleSubmit());
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    act(() => {
      if (change === 'close') f.result.current.handleClose();
      if (change === 'hidden') f.rerender({ open: false });
      if (change === 'unmount') f.unmount();
      if (change === 'name') f.result.current.setProjectName('Replacement');
      if (change === 'actor') { authState.userId = 'other-user'; f.rerender({ open: true }); }
      if (change === 'session') { authState.sessionRevision++; f.rerender({ open: true }); }
      if (change === 'browser') advanceBrowserSessionRevision();
    });
    await act(async () => pending.resolve(receipt));
    expect(f.onClose).toHaveBeenCalledTimes(change === 'close' ? 1 : 0);
    expect(authState.navigate).not.toHaveBeenCalled(); expect(authState.refreshPermissions).not.toHaveBeenCalled(); expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it.each(['null', 'foreign', 'failure'])('requires a current %s permission refresh after ACK and refuses same-dialog replay', async mode => {
    vi.mocked(apiClient.post).mockResolvedValue(receipt);
    authState.refreshPermissions.mockImplementation(async () => { if (mode === 'failure') throw new Error('unavailable'); return mode === 'null' ? null : { userId: 'other-user', tenantId: null }; });
    const f = creating(); act(() => f.result.current.handleSubmit());
    await waitFor(() => expect(f.result.current.generalError).toMatch(/acknowledged.*refresh failed/));
    act(() => f.result.current.handleSubmit());
    expect(apiClient.post).toHaveBeenCalledTimes(1); expect(authState.navigate).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(f.result.current.isValid).toBe(false);
  });

  it('does not navigate when the actor changes during an acknowledged project permission refresh', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(receipt); const pending = deferred(); authState.refreshPermissions.mockReturnValue(pending.promise);
    const f = creating(); act(() => f.result.current.handleSubmit());
    await waitFor(() => expect(authState.refreshPermissions).toHaveBeenCalled());
    act(() => { authState.userId = 'other'; f.rerender({ open: true }); });
    await act(async () => pending.resolve({ userId: 'user-1', tenantId: null }));
    expect(f.onClose).not.toHaveBeenCalled(); expect(authState.navigate).not.toHaveBeenCalled();
  });

  it.each(['online', 'clone'])('creates a verified %s project using the single saved credential without copying its private token', async mode => {
    vi.mocked(apiClient.get).mockImplementation(async url => url === '/git-api/credentials' ? [credential] : []);
    vi.mocked(apiClient.post).mockResolvedValue(mode === 'online'
      ? { project: { id: receipt.id, name: receipt.name }, repository: { id: 'repo-1', name: 'reviewed-project', fullName: 'org/reviewed-project', url: 'https://github.com/org/reviewed-project', cloneUrl: 'https://github.com/org/reviewed-project.git', private: true } }
      : { projectId: receipt.id, projectName: receipt.name, repositoryId: 'repo-1', filesImported: 1, foldersCreated: 0 });
    const f = creating(); act(() => { f.result.current.setConnectToGit(true); f.result.current.setProviderId('github'); f.result.current.setRepoMode(mode === 'online' ? 'new' : 'existing'); });
    await waitFor(() => expect(f.result.current.selectedCredentialId).toBe(credential.id));
    act(() => { f.result.current.setNamespace('org'); f.result.current.setCustomRepoUrl('https://github.com/org/reviewed-project.git'); });
    act(() => f.result.current.handleSubmit());
    await waitFor(() => expect(f.onClose).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiClient.post).mock.calls[0][0]).toBe(mode === 'online' ? '/git-api/create-online' : '/git-api/clone');
    expect(vi.mocked(apiClient.post).mock.calls[0][1]).not.toHaveProperty('token');
  });

  it('does not select an ambiguous provider credential for project creation', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([credential, { ...credential, id: 'credential-other' }]);
    const f = creating(); act(() => { f.result.current.setConnectToGit(true); f.result.current.setProviderId('github'); f.result.current.setRepoMode('new'); });
    await waitFor(() => expect(f.result.current.generalError).toMatch(/multiple saved credentials/));
    act(() => f.result.current.handleSubmit()); expect(apiClient.post).not.toHaveBeenCalled(); expect(f.result.current.isValid).toBe(false);
  });

  it('retains provider credential ambiguity after a PAT save instead of hiding the other saved connection', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([credential, { ...credential, id: 'credential-other' }]);
    vi.mocked(apiClient.post).mockResolvedValue(credential);
    const f = creating(); act(() => { f.result.current.setConnectToGit(true); f.result.current.setProviderId('github'); f.result.current.setRepoMode('new'); });
    await waitFor(() => expect(f.result.current.existingCredentials).toHaveLength(2));
    act(() => { f.result.current.setConnectionMode('new'); f.result.current.setToken('synthetic-token'); });
    await act(async () => { await f.result.current.connectWithPAT(); });
    expect(f.result.current.existingCredentials).toHaveLength(2); expect(f.result.current.generalError).toMatch(/multiple saved credentials/);
    act(() => f.result.current.handleSubmit()); expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/git-api/credentials', { providerId: 'github', token: 'synthetic-token', name: undefined });
    expect(f.result.current.isValid).toBe(false);
  });

  it('creates a local project with only the reviewed engine import target after a canonical preview', async () => {
    vi.mocked(apiClient.post).mockImplementation(async url => url === '/starbase-api/projects' ? receipt : { engineId: 'engine-1', allowed: true, targetAction: 'create_import_target', counts: { bpmn: 0, dmn: 0 }, files: [], warnings: [] });
    const f = creating(); act(() => { f.result.current.setImportFromEngine(true); f.result.current.setSelectedImportEngineId('engine-1'); });
    await waitFor(() => expect(f.result.current.importPreviewQuery.isSuccess).toBe(true));
    act(() => f.result.current.handleSubmit());
    await waitFor(() => expect(f.onClose).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/starbase-api/projects', { name: 'Reviewed project', importFromEngine: { enabled: true, engineId: 'engine-1' } });
  });

  it('refuses legacy metadata-only existing-project operations without a network write', async () => {
    const f = renderHook(() => useOnlineProjectWizard({ open: true, onClose: vi.fn(), existingProjectId: 'project-existing' }), { wrapper: createWrapper() });
    await act(async () => { f.result.current.initExistingMutation.mutate(); f.result.current.cloneExistingMutation.mutate('https://github.com/org/repo.git'); });
    expect(f.result.current.generalError).toMatch(/project Git connection settings/);
    expect(apiClient.post).not.toHaveBeenCalled(); expect(gitApi.initRepository).not.toHaveBeenCalled(); expect(gitApi.cloneRepository).not.toHaveBeenCalled();
  });

  it('rejects local create when project creation permission is unavailable', () => {
    setAuthPermissions({ platform: [], projects: [], engines: [] }); const f = creating();
    act(() => f.result.current.handleSubmit()); expect(apiClient.post).not.toHaveBeenCalled(); expect(f.result.current.generalError).toBe('Missing permission project:create');
  });

  it('exports useOnlineProjectWizard hook', () => {
    expect(useOnlineProjectWizard).toBeDefined();
    expect(typeof useOnlineProjectWizard).toBe('function');
  });

  it('does not acknowledge an empty project-creation response', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const onClose = vi.fn();
    const { result } = renderHook(() => useOnlineProjectWizard({ open: true, onClose }), { wrapper: createWrapper() });
    act(() => { result.current.setProjectName('Reviewed project'); });
    act(() => { result.current.createLocalMutation.mutate(); });
    await waitFor(() => expect(result.current.generalError).toMatch(/not verified/));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not use a different engine preview to authorize the selected import', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ engineId: 'foreign-engine', allowed: true, targetAction: 'create_import_target', counts: { bpmn: 0, dmn: 0 }, files: [], warnings: [] });
    const { result } = renderWizard();
    act(() => { result.current.setProjectName('Reviewed project'); result.current.setImportFromEngine(true); result.current.setSelectedImportEngineId('engine-1'); });
    await waitFor(() => expect(result.current.importPreviewQuery.isFetching).toBe(false));
    expect(result.current.isValid).toBe(false);
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
