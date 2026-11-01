import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitVersionsPanel, { canViewDeploymentHistoryForEngine } from '@src/features/git/components/GitVersionsPanel';
import { apiClient, ApiError } from '@src/shared/api/client';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';
import { EnginePermission } from '@src/shared/auth/permissions';

const authMocks = vi.hoisted(() => ({
  hasEnginePermission: vi.fn(),
  hasProjectPermission: vi.fn(),
  permissions: {
    userId: 'user-1',
    platform: [],
    projects: [
      {
        projectId: 'project-1',
        permissions: [
          'project:files:view',
          'project:versions:create',
          'project:versions:restore',
        ],
      },
    ],
    engines: [],
    generatedAt: 1,
  } as any,
}));

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    hasEnginePermission: authMocks.hasEnginePermission,
    hasProjectPermission: authMocks.hasProjectPermission,
    permissions: authMocks.permissions,
  }),
}));

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: vi.fn(),
    toTenantPath: (path: string) => path,
    tenantSlug: 'default',
    effectivePathname: '/',
    navigate: vi.fn(),
  }),
}));

vi.mock('@src/features/shared/components/LoadingState', () => ({
  LoadingState: ({ message = 'Loading...' }: { message?: string }) => <div>{message}</div>,
}));

vi.mock('@src/features/shared/components/Viewer', () => ({
  default: ({ xml }: { xml: string }) => <div>Viewer<pre>{xml}</pre></div>,
}));

vi.mock('@src/features/starbase/components/DMNDrdMini', () => ({
  default: () => <div>DMNDrdMini</div>,
}));

vi.mock('@carbon/react', () => ({
  Modal: ({ open, children, primaryButtonText, primaryButtonDisabled, onRequestSubmit, onRequestClose }: any) => (open ? (
    <div>
      {children}
      <button type="button" onClick={onRequestClose}>Close version</button>
      {primaryButtonText ? (
        <button type="button" disabled={Boolean(primaryButtonDisabled)} onClick={onRequestSubmit}>
          {primaryButtonText}
        </button>
      ) : null}
    </div>
  ) : null),
  Button: ({ children, onClick, ...props }: any) => <button onClick={onClick} {...props}>{children}</button>,
  InlineNotification: ({ title, subtitle }: any) => <div>{title}{subtitle ? ` ${subtitle}` : ''}</div>,
  ProgressIndicator: ({ children }: any) => <div>{children}</div>,
  ProgressStep: ({ label, secondaryLabel }: any) => (
    <div data-testid="progress-step">
      <div>{label}</div>
      {secondaryLabel ? <div>{secondaryLabel}</div> : null}
    </div>
  ),
  Toggle: ({ id, toggled, onToggle }: any) => (
    <label htmlFor={id}>
      Show system versions
      <input
        id={id}
        type="checkbox"
        aria-label="Show system versions"
        checked={Boolean(toggled)}
        onChange={() => onToggle?.(!toggled)}
      />
    </label>
  ),
  Dropdown: () => <div />,
}));

