import React from 'react'
import { useParams, useLocation, useSearchParams } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { sanitizePathParam } from '../../../shared/utils/sanitize'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../shared/hooks/useAuth'
import {
  Button,
  DataTableSkeleton,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Dropdown,
  Checkbox,
  InlineLoading,
  Toggletip,
  ToggletipButton,
  ToggletipContent,
  TextInput,
  ComposedModal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  InlineNotification,
} from '@carbon/react'
import { Upload, Add, CloudUpload, TrashCan, Commit, Events, IbmWatsonMachineLearning, Renew, Information } from '@carbon/icons-react'
import { BreadcrumbItem } from '@carbon/react'
import { BreadcrumbBar } from '../../shared/components/BreadcrumbBar'
import ConfirmDeleteModal from '../../shared/components/ConfirmDeleteModal'
import { useModal } from '../../../shared/hooks/useModal'
import { ErrorState } from '../../shared/components'
import { ProjectAccessError, isProjectAccessError } from '../components/ProjectAccessError'
import { validateAndUploadFile } from '../utils/uploadValidation'
import { useInlineRename } from '../hooks/useInlineRename'
import DeployDialog from '../../git/components/DeployDialog'
import SyncModal from '../../git/components/SyncModal'
import { ProjectGitSettings } from '../../git/components/ProjectGitSettings'
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings'
import { apiClient } from '../../../shared/api/client'
import { getAccessibleEngines, requestEngineProjectAccess } from '../../mission-control/engines/api/engines'
import { filesApi } from '../../../api/starbase/files'
import { foldersApi } from '../../../api/starbase/folders'
import { projectsApi } from '../../../api/starbase/projects'
import { PlatformPermission, ProjectPermission } from '../../../shared/auth/permissions'
import { evaluateActionSnapshot } from '../../../shared/auth/guards'
import { useSelectedEngine } from '../../../components/EngineSelector'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { useToast } from '../../../shared/notifications/ToastProvider'
import { StarbaseTableShell } from '../components/StarbaseTableShell'
import {
  ProjectContentsTable,
  type ProjectDetailBulkAction,
  type ProjectDetailRowAction,
  type ProjectDetailToolbarAction,
} from './components/ProjectContentsTable'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'
import type {
  AuthzGroup as SharedAuthzGroup,
  AuthzGroupMembership as SharedAuthzGroupMembership,
  AuthzPrincipalType as SharedAuthzPrincipalType,
  RoleAssignmentCreate,
  RoleAssignmentCreateResponse,
  RoleAssignment as SharedRoleAssignment,
  RoleSummary as SharedRoleSummary,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js'
import {
  EditableProjectRoleSchema,
  type EditableProjectRole,
} from '@enterpriseglue/shared/schemas/platform-admin/project-member.js'
import { ProjectMembersModal } from './components/ProjectMembersModal'
import { ProjectMembersManagementModals, type ProjectScopedCustomRole } from './components/ProjectMembersManagementModals'
import { ProjectDetailHeader } from './components/ProjectDetailHeader'
import { downloadBlob, toSafeDownloadFilename, toSafeDownloadFilenameWithExtension } from '../../../utils/safeDom'
import { renderDiagramToPdf } from '../utils/renderDiagramToPdf'

// Import extracted utilities and components
import {
  FileItem,
  Project,
  UserSearchItem,
  FolderSummary,
  ProjectRole,
  ProjectMember,
  ProjectPendingInvite,
  COLLABORATORS_PANEL_WIDTH,
  memberHeaders,
  tagTypeForRole,
  tableHeaders,
  isValidEmail,
  getFileIcon,
} from '../components/project-detail/project-detail-utils'
import { EngineAccessModal } from '../components/project-detail/EngineAccessModal'
import { ProjectDeploymentTargetsModal } from '../components/project-detail/ProjectDeploymentTargetsModal'
import { FolderLoader, CurrentPath, TreePicker } from '../components/project-detail/FolderTreeHelpers'

/** Project ownership changes only through the dedicated ownership-transfer flow. */
function editableProjectRoles(roles: readonly ProjectRole[]): EditableProjectRole[] {
  return roles.flatMap((projectRole) => {
    const parsed = EditableProjectRoleSchema.safeParse(projectRole)
    return parsed.success ? [parsed.data] : []
  })
}

function getProjectDetailBulkActionId(action: ProjectDetailBulkAction): string {
  if (action === 'download') return 'project.files.read'
  if (action === 'delete') return 'project.files.delete'
  if (action === 'move') return 'project.files.update'
  if (action === 'sync') return 'project.git.sync.run'
  return 'project.deploy.create'
}

function getProjectDetailBulkActionPermission(action: ProjectDetailBulkAction, syncPermissions: string[]): string {
  if (action === 'download') return ProjectPermission.FILES_VIEW
  if (action === 'delete') return ProjectPermission.FILES_DELETE
  if (action === 'move') return ProjectPermission.FILES_EDIT
  if (action === 'sync') return syncPermissions[0] ?? ProjectPermission.GIT_PUSH
  return ProjectPermission.DEPLOY
}

function buildProjectDetailBulkDiagnosticDecision(
  projectId: string,
  action: ProjectDetailBulkAction,
  reason: string | null | undefined,
  syncPermissions: string[]
): UiAuthzDecision | null {
  if (!reason) return null

  return {
    actionId: getProjectDetailBulkActionId(action),
    allowed: false,
    diagnostics: {
      explainUrl: '/admin/access-control?tab=effective-access',
      remediation: ['Ask a platform administrator to review effective access.'],
    },
    permissionId: getProjectDetailBulkActionPermission(action, syncPermissions),
    reason,
    resourceId: projectId,
    resourceType: 'project',
    state: 'disabled',
  }
}

function getProjectDetailToolbarActionId(action: ProjectDetailToolbarAction): string {
  if (action === 'members') return 'project.members.read'
  if (action === 'engineAccess') return 'project.deployment-options.read'
  return 'project.files.create'
}

function getProjectDetailToolbarActionPermission(action: ProjectDetailToolbarAction): string {
  if (action === 'members') return ProjectPermission.MEMBERS_VIEW
  if (action === 'engineAccess') return ProjectPermission.FILES_VIEW
  return ProjectPermission.FILES_CREATE
}

function buildProjectDetailToolbarDiagnosticDecision(
  projectId: string,
  action: ProjectDetailToolbarAction,
  reason: string | null | undefined
): UiAuthzDecision | null {
  if (!reason) return null

  return {
    actionId: getProjectDetailToolbarActionId(action),
    allowed: false,
    diagnostics: {
      explainUrl: '/admin/access-control?tab=effective-access',
      remediation: ['Ask a platform administrator to review effective access.'],
    },
    permissionId: getProjectDetailToolbarActionPermission(action),
    reason,
    resourceId: projectId,
    resourceType: 'project',
    state: 'disabled',
  }
}

type ScopedProjectRoleAssignment = SharedRoleAssignment
type ProjectAssignmentPrincipalType = SharedAuthzPrincipalType

type ProjectAuthzGroupSummary = SharedAuthzGroup
type ProjectAuthzGroupMembershipSummary = SharedAuthzGroupMembership

export function formatProjectRoleAssignmentSourceLineage(assignment: Pick<ScopedProjectRoleAssignment, 'source' | 'sourceRef' | 'sourceMappingId'> | null | undefined): string {
  if (!assignment) return '-'
  const sourceLabel = assignment.source === 'sso'
    ? 'SSO-managed assignment'
    : assignment.source === 'manual'
      ? 'Manual assignment'
      : assignment.source === 'system'
        ? 'System-managed assignment'
        : assignment.source === 'api'
          ? 'API-managed assignment'
          : assignment.source === 'legacy'
            ? 'Legacy-derived assignment'
            : `${assignment.source} assignment`
  const parts = [sourceLabel]
  if (assignment.sourceRef) parts.push(`Source ref ${assignment.sourceRef}`)
  if (assignment.sourceMappingId && assignment.sourceMappingId !== assignment.sourceRef) {
    parts.push(`${assignment.source === 'sso' ? 'SSO mapping' : 'Mapping'} ${assignment.sourceMappingId}`)
  }
  return parts.join('; ')
}

function formatProjectGroupLabel(group: Pick<ProjectAuthzGroupSummary, 'id' | 'key' | 'name'> | null | undefined, groupId: string | null | undefined): string {
  return group?.name || group?.key || groupId || 'unknown group'
}

function formatProjectGroupMembershipSourceLineage(membership: Pick<ProjectAuthzGroupMembershipSummary, 'source' | 'sourceRef'> | null | undefined): string {
  if (!membership) return 'Group membership lineage unavailable'
  const sourceLabel = membership.source === 'sso'
    ? 'SSO group membership'
    : membership.source === 'manual'
      ? 'Manual group membership'
      : membership.source === 'api'
        ? 'API-managed group membership'
        : membership.source === 'automation'
          ? 'Automation-managed group membership'
          : membership.source === 'system'
            ? 'System-managed group membership'
            : `${membership.source || 'unknown'} group membership`
  return membership.sourceRef ? `${sourceLabel}; Membership source ref ${membership.sourceRef}` : sourceLabel
}

export function formatProjectInheritedRoleAssignmentSourceLineage(
  assignment: Pick<ScopedProjectRoleAssignment, 'source' | 'sourceRef' | 'sourceMappingId' | 'principalId' | 'userId'> | null | undefined,
  membership: Pick<ProjectAuthzGroupMembershipSummary, 'source' | 'sourceRef'> | null | undefined,
  group?: Pick<ProjectAuthzGroupSummary, 'id' | 'key' | 'name'> | null
): string {
  if (!assignment) return '-'
  const groupId = assignment.principalId || assignment.userId || null
  return [
    formatProjectRoleAssignmentSourceLineage(assignment),
    `Inherited through group ${formatProjectGroupLabel(group, groupId)}`,
    formatProjectGroupMembershipSourceLineage(membership),
  ].join('; ')
}

export default function ProjectDetail() {
  const { projectId } = useParams()
  const location = useLocation() as { state?: { name?: string } }
  const { tenantNavigate, toTenantPath, navigate } = useTenantNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = React.useState('')
  const queryClient = useQueryClient()
  const { user, hasPlatformPermission, hasProjectPermission, permissions } = useAuth()
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)
  // Modal hooks
  const deleteFileModal = useModal<FileItem>()
  const newFolderModal = useModal()
  const createFileModal = useModal<'bpmn' | 'dmn'>()
  const deleteFolderModal = useModal<{ id: string; name: string; preview?: { folderCount: number; fileCount: number; filesByType: { bpmn: number; dmn: number; other: number }; samplePaths: string[] } }>()
  const moveModal = useModal<{ id: string; name: string; type: 'folder' | 'file' | 'files'; ids?: string[] }>()
  const deployModal = useModal()
  const syncModal = useModal()
  const [gitSettingsOpen, setGitSettingsOpen] = React.useState(false)
  const [deploymentTargetsOpen, setDeploymentTargetsOpen] = React.useState(false)
  const [batchDeleteIds, setBatchDeleteIds] = React.useState<string[] | null>(null)
  const [batchCancelSelection, setBatchCancelSelection] = React.useState<null | (() => void)>(null)
  const [batchMoveIds, setBatchMoveIds] = React.useState<string[] | null>(null)

  const [busy, setBusy] = React.useState(false)
  const [newFolderName, setNewFolderName] = React.useState('')
  const folderId = searchParams.get('folder') || null
  const [newFileName, setNewFileName] = React.useState('')
  const [moveTarget, setMoveTarget] = React.useState<string | 'ROOT'>('ROOT')
  const [allFolders, setAllFolders] = React.useState<FolderSummary[] | null>(null)
  // deployModal hook defined above
  const selectedEngineId = useSelectedEngine()
  const [deployEngineId, setDeployEngineId] = React.useState<string | undefined>(undefined)
  const [deployScope, setDeployScope] = React.useState<'project'|'folder'|'files'>('project')
  const [deployRecursive, setDeployRecursive] = React.useState(true)
  const [deployName, setDeployName] = React.useState('')
  const [deployBusy, setDeployBusy] = React.useState(false)
  const [deployBusyLabel, setDeployBusyLabel] = React.useState<string>('')
  const [pushToGit, setPushToGit] = React.useState(false)
  const [gitCommitMessage, setGitCommitMessage] = React.useState('')
  const [selectedAtOpen, setSelectedAtOpen] = React.useState<string[]>([])
  const [selectedFolderAtOpen, setSelectedFolderAtOpen] = React.useState<string | null>(null)
  const [deployStage, setDeployStage] = React.useState<'config'|'preview'>('config')
  const [previewData, setPreviewData] = React.useState<null | { count: number; resources: string[]; warnings: string[]; errors?: string[] }>(null)
  const [previewBusy, setPreviewBusy] = React.useState(false)
  const { notify } = useToast()

  const [collaboratorsOpen, setCollaboratorsOpen] = React.useState(false)
  const addMemberModal = useModal()
  const assignmentModal = useModal()
  const editRolesModal = useModal<ProjectMember>()
  const removeMemberModal = useModal<ProjectMember>()
  const transferOwnershipModal = useModal<ProjectMember>()
  const [memberEmail, setMemberEmail] = React.useState('')
  const [memberEmailTouched, setMemberEmailTouched] = React.useState(false)
  const [memberUserSearch, setMemberUserSearch] = React.useState('')
  const [selectedMemberUser, setSelectedMemberUser] = React.useState<UserSearchItem | null>(null)
  const [memberRoles, setMemberRoles] = React.useState<ProjectRole[]>(['viewer'])
  const [memberDeliveryMethod, setMemberDeliveryMethod] = React.useState<'email' | 'manual'>('manual')
  const [memberInviteReveal, setMemberInviteReveal] = React.useState<{ email: string; inviteUrl: string; oneTimePassword: string } | null>(null)
  const [editRolesSelection, setEditRolesSelection] = React.useState<ProjectRole[]>(['viewer'])
  const [editCustomRoleIds, setEditCustomRoleIds] = React.useState<string[]>([])
  const [assignmentPrincipalType, setAssignmentPrincipalType] = React.useState<ProjectAssignmentPrincipalType>('user')
  const [assignmentPrincipalIdInput, setAssignmentPrincipalIdInput] = React.useState('')
  const [assignmentUserEmail, setAssignmentUserEmail] = React.useState('')
  const [assignmentUserSearch, setAssignmentUserSearch] = React.useState('')
  const [selectedAssignmentUser, setSelectedAssignmentUser] = React.useState<UserSearchItem | null>(null)
  const [assignmentRoleId, setAssignmentRoleId] = React.useState('')
  const [assignmentError, setAssignmentError] = React.useState('')
  const [collaboratorsSearch, setCollaboratorsSearch] = React.useState('')
  const [collaboratorsSearchExpanded, setCollaboratorsSearchExpanded] = React.useState(false)

  // Engine access state
  const [engineAccessOpen, setEngineAccessOpen] = React.useState(false)
  const [selectedEngineForRequest, setSelectedEngineForRequest] = React.useState<string | null>(null)
  const memberManagementModalOpen = addMemberModal.isOpen || assignmentModal.isOpen || editRolesModal.isOpen || removeMemberModal.isOpen || transferOwnershipModal.isOpen

  const openProjectMembers = React.useCallback(() => {
    setCollaboratorsSearch('')
    setCollaboratorsSearchExpanded(false)
    setCollaboratorsOpen(true)
  }, [])

  const closeCollaborators = React.useCallback(() => {
    setCollaboratorsOpen(false)
    setCollaboratorsSearch('')
    setCollaboratorsSearchExpanded(false)
  }, [])

  const showToast = React.useCallback((t: { kind: 'success'|'error'; title: string; subtitle?: string }) => {
    notify({ kind: t.kind, title: t.title, subtitle: t.subtitle })
  }, [notify])

  const resetAddMemberForm = React.useCallback(() => {
    setMemberEmail('')
    setMemberEmailTouched(false)
    setMemberUserSearch('')
    setSelectedMemberUser(null)
    setMemberRoles(['viewer'])
    setMemberDeliveryMethod('manual')
    setMemberInviteReveal(null)
  }, [])

  const resetAssignmentForm = React.useCallback(() => {
    setAssignmentPrincipalType('user')
    setAssignmentPrincipalIdInput('')
    setAssignmentUserEmail('')
    setAssignmentUserSearch('')
    setSelectedAssignmentUser(null)
    setAssignmentRoleId('')
    setAssignmentError('')
  }, [])

  const closeAssignmentModal = React.useCallback(() => {
    resetAssignmentForm()
    assignmentModal.closeModal()
  }, [assignmentModal, resetAssignmentForm])

  const openAssignmentModal = React.useCallback(() => {
    resetAssignmentForm()
    assignmentModal.openModal()
  }, [assignmentModal, resetAssignmentForm])

  const projectsQ = useQuery({
    queryKey: ['starbase', 'projects'],
    queryFn: () => apiClient.get<Project[]>('/starbase-api/projects'),
    enabled: !!projectId,
    staleTime: 60 * 1000,
  })

  const enginesQ = useQuery({
    queryKey: ['engines','list'],
    queryFn: getAccessibleEngines,
    enabled: deployModal.isOpen || deploymentTargetsOpen,
  })
  // Set default deploy engine when engines load or selected engine changes
  React.useEffect(() => {
    if (deployModal.isOpen && !deployEngineId) {
      const engines = enginesQ.data || []
      if (selectedEngineId && engines.some((engine) => engine.id === selectedEngineId)) {
        setDeployEngineId(selectedEngineId)
      } else if (engines.length === 1) {
        setDeployEngineId(engines[0].id)
      } else if (engines.length > 0) {
        // Select first engine alphabetically
        const sorted = [...engines].sort((a, b) =>
          (a.name ?? a.baseUrl ?? '').localeCompare(b.name ?? b.baseUrl ?? '')
        )
        setDeployEngineId(sorted[0].id)
      }
    }
  }, [deployModal.isOpen, enginesQ.data, selectedEngineId, deployEngineId])

  const contentsQ = useQuery({
    queryKey: ['contents', projectId, folderId],
    queryFn: () => projectsApi.getContents(projectId!, folderId),
    enabled: !!projectId,
  })

  // Fetch git repository info to check if project has git connection
  const gitRepoQ = useQuery({
    queryKey: ['git', 'repository', projectId],
    queryFn: async () => {
      const repos = await apiClient.get<any[]>('/git-api/repositories', { projectId })
        .catch(() => [])
      if (!Array.isArray(repos) || repos.length === 0) return null
      return repos[0] || null
    },
    enabled: !!projectId,
    staleTime: 60 * 1000,
  })

  // Show sync button only if: at least one sync option is enabled AND project has git connection
  // Also hide while loading to prevent flash
  const hasGitConnection = !gitRepoQ.isLoading && !!gitRepoQ.data
  const vcsStatusReadDecision = evaluateActionSnapshot(
    permissions,
    'project.vcs.status.read',
    { type: 'project', id: projectId || null }
  )
  const canReadVcsStatus = vcsStatusReadDecision.allowed ||
    hasProjectPermission(projectId, ProjectPermission.FILES_VIEW)

  const uncommittedQ = useQuery({
    queryKey: ['uncommitted-files', projectId, 'main'],
    queryFn: () => apiClient.get<{ hasUncommittedChanges: boolean; uncommittedFileIds: string[]; uncommittedFolderIds: string[] }>(
      `/vcs-api/projects/${projectId}/uncommitted-files`
    ),
    enabled: !!projectId && hasGitConnection && canReadVcsStatus,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })

  const uncommittedFileIdsSet = React.useMemo(() => {
    const ids = uncommittedQ.data?.uncommittedFileIds
    return new Set(Array.isArray(ids) ? ids : [])
  }, [uncommittedQ.data?.uncommittedFileIds])

  const uncommittedFolderIdsSet = React.useMemo(() => {
    const ids = uncommittedQ.data?.uncommittedFolderIds
    return new Set(Array.isArray(ids) ? ids : [])
  }, [uncommittedQ.data?.uncommittedFolderIds])

  // Fetch platform settings to determine if sync is enabled and who can deploy
  const { data: platformSettings } = usePlatformSyncSettings()
  const anySyncEnabled = (platformSettings?.syncPushEnabled ?? true) ||
                         (platformSettings?.syncPullEnabled ?? false)
  const projectAccessAuthority = platformSettings?.projectAccessAuthority || 'manual'
  const manualProjectAccessEnabled = projectAccessAuthority !== 'sso_managed'

  // Fetch project-level Git connection info (for token warning banner)
  const gitConnectionQ = useQuery({
    queryKey: ['git-connection', projectId],
    queryFn: () => apiClient.get<{ connected: boolean; lastValidatedAt?: number | null }>('/git-api/project-connection', { projectId }),
    enabled: !!projectId,
    staleTime: 60 * 1000,
  })

  const showSyncButton = anySyncEnabled && hasGitConnection

  const handleBatchDelete = async () => {
    if (!canDeleteFiles) return
    if (!batchDeleteIds || batchDeleteIds.length === 0) return
    try {
      setBusy(true)
      for (const id of batchDeleteIds) {
        const it = items.find((x) => x.id === id)
        if (!it) continue
        if (it.type === 'folder') {
          await foldersApi.delete(id)
        } else {
          await filesApi.delete(id)
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      showToast({
        kind: 'success',
        title: batchDeleteIds.length === 1 ? 'Item deleted' : 'Items deleted',
      })
      batchCancelSelection?.()
      setBatchDeleteIds(null)
      setBatchCancelSelection(null)
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to delete selected items')
      showToast({ kind: 'error', title: 'Failed to delete selected items', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitUpdateDeployPermission(member: ProjectMember, allowed: boolean) {
    if (!canManageMemberDeployGrant) return
    if (!projectId) return
    try {
      await projectsApi.updateMemberDeployGrant(projectId, member.userId, allowed)
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      showToast({ kind: 'success', title: allowed ? 'Deploy permission granted' : 'Deploy permission revoked' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to update deploy permission')
      showToast({ kind: 'error', title: 'Failed to update deploy permission', subtitle: parsed.message })
    }
  }

  // Cache/read project name to avoid empty header when navigating directly or on fast loads
  const cachedName = React.useMemo(() => {
    if (!projectId) return undefined
    try {
      return sessionStorage.getItem(`projectName:${projectId}`) ?? undefined
    } catch {
      return undefined
    }
  }, [projectId])

  React.useEffect(() => {
    const nameFromList = projectsQ.data?.find((p: Project) => p.id === projectId)?.name
    const nameToCache = (location.state && location.state.name) || nameFromList
    if (projectId && nameToCache) {
      try {
        sessionStorage.setItem(`projectName:${projectId}`!, nameToCache)
      } catch {}
    }
  }, [projectId, location.state, projectsQ.data])

  // Flatten contents into list items (folders first, each group sorted alphabetically)
  const items = React.useMemo<FileItem[]>(() => {
    const c = contentsQ.data
    if (!c) return []
    const folders: FileItem[] = c.folders
      .map(f => ({ id: f.id, name: f.name, type: 'folder' as const, createdBy: f.createdBy, updatedBy: f.updatedBy, updatedAt: f.updatedAt ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const files: FileItem[] = c.files
      .map(f => ({ id: f.id, name: f.name, type: f.type, createdBy: f.createdBy, updatedBy: f.updatedBy, updatedAt: f.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const list = [...folders, ...files]
    const needle = query.trim().toLowerCase()
    return needle ? list.filter(f => f.name.toLowerCase().includes(needle)) : list
  }, [contentsQ.data, query])

  const { editingId, draftName, setDraftName, inputRef, startEditing, handleKeyDown, handleBlur } = useInlineRename({
    getEndpoint: (id: string) => {
      const item = items.find(i => i.id === id)
      const isFolder = item?.type === 'folder'
      return isFolder ? `/starbase-api/folders/${id}` : `/starbase-api/files/${id}`
    },
    queryKey: ['contents', projectId, folderId]
  })

  // Build folder tree options for move modal
  const moveOptions = React.useMemo(() => {
    if (!allFolders) return [] as Array<{ id: string | 'ROOT'; label: string; disabled?: boolean }>
    const roots = allFolders.filter(f => !f.parentFolderId)
    const children = new Map<string, FolderSummary[]>()
    for (const f of allFolders) {
      if (f.parentFolderId) {
        const arr = children.get(f.parentFolderId) || []
        arr.push(f)
        children.set(f.parentFolderId, arr)
      }
    }
    for (const [, arr] of children) arr.sort((a, b) => a.name.localeCompare(b.name))

    // collect descendants of a folder to disable as targets
    const disableSet = new Set<string>()
    if (moveModal.data?.type === 'folder') {
      const stack = [moveModal.data.id]
      while (stack.length) {
        const cur = stack.pop()!
        disableSet.add(cur)
        const kids = children.get(cur) || []
        for (const k of kids) stack.push(k.id)
      }
    }

    const out: Array<{ id: string | 'ROOT'; label: string; disabled?: boolean }> = [
      { id: 'ROOT', label: 'Root', disabled: moveModal.data?.type === 'folder' && !folderId ? false : false }
    ]
    function add(node: FolderSummary, depth: number) {
      const disabled = moveModal.data?.type === 'folder' ? disableSet.has(node.id) : false
      out.push({ id: node.id, label: `${'\u2014 '.repeat(depth)}${node.name}`, disabled })
      const kids = children.get(node.id) || []
      for (const k of kids) add(k, depth + 1)
    }
    roots.sort((a, b) => a.name.localeCompare(b.name))
    for (const r0 of roots) add(r0, 0)
    return out
  }, [allFolders, moveModal.data, folderId])

  const moveDisabledSet = React.useMemo(() => {
    return new Set(
      moveOptions
        .filter((option) => option.id !== 'ROOT' && option.disabled)
        .map((option) => String(option.id))
    )
  }, [moveOptions])

  const nameFromList = projectsQ.data?.find((p: Project) => p.id === projectId)?.name
  const projectName = (location.state && location.state.name) ?? cachedName ?? nameFromList ?? (projectsQ.isLoading ? 'Loading...' : 'Project')

  const projectCountsFromList = projectsQ.data?.find((p: Project) => p.id === projectId)
  const subtitle = contentsQ.data
    ? `${contentsQ.data.folders.length} folders, ${contentsQ.data.files.length} files`
    : (!folderId && projectCountsFromList
        ? `${projectCountsFromList.foldersCount ?? 0} folders, ${projectCountsFromList.filesCount ?? 0} files`
        : 'Loading...')

  async function downloadFile(fileId: string, name: string, type: Exclude<FileItem['type'], 'folder'>) {
    if (!canViewFiles) return

    try {
      const blob = await apiClient.getBlob(`/starbase-api/files/${encodeURIComponent(fileId)}/download`)
      if (!blob || blob.size === 0) return
      const safeName = toSafeDownloadFilenameWithExtension(name, type, 'file')
      downloadBlob(blob, safeName)
    } catch {
      // noop for now
    }
  }

  async function downloadFileAsPdf(fileId: string, name: string, type: 'bpmn' | 'dmn') {
    if (!canViewFiles) return

    try {
      // Reuse the authenticated source-XML endpoint; no new backend route needed.
      const blob = await apiClient.getBlob(`/starbase-api/files/${encodeURIComponent(fileId)}/download`)
      if (!blob || blob.size === 0) {
        notify({
          kind: 'error',
          title: 'PDF export failed',
          subtitle: 'The file is empty or could not be downloaded.',
        })
        return
      }
      const xml = await blob.text()
      await renderDiagramToPdf({ xml, name, type })
    } catch (error) {
      const parsed = parseApiError(error, 'Failed to export diagram as PDF.')
      notify({
        kind: 'error',
        title: 'PDF export failed',
        subtitle: parsed.message,
      })
    }
  }

  async function downloadFolder(folderId: string, name: string) {
    if (!canViewFiles) return

    try {
      const blob = await apiClient.getBlob(`/starbase-api/folders/${encodeURIComponent(folderId)}/download`)
      if (!blob || blob.size === 0) return
      const safeName = toSafeDownloadFilename(`${name}.zip`, 'folder.zip')
      downloadBlob(blob, safeName)
    } catch {
      // noop for now
    }
  }

  async function downloadProject(projectId: string, name: string) {
    if (!canViewFiles) return

    try {
      const blob = await apiClient.getBlob(`/starbase-api/projects/${encodeURIComponent(projectId)}/download`)
      if (!blob || blob.size === 0) return
      const safeName = toSafeDownloadFilename(`${name}.zip`, 'project.zip')
      downloadBlob(blob, safeName)
    } catch {
      // noop for now
    }
  }

  async function uploadProjectZip(file: File) {
    if (!canCreateFiles) return
    if (!projectId) return
    const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
    if (!isZip) {
      showToast({ kind: 'error', title: 'Upload failed', subtitle: 'Only .zip project archives are supported.' })
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      await apiClient.postRaw<{ foldersCreated: number; filesCreated: number; linksRewritten: number; warnings?: string[] }>(
        `/starbase-api/projects/${encodeURIComponent(projectId)}/import-zip`,
        buffer,
        {
          headers: {
            'Content-Type': 'application/zip',
          },
        }
      )

      await queryClient.invalidateQueries({ queryKey: ['contents', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      await queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] })
      showToast({ kind: 'success', title: 'Project zip uploaded', subtitle: file.name })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Upload failed')
      showToast({ kind: 'error', title: 'Upload failed', subtitle: parsed.message })
    }
  }

  async function handleUploadSelection(file: File) {
    if (!canCreateFiles) return

    const isZip = file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'

    if (isZip) {
      await uploadProjectZip(file)
      return
    }

    if (!projectId) return

    await validateAndUploadFile({
      file,
      projectId,
      folderId,
      queryClient,
      showToast,
    })
  }

  async function downloadSelection(selectedItems: FileItem[], cancelSelection: () => void) {
    if (!canViewFiles) return
    if (!projectId || selectedItems.length === 0) return
    try {
      const fileIds = selectedItems.filter((item) => item.type !== 'folder').map((item) => item.id)
      const folderIds = selectedItems.filter((item) => item.type === 'folder').map((item) => item.id)
      const blob = await apiClient.postBlob(`/starbase-api/projects/${encodeURIComponent(projectId)}/download-selection`, {
        fileIds,
        folderIds,
      })
      if (!blob || blob.size === 0) return
      const safeName = toSafeDownloadFilename(`${projectName}-selection.zip`, 'selection.zip')
      downloadBlob(blob, safeName)
      cancelSelection()
    } catch {
      // noop for now
    }
  }

  const membersQ = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectsApi.getMembers(projectId!),
    enabled: !!projectId,
  })

  const myMembershipQ = useQuery({
    queryKey: ['project-members', projectId, 'me'],
    queryFn: () => projectsApi.getMyMembership(projectId!),
    enabled: !!projectId, // Always fetch - needed for deploy permission check
  })

  // Engine access query
  const engineAccessQ = useQuery({
    queryKey: ['project-engine-access', projectId],
    queryFn: () => projectsApi.getEngineAccess(projectId!),
    enabled: !!projectId,
  })

  // Engine access request mutation
  const requestEngineAccessM = useMutation({
    mutationFn: async (engineId: string) => {
      return requestEngineProjectAccess(engineId, projectId!)
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project-engine-access', projectId] })
      if (data.autoApproved) {
        showToast({ kind: 'success', title: 'Access granted', subtitle: 'Auto-approved based on your roles' })
      } else {
        showToast({ kind: 'success', title: 'Access requested', subtitle: 'Waiting for engine owner approval' })
      }
      setSelectedEngineForRequest(null)
    },
    onError: (err: any) => {
      showToast({ kind: 'error', title: 'Request failed', subtitle: err.message })
    },
  })

  const hasProjectAction = React.useCallback((actionId: string) => (
    evaluateActionSnapshot(permissions, actionId, { type: 'project', id: projectId || null }).allowed
  ), [permissions, projectId])

  const hasProjectPermissionForCurrentUser = React.useCallback((permission: string) => (
    hasProjectPermission(projectId, permission)
  ), [hasProjectPermission, projectId])

  const hasProjectPermissionOrAction = React.useCallback((permission: string, actionId: string) => (
    hasProjectPermission(projectId, permission) ||
    hasProjectAction(actionId)
  ), [hasProjectAction, hasProjectPermission, projectId])

  const canViewFiles = hasProjectPermissionForCurrentUser(ProjectPermission.FILES_VIEW)
  const canCreateFiles = hasProjectPermissionForCurrentUser(ProjectPermission.FILES_CREATE)
  const canEditFiles = hasProjectPermissionForCurrentUser(ProjectPermission.FILES_EDIT)
  const canDeleteFiles = hasProjectPermissionForCurrentUser(ProjectPermission.FILES_DELETE)
  const canViewMembers = hasProjectPermissionForCurrentUser(ProjectPermission.MEMBERS_VIEW) ||
    hasProjectPermissionForCurrentUser(ProjectPermission.MEMBERS_MANAGE)
  const canManageMembers = hasProjectPermissionForCurrentUser(ProjectPermission.MEMBERS_MANAGE)
  const canSearchMembers = canManageMembers || hasProjectPermissionOrAction(ProjectPermission.MEMBERS_SEARCH, 'project.members.search')
  const canInviteMembers = canManageMembers || hasProjectPermissionOrAction(ProjectPermission.MEMBERS_INVITE, 'project.members.invite')
  const canAddMembers = canManageMembers || hasProjectPermissionOrAction(ProjectPermission.MEMBERS_ADD, 'project.members.add')
  const canUpdateMemberRoles = canManageMembers || hasProjectPermissionOrAction(ProjectPermission.MEMBERS_UPDATE_ROLE, 'project.members.update-role')
  const canRemoveMembers = canManageMembers || hasProjectPermissionOrAction(ProjectPermission.MEMBERS_REMOVE, 'project.members.remove')
  const canManageMemberDeployGrant = canManageMembers || hasProjectPermissionOrAction(ProjectPermission.MEMBERS_MANAGE_DEPLOY_GRANT, 'project.members.deploy-grant.manage')
  const canTransferOwnership = hasProjectPermissionOrAction(ProjectPermission.OWNERSHIP_TRANSFER, 'project.ownership.transfer')
  const canOpenAddMember = manualProjectAccessEnabled && canSearchMembers && (canAddMembers || canInviteMembers)
  const canAssignScopedProjectAccess = manualProjectAccessEnabled && (canAddMembers || canUpdateMemberRoles)
  const canAssignDelegate = hasProjectPermissionForCurrentUser(ProjectPermission.DELEGATE_MANAGE)
  const canManageProjectSettings = hasProjectPermissionForCurrentUser(ProjectPermission.PROJECT_SETTINGS)
  const requestEngineAccessDecision = evaluateActionSnapshot(
    permissions,
    'project-engine-target.access.request',
    { type: 'project', id: projectId || null }
  )
  const canRequestEngineAccess = requestEngineAccessDecision.allowed || canManageProjectSettings
  const requestEngineAccessUnavailableReason = canRequestEngineAccess
    ? null
    : requestEngineAccessDecision.reason || `Missing permission ${ProjectPermission.PROJECT_SETTINGS}`
  const canManageGitConnection = hasProjectPermissionForCurrentUser(ProjectPermission.GIT_CONNECT)
  const hasDeployPermission = hasProjectPermissionOrAction(ProjectPermission.DEPLOY, 'project.deploy.create')
  const canViewDeploymentOptions = canViewFiles
  const canReadPlatformProjectEngineTargets = hasPlatformPermission(PlatformPermission.PROJECT_ENGINE_TARGETS_VIEW) ||
    hasPlatformPermission(PlatformPermission.PROJECT_ENGINE_TARGETS_MANAGE)
  const canManagePlatformProjectEngineTargets = hasPlatformPermission(PlatformPermission.PROJECT_ENGINE_TARGETS_MANAGE)
  const canInspectScopedProjectLineage = canViewMembers && (
    hasPlatformPermission(PlatformPermission.AUTHZ_ROLES_VIEW) ||
    hasPlatformPermission(PlatformPermission.AUTHZ_ROLES_MANAGE)
  )
  const canReadScopedProjectEngineTargets = hasProjectPermissionForCurrentUser(ProjectPermission.DEPLOYMENT_TARGETS_VIEW) ||
    hasProjectPermissionForCurrentUser(ProjectPermission.DEPLOYMENT_TARGETS_MANAGE)
  const canManageScopedProjectEngineTargets = hasProjectPermissionForCurrentUser(ProjectPermission.DEPLOYMENT_TARGETS_MANAGE)
  const canReadProjectEngineTargets = canReadScopedProjectEngineTargets || canReadPlatformProjectEngineTargets
  const canManageProjectEngineTargets = canManageScopedProjectEngineTargets || canManagePlatformProjectEngineTargets
  const deploymentTargetsApiScope = canManageScopedProjectEngineTargets || (canReadScopedProjectEngineTargets && !canReadPlatformProjectEngineTargets)
    ? 'project'
    : 'platform'

  const getProjectPermissionUnavailableReason = React.useCallback((permission: string): string | null => (
    hasProjectPermissionForCurrentUser(permission) ? null : `Missing permission ${permission}`
  ), [hasProjectPermissionForCurrentUser])

  const getProjectDetailRowActionUnavailableReason = React.useCallback((_item: FileItem, action: ProjectDetailRowAction): string | null => {
    switch (action) {
      case 'rename':
      case 'move':
        return getProjectPermissionUnavailableReason(ProjectPermission.FILES_EDIT)
      case 'download':
      case 'downloadPdf':
        return getProjectPermissionUnavailableReason(ProjectPermission.FILES_VIEW)
      case 'delete':
        return getProjectPermissionUnavailableReason(ProjectPermission.FILES_DELETE)
      default:
        return null
    }
  }, [getProjectPermissionUnavailableReason])

  const syncPermissions = React.useMemo(() => [
    ...((platformSettings?.syncPushEnabled ?? true) ? [ProjectPermission.GIT_PUSH] : []),
    ...((platformSettings?.syncPullEnabled ?? false) ? [ProjectPermission.GIT_PULL] : []),
  ], [platformSettings?.syncPullEnabled, platformSettings?.syncPushEnabled])

  const syncUnavailableReason = React.useMemo(() => {
    if (!anySyncEnabled) return 'Sync is disabled by platform settings'
    if (!hasGitConnection) return 'Project is not connected to Git'
    if (syncPermissions.length === 0) return null
    if (syncPermissions.some((permission) => hasProjectPermissionForCurrentUser(permission))) return null
    const permissionText = syncPermissions.length === 1 ? syncPermissions[0] : syncPermissions.join(' or ')
    return `Missing permission ${permissionText}`
  }, [anySyncEnabled, hasGitConnection, hasProjectPermissionForCurrentUser, syncPermissions])

  const getProjectDetailToolbarActionUnavailableReason = React.useCallback((action: ProjectDetailToolbarAction): string | null => {
    switch (action) {
      case 'members':
        return canViewMembers ? null : getProjectPermissionUnavailableReason(ProjectPermission.MEMBERS_VIEW)
      case 'engineAccess':
        return canViewDeploymentOptions
          ? null
          : getProjectPermissionUnavailableReason(ProjectPermission.FILES_VIEW)
      case 'upload':
      case 'create':
        return getProjectPermissionUnavailableReason(ProjectPermission.FILES_CREATE)
      default:
        return null
    }
  }, [canViewDeploymentOptions, canViewMembers, getProjectPermissionUnavailableReason])

  const getProjectDetailToolbarActionDiagnosticDecision = React.useCallback((
    action: ProjectDetailToolbarAction,
    reason?: string | null
  ): UiAuthzDecision | null => (
    buildProjectDetailToolbarDiagnosticDecision(projectId || '', action, reason)
  ), [projectId])

  const downloadProjectUnavailableReason = getProjectPermissionUnavailableReason(ProjectPermission.FILES_VIEW)
  const gitSettingsUnavailableReason = (canManageProjectSettings || canManageGitConnection)
    ? null
    : `Missing permission ${ProjectPermission.PROJECT_SETTINGS} or ${ProjectPermission.GIT_CONNECT}`
  const deploymentTargetsUnavailableReason = canReadProjectEngineTargets
    ? null
    : `Missing permission ${ProjectPermission.DEPLOYMENT_TARGETS_VIEW} or ${PlatformPermission.PROJECT_ENGINE_TARGETS_VIEW}`
  const deploymentTargetsManageUnavailableReason = canManageProjectEngineTargets
    ? null
    : `Missing permission ${ProjectPermission.DEPLOYMENT_TARGETS_MANAGE} or ${PlatformPermission.PROJECT_ENGINE_TARGETS_MANAGE}`

  const customProjectRolesQ = useQuery({
    queryKey: ['project-members', projectId, 'custom-roles'],
    queryFn: () => apiClient.get<SharedRoleSummary[]>('/api/authz/roles', {
      scope: 'project',
      assignable: 'true',
      resourceType: 'project',
      resourceId: projectId,
    }),
    enabled: !!projectId && (canAssignScopedProjectAccess || (collaboratorsOpen && canInspectScopedProjectLineage)),
  })

  const projectRoleAssignmentsQ = useQuery({
    queryKey: ['project-members', projectId, 'custom-role-assignments'],
    queryFn: () => apiClient.get<ScopedProjectRoleAssignment[]>('/api/authz/role-assignments', {
      resourceType: 'project',
      resourceId: projectId,
    }),
    enabled: !!projectId && (canAssignScopedProjectAccess || (collaboratorsOpen && canInspectScopedProjectLineage)),
  })

  const projectAuthzGroupsQ = useQuery({
    queryKey: ['project-members', projectId, 'authz-groups'],
    queryFn: () => apiClient.get<ProjectAuthzGroupSummary[]>('/api/authz/groups'),
    enabled: !!projectId && collaboratorsOpen && canInspectScopedProjectLineage,
  })

  const projectGroupMembershipsQ = useQuery({
    queryKey: ['project-members', projectId, 'authz-group-memberships'],
    queryFn: () => apiClient.get<ProjectAuthzGroupMembershipSummary[]>('/api/authz/group-memberships'),
    enabled: !!projectId && collaboratorsOpen && canInspectScopedProjectLineage,
  })

  const assignableProjectRoles = React.useMemo(() => (
    (Array.isArray(customProjectRolesQ.data) ? customProjectRolesQ.data : [])
      .filter((role) => role.scope === 'project' && role.isAssignable && !role.isArchived)
  ), [customProjectRolesQ.data])

  const customProjectRoles = React.useMemo(() => (
    assignableProjectRoles.filter((role) => role.kind === 'custom')
  ), [assignableProjectRoles])

  const customProjectRoleNameById = React.useMemo(
    () => new Map(customProjectRoles.map((role) => [role.id, role.name])),
    [customProjectRoles]
  )

  const assignableProjectRoleNameById = React.useMemo(
    () => new Map(assignableProjectRoles.map((role) => [role.id, role.name])),
    [assignableProjectRoles]
  )

  const customProjectAssignmentsByUser = React.useMemo(() => {
    const byUser = new Map<string, ScopedProjectRoleAssignment[]>()
    for (const assignment of Array.isArray(projectRoleAssignmentsQ.data) ? projectRoleAssignmentsQ.data : []) {
      if (assignment.resourceType !== 'project' || assignment.resourceId !== projectId) continue
      if (!customProjectRoleNameById.has(assignment.roleId)) continue
      const principalType = assignment.principalType || 'user'
      if (principalType !== 'user') continue
      const userId = assignment.principalId || assignment.userId
      if (!userId) continue
      const entries = byUser.get(userId) || []
      entries.push(assignment)
      byUser.set(userId, entries)
    }
    return byUser
  }, [customProjectRoleNameById, projectId, projectRoleAssignmentsQ.data])

  const inheritedCustomProjectAssignmentsByUser = React.useMemo(() => {
    const byUser = new Map<string, Array<{ assignment: ScopedProjectRoleAssignment; membership: ProjectAuthzGroupMembershipSummary; group: ProjectAuthzGroupSummary | null }>>()
    if (!canInspectScopedProjectLineage) return byUser
    const groupsById = new Map<string, ProjectAuthzGroupSummary>()
    for (const group of Array.isArray(projectAuthzGroupsQ.data) ? projectAuthzGroupsQ.data : []) {
      groupsById.set(group.id, group)
    }

    const membershipsByGroup = new Map<string, ProjectAuthzGroupMembershipSummary[]>()
    for (const membership of Array.isArray(projectGroupMembershipsQ.data) ? projectGroupMembershipsQ.data : []) {
      if (!membership.groupId || !membership.userId) continue
      const entries = membershipsByGroup.get(membership.groupId) || []
      entries.push(membership)
      membershipsByGroup.set(membership.groupId, entries)
    }

    for (const assignment of Array.isArray(projectRoleAssignmentsQ.data) ? projectRoleAssignmentsQ.data : []) {
      if (assignment.resourceType !== 'project' || assignment.resourceId !== projectId) continue
      if (!customProjectRoleNameById.has(assignment.roleId)) continue
      if ((assignment.principalType || 'user') !== 'group') continue
      const groupId = assignment.principalId || assignment.userId
      if (!groupId) continue
      const memberships = membershipsByGroup.get(groupId) || []
      for (const membership of memberships) {
        const entries = byUser.get(membership.userId) || []
        entries.push({
          assignment,
          membership,
          group: groupsById.get(groupId) || null,
        })
        byUser.set(membership.userId, entries)
      }
    }
    return byUser
  }, [
    canInspectScopedProjectLineage,
    customProjectRoleNameById,
    projectAuthzGroupsQ.data,
    projectGroupMembershipsQ.data,
    projectId,
    projectRoleAssignmentsQ.data,
  ])

  const customProjectRoleTagsByUser = React.useMemo(() => {
    const byUser = new Map<string, Array<{ id: string; label: string; lineage?: string }>>()
    customProjectAssignmentsByUser.forEach((assignments, userId) => {
      byUser.set(userId, assignments.map((assignment) => ({
        id: assignment.id,
        label: customProjectRoleNameById.get(assignment.roleId) || assignment.roleName || 'Custom role',
        lineage: formatProjectRoleAssignmentSourceLineage(assignment),
      })))
    })
    inheritedCustomProjectAssignmentsByUser.forEach((entries, userId) => {
      const current = byUser.get(userId) || []
      byUser.set(userId, [
        ...current,
        ...entries.map(({ assignment, membership, group }) => ({
          id: `${assignment.id}:${membership.id || membership.userId}`,
          label: `${customProjectRoleNameById.get(assignment.roleId) || assignment.roleName || 'Custom role'} (via ${formatProjectGroupLabel(group, assignment.principalId || assignment.userId)})`,
          lineage: formatProjectInheritedRoleAssignmentSourceLineage(assignment, membership, group),
        })),
      ])
    })
    return byUser
  }, [customProjectAssignmentsByUser, customProjectRoleNameById, inheritedCustomProjectAssignmentsByUser])

  const scopedProjectRoleAssignments = React.useMemo(() => (
    (Array.isArray(projectRoleAssignmentsQ.data) ? projectRoleAssignmentsQ.data : [])
      .filter((assignment) => assignment.resourceType === 'project' && assignment.resourceId === projectId)
  ), [projectId, projectRoleAssignmentsQ.data])

  const assignmentPrincipalId = assignmentPrincipalType === 'user'
    ? selectedAssignmentUser?.id || ''
    : assignmentPrincipalIdInput.trim()

  const assignScopedProjectRoleM = useMutation({
    mutationFn: ({ principalType, principalId, roleId }: { principalType: ProjectAssignmentPrincipalType; principalId: string; roleId: string }) => {
      const payload: RoleAssignmentCreate = {
        principalType,
        principalId,
        roleId,
        resourceType: 'project',
        resourceId: projectId,
      }
      return apiClient.post<RoleAssignmentCreateResponse>('/api/authz/role-assignments', payload)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId, 'custom-role-assignments'] })
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      closeAssignmentModal()
      showToast({ kind: 'success', title: 'Access assigned' })
    },
    onError: (error: any) => {
      const parsed = parseApiError(error, 'Failed to assign access')
      setAssignmentError(parsed.message)
    },
  })

  const removeScopedProjectRoleAssignmentM = useMutation({
    mutationFn: (assignmentId: string) => apiClient.delete(`/api/authz/role-assignments/${encodeURIComponent(assignmentId)}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId, 'custom-role-assignments'] })
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      showToast({ kind: 'success', title: 'Access removed' })
    },
    onError: (error: any) => {
      const parsed = parseApiError(error, 'Failed to remove access')
      showToast({ kind: 'error', title: 'Failed to remove access', subtitle: parsed.message })
    },
  })

  const submitScopedProjectRoleAssignment = React.useCallback(() => {
    if (!projectId) return

    if (!assignmentRoleId) {
      setAssignmentError('Select a role to assign')
      return
    }

    if (assignmentPrincipalType === 'user' && !selectedAssignmentUser) {
      setAssignmentError('Select an existing user from the lookup results')
      return
    }

    if (!assignmentPrincipalId) {
      setAssignmentError('Enter a principal identifier')
      return
    }

    if (!canAssignScopedProjectAccess) {
      setAssignmentError(`Missing permission ${ProjectPermission.MEMBERS_ADD} or ${ProjectPermission.MEMBERS_UPDATE_ROLE}`)
      return
    }

    setAssignmentError('')
    assignScopedProjectRoleM.mutate({
      principalType: assignmentPrincipalType,
      principalId: assignmentPrincipalId,
      roleId: assignmentRoleId,
    })
  }, [
    assignScopedProjectRoleM,
    assignmentPrincipalId,
    assignmentPrincipalType,
    assignmentRoleId,
    canAssignScopedProjectAccess,
    projectId,
    selectedAssignmentUser,
  ])

  async function syncProjectCustomRoleAssignments(userId: string, nextRoleIds: string[]) {
    if (!projectId) return
    const next = new Set(nextRoleIds)
    const current = customProjectAssignmentsByUser.get(userId) || []
    const currentRoleIds = new Set(current.map((assignment) => assignment.roleId))
    await Promise.all([
      ...nextRoleIds
        .filter((roleId) => !currentRoleIds.has(roleId))
        .map((roleId) => {
          const payload: RoleAssignmentCreate = {
            principalType: 'user',
            principalId: userId,
            roleId,
            resourceType: 'project',
            resourceId: projectId,
          }
          return apiClient.post<RoleAssignmentCreateResponse>('/api/authz/role-assignments', payload)
        }),
      ...current
        .filter((assignment) => !next.has(assignment.roleId) && assignment.source === 'manual')
        .map((assignment) => apiClient.delete(`/api/authz/role-assignments/${encodeURIComponent(assignment.id)}`)),
    ])
    await queryClient.invalidateQueries({ queryKey: ['project-members', projectId, 'custom-role-assignments'] })
  }

  const canDeployProjectActions = React.useMemo(() => {
    if (!hasDeployPermission) return false
    return (engineAccessQ.data?.accessedEngines ?? []).some((engine) => (
      engine.deploymentEligibility?.manual?.allowed ?? engine.manualDeployAllowed === true
    ))
  }, [engineAccessQ.data?.accessedEngines, hasDeployPermission])

  const getProjectDetailBulkActionUnavailableReason = React.useCallback((_items: FileItem[], action: ProjectDetailBulkAction): string | null => {
    switch (action) {
      case 'download':
        return getProjectPermissionUnavailableReason(ProjectPermission.FILES_VIEW)
      case 'delete':
        return getProjectPermissionUnavailableReason(ProjectPermission.FILES_DELETE)
      case 'move':
        return getProjectPermissionUnavailableReason(ProjectPermission.FILES_EDIT)
      case 'sync':
        return syncUnavailableReason
      case 'deploy':
        if (canDeployProjectActions) return null
        if (!hasDeployPermission) return getProjectPermissionUnavailableReason(ProjectPermission.DEPLOY)
        return 'No eligible deployment target'
      default:
        return null
    }
  }, [canDeployProjectActions, getProjectPermissionUnavailableReason, hasDeployPermission, syncUnavailableReason])

  const getProjectDetailBulkActionDiagnosticDecision = React.useCallback((
  _items: FileItem[],
  action: ProjectDetailBulkAction,
  reason?: string | null
): UiAuthzDecision | null => (
    buildProjectDetailBulkDiagnosticDecision(projectId || '', action, reason, syncPermissions)
  ), [projectId, syncPermissions])

  const resolveMemberName = React.useCallback((member: ProjectMember) => {
    const userInfo = member.user
    const fullName = userInfo
      ? `${userInfo.firstName || ''}${userInfo.firstName && userInfo.lastName ? ' ' : ''}${userInfo.lastName || ''}`.trim()
      : ''
    return fullName || (userInfo?.email ? userInfo.email.split('@')[0] : member.userId)
  }, [])

  const resolvePendingInviteName = React.useCallback((invite: ProjectPendingInvite) => {
    const fullName = `${invite.firstName || ''}${invite.firstName && invite.lastName ? ' ' : ''}${invite.lastName || ''}`.trim()
    return fullName || invite.email
  }, [])

  const activeMembers = React.useMemo(() => {
    const data = membersQ.data?.members
    return Array.isArray(data) ? data : []
  }, [membersQ.data])

  const pendingInvites = React.useMemo(() => {
    const data = membersQ.data?.pendingInvites
    return Array.isArray(data) ? data : []
  }, [membersQ.data])

  const memberNameById = React.useMemo(() => {
    const map = new Map<string, string>()
    activeMembers.forEach((member) => {
      map.set(member.userId, resolveMemberName(member))
    })
    return map
  }, [activeMembers, resolveMemberName])

  const membersTableRows = React.useMemo(() => {
    return activeMembers.map((m) => ({
      id: m.userId,
      name: resolveMemberName(m),
      email: m.user?.email || '',
      _member: m,
    }))
  }, [activeMembers, resolveMemberName])

  const resolveUpdatedByLabel = React.useCallback((item: FileItem) => {
    const id = item.updatedBy || item.createdBy
    if (!id) return ''
    if (user?.id && id === user.id) return 'You'
    return memberNameById.get(id) || ''
  }, [memberNameById, user?.id])

  const visibleMembersTableRows = React.useMemo(() => {
    const q = collaboratorsSearch.trim().toLowerCase()
    if (!q) return membersTableRows
    return membersTableRows.filter((r) => {
      const hay = [String(r.name || ''), String(r.email || ''), String(r.id || '')].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [membersTableRows, collaboratorsSearch])

  const visiblePendingInvites = React.useMemo(() => {
    const q = collaboratorsSearch.trim().toLowerCase()
    if (!q) return pendingInvites
    return pendingInvites.filter((invite) => {
      const roles = Array.isArray(invite.roles) && invite.roles.length > 0 ? invite.roles.join(' ') : invite.role
      const hay = [
        resolvePendingInviteName(invite),
        invite.email,
        invite.status,
        roles,
        invite.deliveryMethod,
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [pendingInvites, collaboratorsSearch, resolvePendingInviteName])

  const memberUserSearchQ = useQuery({
    queryKey: ['project-members', projectId, 'user-search', memberUserSearch],
    queryFn: () => {
      const q = memberUserSearch.trim()
      if (q.length < 2) return Promise.resolve([] as UserSearchItem[])
      return projectsApi.searchMemberCandidates(projectId!, q)
    },
    enabled: addMemberModal.isOpen && !!projectId && canSearchMembers && memberUserSearch.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  const assignmentUsersQ = useQuery({
    queryKey: ['admin', 'users', 'search', 'project-role-assignment', assignmentUserSearch.trim()],
    queryFn: () => {
      const q = assignmentUserSearch.trim()
      if (q.length < 2) return Promise.resolve([] as UserSearchItem[])
      return apiClient.get<UserSearchItem[]>(`/api/admin/users/search?q=${encodeURIComponent(q)}`)
    },
    enabled: assignmentModal.isOpen && assignmentPrincipalType === 'user' && canSearchMembers && assignmentUserSearch.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  const trimmedMemberEmail = memberEmail.trim()
  const isMemberEmailValid = isValidEmail(trimmedMemberEmail)
  const [debouncedMemberEmail, setDebouncedMemberEmail] = React.useState('')

  React.useEffect(() => {
    if (!addMemberModal.isOpen) {
      setDebouncedMemberEmail('')
      return
    }

    const handle = window.setTimeout(() => {
      setDebouncedMemberEmail(trimmedMemberEmail)
    }, 250)

    return () => window.clearTimeout(handle)
  }, [addMemberModal.isOpen, trimmedMemberEmail])

  const memberCapabilitiesQ = useQuery({
    queryKey: ['project-members', projectId, 'capabilities'],
    queryFn: () => projectsApi.getMemberCapabilities(projectId!),
    enabled: addMemberModal.isOpen && !!projectId && canInviteMembers,
    staleTime: 30 * 1000,
  })
  const memberLookupQ = useQuery({
    queryKey: ['project-members', projectId, 'lookup', debouncedMemberEmail.toLowerCase()],
    queryFn: () => projectsApi.lookupMember(projectId!, debouncedMemberEmail.toLowerCase()),
    enabled: addMemberModal.isOpen && !!projectId && canSearchMembers && isValidEmail(debouncedMemberEmail),
    staleTime: 30 * 1000,
  })

  React.useEffect(() => {
    if (!addMemberModal.isOpen || !memberCapabilitiesQ.data) {
      return
    }

    const disabled = Boolean(memberCapabilitiesQ.data.ssoRequired)
    const nextEmailConfigured = Boolean(memberCapabilitiesQ.data.emailConfigured)
    if (disabled && nextEmailConfigured) {
      setMemberDeliveryMethod('email')
    } else if (!disabled) {
      setMemberDeliveryMethod(nextEmailConfigured ? 'email' : 'manual')
    } else {
      setMemberDeliveryMethod('manual')
    }
  }, [addMemberModal.isOpen, memberCapabilitiesQ.data])

  async function submitAddMember() {
    if (!projectId) return
    const email = memberEmail.trim()
    if (!isValidEmail(email)) return
    const memberLookup = memberLookupQ.data
    const memberMode = memberLookup?.mode || 'invite'
    if (memberMode === 'existing-member') return
    if (memberMode === 'direct-add' && !canAddMembers) return
    if (memberMode === 'invite' && !canInviteMembers) return
    try {
      const roles = editableProjectRoles(memberRoles)
      const body = {
        email,
        roles,
        ...(memberLookup?.mode === 'invite' ? { deliveryMethod: memberDeliveryMethod } : {}),
      }
      const json = await projectsApi.addMember(projectId, body)

      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })

      if (json.invited) {
        const inviteUrl = json.inviteUrl || ''
        const oneTimePassword = json.oneTimePassword || ''
        if (!json.emailSent && inviteUrl && oneTimePassword) {
          setMemberInviteReveal({ email, inviteUrl, oneTimePassword })
          return
        }
        resetAddMemberForm()
        addMemberModal.closeModal()
        showToast({ kind: 'success', title: 'Member invited', subtitle: json.emailSent ? `Invite email sent to ${email}` : json.emailError || undefined })
      } else {
        resetAddMemberForm()
        addMemberModal.closeModal()
        showToast({ kind: 'success', title: 'Member added' })
      }
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to add member')
      showToast({ kind: 'error', title: 'Failed to add member', subtitle: parsed.message })
    }
  }

  async function submitReissuePendingInvite(invite: ProjectPendingInvite) {
    if (!canInviteMembers) return
    if (!projectId) return
    try {
      const json = await projectsApi.reissueManualMemberInvitation(projectId, invite.invitationId)
      const inviteUrl = json.inviteUrl || ''
      const oneTimePassword = json.oneTimePassword || ''

      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })

      if (!inviteUrl || !oneTimePassword) {
        showToast({ kind: 'error', title: 'Failed to reissue invitation', subtitle: 'The new invite link or one-time password was missing.' })
        return
      }

      resetAddMemberForm()
      setMemberInviteReveal({ email: invite.email, inviteUrl, oneTimePassword })
      addMemberModal.openModal()
    } catch (e: any) {
      const parsed = parseApiError(e, invite.status === 'expired' ? 'Failed to recreate invitation' : 'Failed to regenerate invitation')
      showToast({
        kind: 'error',
        title: invite.status === 'expired' ? 'Failed to recreate invitation' : 'Failed to regenerate invitation',
        subtitle: parsed.message,
      })
    }
  }

  async function submitRemoveMember(member: ProjectMember) {
    if (!canRemoveMembers) return
    if (!projectId) return
    try {
      await projectsApi.removeMember(projectId, member.userId)
      await syncProjectCustomRoleAssignments(member.userId, [])
      removeMemberModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      showToast({ kind: 'success', title: 'Member removed' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to remove member')
      showToast({ kind: 'error', title: 'Failed to remove member', subtitle: parsed.message })
    }
  }

  async function submitTransferOwnership(member: ProjectMember) {
    if (!canTransferOwnership) return
    if (!projectId) return
    try {
      await projectsApi.transferOwnership(projectId, member.userId)
      transferOwnershipModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId, 'me'] })
      await queryClient.invalidateQueries({ queryKey: ['starbase', 'projects'] })
      showToast({ kind: 'success', title: 'Ownership transferred', subtitle: `${member.user?.email || member.userId} is now the project owner.` })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to transfer ownership')
      showToast({ kind: 'error', title: 'Failed to transfer ownership', subtitle: parsed.message })
    }
  }

  async function submitUpdateRoles(member: ProjectMember, roles: ProjectRole[]) {
    if (!canUpdateMemberRoles) return
    if (!projectId) return
    try {
      await projectsApi.updateMemberRoles(projectId, member.userId, {
        roles: editableProjectRoles(roles),
      })
      await syncProjectCustomRoleAssignments(member.userId, editCustomRoleIds)
      editRolesModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      showToast({ kind: 'success', title: 'Roles updated' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to update roles')
      showToast({ kind: 'error', title: 'Failed to update roles', subtitle: parsed.message })
    }
  }

  async function submitDeleteFile(file: FileItem) {
    if (!canDeleteFiles) return
    if (!projectId) return
    try {
      setBusy(true)
      await filesApi.delete(file.id)
      deleteFileModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      showToast({ kind: 'success', title: 'File deleted' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to delete file')
      showToast({ kind: 'error', title: 'Failed to delete file', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitDeleteFolder(folder: FolderSummary) {
    if (!canDeleteFiles) return
    if (!projectId) return
    try {
      setBusy(true)
      await foldersApi.delete(folder.id)
      deleteFolderModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      showToast({ kind: 'success', title: 'Folder deleted' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to delete folder')
      showToast({ kind: 'error', title: 'Failed to delete folder', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitMoveFile(file: FileItem, targetId: string | null) {
    if (!canEditFiles) return
    if (!projectId) return
    try {
      setBusy(true)
      await filesApi.updateMetadata(file.id, { folderId: targetId })
      moveModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, targetId ?? null] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, file.id] })
      showToast({ kind: 'success', title: 'File moved' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to move file')
      showToast({ kind: 'error', title: 'Failed to move file', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitBatchMoveFiles(fileIds: string[], targetId: string | null) {
    if (!canEditFiles) return
    if (!projectId || fileIds.length === 0) return
    try {
      setBusy(true)
      for (const fileId of fileIds) {
        await filesApi.updateMetadata(fileId, { folderId: targetId })
      }
      moveModal.closeModal()
      setBatchMoveIds(null)
      batchCancelSelection?.()
      setBatchCancelSelection(null)
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, targetId ?? null] })
      showToast({ kind: 'success', title: fileIds.length === 1 ? 'File moved' : 'Files moved' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to move files')
      showToast({ kind: 'error', title: 'Failed to move files', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitMoveFolder(folder: FolderSummary, targetId: string | null) {
    if (!canEditFiles) return
    if (!projectId) return
    try {
      setBusy(true)
      await foldersApi.update(folder.id, { parentFolderId: targetId })
      moveModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, targetId ?? null] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folder.id] })
      showToast({ kind: 'success', title: 'Folder moved' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to move folder')
      showToast({ kind: 'error', title: 'Failed to move folder', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitCreateFile() {
    if (!canCreateFiles) return
    if (!projectId) return
    const name = newFileName.trim()
    if (!name) return
    const type = createFileModal.data ?? 'bpmn'
    try {
      setBusy(true)
      const created = await filesApi.create(projectId, {
        name,
        type,
        folderId: folderId ?? null,
      })
      createFileModal.closeModal()
      setNewFileName('')
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      showToast({ kind: 'success', title: 'File created' })
      if (created?.id) {
        tenantNavigate(`/starbase/editor/${created.id}`)
      }
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to create file')
      showToast({ kind: 'error', title: 'Failed to create file', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }

  async function submitCreateFolder() {
    if (!canCreateFiles) return
    if (!projectId) return
    const name = newFolderName.trim()
    if (!name) return
    try {
      setBusy(true)
      const created = await foldersApi.create(projectId, {
        name,
        parentFolderId: folderId ?? null,
      })
      newFolderModal.closeModal()
      setNewFolderName('')
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      showToast({ kind: 'success', title: 'Folder created' })
      if (created?.id) {
        tenantNavigate(`/starbase/project/${projectId}?folder=${created.id}`)
      }
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to create folder')
      showToast({ kind: 'error', title: 'Failed to create folder', subtitle: parsed.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{
      background: 'var(--color-bg-primary)',
      height: 'calc(100vh - var(--header-height))',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Breadcrumb Bar - full width at top, stays fixed */}
      <BreadcrumbBar>
        <BreadcrumbItem>
          <a href={toTenantPath('/starbase')} onClick={(e) => { e.preventDefault(); tenantNavigate('/starbase'); }}>Starbase</a>
        </BreadcrumbItem>
        <BreadcrumbItem isCurrentPage={!folderId && (!contentsQ.data?.breadcrumb || contentsQ.data.breadcrumb.length === 0)}>
          {folderId || (contentsQ.data?.breadcrumb && contentsQ.data.breadcrumb.length > 0) ? (
            <a href={toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(projectId))}`)} onClick={(e) => { e.preventDefault(); searchParams.delete('folder'); setSearchParams(searchParams); }}>
              {projectName}
            </a>
          ) : (
            projectName
          )}
        </BreadcrumbItem>
        {contentsQ.data?.breadcrumb?.map((folder: FolderSummary, idx: number) => (
          <BreadcrumbItem key={folder.id} isCurrentPage={idx === contentsQ.data!.breadcrumb.length - 1}>
            {idx === contentsQ.data!.breadcrumb.length - 1 ? (
              folder.name
            ) : (
              <a
                href={`/starbase/project/${projectId}?folder=${folder.id}`}
                onClick={(e) => { e.preventDefault(); searchParams.set('folder', folder.id); setSearchParams(searchParams); }}
              >
                {folder.name}
              </a>
            )}
          </BreadcrumbItem>
        ))}
      </BreadcrumbBar>

      {/* Page content with padding - scrollable */}
      <div style={{
        padding: 'var(--spacing-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-5)',
        flex: 1,
        overflow: 'auto',
      }}>
        {/* Page Header */}
        <ProjectDetailHeader
          projectName={projectName}
          subtitle={subtitle}
          projectId={projectId}
          canDownloadProject={canViewFiles}
          canOpenGitSettings={canManageProjectSettings || canManageGitConnection}
          canOpenDeploymentTargets={canReadProjectEngineTargets}
          downloadProjectUnavailableReason={downloadProjectUnavailableReason}
          gitSettingsUnavailableReason={gitSettingsUnavailableReason}
          deploymentTargetsUnavailableReason={deploymentTargetsUnavailableReason}
          onDownloadProject={downloadProject}
          onOpenGitSettings={() => setGitSettingsOpen(true)}
          onOpenDeploymentTargets={() => {
            if (canReadProjectEngineTargets) setDeploymentTargetsOpen(true)
          }}
        />

        {/* Git token warning banner */}
        {gitConnectionQ.data?.connected && (() => {
          const STALE_MS = 7 * 24 * 60 * 60 * 1000
          const lv = gitConnectionQ.data.lastValidatedAt
          const stale = lv ? (Date.now() - lv) > STALE_MS : true
          return stale ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
              <InlineNotification
                kind="warning"
                title="Git token may be expired"
                subtitle="The service token hasn't been validated recently. Open Git Settings to update it."
                hideCloseButton
                lowContrast
                style={{ marginBottom: 0, flex: 1 }}
              />
              <Button
                kind="ghost"
                size="sm"
                onClick={() => setGitSettingsOpen(true)}
                disabled={!canManageGitConnection}
                title={canManageGitConnection ? undefined : `Missing permission ${ProjectPermission.GIT_CONNECT}`}
              >
                Update token
              </Button>
            </div>
          ) : null
        })()}

        {contentsQ.isLoading && (
          <StarbaseTableShell>
            <DataTableSkeleton
              rowCount={8}
              columnCount={tableHeaders.length}
              headers={tableHeaders as any}
              showHeader={false}
              showToolbar={false}
            />
          </StarbaseTableShell>
        )}

        {contentsQ.isError && (
          <ErrorState
            message={isProjectAccessError(contentsQ.error) ? contentsQ.error.message : 'Failed to load contents'}
            onRetry={() => contentsQ.refetch()}
          />
        )}

        {!contentsQ.isLoading && !contentsQ.isError && (
          <StarbaseTableShell>
            <ProjectContentsTable
              items={items}
              tableHeaders={tableHeaders}
              query={query}
              setQuery={setQuery}
              editingId={editingId}
              draftName={draftName}
              setDraftName={setDraftName}
              inputRef={inputRef}
              handleBlur={handleBlur}
              handleKeyDown={handleKeyDown}
              startEditing={startEditing}
              folderId={folderId}
              onOpenFolder={(id) => {
                searchParams.set('folder', id)
                setSearchParams(searchParams)
              }}
              onOpenEditor={(id) => tenantNavigate(`/starbase/editor/${id}`)}
              resolveUpdatedByLabel={resolveUpdatedByLabel}
              uncommittedFileIdsSet={uncommittedFileIdsSet}
              uncommittedFolderIdsSet={uncommittedFolderIdsSet}
              hasGitConnection={hasGitConnection}
              showSyncButton={showSyncButton}
              canDeployByRole={canDeployProjectActions}
              canViewFiles={canViewFiles}
              canCreateFiles={canCreateFiles}
              canEditFiles={canEditFiles}
              canDeleteFiles={canDeleteFiles}
              canViewMembers={canViewMembers}
              canManageEngineAccess={canViewDeploymentOptions}
              getRowActionUnavailableReason={getProjectDetailRowActionUnavailableReason}
              getBulkActionUnavailableReason={getProjectDetailBulkActionUnavailableReason}
              getBulkActionDiagnosticDecision={getProjectDetailBulkActionDiagnosticDecision}
              getToolbarActionUnavailableReason={getProjectDetailToolbarActionUnavailableReason}
              getToolbarActionDiagnosticDecision={getProjectDetailToolbarActionDiagnosticDecision}
              onOpenSync={(cancelSelection) => {
                setBatchCancelSelection(() => cancelSelection)
                syncModal.openModal()
              }}
              onDeploySelected={(selected) => {
                setSelectedAtOpen(selected)
                setSelectedFolderAtOpen(folderId)
                setDeployScope('files')
                setDeployStage('config')
                setPreviewData(null)
                setPreviewBusy(false)
              }}
              uploadInputRef={uploadInputRef}
              onUploadChange={async (e) => {
                const file = e.target.files && e.target.files[0]
                if (file) {
                  await handleUploadSelection(file)
                }
                if (uploadInputRef.current) uploadInputRef.current.value = ''
              }}
              onOpenMembers={() => {
                if (canViewMembers) openProjectMembers()
              }}
              onOpenEngineAccess={() => {
                if (canViewDeploymentOptions) setEngineAccessOpen(true)
              }}
              onUploadClick={() => {
                if (canCreateFiles) uploadInputRef.current?.click()
              }}
              onCreateFile={(type) => {
                if (!canCreateFiles) return
                createFileModal.openModal(type)
                setNewFileName('')
              }}
              onCreateFolder={() => {
                if (canCreateFiles) newFolderModal.openModal()
              }}
              onMoveItem={(file) => {
                if (!canEditFiles) return
                setAllFolders(null)
                setMoveTarget(folderId ?? 'ROOT')
                if (file.type === 'folder') {
                  moveModal.openModal({ id: file.id, name: file.name, type: 'folder' })
                } else {
                  moveModal.openModal({ id: file.id, name: file.name, type: 'file' })
                }
              }}
              onDownloadFile={(file) => {
                if (file.type === 'folder') return
                downloadFile(file.id, file.name, file.type)
              }}
              onDownloadFolder={(file) => downloadFolder(file.id, file.name)}
              onDownloadFileAsPdf={(file) => {
                if (file.type !== 'bpmn' && file.type !== 'dmn') return
                downloadFileAsPdf(file.id, file.name, file.type)
              }}
              onDownloadSelection={downloadSelection}
              onDeleteItem={(file) => {
                if (!canDeleteFiles) return
                if (file.type === 'folder') {
                  if (!file.id) return
                  foldersApi.getDeletePreview(file.id)
                    .then((preview: any) => {
                      deleteFolderModal.openModal({ id: file.id, name: file.name, preview })
                    })
                    .catch(() => {
                      deleteFolderModal.openModal({ id: file.id, name: file.name })
                    })
                } else {
                  deleteFileModal.openModal(file)
                }
              }}
              getFileIcon={getFileIcon}
              onOpenBatchMove={(ids, cancelSelection) => {
                if (!canEditFiles) return
                if (ids.length === 0) return
                setBatchMoveIds(ids)
                setBatchCancelSelection(() => cancelSelection)
                setAllFolders(null)
                setMoveTarget(folderId ?? 'ROOT')
                moveModal.openModal({
                  id: ids.join(','),
                  ids,
                  name: ids.length === 1 ? 'selected file' : `${ids.length} selected files`,
                  type: 'files',
                })
              }}
              setBatchDeleteIds={setBatchDeleteIds}
              setBatchCancelSelection={setBatchCancelSelection}
              setSelectedAtOpen={setSelectedAtOpen}
              setSelectedFolderAtOpen={setSelectedFolderAtOpen}
              setDeployScope={setDeployScope}
              setDeployStage={setDeployStage}
              setPreviewData={setPreviewData}
              setPreviewBusy={setPreviewBusy}
              openDeployModal={deployModal.openModal}
            />
          </StarbaseTableShell>
        )}

        <ComposedModal open={createFileModal.isOpen} size="sm" onClose={() => createFileModal.closeModal()}>
          <ModalHeader
            label={undefined}
            title={`New ${createFileModal.data === 'dmn' ? 'DMN' : 'BPMN'} diagram`}
            closeModal={() => createFileModal.closeModal()}
          />
          <ModalBody>
            <TextInput
              id="create-file-name"
              labelText="File name"
              placeholder="Enter file name"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitCreateFile()
                }
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={() => createFileModal.closeModal()} disabled={busy}>
              Cancel
            </Button>
            <Button kind="primary" onClick={submitCreateFile} disabled={busy || !newFileName.trim()}>
              Create
            </Button>
          </ModalFooter>
        </ComposedModal>

        <ComposedModal open={newFolderModal.isOpen} size="sm" onClose={() => newFolderModal.closeModal()}>
          <ModalHeader
            label={undefined}
            title="New folder"
            closeModal={() => newFolderModal.closeModal()}
          />
          <ModalBody>
            <TextInput
              id="create-folder-name"
              labelText="Folder name"
              placeholder="Enter folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitCreateFolder()
                }
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button kind="secondary" onClick={() => newFolderModal.closeModal()} disabled={busy}>
              Cancel
            </Button>
            <Button kind="primary" onClick={submitCreateFolder} disabled={busy || !newFolderName.trim()}>
              Create
            </Button>
          </ModalFooter>
        </ComposedModal>

        <ConfirmDeleteModal
          open={!!batchDeleteIds?.length}
          title="Delete selected items"
          description={
            batchDeleteIds?.length
              ? `You're about to delete ${batchDeleteIds.length} selected item${batchDeleteIds.length === 1 ? '' : 's'}.`
              : ''
          }
          dangerLabel={busy ? 'Deleting...' : 'Delete selected'}
          busy={busy}
          onCancel={() => {
            batchCancelSelection?.()
            setBatchDeleteIds(null)
            setBatchCancelSelection(null)
          }}
          onConfirm={handleBatchDelete}
        />

        <ConfirmDeleteModal
          open={deleteFileModal.isOpen && !!deleteFileModal.data}
          title="Delete file"
          description={
            deleteFileModal.data
              ? `You're about to delete the file "${deleteFileModal.data.name}".`
              : ''
          }
          dangerLabel={busy ? 'Deleting...' : 'Delete file'}
          busy={busy}
          onCancel={deleteFileModal.closeModal}
          onConfirm={() => {
            if (deleteFileModal.data) return submitDeleteFile(deleteFileModal.data)
          }}
        />

        <ConfirmDeleteModal
          open={deleteFolderModal.isOpen && !!deleteFolderModal.data}
          title="Delete folder"
          description={
            deleteFolderModal.data
              ? `You're about to delete the folder "${deleteFolderModal.data.name}"${
                  deleteFolderModal.data.preview
                    ? ` and its contents (${deleteFolderModal.data.preview.folderCount} folders, ${deleteFolderModal.data.preview.fileCount} files)`
                    : ''
                }.`
              : ''
          }
          dangerLabel={busy ? 'Deleting...' : 'Delete folder'}
          busy={busy}
          onCancel={deleteFolderModal.closeModal}
          onConfirm={() => {
            if (!deleteFolderModal.data) return
            return submitDeleteFolder({
              id: deleteFolderModal.data.id,
              name: deleteFolderModal.data.name,
              parentFolderId: null,
            })
          }}
        />

        <ComposedModal
          open={moveModal.isOpen}
          size="sm"
          onClose={() => {
            moveModal.closeModal()
            setMoveTarget('ROOT')
            setAllFolders(null)
          }}
        >
          <ModalHeader
            label={undefined}
            title={`Move ${moveModal.data?.type === 'folder' ? 'folder' : moveModal.data?.type === 'files' ? 'files' : 'file'}`}
            closeModal={() => {
              moveModal.closeModal()
              setMoveTarget('ROOT')
              setAllFolders(null)
            }}
          />
          <ModalBody>
            {moveModal.data && (
              <div style={{ marginBottom: 'var(--spacing-5)' }}>
                {moveModal.data.type === 'files'
                  ? `Select a destination for ${moveModal.data.ids?.length || 0} selected files.`
                  : `Select a destination for "${moveModal.data.name}".`}
              </div>
            )}
            {moveModal.isOpen && projectId && !allFolders && (
              <FolderLoader projectId={projectId} onLoaded={setAllFolders} />
            )}
            {moveModal.isOpen && allFolders && folderId && (
              <CurrentPath allFolders={allFolders} folderId={folderId} projectName={projectName} />
            )}
            {moveModal.isOpen && allFolders && (
              <TreePicker
                allFolders={allFolders}
                value={moveTarget}
                onChange={setMoveTarget}
                disabledSet={moveDisabledSet}
                projectName={projectName}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              kind="secondary"
              onClick={() => {
                moveModal.closeModal()
                setMoveTarget('ROOT')
                setAllFolders(null)
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              kind="primary"
              onClick={() => {
                if (!moveModal.data) return
                const targetId = moveTarget === 'ROOT' ? null : moveTarget
                if (moveModal.data.type === 'files') {
                  return submitBatchMoveFiles(moveModal.data.ids || [], targetId)
                }
                if (moveModal.data.type === 'folder') {
                  return submitMoveFolder(
                    { id: moveModal.data.id, name: moveModal.data.name, parentFolderId: null },
                    targetId
                  )
                }
                const selectedFile = items.find((item) => item.id === moveModal.data?.id)
                if (selectedFile) {
                  return submitMoveFile(selectedFile, targetId)
                }
              }}
              disabled={busy || !moveModal.data}
            >
              {busy ? 'Moving...' : 'Move'}
            </Button>
          </ModalFooter>
        </ComposedModal>

        {/* Sync Modal */}
        {projectId && (
          <SyncModal
            open={syncModal.isOpen}
            onClose={syncModal.closeModal}
            projectId={projectId}
            projectName={projectName}
            onSuccess={() => {
              showToast({ kind: 'success', title: 'Synced', subtitle: 'Project synchronized with remote repository' })
              queryClient.invalidateQueries({ queryKey: ['project-contents', projectId] })
              batchCancelSelection?.()
              setBatchCancelSelection(null)
            }}
          />
        )}

        <ProjectMembersModal
          open={collaboratorsOpen && !memberManagementModalOpen}
          onClose={closeCollaborators}
          membersLoading={membersQ.isLoading}
          membersError={membersQ.isError}
          members={activeMembers}
          pendingInvites={pendingInvites}
          memberHeaders={memberHeaders}
          visibleRows={visibleMembersTableRows}
          visiblePendingInvites={visiblePendingInvites}
          collaboratorsSearch={collaboratorsSearch}
          setCollaboratorsSearch={setCollaboratorsSearch}
          collaboratorsSearchExpanded={collaboratorsSearchExpanded}
          setCollaboratorsSearchExpanded={setCollaboratorsSearchExpanded}
          canManageMembers={canManageMembers}
          canAddMembers={canOpenAddMember}
          canInviteMembers={canInviteMembers}
          canUpdateMemberRoles={canUpdateMemberRoles}
          canRemoveMembers={canRemoveMembers}
          canManageMemberDeployGrant={canManageMemberDeployGrant}
          canTransferOwnership={canTransferOwnership}
          canAssignScopedAccess={canAssignScopedProjectAccess}
          projectAccessAuthority={projectAccessAuthority}
          scopedAssignmentsVisible={canAssignScopedProjectAccess || canInspectScopedProjectLineage}
          scopedAssignmentsLoading={projectRoleAssignmentsQ.isLoading}
          scopedAssignmentsError={projectRoleAssignmentsQ.isError}
          scopedRoleAssignments={scopedProjectRoleAssignments}
          scopedRoleNamesById={assignableProjectRoleNameById}
          customRoleTagsByUser={customProjectRoleTagsByUser}
          onAddUser={() => {
            if (!manualProjectAccessEnabled || !canOpenAddMember) return
            resetAddMemberForm()
            addMemberModal.openModal()
          }}
          onAssignAccess={() => {
            if (!manualProjectAccessEnabled || !canAssignScopedProjectAccess) return
            openAssignmentModal()
          }}
          onReissuePendingInvite={(invite) => {
            if (!manualProjectAccessEnabled || !canInviteMembers) return
            submitReissuePendingInvite(invite)
          }}
          onEditRoles={(member) => {
            if (!manualProjectAccessEnabled || !canUpdateMemberRoles) return
            const current = (Array.isArray(member.roles) && member.roles.length > 0 ? member.roles : [member.role]) as ProjectRole[]
            const editable = editableProjectRoles(current)
            setEditRolesSelection(editable.length ? editable : ['viewer'])
            setEditCustomRoleIds((customProjectAssignmentsByUser.get(member.userId) || []).map((assignment) => assignment.roleId))
            editRolesModal.openModal(member)
          }}
          onToggleDeploy={(member, next) => {
            if (!manualProjectAccessEnabled || !canManageMemberDeployGrant) return
            submitUpdateDeployPermission(member, next)
          }}
          onRemove={(member) => {
            if (!manualProjectAccessEnabled || !canRemoveMembers) return
            removeMemberModal.openModal(member)
          }}
          onTransferOwnership={(member) => {
            if (!manualProjectAccessEnabled || !canTransferOwnership) return
            transferOwnershipModal.openModal(member)
          }}
          onRemoveScopedAssignment={(assignment) => {
            if (!manualProjectAccessEnabled || !canAssignScopedProjectAccess || assignment.source !== 'manual') return
            removeScopedProjectRoleAssignmentM.mutate(assignment.id)
          }}
          tagTypeForRole={tagTypeForRole}
        />

        <ProjectMembersManagementModals
          addMemberOpen={addMemberModal.isOpen}
          onCloseAddMember={() => {
            resetAddMemberForm()
            addMemberModal.closeModal()
          }}
          memberUserSearchItems={(Array.isArray(memberUserSearchQ.data) ? memberUserSearchQ.data : []) as UserSearchItem[]}
          selectedMemberUser={selectedMemberUser}
          setSelectedMemberUser={setSelectedMemberUser}
          memberUserSearch={memberUserSearch}
          setMemberUserSearch={setMemberUserSearch}
          memberEmail={memberEmail}
          setMemberEmail={setMemberEmail}
          memberEmailTouched={memberEmailTouched}
          setMemberEmailTouched={setMemberEmailTouched}
          memberRoles={memberRoles}
          setMemberRoles={setMemberRoles}
          canAssignDelegate={canAssignDelegate}
          canAddMembers={canAddMembers}
          canInviteMembers={canInviteMembers}
          canUpdateMemberRoles={canUpdateMemberRoles}
          canRemoveMembers={canRemoveMembers}
          canAssignScopedAccess={canAssignScopedProjectAccess}
          addMembersUnavailableReason={canAddMembers ? null : `Missing permission ${ProjectPermission.MEMBERS_ADD}`}
          inviteMembersUnavailableReason={canInviteMembers ? null : `Missing permission ${ProjectPermission.MEMBERS_INVITE}`}
          updateMemberRolesUnavailableReason={canUpdateMemberRoles ? null : `Missing permission ${ProjectPermission.MEMBERS_UPDATE_ROLE}`}
          removeMembersUnavailableReason={canRemoveMembers ? null : `Missing permission ${ProjectPermission.MEMBERS_REMOVE}`}
          assignScopedAccessUnavailableReason={canAssignScopedProjectAccess ? null : `Missing permission ${ProjectPermission.MEMBERS_ADD} or ${ProjectPermission.MEMBERS_UPDATE_ROLE}`}
          isMemberEmailValid={isMemberEmailValid}
          memberLookupEmail={debouncedMemberEmail}
          memberLookup={memberLookupQ.data || null}
          memberLookupLoading={memberLookupQ.isLoading}
          memberCapabilities={memberCapabilitiesQ.data || null}
          memberCapabilitiesLoading={memberCapabilitiesQ.isLoading || memberCapabilitiesQ.isFetching}
          memberDeliveryMethod={memberDeliveryMethod}
          setMemberDeliveryMethod={setMemberDeliveryMethod}
          memberInviteReveal={memberInviteReveal}
          customRoleOptions={assignableProjectRoles}
          resetAddMemberForm={resetAddMemberForm}
          submitAddMember={submitAddMember}
          assignmentOpen={assignmentModal.isOpen}
          onCloseAssignment={closeAssignmentModal}
          assignmentPrincipalType={assignmentPrincipalType}
          setAssignmentPrincipalType={setAssignmentPrincipalType}
          assignmentPrincipalIdInput={assignmentPrincipalIdInput}
          setAssignmentPrincipalIdInput={setAssignmentPrincipalIdInput}
          assignmentUserEmail={assignmentUserEmail}
          setAssignmentUserEmail={setAssignmentUserEmail}
          assignmentUserSearch={assignmentUserSearch}
          setAssignmentUserSearch={setAssignmentUserSearch}
          assignmentUserSearchItems={(Array.isArray(assignmentUsersQ.data) ? assignmentUsersQ.data : []) as UserSearchItem[]}
          selectedAssignmentUser={selectedAssignmentUser}
          setSelectedAssignmentUser={setSelectedAssignmentUser}
          assignmentRoleId={assignmentRoleId}
          setAssignmentRoleId={setAssignmentRoleId}
          assignmentError={assignmentError}
          setAssignmentError={setAssignmentError}
          assignmentSubmitting={assignScopedProjectRoleM.isPending}
          submitScopedAssignment={submitScopedProjectRoleAssignment}
          editRolesOpen={editRolesModal.isOpen}
          editRolesMember={editRolesModal.data as ProjectMember | null}
          editRolesSelection={editRolesSelection}
          setEditRolesSelection={setEditRolesSelection}
          editCustomRoleIds={editCustomRoleIds}
          setEditCustomRoleIds={setEditCustomRoleIds}
          submitUpdateRoles={(member, roles) => submitUpdateRoles(member, roles)}
          onCloseEditRoles={() => editRolesModal.closeModal()}
          removeMemberOpen={removeMemberModal.isOpen}
          removeMemberData={removeMemberModal.data as ProjectMember | null}
          onCloseRemoveMember={() => removeMemberModal.closeModal()}
          submitRemoveMember={submitRemoveMember}
          transferOwnershipOpen={transferOwnershipModal.isOpen}
          transferOwnershipMember={transferOwnershipModal.data as ProjectMember | null}
          onCloseTransferOwnership={() => transferOwnershipModal.closeModal()}
          submitTransferOwnership={submitTransferOwnership}
          transferOwnershipUnavailableReason={canTransferOwnership ? null : `Missing permission ${ProjectPermission.OWNERSHIP_TRANSFER}`}
        />

        {/* Engine Access Modal */}
        <EngineAccessModal
          open={engineAccessOpen}
          onClose={() => setEngineAccessOpen(false)}
          engineAccessQ={engineAccessQ}
          canRequestEngineAccess={canRequestEngineAccess}
          requestEngineAccessUnavailableReason={requestEngineAccessUnavailableReason}
          myMembershipLoading={myMembershipQ.isLoading}
          selectedEngineForRequest={selectedEngineForRequest}
          setSelectedEngineForRequest={setSelectedEngineForRequest}
          requestEngineAccessM={requestEngineAccessM}
        />

        {projectId && (
          <DeployDialog
            projectId={projectId}
            fileIds={selectedAtOpen}
            open={deployModal.isOpen}
            onClose={() => {
              deployModal.closeModal()
              setSelectedAtOpen([])
              setSelectedFolderAtOpen(null)
            }}
          />
        )}

        {/* Project Git Connection Settings */}
        {projectId && (
          <ProjectGitSettings
            projectId={projectId}
            open={gitSettingsOpen}
            onClose={() => setGitSettingsOpen(false)}
            canManageConnection={canManageGitConnection}
            manageConnectionUnavailableReason={canManageGitConnection ? null : `Missing permission ${ProjectPermission.GIT_CONNECT}`}
          />
        )}
        {projectId && (
          <ProjectDeploymentTargetsModal
            projectId={projectId}
            open={deploymentTargetsOpen}
            onClose={() => setDeploymentTargetsOpen(false)}
            apiScope={deploymentTargetsApiScope}
            projectEngineTargetMode={platformSettings?.projectEngineTargetMode}
            engines={enginesQ.data || []}
            enginesLoading={enginesQ.isLoading}
            canReadTargets={canReadProjectEngineTargets}
            canManageTargets={canManageProjectEngineTargets}
            readTargetsUnavailableReason={deploymentTargetsUnavailableReason}
            manageTargetsUnavailableReason={deploymentTargetsManageUnavailableReason}
          />
        )}
      </div>
    </div>
  )
}

// Loader (FolderLoader), CurrentPath, and TreePicker are now imported from '../components/project-detail'
