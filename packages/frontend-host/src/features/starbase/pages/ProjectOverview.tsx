import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { useAuth } from '../../../shared/hooks/useAuth'
import { syncProjectBatch } from '../../git/api/syncProject'
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions'
import { getBrowserSessionRevision } from '../../../utils/browserSession'
import { gitApi } from '../../git/api/gitApi'
import { projectsApi } from '../../../api/starbase/projects'
import { StarbaseTableShell } from '../components/StarbaseTableShell'
import { apiClient } from '../../../shared/api/client'
import { fetchList } from '../../../shared/api/fetchList';
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings'
import { ProjectOverviewTable } from './components/ProjectOverviewTable'
import { ProjectOverviewBulkSyncModal } from './components/ProjectOverviewBulkSyncModal'
import { ProjectOverviewModals } from './components/ProjectOverviewModals'
import DeployDialog from '../../git/components/DeployDialog'
import { ProjectGitSettings } from '../../git/components/ProjectGitSettings'
import { requestEngineProjectAccess } from '../../mission-control/engines/api/engines'
import type { Project, SyncDirection, BulkSyncResult } from './projectOverviewTypes'
import type { ProjectOverviewBulkAction, ProjectOverviewRowAction } from './components/ProjectOverviewTable'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'
import type { ProjectMemberAccessView } from '@enterpriseglue/shared/schemas/platform-admin/project-member.js'
import { hasConnectedEngine } from '../utils/deployEligibility'
import { PlatformPermission, ProjectPermission } from '../../../shared/auth/permissions'
import { evaluateActionSnapshot } from '../../../shared/auth/guards'
import styles from './ProjectOverview.module.css'

function getProjectOverviewRowActionPermission(action: ProjectOverviewRowAction): string | null {
  switch (action) {
    case 'rename':
      return ProjectPermission.PROJECT_SETTINGS
    case 'download':
    case 'connectEngines':
      return ProjectPermission.FILES_VIEW
    case 'connectGit':
    case 'editGit':
    case 'disconnectGit':
      return ProjectPermission.GIT_CONNECT
    case 'delete':
      return ProjectPermission.PROJECT_DELETE
    case 'open':
    default:
      return null
  }
}

function getProjectOverviewRowActionId(action: ProjectOverviewRowAction): string | null {
  switch (action) {
    case 'rename':
      return 'project.projects.update'
    case 'download':
      return 'project.files.read'
    case 'connectEngines':
      return 'project.deployment-options.read'
    case 'connectGit':
    case 'editGit':
    case 'disconnectGit':
      return 'project.git.repositories.manage'
    case 'delete':
      return 'project.projects.delete'
    case 'open':
    default:
      return null
  }
}

function getProjectOverviewBulkActionPermissions(action: ProjectOverviewBulkAction, pushEnabled: boolean, pullEnabled: boolean): string[] {
  switch (action) {
    case 'sync':
      return [
        ...(pushEnabled ? [ProjectPermission.GIT_PUSH] : []),
        ...(pullEnabled ? [ProjectPermission.GIT_PULL] : []),
      ]
    case 'deploy':
      return [ProjectPermission.DEPLOY]
    case 'delete':
      return [ProjectPermission.PROJECT_DELETE]
    default:
      return []
  }
}

function getProjectOverviewBulkActionPastTense(action: ProjectOverviewBulkAction): string {
  if (action === 'sync') return 'synced'
  if (action === 'deploy') return 'deployed'
  return 'deleted'
}

function getProjectOverviewBulkActionId(action: ProjectOverviewBulkAction): string {
  if (action === 'sync') return 'project.git.sync.run'
  if (action === 'deploy') return 'project.deploy.create'
  return 'project.projects.delete'
}

type BulkPermissionDenial = {
  project: Project
  permissionId: string
  reason: string
}

type ProjectPermissionPredicate = (project: Project, permissionId: string) => boolean