vi.mock('@src/shared/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@src/shared/api/client')>(),
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('GitVersionsPanel', () => {
  function setAuthPermissions(overrides: Partial<typeof authMocks.permissions> = {}) {
    authMocks.permissions = {
      userId: 'user-1',
      platform: [],
      projects: [
        {
          projectId: 'project-1',
          permissions: [
            'project:files:view',
            'project:versions:create',
            'project:versions:restore',
          ],
        },
      ],
      engines: [],
      generatedAt: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setAuthPermissions();
    authMocks.hasEnginePermission.mockReturnValue(false);
    authMocks.hasProjectPermission.mockReturnValue(true);
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/engines-api/engines') return [];
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/starbase-api/projects/project-1/files/file-1/deployments/history') return [];
      if (url === '/starbase-api/files/file-1/versions') {
        return [
          {
            id: 'initial-import',
            author: 'system',
            message: 'Initial import',
            createdAt: 1700000000,
          },
        ];
      }
      if (url === '/vcs-api/projects/project-1/commits') {
        return {
          commits: [
            {
              id: 'manual-current',
              branchId: 'draft-1',
              message: 'Save Invoice',
              userId: 'user-1',
              createdAt: 1700000000100,
              hash: 'hash-current',
              versionNumber: 99,
              fileVersionNumber: 7,
              source: 'file-save',
              isRemote: false,
            },
            {
              id: 'manual-legacy',
              branchId: 'main-1',
              message: 'Legacy version',
              userId: 'user-1',
              createdAt: 1700000000000,
              hash: 'hash-legacy',
              versionNumber: 12,
              source: 'manual',
              isRemote: true,
            },
            {
              id: 'system-1',
              branchId: 'main-1',
              message: 'Nightly baseline',
              userId: 'user-1',
              createdAt: 1700000000150,
              hash: 'hash-system',
              source: 'system',
              isRemote: true,
            },
            {
              id: 'auto-sync',
              branchId: 'main-1',
              message: 'Sync from Starbase draft',
              userId: 'user-1',
              createdAt: 1700000000200,
              hash: 'hash-auto',
              source: 'system',
              isRemote: true,
            },
          ],
        };
      }
      return [];
    });
    (apiClient.post as any).mockResolvedValue({});
    (apiClient.delete as any).mockResolvedValue(undefined);
  });

  function renderPanel() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <GitVersionsPanel
          projectId="project-1"
          fileId="file-1"
          fileName="Invoice"
          fileType="bpmn"
        />
      </QueryClientProvider>
    );
  }

  function renderLocalPanel() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <GitVersionsPanel
          projectId="project-1"
          fileId="file-1"
          fileName="Invoice"
          fileType="bpmn"
          saveMode="local"
        />
      </QueryClientProvider>
    );
  }

  it('hides system versions by default while preserving file-version and project-version labels', async () => {
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/v7.*Save Invoice/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/v12.*Legacy version/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nightly baseline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sync from Starbase draft/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Show system versions \(1\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /show system versions/i }));

    await waitFor(() => {
      expect(screen.getByText(/Nightly baseline/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.queryByText(/Sync from Starbase draft/i)).not.toBeInTheDocument();
  });

  it('reuses the versions empty state in local mode while filtering the seeded initial import row', async () => {
    renderLocalPanel();

    await waitFor(() => {
      expect(screen.getByText(/No versions yet\. Save a version to start tracking changes\./i)).toBeInTheDocument();
    });

    expect(apiClient.get).toHaveBeenCalledWith('/starbase-api/files/file-1/versions');
    expect(screen.queryByText(/Initial import/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Show system versions/i)).not.toBeInTheDocument();
  });

  it('uses scoped engine deploy-view permission to enable deployment history', async () => {
    authMocks.hasEnginePermission.mockImplementation((engineId: string | null | undefined, permission: string) =>
      engineId === 'engine-1' && permission === EnginePermission.DEPLOY_VIEW
    );
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/engines-api/engines') return [{ id: 'engine-1', name: 'Dev Engine', myRole: null }];
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/starbase-api/projects/project-1/files/file-1/deployments/history') return [];
      if (url === '/vcs-api/projects/project-1/commits') {
        return {
          commits: [
            {
              id: 'manual-current',
              branchId: 'draft-1',
              message: 'Save Invoice',
              userId: 'user-1',
              createdAt: 1700000000100,
              hash: 'hash-current',
              versionNumber: 99,
              fileVersionNumber: 7,
              source: 'file-save',
              isRemote: false,
            },
          ],
        };
      }
      return [];
    });

    renderPanel();

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/starbase-api/projects/project-1/files/file-1/deployments/history');
    });
  });

  it('disables deployment delete when the engine deploy permission is missing', async () => {
    authMocks.hasEnginePermission.mockImplementation((engineId: string | null | undefined, permission: string) =>
      engineId === 'engine-1' && permission === EnginePermission.DEPLOY_VIEW
    );
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/engines-api/engines') return [{ id: 'engine-1', name: 'Dev Engine', myRole: null }];
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/starbase-api/projects/project-1/files/file-1/deployments/history') {
        return [
          {
            engineId: 'engine-1',
            engineDeploymentId: 'deployment-1',
            fileId: 'file-1',
            fileGitCommitId: 'manual-current',
            environmentTag: 'Dev',
            deployedAt: 1700000000500,
            artifacts: [{ kind: 'process', key: 'invoice', version: 3 }],
          },
        ];
      }
      if (url === '/vcs-api/projects/project-1/commits') {
        return {
          commits: [
            {
              id: 'manual-current',
              branchId: 'draft-1',
              message: 'Save Invoice',
              userId: 'user-1',
              createdAt: 1700000000100,
              hash: 'hash-current',
              versionNumber: 99,
              fileVersionNumber: 7,
              source: 'file-save',
              isRemote: false,
            },
          ],
        };
      }
      return [];
    });

    renderPanel();

    const deleteButton = await screen.findByRole('button', { name: /Delete deployment Dev v3/i });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute('title', 'Missing permission engine:deploy');
  });

  it('deletes deployment records through the engine-scoped delete action', async () => {
    const user = userEvent.setup();
    setAuthPermissions({
      engines: [
        {
          resourceId: 'engine-1',
          permissions: [EnginePermission.DEPLOY],
        },
      ],
    });
    authMocks.hasEnginePermission.mockImplementation((engineId: string | null | undefined, permission: string) =>
      engineId === 'engine-1' && permission === EnginePermission.DEPLOY_VIEW
    );
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/engines-api/engines') return [{ id: 'engine-1', name: 'Dev Engine', myRole: null }];
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/starbase-api/projects/project-1/files/file-1/deployments/history') {
        return [
          {
            engineId: 'engine-1',
            engineDeploymentId: 'deployment-1',
            fileId: 'file-1',
            fileGitCommitId: 'manual-current',
            environmentTag: 'Dev',
            deployedAt: 1700000000500,
            artifacts: [{ kind: 'process', key: 'invoice', version: 3 }],
          },
        ];
      }
      if (url === '/vcs-api/projects/project-1/commits') {
        return {
          commits: [
            {
              id: 'manual-current',
              branchId: 'draft-1',
              message: 'Save Invoice',
              userId: 'user-1',
              createdAt: 1700000000100,
              hash: 'hash-current',
              versionNumber: 99,
              fileVersionNumber: 7,
              source: 'file-save',
              isRemote: false,
            },
          ],
        };
      }
      return [];
    });

    renderPanel();

    await user.click(await screen.findByRole('button', { name: /Delete deployment Dev v3/i }));
    await user.click(screen.getByRole('button', { name: 'Delete deployment' }));

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith(
        '/starbase-api/deployments/deployment-1?engineId=engine-1&cascade=false',
        { credentials: 'include' }
      );
    });
  });

  it('surfaces Mission Control bridge denials for deployment badges', async () => {
    const user = userEvent.setup();
    authMocks.hasEnginePermission.mockImplementation((engineId: string | null | undefined, permission: string) =>
      engineId === 'engine-1' && permission === EnginePermission.DEPLOY_VIEW
    );
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/engines-api/engines') return [{ id: 'engine-1', name: 'Dev Engine', myRole: null }];
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/starbase-api/projects/project-1/files/file-1/deployments/history') {
        return [
          {
            engineId: 'engine-1',
            engineDeploymentId: 'deployment-1',
            fileId: 'file-1',
            fileGitCommitId: 'manual-current',
            environmentTag: 'Dev',
            deployedAt: 1700000000500,
            artifacts: [{ kind: 'process', key: 'invoice', version: 3 }],
          },
        ];
      }
      if (url === '/vcs-api/projects/project-1/commits') {
        return {
          commits: [
            {
              id: 'manual-current',
              branchId: 'draft-1',
              message: 'Save Invoice',
              userId: 'user-1',
              createdAt: 1700000000100,
              hash: 'hash-current',
              versionNumber: 99,
              fileVersionNumber: 7,
              source: 'file-save',
              isRemote: false,
            },
          ],
        };
      }
      return [];
    });
    (apiClient.post as any).mockImplementation(async (url: string) => {
      if (url === '/api/starbase/bridge/mission-control/evaluate') {
        return {
          allowed: false,
          reasonCode: 'missing_engine_runtime_read_permission',
          reason: 'Missing engine runtime read permission.',
          missingActions: ['engine.runtime.process-definitions.read'],
          projectId: 'project-1',
          fileId: 'file-1',
          engineId: 'engine-1',
          targetId: 'target-1',
          lineage: {},
        };
      }
      return {};
    });

    renderPanel();

    await user.click(await screen.findByRole('button', { name: /^Dev v3$/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/api/starbase/bridge/mission-control/evaluate', expect.objectContaining({
        projectId: 'project-1',
        fileId: 'file-1',
        engineId: 'engine-1',
        definitionKey: 'invoice',
        kind: 'process',
      }));
    });
    expect(screen.getByText(/Mission Control unavailable Missing engine runtime read permission\./i)).toBeInTheDocument();
  });

  it('does not display a cached Git snapshot as a local file version with the same ID', async () => {
    const originalGet = vi.mocked(apiClient.get).getMockImplementation()!;
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.get).mockImplementation(url => {
      if (url === '/starbase-api/files/file-1/versions') return Promise.resolve([
        { id: 'newer', message: 'Current local', createdAt: 2000 },
        { id: 'same-id', message: 'Older local', createdAt: 1000 },
      ]);
      if (url === '/starbase-api/files/file-1/versions/same-id') return new Promise(resolve => { finish = resolve; });
      return originalGet(url);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['vcs', 'commit-files', 'project-1', 'same-id'], { files: [{
      id: 'git-snapshot', mainFileId: 'file-1', folderId: null, name: 'Invoice', type: 'bpmn',
      content: 'WRONG_GIT_CONTENT', changeType: 'modified',
    }] });
    render(<QueryClientProvider client={client}><GitVersionsPanel projectId="project-1" fileId="file-1" fileName="Invoice" fileType="bpmn" saveMode="local" /></QueryClientProvider>);
    await userEvent.click(await screen.findByText(/Older local/));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(screen.queryByText('WRONG_GIT_CONTENT')).not.toBeInTheDocument();
    expect(screen.getByText('Loading version...')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
    await act(async () => { finish({ id: 'same-id', fileId: 'file-1', xml: 'CORRECT_LOCAL_CONTENT' }); });
    expect(await screen.findByText('CORRECT_LOCAL_CONTENT')).toBeVisible();
  });

  function restoreFixture(beforeVersionSave: () => Promise<void>, onVersionSaveSuccess = vi.fn(), saveMode: 'git' | 'local' = 'git') {
    const originalGet = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(url => saveMode === 'local' && url === '/starbase-api/files/file-1/versions'
      ? Promise.resolve([{ id: 'current', message: 'Current', createdAt: 2000 }, { id: 'manual-legacy', message: 'Legacy version', createdAt: 1000 }])
      : saveMode === 'local' && url === '/starbase-api/files/file-1/versions/manual-legacy'
        ? Promise.resolve({ id: 'manual-legacy', fileId: 'file-1', xml: '<saved/>' })
      : url === '/vcs-api/projects/project-1/commits/manual-legacy/files'
      ? Promise.resolve({ files: [{ id: 'snapshot', mainFileId: 'file-1', folderId: null, name: 'Invoice', type: 'bpmn', content: '<saved/>', changeType: 'modified' }] })
      : originalGet(url));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const panel = (projectId = 'project-1', fileId = 'file-1') => <QueryClientProvider client={client}><GitVersionsPanel projectId={projectId} fileId={fileId} fileName="Invoice" fileType="bpmn" saveMode={saveMode} hasUnsavedVersion beforeVersionSave={beforeVersionSave} onVersionSaveSuccess={onVersionSaveSuccess} /></QueryClientProvider>;
    const view = render(panel());
    return { ...view, client, panel, onVersionSaveSuccess };
  }

  async function startRestore() {
    await userEvent.click(await screen.findByText(/Legacy version/));
    const button = await screen.findByRole('button', { name: 'Restore this version' });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
  }

  it('sends the selected file ID only after the preceding save receipt is verified', async () => {
    let finish!: () => void;
    const beforeSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    vi.mocked(apiClient.post).mockImplementation(url => url.endsWith('/commit') ? Promise.resolve({ commitId: 'checkpoint' }) : new Promise(() => {}));
    restoreFixture(beforeSave);
    await startRestore();
    expect(apiClient.post).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/vcs-api/projects/project-1/commits/manual-legacy/files/file-1/restore'));
    expect(vi.mocked(apiClient.post).mock.calls[0]).toEqual(['/vcs-api/projects/project-1/commit', { message: 'Auto-saved before restore', fileIds: ['file-1'] }]);
  });

  it('keeps local autosave and restore bound to the same file and verified local version receipt', async () => {
    vi.mocked(apiClient.post).mockImplementation(url => url.endsWith('/versions') ? Promise.resolve({ id: 'verified-local-checkpoint' }) : new Promise(() => {}));
    restoreFixture(vi.fn().mockResolvedValue(undefined), vi.fn(), 'local');
    await startRestore();
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/starbase-api/files/file-1/versions/manual-legacy/restore'));
    expect(vi.mocked(apiClient.post).mock.calls[0]).toEqual(['/starbase-api/files/file-1/versions', { message: 'Auto-saved before restore' }]);
  });

  it.each(['project', 'file', 'session', 'permission', 'close', 'unmount'])('stops restore after pending autosave when the %s context changes', async change => {
    let finish!: () => void;
    const beforeSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const fixture = restoreFixture(beforeSave);
    await startRestore();
    await waitFor(() => expect(beforeSave).toHaveBeenCalledTimes(1));
    if (change === 'project') { fixture.rerender(fixture.panel('project-2')); fixture.rerender(fixture.panel()); }
    if (change === 'file') fixture.rerender(fixture.panel('project-1', 'file-2'));
    if (change === 'session') advanceBrowserSessionRevision();
    if (change === 'permission') { setAuthPermissions({ projects: [] }); fixture.rerender(fixture.panel()); }
    if (change === 'close') await userEvent.click(screen.getByRole('button', { name: 'Close version' }));
    if (change === 'unmount') fixture.unmount();
    await act(async () => { finish(); });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(fixture.onVersionSaveSuccess).not.toHaveBeenCalled();
  });

  it('stops between checkpoint and restore when the session changes during checkpoint persistence', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const fixture = restoreFixture(vi.fn().mockResolvedValue(undefined));
    await startRestore();
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    advanceBrowserSessionRevision();
    await act(async () => { finish({ commitId: 'retained-checkpoint' }); });
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(fixture.onVersionSaveSuccess).not.toHaveBeenCalled();
  });

  it.each(['git', 'local'] as const)('does not restore after an unverified %s autosave acknowledgement', async saveMode => {
    restoreFixture(vi.fn().mockResolvedValue(undefined), vi.fn(), saveMode);
    await startRestore();
    expect(await screen.findByText(/Saved version was not verified; restore stopped/)).toBeVisible();
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to whole-project restore when an older host rejects file restore', async () => {
    vi.mocked(apiClient.post).mockImplementation(url => url.endsWith('/commit')
      ? Promise.resolve({ commitId: 'retained-checkpoint' })
      : Promise.reject(new ApiError(404, 'Not Found', 'File restore is unavailable on this host')));
    restoreFixture(vi.fn().mockResolvedValue(undefined));
    await startRestore();
    expect(await screen.findByText(/File restore is unavailable on this host/)).toBeVisible();
    expect(vi.mocked(apiClient.post).mock.calls).toEqual([
      ['/vcs-api/projects/project-1/commit', { message: 'Auto-saved before restore', fileIds: ['file-1'] }],
      ['/vcs-api/projects/project-1/commits/manual-legacy/files/file-1/restore'],
    ]);
  });

  it.each(['git', 'local'] as const)('retains private drafts and blocks replay after an unverified %s restore response', async mode => {
    vi.mocked(apiClient.post).mockImplementation(url => url.endsWith('/commit') ? Promise.resolve({ commitId: 'checkpoint' })
      : url.endsWith('/versions') ? Promise.resolve({ id: 'local-checkpoint' }) : Promise.resolve({}));
    restoreFixture(vi.fn().mockResolvedValue(undefined), vi.fn(), mode);
    localStorage.setItem('xml-history-file-1', 'retained-private-draft');
    sessionStorage.setItem('starbase:lastEditedAt:file-1', 'retained-private-time');
    await startRestore();
    expect(await screen.findByText(/Restore response was not verified/)).toBeVisible();
    expect(localStorage.getItem('xml-history-file-1')).toBe('retained-private-draft');
    expect(sessionStorage.getItem('starbase:lastEditedAt:file-1')).toBe('retained-private-time');
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
    expect(apiClient.post).toHaveBeenCalledTimes(2);
  });

  it('retains drafts if verified restore acknowledgement is followed by a failed refresh', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(url => url.endsWith('/commit') ? Promise.resolve({ commitId: 'checkpoint' }) : new Promise(resolve => { finish = resolve; }));
    const fixture = restoreFixture(vi.fn().mockResolvedValue(undefined));
    localStorage.setItem('xml-history-file-1', 'retained-private-draft');
    await startRestore(); await waitFor(() => expect(finish).toBeTypeOf('function'));
    const refresh = vi.spyOn(fixture.client, 'invalidateQueries').mockRejectedValueOnce(new Error('Refresh unavailable'));
    await act(async () => finish({ success: true, filesRestored: 1, newCommitId: 'restored' }));
    expect(await screen.findByText(/Refresh unavailable/)).toBeVisible();
    expect(localStorage.getItem('xml-history-file-1')).toBe('retained-private-draft');
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
    expect(refresh).toHaveBeenCalledWith(expect.any(Object), { throwOnError: true });
  });

  it('does not apply completion callbacks or clear drafts after the submitted view is replaced', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(url => url.endsWith('/commit') ? Promise.resolve({ commitId: 'checkpoint' }) : new Promise(resolve => { finish = resolve; }));
    const fixture = restoreFixture(vi.fn().mockResolvedValue(undefined));
    sessionStorage.setItem('starbase:lastEditedAt:file-1', 'retained');
    await startRestore();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const invalidations = vi.spyOn(fixture.client, 'invalidateQueries'); invalidations.mockClear();
    fixture.rerender(fixture.panel('project-2'));
    await act(async () => { finish({ success: true, filesRestored: 1, newCommitId: 'restored' }); });
    expect(invalidations).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('starbase:lastEditedAt:file-1')).toBe('retained');
  });

  it('requires a scoped deployment history permission or action', () => {
    const noScopedPermission = vi.fn().mockReturnValue(false);

    expect(canViewDeploymentHistoryForEngine({ id: 'engine-1', name: 'Engine One' }, noScopedPermission)).toBe(false);
    expect(canViewDeploymentHistoryForEngine(
      { id: 'engine-1', name: 'Engine One' },
      noScopedPermission,
      (_engineId, actionId) => actionId === 'engine.deployments.read'
    )).toBe(true);
  });

  it('disables restore with the supplied project permission reason', async () => {
    (apiClient.get as any).mockImplementation(async (url: string) => {
      if (url === '/engines-api/engines') return [];
      if (url === '/engines-api/environment-tags') return [];
      if (url === '/vcs-api/projects/project-1/commits') {
        return {
          commits: [
            {
              id: 'manual-current',
              branchId: 'draft-1',
              message: 'Current',
              userId: 'user-1',
              createdAt: 1700000000100,
              hash: 'hash-current',
              versionNumber: 2,
              fileVersionNumber: 2,
              source: 'file-save',
              isRemote: false,
            },
            {
              id: 'manual-legacy',
              branchId: 'main-1',
              message: 'Legacy version',
              userId: 'user-1',
              createdAt: 1700000000000,
              hash: 'hash-legacy',
              versionNumber: 1,
              fileVersionNumber: 1,
              source: 'manual',
              isRemote: true,
            },
          ],
        };
      }
      if (url === '/vcs-api/projects/project-1/commits/manual-legacy/files') {
        return {
          files: [
            {
              id: 'file-1',
              mainFileId: 'file-1',
              folderId: null,
              name: 'Invoice',
              type: 'bpmn',
              content: '<definitions />',
              changeType: 'modified',
            },
          ],
        };
      }
      return [];
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GitVersionsPanel
          projectId="project-1"
          fileId="file-1"
          fileName="Invoice"
          fileType="bpmn"
          canRestoreVersion={false}
          restoreVersionUnavailableReason="Missing permission project:versions:restore"
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Legacy version/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText(/Legacy version/i));

    expect(await screen.findByText(/Restore unavailable Missing permission project:versions:restore/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeDisabled();
  });
});
