import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectGitSettings } from '@src/features/git/components/ProjectGitSettings';
import { apiClient } from '@src/shared/api/client';
import { ProjectPermission } from '@src/shared/auth/permissions';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import type { CurrentUserPermissions } from '@src/shared/types/auth';
import { advanceBrowserSessionRevision } from '@src/utils/browserSession';

const projectId = '11111111-1111-4111-8111-111111111111';
const secondProjectId = '22222222-2222-4222-8222-222222222222';

vi.mock('@carbon/react', () => ({
  Modal: ({ open, children, modalHeading, onRequestClose }: any) => (open ? (
    <div role="dialog" aria-label={modalHeading}>
      <h1>{modalHeading}</h1>
      {children}
      <button onClick={onRequestClose}>Close settings</button>
    </div>
  ) : null),
  TextInput: ({ id, labelText, value, onChange, disabled, type = 'text', invalidText }: any) => (
    <label htmlFor={id}>
      {labelText}
      <input id={id} type={type} value={value || ''} onChange={onChange} disabled={Boolean(disabled)} />
      {invalidText ? <span>{invalidText}</span> : null}
    </label>
  ),
  Dropdown: ({ id, titleText, items, selectedItem, itemToString, onChange, disabled }: any) => (
    <label htmlFor={id}>
      {titleText}
      <select
        id={id}
        value={selectedItem?.id || ''}
        disabled={Boolean(disabled)}
        onChange={(event) => onChange?.({ selectedItem: items.find((item: any) => item.id === event.target.value) })}
      >
        {items.map((item: any) => (
          <option key={item.id} value={item.id}>{itemToString(item)}</option>
        ))}
      </select>
    </label>
  ),
  Button: ({ children, onClick, disabled, title }: any) => (
    <button type="button" onClick={onClick} disabled={Boolean(disabled)} title={title}>
      {children}
    </button>
  ),
  InlineNotification: ({ title, subtitle }: any) => (
    <div>
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  ),
  InlineLoading: ({ description }: any) => <div>{description}</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Tile: ({ children }: any) => <div>{children}</div>,
  Toggletip: ({ children }: any) => <div>{children}</div>,
  ToggletipButton: ({ children, label }: any) => <button type="button" aria-label={label}>{children}</button>,
  ToggletipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@src/shared/api/client', async original => ({
  ...await original<typeof import('@src/shared/api/client')>(),
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

type GitConnectionResponse = {
  connected: boolean;
  providerId?: string;
  repositoryName?: string;
  namespace?: string;
  defaultBranch?: string;
  hasToken?: boolean;
  lastValidatedAt?: number | null;
};

const basePermissions: CurrentUserPermissions = {
  userId: 'user-1',
  tenantId: null,
  platform: [],
  projects: [{
    resourceId: projectId,
    permissions: [
      ProjectPermission.FILES_VIEW,
      ProjectPermission.GIT_CONNECT,
    ],
  }],
  engines: [],
  authorizationVersion: 'test-authz-v1',
  generatedAt: 1,
};
const bothProjectPermissions = { ...basePermissions, projects: [...basePermissions.projects,
  { ...basePermissions.projects[0], resourceId: secondProjectId }] };

function makeAuthContext(permissions: CurrentUserPermissions = basePermissions): AuthContextValue {
  return {
    user: null,
    permissions,
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    resetPassword: vi.fn(),
    changePassword: vi.fn(),
    refreshUser: vi.fn(),
    setAuthenticatedUser: vi.fn(),
    refreshPermissions: vi.fn(),
    hasPlatformPermission: vi.fn((permission: string) => permissions.platform.includes(permission)),
    hasAnyPlatformPermission: vi.fn((platformPermissions: string[]) => platformPermissions.some((permission) => permissions.platform.includes(permission))),
    hasProjectPermission: vi.fn((projectId: string | null | undefined, permission: string) => (
      Boolean(projectId && permissions.projects.some((project) => project.resourceId === projectId && project.permissions.includes(permission)))
    )),
    hasAnyProjectPermission: vi.fn((projectId: string | null | undefined, projectPermissions: string[]) => (
      Boolean(projectId && permissions.projects.some((project) => (
        project.resourceId === projectId && projectPermissions.some((permission) => project.permissions.includes(permission))
      )))
    )),
    hasAnyEnginePermission: vi.fn(),
    hasEnginePermission: vi.fn(),
    hasAnyScopedEnginePermission: vi.fn(),
  };
}

function renderSettings(
  connection: GitConnectionResponse,
  props: Partial<React.ComponentProps<typeof ProjectGitSettings>> = {},
  permissions: CurrentUserPermissions = basePermissions,
  strict = false
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  (apiClient.get as any).mockImplementation(async (url: string) => {
    if (url === '/git-api/project-connection') return connection.connected ? {
      providerId: 'github', repositoryName: 'orders', namespace: 'acme', defaultBranch: 'main',
      remoteUrl: 'https://example.invalid/acme/orders', hasToken: true, lastValidatedAt: Date.now(),
      tokenScopeHint: null, connectedByUserId: 'user-1', lastSyncAt: null, ...connection,
    } : connection;
    return {};
  });

  const tree = (nextProps = props, nextPermissions = permissions) => (
    <AuthContext.Provider value={makeAuthContext(nextPermissions)}>
      <QueryClientProvider client={queryClient}>
        <ProjectGitSettings projectId={projectId} open onClose={vi.fn()} {...nextProps} />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
  return { ...render(strict ? <React.StrictMode>{tree()}</React.StrictMode> : tree()), tree, queryClient };
}

describe('ProjectGitSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    (apiClient.post as any).mockResolvedValue({ success: true, repoFullName: 'acme/orders' });
    (apiClient.put as any).mockResolvedValue({ success: true });
    (apiClient.delete as any).mockResolvedValue({ success: true });
  });

  it('keeps disconnected Git settings read-only without project git connect permission', async () => {
    renderSettings(
      { connected: false },
      {
        canManageConnection: false,
        manageConnectionUnavailableReason: `Missing permission ${ProjectPermission.GIT_CONNECT}`,
      }
    );

    expect(await screen.findByText('Git connection changes unavailable')).toBeInTheDocument();
    expect(await screen.findByText(/Connect this project to a Git repository/i)).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.GIT_CONNECT}`)).toBeInTheDocument();
    expect(screen.getByLabelText(/Provider/i)).toBeDisabled();
    expect(screen.getByLabelText(/Repository name/i)).toBeDisabled();
    expect(screen.getByLabelText(/Service Token \(PAT\)/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test & Connect' })).toBeDisabled();
  });

  it('shows connected status but disables token and disconnect actions without project git connect permission', async () => {
    renderSettings(
      {
        connected: true,
        providerId: 'github',
        namespace: 'acme',
        repositoryName: 'orders',
        defaultBranch: 'main',
        hasToken: true,
        lastValidatedAt: Date.now(),
      },
      {
        canManageConnection: false,
        manageConnectionUnavailableReason: `Missing permission ${ProjectPermission.GIT_CONNECT}`,
      }
    );

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('acme/orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Token' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled();
  });

  it('disables connection changes when the clean manage action is unavailable', async () => {
    renderSettings(
      { connected: false },
      { canManageConnection: true },
      {
        ...basePermissions,
        projects: [{
          resourceId: projectId,
          permissions: [ProjectPermission.FILES_VIEW],
        }],
      }
    );

    expect(await screen.findByText('Git connection changes unavailable')).toBeInTheDocument();
    expect(await screen.findByText(/Connect this project to a Git repository/i)).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.GIT_CONNECT}`)).toBeInTheDocument();
    expect(screen.getByLabelText(/Provider/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test & Connect' })).toBeDisabled();
  });

  it('hides connection status when the clean read action is unavailable', async () => {
    renderSettings(
      { connected: true, repositoryName: 'orders' },
      { canManageConnection: true },
      {
        ...basePermissions,
        projects: [{
          resourceId: projectId,
          permissions: [ProjectPermission.GIT_CONNECT],
        }],
      }
    );

    expect(await screen.findByText('Git connection status unavailable')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.FILES_VIEW}`)).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect this project to a Git repository/i)).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith('/git-api/project-connection', { projectId });
  });

  it('connects a repository when project git connect permission is available', async () => {
    renderSettings({ connected: false }, { canManageConnection: true });

    await userEvent.type(await screen.findByLabelText(/Owner \/ Namespace/i), 'acme');
    await userEvent.type(screen.getByLabelText(/Repository name/i), 'orders');
    await userEvent.type(screen.getByLabelText(/Service Token \(PAT\)/i), 'ghp_token');
    await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/project-connection', {
        projectId,
        providerId: 'github',
        repositoryName: 'orders',
        namespace: 'acme',
        defaultBranch: 'main',
        token: 'ghp_token',
      });
    });
  });

  async function fillConnection() {
    await userEvent.type(await screen.findByLabelText(/Owner \/ Namespace/i), 'acme');
    await userEvent.type(screen.getByLabelText(/Repository name/i), 'orders');
    await userEvent.type(screen.getByLabelText(/Service Token \(PAT\)/i), 'synthetic-service-token');
  }

  it('does not clear the token or invalidate caches for an unverified connection receipt', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const f = renderSettings({ connected: false });
    const invalidate = vi.spyOn(f.queryClient, 'invalidateQueries');
    await fillConnection();
    await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));
    expect(await screen.findByText(/Connection response was not verified/)).toBeVisible();
    expect(screen.getByLabelText(/Service Token \(PAT\)/i)).toHaveValue('synthetic-service-token');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('clears private and target form fields when the project changes', async () => {
    const f = renderSettings({ connected: false }); await fillConnection();
    f.rerender(f.tree({ projectId: secondProjectId }, bothProjectPermissions));
    expect(await screen.findByLabelText(/Service Token \(PAT\)/i)).toHaveValue('');
    expect(screen.getByLabelText(/Repository name/i)).toHaveValue('');
  });

  it('refuses malformed or unredacted connection status before caching/displaying it', async () => {
    const f = renderSettings({ connected: true });
    await screen.findByText('Connected');
    vi.mocked(apiClient.get).mockResolvedValue({ connected: true, repositoryName: 'unverified-repository', token: 'synthetic-secret' });
    await act(async () => { f.queryClient.removeQueries({ queryKey: ['git-connection'] }); });
    f.rerender(f.tree({ projectId: secondProjectId }, bothProjectPermissions));
    expect(await screen.findByText(/Connection status was not verified/)).toBeVisible();
    expect(screen.queryByText('unverified-repository')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test & Connect' })).not.toBeInTheDocument();
    expect(JSON.stringify(f.queryClient.getQueryCache().findAll({ queryKey: ['git-connection', secondProjectId] }).map(query => query.state.data))).not.toContain('synthetic-secret');
  });

  it.each([{}, { success: false }, { success: true, repoFullName: 'foreign/repository' }, { success: true, repoFullName: 'acme/orders', token: 'unexpected' }])('refuses a malformed or retargeted connect acknowledgement %j', async receipt => {
    vi.mocked(apiClient.post).mockResolvedValue(receipt);
    const f = renderSettings({ connected: false }); const invalidate = vi.spyOn(f.queryClient, 'invalidateQueries');
    await fillConnection(); await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));
    expect(await screen.findByText(/Connection response was not verified/)).toBeVisible();
    expect(invalidate).not.toHaveBeenCalled(); expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it.each(['token', 'disconnect'])('does not report %s success for an empty receipt', async operation => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(apiClient.put).mockResolvedValue({}); vi.mocked(apiClient.delete).mockResolvedValue({});
    const f = renderSettings({ connected: true }); const invalidate = vi.spyOn(f.queryClient, 'invalidateQueries');
    await screen.findByText('Connected');
    if (operation === 'token') {
      await userEvent.click(screen.getByRole('button', { name: 'Update Token' }));
      await userEvent.type(screen.getByLabelText('New Token'), 'synthetic-new-token');
      await userEvent.click(screen.getByRole('button', { name: 'Test & Save' }));
    } else await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/Connection response was not verified/)).toBeVisible();
    if (operation === 'token') expect(screen.getByLabelText('New Token')).toHaveValue('synthetic-new-token');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(['project', 'close', 'unmount', 'user', 'permission', 'session'])('suppresses late connect results after %s changes', async change => {
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const f = renderSettings({ connected: false }); const invalidate = vi.spyOn(f.queryClient, 'invalidateQueries');
    await fillConnection(); await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    if (change === 'project') {
      f.rerender(f.tree({ projectId: secondProjectId }, bothProjectPermissions));
      await fillConnection();
    } else if (change === 'close') await userEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    else if (change === 'unmount') f.unmount();
    else if (change === 'user') f.rerender(f.tree({}, { ...basePermissions, userId: 'user-2' }));
    else if (change === 'permission') f.rerender(f.tree({ canManageConnection: false }));
    else advanceBrowserSessionRevision();
    await act(async () => finish({ success: true, repoFullName: 'acme/orders' }));
    expect(invalidate).not.toHaveBeenCalled();
    if (change === 'project') {
      expect(screen.getByLabelText(/Service Token \(PAT\)/i)).toHaveValue('synthetic-service-token');
      expect(screen.getByRole('button', { name: 'Test & Connect' })).toBeEnabled();
    }
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('refreshes all connection consumers only after the matching verified receipt', async () => {
    const f = renderSettings({ connected: false }); const invalidate = vi.spyOn(f.queryClient, 'invalidateQueries');
    await fillConnection(); await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5));
    for (const queryKey of [['git-connection', projectId], ['git', 'repository', projectId], ['git', 'repositories'], ['git', 'sync-status', projectId], ['starbase', 'projects']]) expect(invalidate).toHaveBeenCalledWith({ queryKey });
    expect(screen.getByLabelText(/Service Token \(PAT\)/i)).toHaveValue('');
    expect(f.queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('refuses a click from an authority rendered before the browser session changed', async () => {
    renderSettings({ connected: false }); await fillConnection(); advanceBrowserSessionRevision();
    await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' })); expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('supports a verified connection under StrictMode without retaining the private request in a mutation cache', async () => {
    const f = renderSettings({ connected: false }, {}, basePermissions, true);
    const invalidate = vi.spyOn(f.queryClient, 'invalidateQueries'); await fillConnection();
    await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5)); expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(f.queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it.each(['token', 'disconnect'])('accepts a verified %s receipt and sends only its canonical request', async operation => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const f = renderSettings({ connected: true }); const invalidate = vi.spyOn(f.queryClient, 'invalidateQueries');
    await screen.findByText('Connected');
    if (operation === 'token') {
      await userEvent.click(screen.getByRole('button', { name: 'Update Token' })); await userEvent.type(screen.getByLabelText('New Token'), 'synthetic-new-token');
      await userEvent.click(screen.getByRole('button', { name: 'Test & Save' }));
      expect(apiClient.put).toHaveBeenCalledExactlyOnceWith('/git-api/project-connection/token', { projectId, token: 'synthetic-new-token' });
    } else {
      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      expect(apiClient.delete).toHaveBeenCalledExactlyOnceWith('/git-api/project-connection', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
    }
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5)); expect(f.queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('does not reuse the previous principal connection status while the new query is pending', async () => {
    const f = renderSettings({ connected: true }); await screen.findByText('Connected');
    let finish!: (value: unknown) => void;
    vi.mocked(apiClient.get).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.rerender(f.tree({}, { ...basePermissions, userId: 'user-2' }));
    expect(screen.queryByText('Connected')).not.toBeInTheDocument(); expect(screen.queryByText('acme/orders')).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    await act(async () => finish({ connected: false })); expect(await screen.findByRole('button', { name: 'Test & Connect' })).toBeVisible();
  });

  it('does not expose the submitted service token in a failure notification', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('Rejected synthetic-service-token'));
    renderSettings({ connected: false }); await fillConnection(); await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));
    expect(await screen.findByText('Rejected [redacted]')).toBeVisible(); expect(screen.queryByText('Rejected synthetic-service-token')).not.toBeInTheDocument();
  });

  it('refuses duplicate confirmation while a request is pending and freezes its target fields', async () => {
    let finish!: (value: unknown) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    renderSettings({ connected: false }); await fillConnection(); await userEvent.dblClick(screen.getByRole('button', { name: 'Test & Connect' }));
    expect(apiClient.post).toHaveBeenCalledTimes(1); expect(screen.getByLabelText(/Repository name/i)).toBeDisabled(); expect(screen.getByLabelText(/Service Token \(PAT\)/i)).toBeDisabled();
    await act(async () => finish({ success: true, repoFullName: 'acme/orders' }));
  });
});
