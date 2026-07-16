import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GitVersionsPanel, { canViewDeploymentHistoryForEngine } from '@src/features/git/components/GitVersionsPanel';
import { apiClient } from '@src/shared/api/client';
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
  default: () => <div>Viewer</div>,
}));

vi.mock('@src/features/starbase/components/DMNDrdMini', () => ({
  default: () => <div>DMNDrdMini</div>,
}));

vi.mock('@carbon/react', () => ({
  Modal: ({ open, children, primaryButtonText, primaryButtonDisabled, onRequestSubmit }: any) => (open ? (
    <div>
      {children}
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

vi.mock('@src/shared/api/client', () => ({
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

  it('requires a scoped deployment history permission or action', () => {
    const noScopedPermission = vi.fn().mockReturnValue(false);

    expect(canViewDeploymentHistoryForEngine({ id: 'engine-1' }, noScopedPermission)).toBe(false);
    expect(canViewDeploymentHistoryForEngine(
      { id: 'engine-1' },
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
