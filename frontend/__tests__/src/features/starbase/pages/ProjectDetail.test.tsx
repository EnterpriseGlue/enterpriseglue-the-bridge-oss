import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectDetail from '@src/features/starbase/pages/ProjectDetail'
import { apiClient } from '@src/shared/api/client'

let projectFileName = 'Alpha.bpmn'

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
  ProjectContentsTable: ({ items, onDeleteItem, onMoveItem, onDownloadFile }: any) => (
    <div>
      <div>{items[0]?.name}</div>
      <button type="button" onClick={() => onDeleteItem(items[0])}>
        Trigger delete
      </button>
      <button type="button" onClick={() => onMoveItem(items[0])}>
        Trigger move
      </button>
      <button type="button" onClick={() => onDownloadFile(items[0])}>
        Trigger download
      </button>
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
  beforeEach(() => {
    vi.clearAllMocks()
    projectFileName = 'Alpha.bpmn'

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
          role: 'owner',
          roles: ['owner'],
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
})