export function getBulkPermissionDenial(
  projects: Project[],
  action: ProjectOverviewBulkAction,
  permissionIds: string[],
  membershipByProjectId: Map<string, ProjectMemberAccessView | null | undefined>,
  hasProjectPermissionForProject?: ProjectPermissionPredicate
): BulkPermissionDenial | null {
  if (projects.length === 0 || permissionIds.length === 0) return null

  const denied = projects.flatMap((project) => {
    const membership = membershipByProjectId.get(project.id)
    const membershipPending = membership === undefined
    const hasAnyRequiredPermission = permissionIds.some((permission) =>
      hasProjectPermissionForProject?.(project, permission)
    )
    if (!hasAnyRequiredPermission && membershipPending) return []
    return hasAnyRequiredPermission ? [] : [{ project, permissionId: permissionIds[0] }]
  })

  if (denied.length === 0) return null
  const permissionText = permissionIds.length === 1 ? permissionIds[0] : permissionIds.join(' or ')
  const projectText = denied.length === 1 ? 'project' : 'projects'
  return {
    project: denied[0].project,
    permissionId: denied[0].permissionId,
    reason: `Unavailable: ${denied.length} of ${projects.length} selected ${projectText} cannot be ${getProjectOverviewBulkActionPastTense(action)}. First reason: missing permission ${permissionText}.`,
  }
}

function getBulkPermissionReason(
  projects: Project[],
  action: ProjectOverviewBulkAction,
  permissionIds: string[],
  membershipByProjectId: Map<string, ProjectMemberAccessView | null | undefined>,
  hasProjectPermissionForProject?: ProjectPermissionPredicate
): string | null {
  return getBulkPermissionDenial(
    projects,
    action,
    permissionIds,
    membershipByProjectId,
    hasProjectPermissionForProject
  )?.reason ?? null
}

function buildProjectOverviewBulkDiagnosticDecision(
  projects: Project[],
  action: ProjectOverviewBulkAction,
  reason: string | null | undefined,
  permissionIds: string[],
  membershipByProjectId: Map<string, ProjectMemberAccessView | null | undefined>,
  hasProjectPermissionForProject?: ProjectPermissionPredicate
): UiAuthzDecision | null {
  if (!reason || projects.length === 0) return null

  const permissionDenial = getBulkPermissionDenial(
    projects,
    action,
    permissionIds,
    membershipByProjectId,
    hasProjectPermissionForProject
  )
  const project = permissionDenial?.project ?? projects[0]
  const permissionId = permissionDenial?.permissionId ?? permissionIds[0] ?? (
    action === 'deploy' ? ProjectPermission.DEPLOY :
    action === 'delete' ? ProjectPermission.PROJECT_DELETE :
    ProjectPermission.GIT_PUSH
  )

  return {
    actionId: getProjectOverviewBulkActionId(action),
    allowed: false,
    diagnostics: {
      explainUrl: '/admin/access-control?tab=effective-access',
      remediation: ['Ask a platform administrator to review effective access.'],
    },
    permissionId,
    reason,
    resourceId: project.id,
    resourceType: 'project',
    state: 'disabled',
  }
}

function getProjectSyncPermissionForDirection(direction: SyncDirection): string {
  return direction === 'pull' ? ProjectPermission.GIT_PULL : ProjectPermission.GIT_PUSH
}

