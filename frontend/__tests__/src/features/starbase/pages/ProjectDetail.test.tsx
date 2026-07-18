import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectDetail, { formatProjectInheritedRoleAssignmentSourceLineage, formatProjectRoleAssignmentSourceLineage } from '@src/features/starbase/pages/ProjectDetail'
import { apiClient } from '@src/shared/api/client'

let projectFileName = 'Alpha.bpmn'
let projectMemberRoles: Array<'owner' | 'delegate' | 'developer' | 'editor' | 'viewer'> = ['owner']

const authMocks = vi.hoisted(() => ({
  hasPlatformPermission: vi.fn(),
  hasProjectPermission: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useParams: () => ({ projectId: 'project-1' }),
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
    user: { id: 'user-1' },
    hasPlatformPermission: authMocks.hasPlatformPermission,
    hasProjectPermission: authMocks.hasProjectPermission,
  }),
}))

vi.mock('@src/shared/notifications/ToastProvider', () => ({
  useToast: () => ({
    notify: vi.fn(),
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
  }: any) => (
    <div>
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

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/starbase/project/project-1']}>
        <ProjectDetail />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ProjectDetail', () => {
  it('formats project role assignment source lineage', () => {
    expect(formatProjectRoleAssignmentSourceLineage({
      source: 'sso',
      sourceRef: 'sso-group:release-ops',
      sourceMappingId: 'mapping-1',
    })).toBe('SSO-managed assignment; Source ref sso-group:release-ops; SSO mapping mapping-1')
    expect(formatProjectRoleAssignmentSourceLineage({
      source: 'manual',
      sourceRef: null,
      sourceMappingId: null,
    })).toBe('Manual assignment')
  })

  it('formats inherited project role assignment source lineage', () => {
    expect(formatProjectInheritedRoleAssignmentSourceLineage(
      {
        source: 'manual',
        sourceRef: 'assignment-ref',
        sourceMappingId: null,
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
    projectFileName = 'Alpha.bpmn'
    projectMemberRoles = ['owner']
    authMocks.hasPlatformPermission.mockReturnValue(false)
    authMocks.hasProjectPermission.mockImplementation((_projectId: string, permission: string) => (
      ['project:files:view', 'project:files:edit', 'project:files:delete'].includes(permission)
    ))

    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
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
