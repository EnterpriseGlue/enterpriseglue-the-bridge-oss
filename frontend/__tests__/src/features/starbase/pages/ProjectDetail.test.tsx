import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectDetail, { formatProjectInheritedRoleAssignmentSourceLineage, formatProjectRoleAssignmentSourceLineage } from '@src/features/starbase/pages/ProjectDetail'
import { apiClient } from '@src/shared/api/client'

let projectFileName = 'Alpha.bpmn'
let projectMemberRoles: Array<'owner' | 'delegate' | 'developer' | 'editor' | 'viewer'> = ['owner']

const authMocks = vi.hoisted(() => ({
  projectId: 'project-1', userId: 'user-1', sessionRevision: 1, notify: vi.fn(),
  hasPlatformPermission: vi.fn(),
  hasProjectPermission: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useParams: () => ({ projectId: authMocks.projectId }),
    useLocation: () => ({ state: { name: 'Alpha Project' } }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  }
})

vi.mock('@src/shared/hooks/useTenantNavigate', () => ({
  useTenantNavigate: () => ({
    tenantNavigate: vi.fn(),
    toTenantPath: (path: string) => `/t/default${path}`,
    navigate: vi.fn(),
  }),
}))

vi.mock('@src/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: authMocks.userId },
    sessionRevision: authMocks.sessionRevision,
    hasPlatformPermission: authMocks.hasPlatformPermission,
    hasProjectPermission: authMocks.hasProjectPermission,
  }),
}))

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({
    notify: authMocks.notify,
  }),
}))

vi.mock('@src/components/EngineSelector', () => ({
  useSelectedEngine: () => undefined,
}))

vi.mock('@src/features/platform-admin/hooks/usePlatformSyncSettings', () => ({
  usePlatformSyncSettings: () => ({
    data: {
      syncPushEnabled: true,
      syncPullEnabled: false,
      defaultDeployRoles: ['owner', 'delegate', 'operator', 'deployer'],
    },
  }),
}))

vi.mock('@src/features/starbase/pages/components/ProjectContentsTable', () => ({
  ProjectContentsTable: ({
    items,
    canDeleteFiles = true,
    canEditFiles = true,
    canViewFiles = true,
    onDeleteItem,
    onMoveItem,
    onDownloadFile,
    setBatchDeleteIds,
    setBatchCancelSelection,
    uploadInputRef, onUploadChange, onUploadClick, onCreateFolder, getToolbarActionUnavailableReason,
  }: any) => (
    <div>
      <button onClick={onCreateFolder}>Create folder fixture</button>
      <button onClick={() => onDeleteItem({ id: '22222222-2222-4222-8222-222222222222', name: 'Owned folder', type: 'folder' })}>Delete folder fixture</button>
      <input aria-label="Fixture upload" type="file" ref={uploadInputRef} onChange={onUploadChange} />
      <button onClick={onUploadClick} disabled={Boolean(getToolbarActionUnavailableReason?.('upload'))}>Pick upload</button>
      <div>{items[0]?.name}</div>
      {canDeleteFiles && (
        <button type="button" onClick={() => onDeleteItem(items[0])}>
          Trigger delete
        </button>
      )}
      {canDeleteFiles && (
        <button
          type="button"
          onClick={() => {
            setBatchDeleteIds([items[0].id])
            setBatchCancelSelection(() => () => {})
          }}
        >
          Trigger batch delete
        </button>
      )}
      {canEditFiles && (
        <button type="button" onClick={() => onMoveItem(items[0])}>
          Trigger move
        </button>
      )}
      {canViewFiles && (
        <button type="button" onClick={() => onDownloadFile(items[0])}>
          Trigger download
        </button>
      )}
    </div>
  ),
}))

vi.mock('@src/features/starbase/pages/components/ProjectMembersModal', () => ({
  ProjectMembersModal: () => null,
}))

vi.mock('@src/features/starbase/pages/components/ProjectMembersManagementModals', () => ({
  ProjectMembersManagementModals: () => null,
}))

vi.mock('@src/features/starbase/pages/components/ProjectDetailHeader', () => ({
  ProjectDetailHeader: () => null,
}))

vi.mock('@src/features/git/components', () => ({
  SyncModal: () => null,
  DeployDialog: () => null,
}))

vi.mock('@src/features/git/components/ProjectGitSettings', () => ({
  ProjectGitSettings: () => null,
}))

vi.mock('@src/features/starbase/components/project-detail', async () => {
  const actual = await vi.importActual<any>('@src/features/starbase/components/project-detail')
  return {
    ...actual,
    EngineAccessModal: () => null,
  }
})

vi.mock('@src/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getBlob: vi.fn(),
  },
}))

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/starbase/project/project-1']}>
        <ProjectDetail />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { ...render(tree()), tree, queryClient };
}