export default function ProjectOverview() {
  const nav = useNavigate()
  const location = useLocation()
  const { pathname } = location
  const { hasPlatformPermission, hasProjectPermission, permissions, user, sessionRevision } = useAuth()
  const authority = JSON.stringify([user?.session?.principal.id || user?.id || null, user?.session?.tenant.id || null, sessionRevision ?? null, permissionSnapshotAuthorityKey(permissions)])

  const authoritySession = React.useRef({ authority, revision: getBrowserSessionRevision() })
  if (authoritySession.current.authority !== authority) authoritySession.current = { authority, revision: getBrowserSessionRevision() }

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
    queryFn: () => fetchList<Project>('/starbase-api/projects'),
    staleTime: 60 * 1000,
  })

  const projectIds = React.useMemo(() => {
    const ids = (q.data || []).map((p) => p.id).filter(Boolean)
    ids.sort()
    return ids
  }, [q.data])
  const canReadProjectVcsStatus = React.useCallback((projectId: string) => (
    evaluateActionSnapshot(
      permissions,
      'project.vcs.status.read',
      { type: 'project', id: projectId }
    ).allowed || hasProjectPermission(projectId, ProjectPermission.FILES_VIEW)
  ), [hasProjectPermission, permissions])
  const vcsStatusProjectIds = React.useMemo(() => (
    projectIds.filter((projectId) => canReadProjectVcsStatus(projectId))
  ), [canReadProjectVcsStatus, projectIds])

  const projectStatusQ = useQuery({
    queryKey: ['vcs', 'uncommitted-status', 'projects', vcsStatusProjectIds.join(',')],
    queryFn: () => apiClient.get<{ statuses: Record<string, { hasUncommittedChanges: boolean; dirtyFileCount: number }> }>(
      '/vcs-api/projects/uncommitted-status',
      { projectIds: vcsStatusProjectIds.join(',') }
    ),
    enabled: vcsStatusProjectIds.length > 0,
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
    queryKey: ['git', 'credentials', authority],
    queryFn: async () => {
      const data = await fetchList<any>('/git-api/credentials').catch(() => [])
      return Array.isArray(data) ? data : []
    },
    staleTime: 30 * 1000,
  })

  const membershipQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ['project-members', projectId, 'me'],
      queryFn: () => projectsApi.getMyMembership(projectId),
      enabled: !!projectId,
      staleTime: 60 * 1000,
    })),
  })

  const engineAccessQueries = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: ['project-engine-access', projectId],
      queryFn: () => projectsApi.getEngineAccess(projectId),
      enabled: !!projectId,
      staleTime: 30 * 1000,
    })),
  })

  const [deleteProject, setDeleteProject] = React.useState<Project | null>(null)
  const [batchDeleteIds, setBatchDeleteIds] = React.useState<string[] | null>(null)
  const [batchCancelSelection, setBatchCancelSelection] = React.useState<null | (() => void)>(null)
  const [disconnectProject, setDisconnectProject] = React.useState<Project | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [deployProjectId, setDeployProjectId] = React.useState<string | null>(null)
  const [deployCancelSelection, setDeployCancelSelection] = React.useState<null | (() => void)>(null)
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
  const bulkSyncProjects = React.useMemo(() => (
    (q.data || []).filter((project) => bulkSyncIds.includes(project.id))
  ), [bulkSyncIds, q.data])

  const bulkScope = JSON.stringify([isBulkSyncOpen, bulkSyncIds, bulkDirection, bulkMessage, authority, canBulkSync, pushEnabled, pullEnabled,
    bulkSyncProjects.map(project => [project.id, project.gitUrl, hasProjectPermission(project.id, bulkDirection === 'pull' ? ProjectPermission.GIT_PULL : ProjectPermission.GIT_PUSH)])])
  const bulkScopeRef = React.useRef(bulkScope), bulkLifetimeRef = React.useRef(0), bulkActiveRef = React.useRef<number | null>(null), bulkSubmittedRef = React.useRef<number | null>(null)
  if (bulkScopeRef.current !== bulkScope) { bulkScopeRef.current = bulkScope; bulkLifetimeRef.current += 1 }
  const bulkMountedRef = React.useRef(true)
  const bulkRenderedSession = authoritySession.current.revision
  React.useEffect(() => { bulkMountedRef.current = true; return () => { bulkMountedRef.current = false; bulkLifetimeRef.current += 1 } }, [])

  const ownsBulkAttempt = bulkSubmittedRef.current === bulkLifetimeRef.current

  const closeBulkSync = React.useCallback(() => {
    bulkLifetimeRef.current += 1
    setIsBulkSyncOpen(false)
    setBulkBusy(false)
    setBulkError(null)
    setBulkResult(null)
    setBulkSyncIds([])
    setBulkCancelSelection(null)
    setBulkMessage('')
  }, [])
  const previousAuthorityRef = React.useRef(authority)
  React.useEffect(() => {
    if (previousAuthorityRef.current !== authority) { previousAuthorityRef.current = authority; closeBulkSync() }
  }, [authority, closeBulkSync])

  const runBulkSync = async () => {
    if (!bulkMountedRef.current || bulkScope !== bulkScopeRef.current || !isBulkSyncOpen || (ownsBulkAttempt && bulkBusy) || bulkActiveRef.current === bulkLifetimeRef.current || bulkRenderedSession !== getBrowserSessionRevision()) return
    bulkSubmittedRef.current = bulkLifetimeRef.current
    if (!canBulkSync || credentialsCheckLoading) { setBulkError('Git credentials required. Connect your Git credentials to sync.'); return }
    if (bulkSyncUnavailableReason) { setBulkError(bulkSyncUnavailableReason); return }
    const message = bulkMessage.trim()
    if (!message) { setBulkError('Commit message is required'); return }
    const selected = (q.data || []).filter(project => bulkSyncIds.includes(project.id))
    if (!selected.length || (bulkDirection === 'push' ? !pushEnabled : !pullEnabled)) return
    const lifetime = bulkLifetimeRef.current, session = bulkRenderedSession
    const isCurrent = () => bulkMountedRef.current && lifetime === bulkLifetimeRef.current && session === getBrowserSessionRevision()
    const check = () => { if (!isCurrent()) throw new Error('Sync context changed; review the target again') }
    bulkActiveRef.current = lifetime
    setBulkBusy(true); setBulkError(null); setBulkResult(null)
    try {
      const result = await syncProjectBatch(selected, { direction: bulkDirection, message }, check)
      check(); setBulkResult(result)
      if (selected.some(project => !!project.gitUrl)) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['starbase', 'projects'] }),
          qc.invalidateQueries({ queryKey: ['vcs', 'uncommitted-status'] }),
          qc.invalidateQueries({ queryKey: ['git'] }),
        ])
        check()
      }
      if (!result.failed.length && !result.skipped.length) {
        bulkCancelSelection?.()
        check(); closeBulkSync()
      }
    } catch (failure) {
      if (isCurrent()) setBulkError(parseApiError(failure, 'Sync failed').message)
    } finally {
      if (isCurrent()) { setBulkBusy(false); bulkActiveRef.current = null }
    }
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
    scopeKey: authority,
    type: 'project',
    queryKey: ['starbase', 'projects']
  })

  const items = React.useMemo(() => {
    if (!q.data) return []
    const needle = query.trim().toLowerCase()
    return q.data.filter(p => !needle || p.name.toLowerCase().includes(needle))
  }, [q.data, query])

  const deployableProjectIdsSet = React.useMemo(() => {
    const ids = new Set<string>()
    projectIds.forEach((projectId, index) => {
      const canDeploy = evaluateActionSnapshot(
        permissions,
        'project.deploy.create',
        { type: 'project', id: projectId }
      ).allowed || hasProjectPermission(projectId, ProjectPermission.DEPLOY)
      if (canDeploy && hasConnectedEngine(engineAccessQueries[index]?.data)) {
        ids.add(projectId)
      }
    })
    return ids
  }, [engineAccessQueries, hasProjectPermission, permissions, projectIds])

  const membershipByProjectId = React.useMemo(() => {
    const memberships = new Map<string, ProjectMemberAccessView | null | undefined>()
    projectIds.forEach((projectId, index) => {
      memberships.set(projectId, membershipQueries[index]?.data)
    })
    return memberships
  }, [membershipQueries, projectIds])

  const createProjectDecision = evaluateActionSnapshot(
    permissions,
    'project.projects.create',
    { type: 'platform' }
  )
  const createProjectUnavailableReason = createProjectDecision.allowed || hasPlatformPermission(PlatformPermission.PROJECT_CREATE)
    ? null
    : `Missing permission ${PlatformPermission.PROJECT_CREATE}`

  const getProjectRowActionUnavailableReason = React.useCallback((project: Project, action: ProjectOverviewRowAction): string | null => {
    const permission = getProjectOverviewRowActionPermission(action)
    if (!permission) return null
    const actionId = getProjectOverviewRowActionId(action)
    if (actionId && evaluateActionSnapshot(
      permissions,
      actionId,
      { type: 'project', id: project.id }
    ).allowed) return null
    if (hasProjectPermission(project.id, permission)) return null
    return `Missing permission ${permission}`
  }, [hasProjectPermission, permissions])

  const gitSettingsCanManageConnection = React.useMemo(() => {
    if (!gitSettingsProjectId) return false
    if (hasProjectPermission(gitSettingsProjectId, ProjectPermission.GIT_CONNECT)) return true
    return false
  }, [gitSettingsProjectId, hasProjectPermission])

  const hasProjectPermissionForProject = React.useCallback((project: Project, permission: string) => (
    hasProjectPermission(project.id, permission)
  ), [hasProjectPermission])

  const hasProjectActionOrPermission = React.useCallback((
    project: Project,
    actionId: string,
    permission: string
  ) => {
    const decision = evaluateActionSnapshot(permissions, actionId, { type: 'project', id: project.id })
    if (actionId === 'project.git.sync.run') {
      const availability = permissions?.projects?.find(entry => entry.resourceId === project.id)?.actionAvailability
      if (availability?.restrictions[actionId] && !availability.allowedActions.includes(actionId)) return false
      if (permission === ProjectPermission.GIT_PULL) return hasProjectPermissionForProject(project, permission)
    }
    return decision.allowed || hasProjectPermissionForProject(project, permission)
  }, [hasProjectPermissionForProject, permissions])

  const getProjectBulkActionUnavailableReason = React.useCallback((projects: Project[], action: ProjectOverviewBulkAction): string | null => {
    const permissionIds = getProjectOverviewBulkActionPermissions(action, pushEnabled, pullEnabled)
    const actionId = getProjectOverviewBulkActionId(action)
    return getBulkPermissionReason(
      projects,
      action,
      permissionIds,
      membershipByProjectId,
      (project, permission) => hasProjectActionOrPermission(project, actionId, permission)
    )
  }, [hasProjectActionOrPermission, membershipByProjectId, pullEnabled, pushEnabled])

  const getProjectBulkActionDiagnosticDecision = React.useCallback((
    projects: Project[],
    action: ProjectOverviewBulkAction,
    reason?: string | null
  ): UiAuthzDecision | null => {
    const permissionIds = getProjectOverviewBulkActionPermissions(action, pushEnabled, pullEnabled)
    const actionId = getProjectOverviewBulkActionId(action)
    return buildProjectOverviewBulkDiagnosticDecision(
      projects,
      action,
      reason,
      permissionIds,
      membershipByProjectId,
      (project, permission) => hasProjectActionOrPermission(project, actionId, permission)
    )
  }, [hasProjectActionOrPermission, membershipByProjectId, pullEnabled, pushEnabled])

  const bulkSyncUnavailableReason = React.useMemo(() => {
    if (bulkSyncProjects.length === 0) return null
    if (!anySyncEnabled) return 'Sync is disabled by platform settings'
    if (bulkDirection === 'push' && !pushEnabled) return 'Git push is disabled by platform settings'
    if (bulkDirection === 'pull' && !pullEnabled) return 'Git pull is disabled by platform settings'
    const required = getProjectSyncPermissionForDirection(bulkDirection)
    // Membership presentation may still be loading; it cannot override a known
    // action restriction or missing directional permission at dispatch.
    if (bulkSyncProjects.some(project => !hasProjectActionOrPermission(project, 'project.git.sync.run', required))) return `Missing permission ${required} or sync is restricted for a selected project`

    const permissionId = getProjectSyncPermissionForDirection(bulkDirection)
    return getBulkPermissionReason(
      bulkSyncProjects,
      'sync',
      [permissionId],
      membershipByProjectId,
      (project, permission) => hasProjectActionOrPermission(project, 'project.git.sync.run', permission)
    )
  }, [
    anySyncEnabled,
    bulkDirection,
    bulkSyncProjects,
    hasProjectActionOrPermission,
    membershipByProjectId,
    pullEnabled,
    pushEnabled,
  ])

  const bulkSyncDiagnosticDecision = React.useMemo(() => {
    if (!bulkSyncUnavailableReason || bulkSyncProjects.length === 0) return null
    const permissionId = getProjectSyncPermissionForDirection(bulkDirection)
    return buildProjectOverviewBulkDiagnosticDecision(
      bulkSyncProjects,
      'sync',
      bulkSyncUnavailableReason,
      [permissionId],
      membershipByProjectId,
      (project, permission) => hasProjectActionOrPermission(project, 'project.git.sync.run', permission)
    )
  }, [
    bulkDirection,
    bulkSyncProjects,
    bulkSyncUnavailableReason,
    hasProjectActionOrPermission,
    membershipByProjectId,
  ])

  const openCreateProject = React.useCallback(() => {
    if (createProjectUnavailableReason) return
    setOnlineProjectContext(null)
    createOnlineModal.openModal()
  }, [createOnlineModal, createProjectUnavailableReason])

  const engineAccessQ = useQuery({
    queryKey: ['project-engine-access', engineAccessProject?.id],
    queryFn: () => projectsApi.getEngineAccess(String(engineAccessProject?.id)),
    enabled: engineAccessOpen && !!engineAccessProject?.id,
  })

  const canRequestEngineAccess = React.useMemo(() => {
    if (!engineAccessProject?.id) return false
    const requestAccessDecision = evaluateActionSnapshot(
      permissions,
      'project-engine-target.access.request',
      { type: 'project', id: engineAccessProject.id }
    )
    if (requestAccessDecision.allowed) return true
    return hasProjectPermission(engineAccessProject.id, ProjectPermission.PROJECT_SETTINGS)
  }, [engineAccessProject?.id, hasProjectPermission, permissions])
  const requestEngineAccessUnavailableReason = canRequestEngineAccess
    ? null
    : evaluateActionSnapshot(
      permissions,
      'project-engine-target.access.request',
      { type: 'project', id: engineAccessProject?.id || null }
    ).reason || `Missing permission ${ProjectPermission.PROJECT_SETTINGS}`

  const requestEngineAccessM = useMutation({
    mutationFn: async (engineId: string) => {
      if (!engineAccessProject?.id) return { autoApproved: false }
      return requestEngineProjectAccess(engineId, engineAccessProject.id)
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
        bulkBusy={ownsBulkAttempt && bulkBusy}
        bulkError={ownsBulkAttempt ? bulkError : null}
        bulkResult={ownsBulkAttempt ? bulkResult : null}
        bulkMessage={bulkMessage}
        setBulkMessage={setBulkMessage}
        bulkDirection={bulkDirection}
        setBulkDirection={setBulkDirection}
        bulkSyncIds={bulkSyncIds}
        canBulkSync={canBulkSync}
        bulkSyncUnavailableReason={bulkSyncUnavailableReason}
        bulkSyncDiagnosticDecision={bulkSyncDiagnosticDecision}
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
        <NoDataState resource="project" onCreate={createProjectUnavailableReason ? undefined : openCreateProject} />
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
          onOpenNewProject={openCreateProject}
          onBulkSync={(ids, cancelSelection) => {
            setBulkCancelSelection(() => cancelSelection)
            setBulkSyncIds(ids)
            setIsBulkSyncOpen(true)
          }}
          onBatchDeploy={(projectId, cancelSelection) => {
            setDeployProjectId(projectId)
            setDeployCancelSelection(() => cancelSelection)
          }}
          onBatchDelete={(ids, cancelSelection) => {
            setBatchCancelSelection(() => cancelSelection)
            setBatchDeleteIds(ids)
          }}
          deployableProjectIdsSet={deployableProjectIdsSet}
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
          createProjectUnavailableReason={createProjectUnavailableReason}
          getRowActionUnavailableReason={getProjectRowActionUnavailableReason}
          getBulkActionUnavailableReason={getProjectBulkActionUnavailableReason}
          getBulkActionDiagnosticDecision={getProjectBulkActionDiagnosticDecision}
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
        canRequestEngineAccess={canRequestEngineAccess}
        requestEngineAccessUnavailableReason={requestEngineAccessUnavailableReason}
        myMembershipLoading={engineAccessQ.isLoading}
        selectedEngineForRequest={selectedEngineForRequest}
        setSelectedEngineForRequest={setSelectedEngineForRequest}
        requestEngineAccessM={requestEngineAccessM}
      />

      {deployProjectId && (
        <DeployDialog
          projectId={deployProjectId}
          open={!!deployProjectId}
          onClose={() => {
            setDeployProjectId(null)
            setDeployCancelSelection(null)
          }}
          onDeploySuccess={() => {
            deployCancelSelection?.()
            setDeployProjectId(null)
            setDeployCancelSelection(null)
          }}
        />
      )}

      {/* Project Git Settings modal (new project-level connection) */}
      {gitSettingsProjectId && (
        <ProjectGitSettings
          projectId={gitSettingsProjectId}
          open={!!gitSettingsProjectId}
          onClose={() => setGitSettingsProjectId(null)}
          canManageConnection={gitSettingsCanManageConnection}
          manageConnectionUnavailableReason={gitSettingsCanManageConnection ? null : `Missing permission ${ProjectPermission.GIT_CONNECT}`}
        />
      )}

      </div>
    </div>
    </>
  )
}
