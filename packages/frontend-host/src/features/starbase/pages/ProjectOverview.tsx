import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DataTableSkeleton,
} from '@carbon/react'
import { Dashboard } from '@carbon/icons-react'
import { BreadcrumbItem } from '@carbon/react'
import { PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout'
import { BreadcrumbBar } from '../../shared/components/BreadcrumbBar'
import { useModal } from '../../../shared/hooks/useModal'
import { NoDataState, ErrorState } from '../../shared/components'
import { useInlineRename } from '../hooks/useInlineRename'
import { gitApi } from '../../git/api/gitApi'
import { StarbaseTableShell } from '../components/StarbaseTableShell'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings'
import { ProjectOverviewTable } from './components/ProjectOverviewTable'
import { ProjectOverviewBulkSyncModal } from './components/ProjectOverviewBulkSyncModal'
import { ProjectOverviewModals } from './components/ProjectOverviewModals'
import { ProjectGitSettings } from '../../git/components/ProjectGitSettings'
import type { Project, ProjectMember, EngineAccessData, SyncDirection, BulkSyncResult } from './projectOverviewTypes'
import styles from './ProjectOverview.module.css'
 

export default function ProjectOverview() {
  const nav = useNavigate()
  const location = useLocation()
  const { pathname } = location

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  const qc = useQueryClient()
  const [query, setQuery] = React.useState('')

  const { data: platformSettings } = usePlatformSyncSettings()
  const pushEnabled = platformSettings?.syncPushEnabled ?? true
  const pullEnabled = platformSettings?.syncPullEnabled ?? false
  const anySyncEnabled = pushEnabled || pullEnabled

  const sharingEnabled = platformSettings?.gitProjectTokenSharingEnabled ?? false

  const [isBulkSyncOpen, setIsBulkSyncOpen] = React.useState(false)
  const [bulkSyncIds, setBulkSyncIds] = React.useState<string[]>([])
  const [bulkCancelSelection, setBulkCancelSelection] = React.useState<null | (() => void)>(null)
  const [bulkDirection, setBulkDirection] = React.useState<SyncDirection>('push')
  const [bulkMessage, setBulkMessage] = React.useState('')
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [bulkError, setBulkError] = React.useState<string | null>(null)
  const [bulkResult, setBulkResult] = React.useState<BulkSyncResult | null>(null)
  const q = useQuery({
    queryKey: ['starbase', 'projects'],
    queryFn: () => apiClient.get<Project[]>('/starbase-api/projects'),
    staleTime: 60 * 1000,
  })

  const projectIds = React.useMemo(() => {
    const ids = (q.data || []).map((p) => p.id).filter(Boolean)
    ids.sort()
    return ids
  }, [q.data])

  const projectStatusQ = useQuery({
    queryKey: ['vcs', 'uncommitted-status', 'projects', projectIds.join(',')],
    queryFn: () => apiClient.get<{ statuses: Record<string, { hasUncommittedChanges: boolean; dirtyFileCount: number }> }>(
      '/vcs-api/projects/uncommitted-status',
      { projectIds: projectIds.join(',') }
    ),
    enabled: projectIds.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
  const providersQuery = useQuery({
    queryKey: ['git', 'providers'],
    queryFn: () => gitApi.getProviders(),
    staleTime: 5 * 60 * 1000,
  })
  const hasGitProviders = (providersQuery.data?.length ?? 0) > 0

  const credentialsQuery = useQuery({
    queryKey: ['git', 'credentials'],
    queryFn: async () => {
      const data = await apiClient.get<any[]>('/git-api/credentials').catch(() => [])
      return Array.isArray(data) ? data : []
    },
    staleTime: 30 * 1000,
  })

  const [deleteProject, setDeleteProject] = React.useState<Project | null>(null)
  const [batchDeleteIds, setBatchDeleteIds] = React.useState<string[] | null>(null)
  const [batchCancelSelection, setBatchCancelSelection] = React.useState<null | (() => void)>(null)
  const [disconnectProject, setDisconnectProject] = React.useState<Project | null>(null)
  const [busy, setBusy] = React.useState(false)
  const createOnlineModal = useModal()
  const [onlineProjectContext, setOnlineProjectContext] = React.useState<{ id: string; name: string } | null>(null)
  const [engineAccessOpen, setEngineAccessOpen] = React.useState(false)
  const [engineAccessProject, setEngineAccessProject] = React.useState<{ id: string; name: string } | null>(null)
  const [selectedEngineForRequest, setSelectedEngineForRequest] = React.useState<string | null>(null)
  const [gitSettingsProjectId, setGitSettingsProjectId] = React.useState<string | null>(null)

  const didHandleOpenCreateProject = React.useRef(false)
  React.useEffect(() => {
    if (didHandleOpenCreateProject.current) return
    const state = (location as any).state as any
    if (!state?.openCreateProject) return

    didHandleOpenCreateProject.current = true
    setOnlineProjectContext(null)
    createOnlineModal.openModal()
    nav(toTenantPath('/starbase'), { replace: true, state: {} })
  }, [location, nav, toTenantPath, createOnlineModal])

  React.useEffect(() => {
    if (!isBulkSyncOpen) return
    if (pushEnabled) setBulkDirection('push')
    else if (pullEnabled) setBulkDirection('pull')
    setBulkMessage('')
    setBulkBusy(false)
    setBulkError(null)
    setBulkResult(null)
  }, [isBulkSyncOpen, pushEnabled, pullEnabled])

  const requiresPersonalToken = !sharingEnabled
  const hasAnyCredentials = (credentialsQuery.data?.length ?? 0) > 0
  const credentialsCheckLoading = requiresPersonalToken && credentialsQuery.isLoading
  const canBulkSync = !requiresPersonalToken || hasAnyCredentials

  const closeBulkSync = () => {
    setIsBulkSyncOpen(false)
    setBulkBusy(false)
    setBulkError(null)
    setBulkResult(null)
    setBulkSyncIds([])
    setBulkCancelSelection(null)
  }

  const runBulkSync = async () => {
    if (!canBulkSync) {
      setBulkError('Git credentials required. Connect your Git credentials to sync.')
      return
    }

    const commitMessage = bulkMessage.trim()
    if (!commitMessage) {
      setBulkError('Commit message is required')
      return
    }

    setBulkBusy(true)
    setBulkError(null)
    setBulkResult(null)

    const selected = (q.data || []).filter((p) => bulkSyncIds.includes(p.id))
    const connected = selected.filter((p) => !!p.gitUrl)
    const skipped: BulkSyncResult['skipped'] = []
    const succeeded: BulkSyncResult['succeeded'] = []
    const failed: BulkSyncResult['failed'] = []

    for (const p of selected) {
      if (!p.gitUrl) {
        skipped.push({ id: p.id, name: p.name, reason: 'Not connected to Git' })
        continue
      }

      try {
        await apiClient.post('/git-api/sync', {
          projectId: p.id,
          direction: bulkDirection,
          message: commitMessage,
        })

        succeeded.push({ id: p.id, name: p.name })
      } catch (e: any) {
        const parsed = parseApiError(e, 'Sync failed')
        failed.push({ id: p.id, name: p.name, error: parsed.message })
      }
    }

    const result: BulkSyncResult = { succeeded, skipped, failed }
    setBulkResult(result)

    if (connected.length > 0) {
      await qc.invalidateQueries({ queryKey: ['starbase', 'projects'] })
      await qc.invalidateQueries({ queryKey: ['vcs', 'uncommitted-status'] })
      await qc.invalidateQueries({ queryKey: ['git'] })
    }

    if (failed.length === 0 && skipped.length === 0) {
      bulkCancelSelection?.()
      closeBulkSync()
    }

    setBulkBusy(false)
  }

  const handleBatchDelete = async () => {
    if (!batchDeleteIds || batchDeleteIds.length === 0) return
    setBusy(true)
    try {
      for (const id of batchDeleteIds) {
        await apiClient.delete(`/starbase-api/projects/${id}`)
      }
      await qc.invalidateQueries({ queryKey: ['starbase', 'projects'] })
      batchCancelSelection?.()
      setBatchDeleteIds(null)
      setBatchCancelSelection(null)
    } catch {
    } finally {
      setBusy(false)
    }
  }

  const handleDisconnectFromGit = async () => {
    if (!disconnectProject) return
    setBusy(true)
    try {
      await gitApi.disconnectFromGit(disconnectProject.id)
      await qc.invalidateQueries({ queryKey: ['starbase', 'projects'] })
    } catch (error) {
      console.error('Failed to disconnect from Git:', error)
    } finally {
      setBusy(false)
      setDisconnectProject(null)
    }
  }

  const { editingId, draftName, setDraftName, inputRef, startEditing, handleKeyDown, handleBlur } = useInlineRename({
    type: 'project',
    queryKey: ['starbase', 'projects']
  })

  const items = React.useMemo(() => {
    if (!q.data) return []
    const needle = query.trim().toLowerCase()
    return q.data.filter(p => !needle || p.name.toLowerCase().includes(needle))
  }, [q.data, query])

  const engineAccessQ = useQuery({
    queryKey: ['project-engine-access', engineAccessProject?.id],
    queryFn: () => apiClient.get<EngineAccessData>(`/starbase-api/projects/${engineAccessProject?.id}/engine-access`),
    enabled: engineAccessOpen && !!engineAccessProject?.id,
  })

  const myMembershipQ = useQuery({
    queryKey: ['project-members', engineAccessProject?.id, 'me'],
    queryFn: () => apiClient.get<ProjectMember | null>(`/starbase-api/projects/${engineAccessProject?.id}/members/me`),
    enabled: engineAccessOpen && !!engineAccessProject?.id,
  })

  const canManageMembers = React.useMemo(() => {
    const membership = myMembershipQ.data
    if (!membership) return false
    const roles = Array.isArray((membership as any).roles) && (membership as any).roles.length > 0
      ? (membership as any).roles
      : [membership.role]
    return roles.includes('owner') || roles.includes('delegate')
  }, [myMembershipQ.data])

  const requestEngineAccessM = useMutation({
    mutationFn: async (engineId: string) => {
      if (!engineAccessProject?.id) return { autoApproved: false }
      return apiClient.post<{ autoApproved?: boolean }>(
        `/engines-api/engines/${engineId}/request-access`,
        { projectId: engineAccessProject.id }
      )
    },
    onSuccess: () => {
      if (engineAccessProject?.id) {
        qc.invalidateQueries({ queryKey: ['project-engine-access', engineAccessProject.id] })
      }
      setSelectedEngineForRequest(null)
    },
  })

  return (
    <>
      <ProjectOverviewBulkSyncModal
        open={isBulkSyncOpen}
        bulkBusy={bulkBusy}
        bulkError={bulkError}
        bulkResult={bulkResult}
        bulkMessage={bulkMessage}
        setBulkMessage={setBulkMessage}
        bulkDirection={bulkDirection}
        setBulkDirection={setBulkDirection}
        bulkSyncIds={bulkSyncIds}
        canBulkSync={canBulkSync}
        credentialsCheckLoading={credentialsCheckLoading}
        sharingEnabled={sharingEnabled}
        pushEnabled={pushEnabled}
        pullEnabled={pullEnabled}
        onClose={closeBulkSync}
        onSubmit={runBulkSync}
        onClearError={() => setBulkError(null)}
        onConnectCredentials={() => nav(toTenantPath('/settings/git-connections'))}
      />
    <div className={styles.pageRoot}>
      {/* Breadcrumb Bar - full width at top, stays fixed */}
      <BreadcrumbBar>
        <BreadcrumbItem isCurrentPage>Starbase</BreadcrumbItem>
      </BreadcrumbBar>

      {/* Page content with padding - scrollable */}
      <div className={styles.pageContent}>
      <PageHeader
        icon={Dashboard}
        title="Starbase"
        subtitle="Manage your projects and collaborate with your team"
        gradient={PAGE_GRADIENTS.blue}
      />

      {q.isLoading && (
        <StarbaseTableShell>
          <DataTableSkeleton
            showHeader
            showToolbar
            rowCount={8}
            columnCount={5}
          />
        </StarbaseTableShell>
      )}
      {q.isError && <ErrorState message="Failed to load projects" onRetry={() => q.refetch()} />}
      {/* If there are no projects in the system at all, show the create-empty state */}
      {!q.isLoading && !q.isError && q.data && q.data.length === 0 && (
        <NoDataState resource="project" onCreate={() => {
          setOnlineProjectContext(null)
          createOnlineModal.openModal()
        }} />
      )}
      {/* If there is at least one project, always show the table/toolbar; rows may be empty when filtered */}
      {!q.isLoading && !q.isError && q.data && q.data.length > 0 && (
        <ProjectOverviewTable
          items={items}
          query={query}
          setQuery={setQuery}
          hasGitProviders={hasGitProviders}
          anySyncEnabled={anySyncEnabled}
          projectStatusMap={projectStatusQ.data?.statuses}
          editingId={editingId}
          draftName={draftName}
          setDraftName={setDraftName}
          inputRef={inputRef}
          handleBlur={handleBlur}
          handleKeyDown={handleKeyDown}
          startEditing={startEditing}
          onOpenProject={(project) => nav(toTenantPath(`/starbase/project/${project.id}`), { state: { name: project.name } })}
          onOpenNewProject={() => {
            setOnlineProjectContext(null)
            createOnlineModal.openModal()
          }}
          onBulkSync={(ids, cancelSelection) => {
            setBulkCancelSelection(() => cancelSelection)
            setBulkSyncIds(ids)
            setIsBulkSyncOpen(true)
          }}
          onBatchDelete={(ids, cancelSelection) => {
            setBatchCancelSelection(() => cancelSelection)
            setBatchDeleteIds(ids)
          }}
          onDownloadProject={(project) => {
            apiClient.getBlob(`/starbase-api/projects/${project.id}/download`)
              .then((blob: Blob) => {
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `project-${project.id}.zip`
                a.click()
                window.URL.revokeObjectURL(url)
              })
              .catch((err: unknown) => console.error('Download failed:', err))
          }}
          onConnectEngines={(project) => {
            setEngineAccessProject({ id: project.id, name: project.name })
            setSelectedEngineForRequest(null)
            setEngineAccessOpen(true)
          }}
          onConnectGit={(project) => {
            setGitSettingsProjectId(project.id)
          }}
          onEditGit={(project) => {
            setGitSettingsProjectId(project.id)
          }}
          onDisconnectGit={(project) => setDisconnectProject(project)}
          onDeleteProject={(project) => setDeleteProject(project)}
        />
      )}

      <ProjectOverviewModals
        batchDeleteIds={batchDeleteIds}
        busy={busy}
        onCancelBatchDelete={() => {
          if (busy) return
          setBatchDeleteIds(null)
        }}
        onConfirmBatchDelete={handleBatchDelete}
        deleteProject={deleteProject}
        onCancelDeleteProject={() => !busy && setDeleteProject(null)}
        onConfirmDeleteProject={async () => {
          if (!deleteProject) return
          try {
            setBusy(true)
            await apiClient.delete(`/starbase-api/projects/${deleteProject.id}`)
            await qc.invalidateQueries({ queryKey: ['starbase', 'projects'] })
          } catch {} finally {
            setBusy(false)
            setDeleteProject(null)
          }
        }}
        disconnectProject={disconnectProject}
        onCancelDisconnectProject={() => !busy && setDisconnectProject(null)}
        onConfirmDisconnectProject={handleDisconnectFromGit}
        createOnlineModalOpen={createOnlineModal.isOpen}
        onCloseCreateOnlineModal={() => createOnlineModal.closeModal()}
        existingProjectId={onlineProjectContext?.id}
        existingProjectName={onlineProjectContext?.name}
        engineAccessOpen={engineAccessOpen}
        onCloseEngineAccess={() => {
          setEngineAccessOpen(false)
          setEngineAccessProject(null)
          setSelectedEngineForRequest(null)
        }}
        engineAccessQ={engineAccessQ}
        canManageMembers={canManageMembers}
        myMembershipLoading={myMembershipQ.isLoading}
        selectedEngineForRequest={selectedEngineForRequest}
        setSelectedEngineForRequest={setSelectedEngineForRequest}
        requestEngineAccessM={requestEngineAccessM}
      />

      {/* Project Git Settings modal (new project-level connection) */}
      {gitSettingsProjectId && (
        <ProjectGitSettings
          projectId={gitSettingsProjectId}
          open={!!gitSettingsProjectId}
          onClose={() => setGitSettingsProjectId(null)}
        />
      )}

      </div>
    </div>
    </>
  )
}