describe('ProjectDetail', () => {
  it('wires the real upload controller from project contents to a canonical file creation request', async () => {
    authMocks.projectId = '11111111-1111-4111-8111-111111111111';
    authMocks.hasProjectPermission.mockReturnValue(true);
    vi.mocked(apiClient.post).mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222', name: 'Imported.bpmn', type: 'bpmn', bpmnProcessId: 'p', dmnDecisionId: null, createdAt: 1, updatedAt: 1 });
    renderWithProviders(); await screen.findByText('Alpha.bpmn');
    await userEvent.click(screen.getByRole('button', { name: 'Pick upload' }));
    const file = new File([''], 'Imported.bpmn'); Object.defineProperty(file, 'text', { value: async () => '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="p"/></definitions>' });
    await userEvent.upload(screen.getByLabelText('Fixture upload'), file);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(`/starbase-api/projects/${authMocks.projectId}/files`, expect.objectContaining({ name: 'Imported.bpmn', type: 'bpmn', folderId: null })));
  });

  const createdFolder = { id: '22222222-2222-4222-8222-222222222222', name: 'Reviewed folder', parentFolderId: null, createdAt: 1, updatedAt: 1 };
  const prepareFolder = async () => {
    authMocks.projectId = '11111111-1111-4111-8111-111111111111'; authMocks.hasProjectPermission.mockReturnValue(true);
    const f = renderWithProviders(); await screen.findByText('Alpha.bpmn');
    await userEvent.click(screen.getByRole('button', { name: 'Create folder fixture' }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Reviewed folder'); return f;
  };

  it('creates a folder only after a verified receipt and refresh', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(createdFolder); await prepareFolder();
    await userEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(authMocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Folder created' })));
    expect(apiClient.post).toHaveBeenCalledWith('/starbase-api/projects/11111111-1111-4111-8111-111111111111/folders', { name: 'Reviewed folder', parentFolderId: null });
  });

  it('does not acknowledge or replay an empty folder creation response', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({}); await prepareFolder();
    await userEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(authMocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Folder creation was not verified' })));
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled(); expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('suppresses a late creation after a same-user session replacement', async () => {
    let finish!: (value: unknown) => void; vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const f = await prepareFolder(); await userEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    authMocks.sessionRevision++; f.rerender(f.tree()); await act(async () => finish(createdFolder));
    expect(authMocks.notify).not.toHaveBeenCalled(); expect(screen.getByLabelText('Folder name').closest('.cds--modal')).not.toHaveClass('is-visible');
  });

  it('requires a verified deletion preview instead of falling back to blind confirmation', async () => {
    authMocks.projectId = '11111111-1111-4111-8111-111111111111'; authMocks.hasProjectPermission.mockReturnValue(true);
    const get = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async (url: any, ...args: any[]) => url.endsWith('/delete-preview') ? {} : get(url, ...args));
    renderWithProviders(); await screen.findByText('Alpha.bpmn'); await userEvent.click(screen.getByRole('button', { name: 'Delete folder fixture' }));
    await waitFor(() => expect(authMocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Folder deletion preview unavailable' })));
    expect(screen.queryByText(/You're about to delete the folder/)).not.toBeInTheDocument(); expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it('formats project role assignment source lineage', () => {
    expect(formatProjectRoleAssignmentSourceLineage({
      source: 'sso',
      sourceRef: 'sso-group:release-ops',
    })).toBe('SSO-managed assignment; Source ref sso-group:release-ops')
    expect(formatProjectRoleAssignmentSourceLineage({
      source: 'manual',
      sourceRef: null,
    })).toBe('Manual assignment')
  })

  it('formats inherited project role assignment source lineage', () => {
    expect(formatProjectInheritedRoleAssignmentSourceLineage(
      {
        source: 'manual',
        sourceRef: 'assignment-ref',
        principalId: 'group-1',
        userId: '',
      },
      {
        source: 'sso',
        sourceRef: 'group:release-ops',
      },
      {
        id: 'group-1',
        key: 'release-ops',
        name: 'Release Ops',
      }
    )).toBe('Manual assignment; Source ref assignment-ref; Inherited through group Release Ops; SSO group membership; Membership source ref group:release-ops')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.projectId = 'project-1'; authMocks.userId = 'user-1'; authMocks.sessionRevision = 1;
    projectFileName = 'Alpha.bpmn'
    projectMemberRoles = ['owner']
    authMocks.hasPlatformPermission.mockReturnValue(false)
    authMocks.hasProjectPermission.mockImplementation((_projectId: string, permission: string) => (
      ['project:files:view', 'project:files:edit', 'project:files:delete'].includes(permission)
    ))

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      url = url.replace(authMocks.projectId, 'project-1')
      if (url === '/starbase-api/projects') {
        return [
          {
            id: 'project-1',
            name: 'Alpha Project',
            foldersCount: 0,
            filesCount: 1,
          },
        ]
      }

      if (url === '/starbase-api/projects/project-1/contents') {
        return {
          folders: [],
          files: [
            {
              id: 'file-1',
              name: projectFileName,
              type: 'bpmn',
              createdBy: 'user-1',
              updatedBy: 'user-1',
              updatedAt: 1710000000,
            },
          ],
        }
      }

      if (url === '/git-api/repositories') {
        return []
      }

      if (url === '/git-api/project-connection') {
        return { connected: false }
      }

      if (url === '/starbase-api/projects/project-1/members') {
        return []
      }

      if (url === '/starbase-api/projects/project-1/members/me') {
        return {
          userId: 'user-1',
          role: projectMemberRoles[0] || 'viewer',
          roles: projectMemberRoles,
          deployAllowed: true,
        }
      }

      if (url === '/starbase-api/projects/project-1/engine-access') {
        return {
          accessedEngines: [
            {
              engineId: 'engine-1',
              engineName: 'Dev Engine',
            },
          ],
          pendingRequests: [],
          availableEngines: [],
        }
      }

      if (url === '/starbase-api/projects/project-1/folders') {
        return []
      }

      return []
    })
  })

  it('opens the file delete confirmation modal from table actions', async () => {
    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText('Alpha.bpmn')).toBeDefined()
    })

    await userEvent.click(screen.getByRole('button', { name: /trigger delete/i }))

    expect(await screen.findByText(/you're about to delete the file "Alpha\.bpmn"\./i)).toBeDefined()
  })

  it('opens file delete when scoped RBAC grants delete without a legacy delete role', async () => {
    projectMemberRoles = ['viewer']
    authMocks.hasProjectPermission.mockImplementation((_projectId: string, permission: string) =>
      permission === 'project:files:delete'
    )

    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText('Alpha.bpmn')).toBeDefined()
    })

    await userEvent.click(screen.getByRole('button', { name: /trigger delete/i }))

    expect(await screen.findByText(/you're about to delete the file "Alpha\.bpmn"\./i)).toBeDefined()
  })

  it('hides file delete when neither role nor RBAC grants delete', async () => {
    projectMemberRoles = ['viewer']
    authMocks.hasProjectPermission.mockReturnValue(false)

    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText('Alpha.bpmn')).toBeDefined()
    })

    expect(screen.queryByRole('button', { name: /trigger delete/i })).toBeNull()
  })

  it('opens the move modal from table actions', async () => {
    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText('Alpha.bpmn')).toBeDefined()
    })

    await userEvent.click(screen.getByRole('button', { name: /trigger move/i }))

    expect(await screen.findByText(/move file/i)).toBeDefined()
    expect(await screen.findByText(/select a destination for "Alpha\.bpmn"\./i)).toBeDefined()
  })

  it('downloads BPMN files with the bpmn extension when the file name has no extension', async () => {
    projectFileName = 'Alpha'
    vi.mocked(apiClient.getBlob).mockResolvedValue(new Blob(['<definitions />'], { type: 'application/xml' }))
    ;(globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock')
    ;(globalThis.URL as any).revokeObjectURL = vi.fn()

    let downloadedFilename = ''
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download
    })

    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeDefined()
    })

    await userEvent.click(screen.getByRole('button', { name: /trigger download/i }))

    await waitFor(() => {
      expect(apiClient.getBlob).toHaveBeenCalledWith('/starbase-api/files/file-1/download')
      expect(downloadedFilename).toBe('Alpha.bpmn')
    })

    clickSpy.mockRestore()
  })

  it('sanitizes slashes in downloaded BPMN filenames instead of producing a folder-like path', async () => {
    projectFileName = 'Team/Alpha'
    vi.mocked(apiClient.getBlob).mockResolvedValue(new Blob(['<definitions />'], { type: 'application/xml' }))
    ;(globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:mock')
    ;(globalThis.URL as any).revokeObjectURL = vi.fn()

    let downloadedFilename = ''
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download
    })

    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText('Team/Alpha')).toBeDefined()
    })

    await userEvent.click(screen.getByRole('button', { name: /trigger download/i }))

    await waitFor(() => {
      expect(apiClient.getBlob).toHaveBeenCalledWith('/starbase-api/files/file-1/download')
      expect(downloadedFilename).toBe('Team_Alpha.bpmn')
    })

    clickSpy.mockRestore()
  })

  it('confirms and executes batch delete from selected items', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue(undefined as any)

    renderWithProviders()

    await waitFor(() => {
      expect(screen.getByText('Alpha.bpmn')).toBeDefined()
    })

    await userEvent.click(screen.getByRole('button', { name: /trigger batch delete/i }))

    expect(await screen.findByText(/you're about to delete 1 selected item\./i)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: /delete selected/i }))

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith('/starbase-api/files/file-1')
    })
  })
})
