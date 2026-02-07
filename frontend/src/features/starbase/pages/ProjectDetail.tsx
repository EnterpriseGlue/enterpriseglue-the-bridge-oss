import React from 'react'
import { useParams, useLocation, useSearchParams } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../shared/hooks/useAuth'
import {
  Button,
  ComboBox,
  MultiSelect,
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
import { SyncModal } from '../../git/components'
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings'
import { apiClient } from '../../../shared/api/client'
import { useSelectedEngine } from '../../../components/EngineSelector'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { useToast } from '../../../shared/notifications/ToastProvider'
import { StarbaseTableShell } from '../components/StarbaseTableShell'
import { ProjectContentsTable } from './components/ProjectContentsTable'
import { ProjectMembersModal } from './components/ProjectMembersModal'
import { ProjectMembersManagementModals } from './components/ProjectMembersManagementModals'
import { ProjectDetailHeader } from './components/ProjectDetailHeader'
import { downloadBlob, toSafeDownloadFilename } from '../../../utils/safeDom'

// Import extracted utilities and components
import {
  FileItem,
  Project,
  UserSearchItem,
  FolderSummary,
  ProjectContents,
  ProjectRole,
  ProjectMember,
  COLLABORATORS_PANEL_WIDTH,
  memberHeaders,
  editableRoleOptions,
  roleLabel,
  tagTypeForRole,
  tableHeaders,
  isValidEmail,
  getFileIcon,
} from '../components/project-detail'
import {
  EngineAccessModal,
  FolderLoader,
  CurrentPath,
  TreePicker,
} from '../components/project-detail'

export default function ProjectDetail() {
  const { projectId } = useParams()
  const location = useLocation() as { state?: { name?: string } }
  const { tenantNavigate, toTenantPath, navigate } = useTenantNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = React.useState('')
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)
  // Modal hooks
  const deleteFileModal = useModal<FileItem>()
  const newFolderModal = useModal()
  const createFileModal = useModal<'bpmn' | 'dmn'>()
  const deleteFolderModal = useModal<{ id: string; name: string; preview?: { folderCount: number; fileCount: number; filesByType: { bpmn: number; dmn: number; other: number }; samplePaths: string[] } }>()
  const moveModal = useModal<{ id: string; name: string; type: 'folder' | 'file' }>()
  const deployModal = useModal()
  const syncModal = useModal()
  const [batchDeleteIds, setBatchDeleteIds] = React.useState<string[] | null>(null)
  const [batchCancelSelection, setBatchCancelSelection] = React.useState<null | (() => void)>(null)
  
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
  const inviteMemberModal = useModal()
  const editRolesModal = useModal<ProjectMember>()
  const removeMemberModal = useModal<ProjectMember>()
  const [memberEmail, setMemberEmail] = React.useState('')
  const [memberEmailTouched, setMemberEmailTouched] = React.useState(false)
  const [memberUserSearch, setMemberUserSearch] = React.useState('')
  const [selectedMemberUser, setSelectedMemberUser] = React.useState<UserSearchItem | null>(null)
  const [memberRoles, setMemberRoles] = React.useState<ProjectRole[]>(['viewer'])
  const [editRolesSelection, setEditRolesSelection] = React.useState<ProjectRole[]>(['viewer'])
  const [collaboratorsSearch, setCollaboratorsSearch] = React.useState('')
  const [collaboratorsSearchExpanded, setCollaboratorsSearchExpanded] = React.useState(false)

  // Engine access state
  const [engineAccessOpen, setEngineAccessOpen] = React.useState(false)
  const [selectedEngineForRequest, setSelectedEngineForRequest] = React.useState<string | null>(null)

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
  
  const projectsQ = useQuery({
    queryKey: ['starbase', 'projects'],
    queryFn: () => apiClient.get<Project[]>('/starbase-api/projects'),
    enabled: !!projectId,
    staleTime: 60 * 1000,
  })

  const enginesQ = useQuery({
    queryKey: ['engines','list'],
    queryFn: () => apiClient.get<any[]>('/engines-api/engines'),
    enabled: deployModal.isOpen,
  })
  // Set default deploy engine when engines load or selected engine changes
  React.useEffect(() => {
    if (deployModal.isOpen && !deployEngineId) {
      const engines = enginesQ.data || []
      if (selectedEngineId && engines.some((e: any) => e.id === selectedEngineId)) {
        setDeployEngineId(selectedEngineId)
      } else if (engines.length === 1) {
        setDeployEngineId(engines[0].id)
      } else if (engines.length > 0) {
        // Select first engine alphabetically
        const sorted = [...engines].sort((a: any, b: any) => 
          (a.name || a.baseUrl).localeCompare(b.name || b.baseUrl)
        )
        setDeployEngineId(sorted[0].id)
      }
    }
  }, [deployModal.isOpen, enginesQ.data, selectedEngineId, deployEngineId])

  const contentsQ = useQuery({
    queryKey: ['contents', projectId, folderId],
    queryFn: () => apiClient.get<ProjectContents>(
      `/starbase-api/projects/${projectId}/contents`,
      folderId ? { folderId } : undefined
    ),
    enabled: !!projectId,
  })

  const uncommittedQ = useQuery({
    queryKey: ['uncommitted-files', projectId, 'main'],
    queryFn: () => apiClient.get<{ hasUncommittedChanges: boolean; uncommittedFileIds: string[]; uncommittedFolderIds: string[] }>(
      `/vcs-api/projects/${projectId}/uncommitted-files`
    ),
    enabled: !!projectId,
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
  const showSyncButton = anySyncEnabled && hasGitConnection

  const handleBatchDelete = async () => {
    if (!batchDeleteIds || batchDeleteIds.length === 0) return
    try {
      setBusy(true)
      for (const id of batchDeleteIds) {
        const it = items.find((x) => x.id === id)
        if (!it) continue
        const url = it.type === 'folder' ? `/starbase-api/folders/${id}` : `/starbase-api/files/${id}`
        await apiClient.delete(url)
      }
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      batchCancelSelection?.()
      setBatchDeleteIds(null)
      setBatchCancelSelection(null)
    } catch {
    } finally {
      setBusy(false)
    }
  }

  async function submitUpdateDeployPermission(member: ProjectMember, allowed: boolean) {
    if (!projectId) return
    try {
      await apiClient.put(`/starbase-api/projects/${projectId}/members/${encodeURIComponent(member.userId)}/deploy-permission`, {
        allowed,
      })
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

  const nameFromList = projectsQ.data?.find((p: Project) => p.id === projectId)?.name
  const projectName = (location.state && location.state.name) ?? cachedName ?? nameFromList ?? (projectsQ.isLoading ? 'Loading...' : 'Project')

  const projectCountsFromList = projectsQ.data?.find((p: Project) => p.id === projectId)
  const subtitle = contentsQ.data
    ? `${contentsQ.data.folders.length} folders, ${contentsQ.data.files.length} files`
    : (!folderId && projectCountsFromList
        ? `${projectCountsFromList.foldersCount ?? 0} folders, ${projectCountsFromList.filesCount ?? 0} files`
        : 'Loading...')

  async function downloadFile(fileId: string, name: string) {
    try {
      const blob = await apiClient.getBlob(`/starbase-api/files/${encodeURIComponent(fileId)}/download`)
      if (!blob || blob.size === 0) return
      const safeName = toSafeDownloadFilename(name, 'file')
      downloadBlob(blob, safeName)
    } catch {
      // noop for now
    }
  }

  async function downloadFolder(folderId: string, name: string) {
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
    try {
      const blob = await apiClient.getBlob(`/starbase-api/projects/${encodeURIComponent(projectId)}/download`)
      if (!blob || blob.size === 0) return
      const safeName = toSafeDownloadFilename(`${name}.zip`, 'project.zip')
      downloadBlob(blob, safeName)
    } catch {
      // noop for now
    }
  }


  const membersQ = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => apiClient.get<ProjectMember[]>(`/starbase-api/projects/${projectId}/members`),
    enabled: !!projectId,
  })

  const myMembershipQ = useQuery({
    queryKey: ['project-members', projectId, 'me'],
    queryFn: () => apiClient.get<ProjectMember | null>(`/starbase-api/projects/${projectId}/members/me`),
    enabled: !!projectId, // Always fetch - needed for deploy permission check
  })

  // Engine access query
  type EngineAccessData = {
    accessedEngines: { engineId: string; engineName: string; grantedAt: number; autoApproved: boolean }[]
    pendingRequests: { requestId: string; engineId: string; engineName: string; requestedAt: number }[]
    availableEngines: { id: string; name: string }[]
  }
  const engineAccessQ = useQuery({
    queryKey: ['project-engine-access', projectId],
    queryFn: () => apiClient.get<EngineAccessData>(`/starbase-api/projects/${projectId}/engine-access`),
    enabled: engineAccessOpen && !!projectId,
  })

  // Engine access request mutation
  const requestEngineAccessM = useMutation({
    mutationFn: async (engineId: string) => {
      return apiClient.post<{ autoApproved?: boolean }>(
        `/engines-api/engines/${engineId}/request-access`,
        { projectId }
      )
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

  const myRoles = React.useMemo(() => {
    const m = myMembershipQ.data
    if (!m) return [] as ProjectRole[]
    const roles = (Array.isArray(m.roles) && m.roles.length > 0 ? m.roles : [m.role]) as ProjectRole[]
    return roles
  }, [myMembershipQ.data])
  const canManageMembers = myRoles.includes('owner') || myRoles.includes('delegate')
  
  // Check if user can deploy based on their role and defaultDeployRoles setting
  const canDeployByRole = React.useMemo(() => {
    const defaultDeployRoles = platformSettings?.defaultDeployRoles ?? ['owner', 'delegate', 'operator', 'deployer']
    const membership = myMembershipQ.data
    if (!membership) return false
    
    const userRoles = Array.isArray(membership.roles) && membership.roles.length > 0 
      ? membership.roles 
      : [membership.role]
    
    // Check if any of the user's roles is in defaultDeployRoles
    const hasDeployRole = userRoles.some((role: ProjectRole) => defaultDeployRoles.includes(role))
    
    // Editors can deploy if they have explicit deploy permission
    if (!hasDeployRole && membership.role === 'editor' && membership.deployAllowed) {
      return true
    }
    
    return hasDeployRole
  }, [platformSettings?.defaultDeployRoles, myMembershipQ.data])

  const roleOptions = React.useMemo<ProjectRole[]>(() => {
    const isOwner = myRoles.includes('owner')
    if (isOwner) return editableRoleOptions
    return editableRoleOptions.filter((r) => r !== 'delegate')
  }, [myRoles])

  const roleItems = React.useMemo(() => {
    return roleOptions.map((r) => ({ id: r, label: roleLabel(r) }))
  }, [roleOptions])

  const selectedMemberRoleItems = React.useMemo(() => {
    const set = new Set(memberRoles)
    return roleItems.filter((it) => set.has(it.id))
  }, [roleItems, memberRoles])

  const selectedEditRoleItems = React.useMemo(() => {
    const set = new Set(editRolesSelection)
    return roleItems.filter((it) => set.has(it.id))
  }, [roleItems, editRolesSelection])

  const resolveMemberName = React.useCallback((member: ProjectMember) => {
    const userInfo = member.user
    const fullName = userInfo
      ? `${userInfo.firstName || ''}${userInfo.firstName && userInfo.lastName ? ' ' : ''}${userInfo.lastName || ''}`.trim()
      : ''
    return fullName || (userInfo?.email ? userInfo.email.split('@')[0] : member.userId)
  }, [])

  const memberNameById = React.useMemo(() => {
    const map = new Map<string, string>()
    ;(membersQ.data || []).forEach((member) => {
      map.set(member.userId, resolveMemberName(member))
    })
    return map
  }, [membersQ.data, resolveMemberName])

  const membersTableRows = React.useMemo(() => {
    const data = membersQ.data
    if (!Array.isArray(data)) return [] as any[]
    return data.map((m) => ({
      id: m.userId,
      name: resolveMemberName(m),
      email: m.user?.email || '',
      _member: m,
    }))
  }, [membersQ.data, resolveMemberName])

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

  const memberUserSearchQ = useQuery({
    queryKey: ['project-members', projectId, 'user-search', memberUserSearch],
    queryFn: () => {
      const q = memberUserSearch.trim()
      if (q.length < 2) return Promise.resolve([] as UserSearchItem[])
      return apiClient.get<UserSearchItem[]>(
        `/starbase-api/projects/${projectId}/members/user-search`,
        q ? { q } : undefined
      )
    },
    enabled: addMemberModal.isOpen && !!projectId && memberUserSearch.trim().length >= 2,
    staleTime: 30 * 1000,
  })

  const trimmedMemberEmail = memberEmail.trim()
  const isMemberEmailValid = isValidEmail(trimmedMemberEmail)

  async function submitAddMember() {
    if (!projectId) return
    const email = memberEmail.trim()
    if (!isValidEmail(email)) return
    try {
      const body = {
        email,
        roles: memberRoles.filter((r) => r !== 'owner'),
      }
      const json = await apiClient.post<any>(`/starbase-api/projects/${projectId}/members`, body)
      const invited = !!json?.invited
      const emailSent = !!json?.emailSent
      const emailError = typeof json?.emailError === 'string' ? String(json.emailError) : ''
      const temporaryPassword = typeof json?.temporaryPassword === 'string' ? String(json.temporaryPassword) : ''

      addMemberModal.closeModal()
      setMemberEmail('')
      setMemberUserSearch('')
      setSelectedMemberUser(null)
      setMemberRoles(['viewer'])
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })

      if (invited) {
        const subtitle = emailSent
          ? `Invite email sent to ${email}`
          : `Invite created for ${email}${emailError ? `. ${emailError}` : ''}${temporaryPassword ? ` Temporary password: ${temporaryPassword}` : ''}`
        showToast({ kind: 'success', title: 'Member invited', subtitle })
      } else {
        showToast({ kind: 'success', title: 'Member added' })
      }
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to add member')
      showToast({ kind: 'error', title: 'Failed to add member', subtitle: parsed.message })
    }
  }

  async function submitRemoveMember(member: ProjectMember) {
    if (!projectId) return
    try {
      await apiClient.delete(`/starbase-api/projects/${projectId}/members/${encodeURIComponent(member.userId)}`)
      removeMemberModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      showToast({ kind: 'success', title: 'Member removed' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to remove member')
      showToast({ kind: 'error', title: 'Failed to remove member', subtitle: parsed.message })
    }
  }

  async function submitUpdateRoles(member: ProjectMember, roles: ProjectRole[]) {
    if (!projectId) return
    try {
      await apiClient.patch(`/starbase-api/projects/${projectId}/members/${encodeURIComponent(member.userId)}`, {
        roles: roles.filter((r) => r !== 'owner'),
      })
      editRolesModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      showToast({ kind: 'success', title: 'Roles updated' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to update roles')
      showToast({ kind: 'error', title: 'Failed to update roles', subtitle: parsed.message })
    }
  }

  async function submitDeleteFile(file: FileItem) {
    if (!projectId) return
    try {
      await apiClient.delete(`/starbase-api/files/${file.id}`)
      deleteFileModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      showToast({ kind: 'success', title: 'File deleted' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to delete file')
      showToast({ kind: 'error', title: 'Failed to delete file', subtitle: parsed.message })
    }
  }

  async function submitDeleteFolder(folder: FolderSummary) {
    if (!projectId) return
    try {
      await apiClient.delete(`/starbase-api/folders/${folder.id}`)
      deleteFolderModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      showToast({ kind: 'success', title: 'Folder deleted' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to delete folder')
      showToast({ kind: 'error', title: 'Failed to delete folder', subtitle: parsed.message })
    }
  }

  async function submitMoveFile(file: FileItem, targetId: string | null) {
    if (!projectId) return
    try {
      await apiClient.patch(`/starbase-api/files/${file.id}`, { folderId: targetId })
      moveModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, targetId ?? null] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, file.id] })
      showToast({ kind: 'success', title: 'File moved' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to move file')
      showToast({ kind: 'error', title: 'Failed to move file', subtitle: parsed.message })
    }
  }

  async function submitMoveFolder(folder: FolderSummary, targetId: string | null) {
    if (!projectId) return
    try {
      await apiClient.patch(`/starbase-api/folders/${folder.id}`, { parentFolderId: targetId })
      moveModal.closeModal()
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folderId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, targetId ?? null] })
      await queryClient.invalidateQueries({ queryKey: ['contents', projectId, folder.id] })
      showToast({ kind: 'success', title: 'Folder moved' })
    } catch (e: any) {
      const parsed = parseApiError(e, 'Failed to move folder')
      showToast({ kind: 'error', title: 'Failed to move folder', subtitle: parsed.message })
    }
  }

  async function submitCreateFile() {
    if (!projectId) return
    const name = newFileName.trim()
    if (!name) return
    const type = createFileModal.data ?? 'bpmn'
    try {
      setBusy(true)
      const created = await apiClient.post<{ id?: string }>(`/starbase-api/projects/${projectId}/files`, {
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
    if (!projectId) return
    const name = newFolderName.trim()
    if (!name) return
    try {
      setBusy(true)
      const created = await apiClient.post<{ id?: string }>(`/starbase-api/projects/${projectId}/folders`, {
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
            <a href={toTenantPath(`/starbase/project/${projectId}`)} onClick={(e) => { e.preventDefault(); searchParams.delete('folder'); setSearchParams(searchParams); }}>
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
          onDownloadProject={downloadProject}
        />


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
              showSyncButton={showSyncButton}
              canDeployByRole={canDeployByRole}
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
                if (file && projectId) {
                  await validateAndUploadFile({
                    file,
                    projectId,
                    folderId,
                    queryClient,
                    showToast,
                  })
                }
                if (uploadInputRef.current) uploadInputRef.current.value = ''
              }}
              onOpenMembers={openProjectMembers}
              onOpenEngineAccess={() => setEngineAccessOpen(true)}
              onUploadClick={() => uploadInputRef.current?.click()}
              onCreateFile={(type) => {
                createFileModal.openModal(type)
                setNewFileName('')
              }}
              onCreateFolder={() => newFolderModal.openModal()}
              onMoveItem={(file) => {
                if (file.type === 'folder') {
                  moveModal.openModal({ id: file.id, name: file.name, type: 'folder' })
                } else {
                  moveModal.openModal({ id: file.id, name: file.name, type: 'file' })
                }
              }}
              onDownloadFile={(file) => downloadFile(file.id, file.name)}
              onDownloadFolder={(file) => downloadFolder(file.id, file.name)}
              onDeleteItem={(file) => {
                if (file.type === 'folder') {
                  if (!file.id) return
                  apiClient.get(`/starbase-api/folders/${file.id}/delete-preview`)
                    .then((preview: any) => {
                      deleteFolderModal.openModal({ id: file.id, name: file.name, preview })
                    })
                    .catch(() => {})
                } else {
                  deleteFileModal.openModal(file)
                }
              }}
              getFileIcon={getFileIcon}
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
            label={null}
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
            label={null}
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
          open={collaboratorsOpen}
          onClose={closeCollaborators}
          membersLoading={membersQ.isLoading}
          membersError={membersQ.isError}
          members={(membersQ.data || []) as ProjectMember[]}
          memberHeaders={memberHeaders}
          visibleRows={visibleMembersTableRows}
          collaboratorsSearch={collaboratorsSearch}
          setCollaboratorsSearch={setCollaboratorsSearch}
          collaboratorsSearchExpanded={collaboratorsSearchExpanded}
          setCollaboratorsSearchExpanded={setCollaboratorsSearchExpanded}
          canManageMembers={canManageMembers}
          onInvite={() => inviteMemberModal.openModal()}
          onAddUser={() => {
            setMemberEmail('')
            setMemberEmailTouched(false)
            setMemberUserSearch('')
            setSelectedMemberUser(null)
            setMemberRoles(['viewer'])
            addMemberModal.openModal()
          }}
          onEditRoles={(member) => {
            const current = (Array.isArray(member.roles) && member.roles.length > 0 ? member.roles : [member.role]) as ProjectRole[]
            const editable = current.filter((rr) => rr !== 'owner')
            setEditRolesSelection(editable.length ? editable : ['viewer'])
            editRolesModal.openModal(member)
          }}
          onToggleDeploy={(member, next) => submitUpdateDeployPermission(member, next)}
          onRemove={(member) => removeMemberModal.openModal(member)}
          tagTypeForRole={tagTypeForRole}
        />

        <ProjectMembersManagementModals
          addMemberOpen={addMemberModal.isOpen}
          onCloseAddMember={() => addMemberModal.closeModal()}
          memberUserSearchItems={(Array.isArray(memberUserSearchQ.data) ? memberUserSearchQ.data : []) as UserSearchItem[]}
          selectedMemberUser={selectedMemberUser}
          setSelectedMemberUser={setSelectedMemberUser}
          memberUserSearch={memberUserSearch}
          setMemberUserSearch={setMemberUserSearch}
          memberEmail={memberEmail}
          setMemberEmail={setMemberEmail}
          memberEmailTouched={memberEmailTouched}
          setMemberEmailTouched={setMemberEmailTouched}
          roleItems={roleItems}
          selectedMemberRoleItems={selectedMemberRoleItems}
          setMemberRoles={setMemberRoles}
          isMemberEmailValid={isMemberEmailValid}
          submitAddMember={submitAddMember}
          inviteMemberOpen={inviteMemberModal.isOpen}
          onInviteClose={() => inviteMemberModal.closeModal()}
          onInviteSuccess={() => queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })}
          projectId={projectId}
          projectName={projectName}
          editRolesOpen={editRolesModal.isOpen}
          editRolesMember={editRolesModal.data as ProjectMember | null}
          selectedEditRoleItems={selectedEditRoleItems}
          setEditRolesSelection={setEditRolesSelection}
          submitUpdateRoles={(member, roles) => submitUpdateRoles(member, roles)}
          onCloseEditRoles={() => editRolesModal.closeModal()}
          removeMemberOpen={removeMemberModal.isOpen}
          removeMemberData={removeMemberModal.data as ProjectMember | null}
          onCloseRemoveMember={() => removeMemberModal.closeModal()}
          submitRemoveMember={submitRemoveMember}
        />

        {/* Engine Access Modal */}
        <EngineAccessModal
          open={engineAccessOpen}
          onClose={() => setEngineAccessOpen(false)}
          engineAccessQ={engineAccessQ}
          canManageMembers={canManageMembers}
          myMembershipLoading={myMembershipQ.isLoading}
          selectedEngineForRequest={selectedEngineForRequest}
          setSelectedEngineForRequest={setSelectedEngineForRequest}
          requestEngineAccessM={requestEngineAccessM}
        />
      </div>
    </div>
  )
}

// Loader (FolderLoader), CurrentPath, and TreePicker are now imported from '../components/project-detail'
