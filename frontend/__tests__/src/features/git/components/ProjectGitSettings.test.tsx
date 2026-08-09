import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectGitSettings } from '@src/features/git/components/ProjectGitSettings';
import { apiClient } from '@src/shared/api/client';
import { ProjectPermission } from '@src/shared/auth/permissions';
import { AuthContext, type AuthContextValue } from '@src/contexts/AuthContext';
import type { CurrentUserPermissions } from '@src/shared/types/auth';

vi.mock('@carbon/react', () => ({
  Modal: ({ open, children, modalHeading }: any) => (open ? (
    <div role="dialog" aria-label={modalHeading}>
      <h1>{modalHeading}</h1>
      {children}
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

vi.mock('@src/shared/api/client', () => ({
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
    resourceId: 'project-1',
    permissions: [
      ProjectPermission.FILES_VIEW,
      ProjectPermission.GIT_CONNECT,
    ],
  }],
  engines: [],
  authorizationVersion: 'test-authz-v1',
  generatedAt: 1,
};

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
  permissions: CurrentUserPermissions = basePermissions
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  (apiClient.get as any).mockImplementation(async (url: string) => {
    if (url === '/git-api/project-connection') return connection;
    return {};
  });

  return render(
    <AuthContext.Provider value={makeAuthContext(permissions)}>
      <QueryClientProvider client={queryClient}>
        <ProjectGitSettings projectId="project-1" open onClose={vi.fn()} {...props} />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

describe('ProjectGitSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.post as any).mockResolvedValue({ success: true });
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
          resourceId: 'project-1',
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
          resourceId: 'project-1',
          permissions: [ProjectPermission.GIT_CONNECT],
        }],
      }
    );

    expect(await screen.findByText('Git connection status unavailable')).toBeInTheDocument();
    expect(screen.getByText(`Missing permission ${ProjectPermission.FILES_VIEW}`)).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect this project to a Git repository/i)).not.toBeInTheDocument();
    expect(apiClient.get).not.toHaveBeenCalledWith('/git-api/project-connection', { projectId: 'project-1' });
  });

  it('connects a repository when project git connect permission is available', async () => {
    renderSettings({ connected: false }, { canManageConnection: true });

    await userEvent.type(await screen.findByLabelText(/Owner \/ Namespace/i), 'acme');
    await userEvent.type(screen.getByLabelText(/Repository name/i), 'orders');
    await userEvent.type(screen.getByLabelText(/Service Token \(PAT\)/i), 'ghp_token');
    await userEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/git-api/project-connection', {
        projectId: 'project-1',
        providerId: 'github',
        repositoryName: 'orders',
        namespace: 'acme',
        defaultBranch: 'main',
        token: 'ghp_token',
      });
    });
  });
});
