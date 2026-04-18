import React from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { sanitizePathParam } from '../../../shared/utils/sanitize'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs, TabList, Tab, TabPanels, TabPanel, Button, BreadcrumbItem, InlineNotification, ComboBox, ComposedModal, ModalHeader, ModalBody, ModalFooter, DataTable, Table, TableHead, TableRow, TableHeader, TableBody, TableCell, TableContainer, Link as CarbonLink } from '@carbon/react'
import { Flag, Undo, Redo, Branch, Launch, Information } from '@carbon/icons-react'
import { BreadcrumbBar } from '../../shared/components/BreadcrumbBar'
import { useModal } from '../../../shared/hooks/useModal'
import Canvas from '../components/Canvas'
import CanvasToolbar from '../components/CanvasToolbar'
import HistoryPanel from '../components/HistoryPanel'
import { useXmlHistory } from '../hooks/useXmlHistory'
import CommitModal from '../components/CommitModal'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import type { File as StarbaseFile } from '../../../shared/api/types'
import { buildEditorBreadcrumbBackState, buildEditorNavigationState, getEditorBreadcrumbTrail } from '../utils/editorBreadcrumbs'
import { buildProjectFileIndex, resolveLinkedFile, type ProjectFileMeta } from '../utils/linkResolution'
import type { FolderSummary, ProjectMember } from '../components/project-detail/project-detail-utils'
import { FolderLoader, CurrentPath, TreePicker } from '../components/project-detail/FolderTreeHelpers'
import { useElementLinkOverlay } from '../hooks/useElementLinkOverlay'
import { getElementLinkInfo, updateElementLink, clearElementLink } from '../utils/bpmnLinking'
import { buildLinkedDecisionCreationPayload, buildLinkedProcessCreationPayload, getCreateLinkedProcessName } from '../utils/processCreation'
const DMNCanvas = React.lazy(() => import('../components/DMNCanvas'))
const DMNDrdMini = React.lazy(() => import('../components/DMNDrdMini'))
const DMNEvaluatePanel = React.lazy(() => import('../components/DMNEvaluatePanel'))
// Properties panel is provided by camunda-bpmn-js and mounted by Canvas
import DeployButton from '../../git/components/DeployButton'
import GitVersionsPanel from '../../git/components/GitVersionsPanel'
import { gitApi } from '../../git/api/gitApi'
import { useGitRepository } from '../../git/hooks/useGitRepository'
import { usePlatformSyncSettings } from '../../platform-admin/hooks/usePlatformSyncSettings'
import { ProjectAccessError, isProjectAccessError } from '../components/ProjectAccessError'
import { useSelectedEngine } from '../../../components/EngineSelector'
import { useEngineSelectorStore } from '../../../stores/engineSelectorStore'
import { useToast } from '../../../shared/notifications/ToastProvider'
import { useAuth } from '../../../shared/hooks/useAuth'
import { toSafeInternalPath } from '../../../utils/safeNavigation'
import { redirectTo, replaceAndReloadToInternalPath } from '../../../utils/redirect'
import { canDeployProject, type ProjectEngineAccessData } from '../utils/deployEligibility'
import { LoadingState } from '../../shared/components/LoadingState'
import type { LockHolder, LockResponse } from '../../git/types/git'

type FolderBreadcrumb = {
  id: string
  name: string
}

type FileDetail = {
  id: string
  projectId: string
  projectName: string
  folderId: string | null
  folderBreadcrumb: FolderBreadcrumb[]
  name: string
  type: 'bpmn' | 'dmn'
  xml: string
  bpmnProcessId?: string | null
  dmnDecisionId?: string | null
  createdAt: number
  updatedAt: number
}

type CallerOccurrence = {
  parentFileId: string
  parentFileName: string
  parentFolderId: string | null
  parentProcessId: string | null
  callActivityId: string
  callActivityName: string | null
}

type CallerTableRow = {
  id: string
  parent: string
  activity: string
  location: string
  actionLabel: string
  caller: CallerOccurrence
}

function toDisplayFileName(name: string | null | undefined): string {
  return String(name || '').replace(/\.(bpmn|dmn)$/i, '')
}

function formatUsedInParentProcessesLabel(count: number): string {
  return `Used in ${count} parent ${count === 1 ? 'process' : 'processes'}`
}

type DeploymentArtifact = {
  kind?: string
  key?: string
  version?: number
}

type LatestDeploymentByFile = {
  engineId?: string
  engineName?: string | null
  environmentTag?: string | null
  deployedAt?: number | null
  fileId?: string
  artifacts?: DeploymentArtifact[]
}

type FileCommitRef = {
  id: string
  fileVersionNumber?: number | null
}

type MissionControlTarget = {
  engineId: string
  path: '/mission-control/processes' | '/mission-control/decisions'
  keyParam: 'process' | 'decision'
  key: string
  version: number
}

type RestoreFromCommitResponse = {
  restored: boolean
  fileId: string
  commitId: string
  fileVersionNumber?: number | null
  updatedAt: number
}

type CollaborationLock = LockResponse
type CollaborationHolder = LockHolder

export default function Editor() {
  const { fileId } = useParams()
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation() as { state?: any; search: string }
  const { notify } = useToast()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const currentUserId = String(user?.id || '')
  const phase2Params = React.useMemo(() => new URLSearchParams(location.search || ''), [location.search])
  const phase2Source = String(phase2Params.get('source') || '')
  const phase2IsMissionControl = phase2Source === 'mission-control'
  const phase2ProcessKey = String(phase2Params.get('process') || '')
  const phase2DecisionKey = String(phase2Params.get('decision') || '')
  const phase2CommitId = String(phase2Params.get('commitId') || '') || null
  const phase2ProcessVersion = React.useMemo(() => {
    const v = Number(phase2Params.get('version'))
    return Number.isFinite(v) && v > 0 ? Math.trunc(v) : null
  }, [phase2Params])
  const phase2FileVersion = React.useMemo(() => {
    const v = Number(phase2Params.get('fileVersion'))
    return Number.isFinite(v) && v > 0 ? Math.trunc(v) : null
  }, [phase2Params])
  const phase2EngineId = String(phase2Params.get('engineId') || '')
  const phase2CanRestore = Boolean(phase2CommitId || typeof phase2FileVersion === 'number')
  const [phase2Dismissed, setPhase2Dismissed] = React.useState(false)
  const phase2AutoDismissedRef = React.useRef(false)

  // View / Hotfix mode state
  const [editorMode, setEditorMode] = React.useState<'normal' | 'view' | 'hotfix'>(() => {
    if (!fileId) return 'normal'
    try {
      const stored = sessionStorage.getItem(`hotfix-context-${fileId}`)
      if (stored) return 'hotfix'
    } catch {}
    return 'normal'
  })
  const [hotfixContext, setHotfixContext] = React.useState<{ fromCommitId: string | null; fromFileVersion: number | null } | null>(() => {
    if (!fileId) return null
    try {
      const stored = sessionStorage.getItem(`hotfix-context-${fileId}`)
      if (stored) return JSON.parse(stored)
    } catch {}
    return null
  })
  const [showSaveFirstPrompt, setShowSaveFirstPrompt] = React.useState(false)
  const editorModeRef = React.useRef(editorMode)
  React.useEffect(() => { editorModeRef.current = editorMode }, [editorMode])
  const viewModeImportedRef = React.useRef(false)

  const cleanEditorPath = React.useMemo(
    () => (fileId ? `/starbase/editor/${encodeURIComponent(sanitizePathParam(String(fileId)))}` : '/starbase'),
    [fileId]
  )
  const safeEditorTenantPath = React.useMemo(
    () => toSafeInternalPath(toTenantPath(cleanEditorPath), toTenantPath('/starbase')),
    [cleanEditorPath, toTenantPath]
  )
  const navigateFromBreadcrumb = React.useCallback((path: string, options?: { state?: any }) => {
    if (collaborationReadOnlyRef.current) {
      redirectTo(toTenantPath(path))
      return
    }
    tenantNavigate(path, options)
  }, [tenantNavigate, toTenantPath])
  const fileQ = useQuery({
    queryKey: ['file', fileId],
    queryFn: () => apiClient.get<FileDetail>(`/starbase-api/files/${fileId}`),
    enabled: !!fileId,
    staleTime: Infinity, // Don't refetch - we manage XML state locally
    // When navigating between editor files, we still need a fresh server fetch.
    // Otherwise we can end up rendering an indefinitely-fresh cached XML that doesn't include the latest link data
    // until the user hard-refreshes the page.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false, // Prevent refetch on tab switch which would reset canvas
  })

  const editorBreadcrumbTrail = React.useMemo(
    () => getEditorBreadcrumbTrail(location.state, fileId ? String(fileId) : null),
    [location.state, fileId]
  )

  const buildCurrentEditorNavigationState = React.useCallback(
    (extraState?: Record<string, unknown>) => buildEditorNavigationState({
      currentState: location.state,
      currentFileId: fileId ? String(fileId) : null,
      currentFileName: fileQ.data?.name ?? null,
      extraState,
    }),
    [location.state, fileId, fileQ.data?.name]
  )

  const projectFilesQ = useQuery({
    queryKey: ['starbase', 'project-files', fileQ.data?.projectId],
    queryFn: () => apiClient.get<StarbaseFile[]>(`/starbase-api/projects/${fileQ.data?.projectId}/files`),
    enabled: !!fileQ.data?.projectId,
    refetchOnMount: 'always',
    staleTime: 30 * 1000,
  })

  const callersQ = useQuery({
    queryKey: ['starbase', 'file-callers', fileQ.data?.projectId, fileQ.data?.id, fileQ.data?.type, fileQ.data?.bpmnProcessId, fileQ.data?.dmnDecisionId],
    queryFn: async () => {
      if (!fileQ.data?.projectId || !fileQ.data?.id) return [] as CallerOccurrence[]
      const data = await apiClient.get<{ callers?: CallerOccurrence[] }>(
        `/starbase-api/projects/${fileQ.data.projectId}/files/${fileQ.data.id}/callers`
      )
      return Array.isArray(data?.callers) ? data.callers : []
    },
    enabled: Boolean(fileQ.data?.projectId && fileQ.data?.id && (fileQ.data?.type === 'bpmn' || fileQ.data?.type === 'dmn')),
    staleTime: 30 * 1000,
  })

  // Declare hooks unconditionally to keep a stable hook order across renders
  const [selection, setSelection] = React.useState<{ id: string; type: string; name?: string } | null>(null)
  const selectionIdRef = React.useRef<string | null>(null)
  const [tabIndex, setTabIndex] = React.useState(0) // 0: Design, 1: Implement
  const propRef = React.useRef<HTMLDivElement | null>(null)
  const [propEl, setPropEl] = React.useState<HTMLDivElement | null>(null)
  const setPropHostRef = React.useCallback((el: HTMLDivElement | null) => {
    if (propRef.current === el) return
    propRef.current = el
    setPropEl(el)
  }, [])
  const [overlayOpen, setOverlayOpen] = React.useState(false)
  const [versionsPanelOpen, setVersionsPanelOpen] = React.useState(false)
  const commitModal = useModal()
  const [dmnEvaluateOpen, setDmnEvaluateOpen] = React.useState(false)
  const modelerRef = React.useRef<any | null>(null)
  const [modelerReady, setModelerReady] = React.useState(false)
  const [saving, setSaving] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveFeedbackTokenRef = React.useRef(0)
  const saveFeedbackTimerRef = React.useRef<number | null>(null)
  const [collaborationLock, setCollaborationLock] = React.useState<CollaborationLock | null>(null)
  const [collaborationHolder, setCollaborationHolder] = React.useState<CollaborationHolder | null>(null)
  const [collaborationMode, setCollaborationMode] = React.useState<'acquiring' | 'owner' | 'blocked' | 'superseded'>('acquiring')
  const [collaborationError, setCollaborationError] = React.useState<string | null>(null)
  const [takeoverModalOpen, setTakeoverModalOpen] = React.useState(false)
  const [takeoverPending, setTakeoverPending] = React.useState(false)
  const [recoveryPending, setRecoveryPending] = React.useState<'copy' | 'reload' | null>(null)
  const updatedAtRef = React.useRef<number | null>(null)
  const [lastEditedAt, setLastEditedAt] = React.useState<number | null>(null)
  const [lastEditedAtHydrated, setLastEditedAtHydrated] = React.useState(false)
  const [localDirty, setLocalDirty] = React.useState(false)
  const [linkStateVersion, setLinkStateVersion] = React.useState(0)
  const [decisionKey, setDecisionKey] = React.useState<string | undefined>(undefined)
  const [historyPanelOpen, setHistoryPanelOpen] = React.useState(false)
  const isRestoringRef = React.useRef(false)
  const appliedInitialHistoryRef = React.useRef(false)
  const autosaveTimerRef = React.useRef<number | null>(null)
  const addXmlHistorySnapshotRef = React.useRef<(xml: string, label: string) => void>(() => {})
  const ignoreDirtyUntilRef = React.useRef(0)
  const [projectFilesError, setProjectFilesError] = React.useState<string | null>(null)
  const [linkModalOpen, setLinkModalOpen] = React.useState(false)
  const [linkSelectedFileId, setLinkSelectedFileId] = React.useState<string | null>(null)
  const [linkModalError, setLinkModalError] = React.useState<string | null>(null)
  const [creatingLinkedProcess, setCreatingLinkedProcess] = React.useState(false)
  const [allFolders, setAllFolders] = React.useState<FolderSummary[] | null>(null)
  const [callersModalOpen, setCallersModalOpen] = React.useState(false)
  const lastFocusRef = React.useRef<HTMLElement | null>(null)
  const focusElementAttemptedRef = React.useRef<string | null>(null)
  const collaborationLockIdRef = React.useRef<string | null>(null)
  const lastInteractionAtRef = React.useRef(Date.now())
  const lastHeartbeatInteractionAtRef = React.useRef(0)
  const acquireInFlightRef = React.useRef(false)
  const blockingTakeoverPromptFileRef = React.useRef<string | null>(null)

  const collaborationCanWrite = collaborationMode === 'owner'
  const collaborationReadOnly = editorMode === 'view' || !collaborationCanWrite
  const collaborationReadOnlyRef = React.useRef(collaborationReadOnly)
  React.useEffect(() => {
    collaborationReadOnlyRef.current = collaborationReadOnly
  }, [collaborationReadOnly])

  const captureFocus = React.useCallback(() => {
    if (typeof document === 'undefined') return
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      lastFocusRef.current = active
    }
  }, [])

  const restoreFocus = React.useCallback(() => {
    if (typeof document === 'undefined') return
    const target = lastFocusRef.current
    if (target && document.contains(target)) {
      target.focus()
      return
    }
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      active.blur()
    }
  }, [])

  const lastEditedAtStorageKey = React.useMemo(
    () => (fileId ? `starbase:lastEditedAt:${fileId}` : null),
    [fileId]
  )

  const lastSelectionStorageKey = React.useMemo(
    () => (fileId ? `starbase:lastSelection:${fileId}` : null),
    [fileId]
  )

  const clearPendingAutosave = React.useCallback(() => {
    if (typeof window === 'undefined') return
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  const clearSaveFeedbackTimer = React.useCallback(() => {
    if (typeof window === 'undefined') return
    if (saveFeedbackTimerRef.current != null) {
      window.clearTimeout(saveFeedbackTimerRef.current)
      saveFeedbackTimerRef.current = null
    }
  }, [])

  const beginTrackedSaveFeedback = React.useCallback(() => {
    saveFeedbackTokenRef.current += 1
    const token = saveFeedbackTokenRef.current
    clearSaveFeedbackTimer()
    setSaving('saving')
    return token
  }, [clearSaveFeedbackTimer])

  const finishTrackedSaveFeedback = React.useCallback((token: number, state: 'idle' | 'saved' | 'error', resetAfterMs: number) => {
    if (token !== saveFeedbackTokenRef.current) return
    clearSaveFeedbackTimer()
    setSaving(state)
    if (state === 'idle' || typeof window === 'undefined') return
    saveFeedbackTimerRef.current = window.setTimeout(() => {
      if (token !== saveFeedbackTokenRef.current) return
      setSaving('idle')
      saveFeedbackTimerRef.current = null
    }, resetAfterMs)
  }, [clearSaveFeedbackTimer])

  const wasSaveRequestAttempted = React.useCallback((error: unknown): boolean => {
    return Boolean(error && typeof error === 'object' && 'saveRequestAttempted' in error && (error as { saveRequestAttempted?: boolean }).saveRequestAttempted)
  }, [])

  const captureCurrentXmlSnapshot = React.useCallback(async (label: string = 'Navigation snapshot') => {
    const modeler = modelerRef.current
    if (!modeler || !fileId) return
    try {
      const { xml } = await modeler.saveXML({ format: true })
      if (xml) {
        addXmlHistorySnapshotRef.current(xml, label)
      }
    } catch {}
  }, [fileId])

  const snapshotBeforeEditorNavigation = React.useCallback(async () => {
    clearPendingAutosave()
    if (!collaborationReadOnlyRef.current) {
      try { await captureCurrentXmlSnapshot() } catch {}
    }
  }, [clearPendingAutosave, captureCurrentXmlSnapshot])

  const refreshLinkedElementState = React.useCallback(() => {
    setLinkStateVersion((current) => current + 1)
    setLastEditedAt(Date.now())
  }, [])

  const handleSelectionChange = React.useCallback(
    (next: { id: string; type: string; name?: string } | null) => {
      selectionIdRef.current = next?.id ?? null
      setSelection(next)
      if (!lastSelectionStorageKey) return
      try {
        if (next?.id) sessionStorage.setItem(lastSelectionStorageKey, next.id)
      } catch {}
    },
    [lastSelectionStorageKey]
  )

  // Reset editor state when navigating to a different file
  React.useEffect(() => {
    clearPendingAutosave()
    clearSaveFeedbackTimer()
    saveFeedbackTokenRef.current += 1
    setSelection(null)
    selectionIdRef.current = null
    setTabIndex(0)
    setOverlayOpen(false)
    setVersionsPanelOpen(false)
    setDmnEvaluateOpen(false)
    modelerRef.current = null
    setModelerReady(false)
    setSaving('idle')
    setLastEditedAtHydrated(false)
    setLastEditedAt(null)
    setLocalDirty(false)
    setHistoryPanelOpen(false)
    setLinkModalOpen(false)
    setLinkSelectedFileId(null)
    setLinkModalError(null)
    setCreatingLinkedProcess(false)
    setCallersModalOpen(false)
    setCollaborationLock(null)
    setCollaborationHolder(null)
    setCollaborationMode('acquiring')
    setCollaborationError(null)
    setTakeoverModalOpen(false)
    setTakeoverPending(false)
    setRecoveryPending(null)
    updatedAtRef.current = null
    appliedInitialHistoryRef.current = false
    ignoreDirtyUntilRef.current = 0
    setEditorMode('normal')
    setHotfixContext(null)
    setShowSaveFirstPrompt(false)
    viewModeImportedRef.current = false
    focusElementAttemptedRef.current = null
    blockingTakeoverPromptFileRef.current = null
  }, [fileId, clearPendingAutosave, clearSaveFeedbackTimer])

  React.useEffect(() => {
    return () => {
      clearPendingAutosave()
      clearSaveFeedbackTimer()
    }
  }, [clearPendingAutosave, clearSaveFeedbackTimer])

  const projectFiles = React.useMemo<ProjectFileMeta[]>(() => {
    if (!Array.isArray(projectFilesQ.data)) return []
    return projectFilesQ.data
      .filter((f): f is StarbaseFile => Boolean(f && f.id && f.name))
      .map((f) => {
        const anyF = f as any
        const tyRaw = String(anyF.type ?? 'bpmn').toLowerCase()
        const type = (tyRaw === 'dmn' ? 'dmn' : tyRaw === 'form' ? 'form' : 'bpmn') as 'bpmn' | 'dmn' | 'form'

        const folderIdRaw = anyF.folderId ?? anyF.folder_id ?? null
        const bpmnProcessId = anyF.bpmnProcessId ?? anyF.bpmn_process_id ?? null
        const dmnDecisionId = anyF.dmnDecisionId ?? anyF.dmn_decision_id ?? null

        return {
          id: String(anyF.id),
          name: String(anyF.name),
          type,
          folderId: folderIdRaw ? String(folderIdRaw) : null,
          bpmnProcessId: bpmnProcessId ? String(bpmnProcessId) : null,
          dmnDecisionId: dmnDecisionId ? String(dmnDecisionId) : null,
          isSelf: String(anyF.id) === fileId,
        }
      })
  }, [projectFilesQ.data, fileId])

  const projectFileIndex = React.useMemo(() => buildProjectFileIndex(projectFiles), [projectFiles])

  React.useEffect(() => {
    if (projectFilesQ.isError) {
      const parsed = parseApiError(projectFilesQ.error, 'Failed to load project files')
      setProjectFilesError(parsed.message)
      return
    }
    setProjectFilesError(null)
  }, [projectFilesQ.isError, projectFilesQ.error])

  const selectedElement = React.useMemo(() => {
    if (!modelerReady || !selection?.id || !modelerRef.current) return null
    try {
      const registry = modelerRef.current.get?.('elementRegistry')
      return registry?.get(selection.id) || null
    } catch {
      return null
    }
  }, [modelerReady, selection])

  const elementLinkInfo = React.useMemo(
    () => getElementLinkInfo(selectedElement),
    // Linking updates properties on the same businessObject reference; lastEditedAt changes on commandStack events.
    [selectedElement, lastEditedAt, linkStateVersion]
  )

  const resolvedLink = React.useMemo(() => {
    if (!elementLinkInfo) return null
    return resolveLinkedFile(projectFileIndex, {
      fileId: elementLinkInfo.fileId,
      processId: elementLinkInfo.linkType === 'process' ? elementLinkInfo.targetKey : null,
      decisionId: elementLinkInfo.linkType === 'decision' ? elementLinkInfo.targetKey : null,
    })
  }, [elementLinkInfo, projectFileIndex])

  const linkStatus = React.useMemo(() => {
    if (!elementLinkInfo) return 'unlinked'
    if (resolvedLink) return 'linked'
    if (elementLinkInfo.targetKey || elementLinkInfo.fileId) return 'missing'
    return 'unlinked'
  }, [elementLinkInfo, resolvedLink])

  const isMessageEndEventLink = elementLinkInfo?.elementType === 'EndEvent' && elementLinkInfo?.linkType === 'process'

  React.useEffect(() => {
    if (!modelerReady || !selectedElement || !elementLinkInfo || !resolvedLink || !modelerRef.current) return
    const desiredTargetKey =
      elementLinkInfo.linkType === 'decision' ? resolvedLink.dmnDecisionId : resolvedLink.bpmnProcessId
    if (!desiredTargetKey) return

    const needsUpdate =
      elementLinkInfo.fileId !== resolvedLink.id ||
      elementLinkInfo.targetKey !== desiredTargetKey ||
      elementLinkInfo.fileName !== resolvedLink.name
    if (!needsUpdate) return

    updateElementLink(modelerRef.current, selectedElement, {
      linkType: elementLinkInfo.linkType,
      targetKey: desiredTargetKey,
      fileId: resolvedLink.id,
      fileName: resolvedLink.name,
      nameSyncMode: elementLinkInfo.nameSyncMode,
      syncName: elementLinkInfo.nameSyncMode === 'auto',
    })
  }, [modelerReady, selectedElement, elementLinkInfo, resolvedLink])

  const linkTypeLabel = elementLinkInfo?.linkType === 'decision' ? 'decision' : 'process'
  const linkedLabel = toDisplayFileName(resolvedLink?.name ?? elementLinkInfo?.fileName ?? null) || null
  const canOpenLinked = Boolean(resolvedLink)
  const createLinkedProcessName = React.useMemo(
    () => getCreateLinkedProcessName(selectedElement, elementLinkInfo?.linkType ?? null),
    [selectedElement, elementLinkInfo?.linkType, lastEditedAt]
  )
  const createActionLabel = elementLinkInfo?.linkType === 'decision' ? 'Create decision' : 'Create process'
  const currentProjectId = fileQ.data?.projectId ?? null
  const currentFolderId = fileQ.data?.folderId ?? null

  const collaborationLocksQ = useQuery({
    queryKey: ['git-locks', currentProjectId],
    queryFn: () => gitApi.getLocks(String(currentProjectId)),
    enabled: Boolean(currentProjectId && fileQ.data?.id),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  })

  const remoteFileLock = React.useMemo<CollaborationLock | null>(() => {
    const locks = collaborationLocksQ.data?.locks || []
    const targetFileId = String(fileQ.data?.id || '')
    return locks.find((lock: CollaborationLock) => String(lock.fileId) === targetFileId) || null
  }, [collaborationLocksQ.data?.locks, fileQ.data?.id])

  const buildHolderFromLock = React.useCallback((lock: CollaborationLock | null): CollaborationHolder | null => {
    if (!lock || String(lock.userId || '') === currentUserId) return null
    return {
      userId: lock.userId,
      name: String(lock.userName || `User ${String(lock.userId).slice(0, 8)}`),
      acquiredAt: lock.acquiredAt,
      heartbeatAt: lock.heartbeatAt,
      lastInteractionAt: lock.lastInteractionAt,
      visibilityState: lock.visibilityState,
      visibilityChangedAt: lock.visibilityChangedAt,
      sessionStatus: lock.sessionStatus,
    }
  }, [currentUserId])

  const collaborationSummary = React.useMemo(() => {
    if (!collaborationHolder) return null
    if (collaborationMode === 'superseded') {
      return {
        kind: 'error' as const,
        title: <><strong>{collaborationHolder.name}</strong> took over this draft</>,
        subtitle: 'Your unsaved work is still visible locally, but this editor is now read-only until you explicitly take over again.',
      }
    }
    if (collaborationHolder.sessionStatus === 'active') {
      return {
        kind: 'warning' as const,
        title: <><strong>{collaborationHolder.name}</strong> is actively editing this draft</>,
        subtitle: 'You can review the current draft in read-only mode or take over editing explicitly.',
      }
    }
    if (collaborationHolder.sessionStatus === 'idle') {
      return {
        kind: 'info' as const,
        title: <><strong>{collaborationHolder.name}</strong> appears idle in this draft</>,
        subtitle: 'You can take over editing if you need to continue working on this file.',
      }
    }
    return {
      kind: 'info' as const,
      title: <><strong>{collaborationHolder.name}</strong> left this tab hidden</>,
      subtitle: 'You can take over editing if they are no longer actively working here.',
    }
  }, [collaborationHolder, collaborationMode])

  const collaborationTakeoverPrompt = React.useMemo(() => {
    if (!collaborationHolder) return null
    if (collaborationHolder.sessionStatus === 'active') {
      return {
        title: <><strong>{collaborationHolder.name}</strong> is actively editing this draft.</>,
        subtitle: 'Taking over switches their editor to read-only. Your current tab will become writable immediately, and your unsaved local work stays in place.',
      }
    }
    if (collaborationHolder.sessionStatus === 'idle') {
      return {
        title: <><strong>{collaborationHolder.name}</strong> appears idle in this draft.</>,
        subtitle: 'You can take over editing if you need to continue working on this file. Your current tab will become writable immediately, and your unsaved local work stays in place.',
      }
    }
    return {
      title: <><strong>{collaborationHolder.name}</strong> left this draft hidden.</>,
      subtitle: 'You can take over editing if they are no longer actively working here. Your current tab will become writable immediately, and your unsaved local work stays in place.',
    }
  }, [collaborationHolder])

  const collaborationHeaderStatus = React.useMemo(() => {
    if (editorMode === 'view') {
      return {
        label: 'View only',
        background: '#e8f1ff',
        color: '#002d9c',
      }
    }

    if (collaborationMode === 'acquiring') {
      return {
        label: 'Connecting',
        background: '#edf5ff',
        color: '#0043ce',
      }
    }

    if (collaborationMode === 'owner') {
      if (collaborationLock?.sessionStatus === 'idle') {
        return {
          label: 'Idle',
          background: '#fff1c2',
          color: '#8a3800',
        }
      }

      return {
        label: 'Editing',
        background: '#defbe6',
        color: '#0e6027',
      }
    }

    return {
      label: 'View only',
      background: '#f4f4f4',
      color: '#525252',
    }
  }, [editorMode, collaborationMode, collaborationLock?.sessionStatus])

  const shouldRenderCollaborationOverlay = React.useMemo(() => {
    return editorMode !== 'view' && collaborationReadOnly && collaborationMode === 'superseded'
  }, [editorMode, collaborationReadOnly, collaborationMode])

  const openBlockingTakeoverPrompt = React.useCallback(() => {
    const targetFileId = String(fileQ.data?.id || fileId || '')
    if (!targetFileId) return
    if (blockingTakeoverPromptFileRef.current === targetFileId) return
    blockingTakeoverPromptFileRef.current = targetFileId
    setTakeoverModalOpen(true)
  }, [fileQ.data?.id, fileId])

  const acquireCollaborationLock = React.useCallback(async (force = false) => {
    if (!fileQ.data?.id || !currentUserId || acquireInFlightRef.current) return null
    acquireInFlightRef.current = true
    setCollaborationError(null)
    try {
      const lock = await gitApi.acquireLock({
        fileId: fileQ.data.id,
        force,
        visibilityState: typeof document !== 'undefined' && document.hidden ? 'hidden' : 'visible',
        hasInteraction: true,
      })
      collaborationLockIdRef.current = lock.id
      setCollaborationLock(lock)
      setCollaborationHolder(null)
      setCollaborationMode('owner')
      setTakeoverModalOpen(false)
      if (force) {
        notify({
          kind: 'success',
          title: 'Editing takeover complete',
          subtitle: 'You are now the active editor for this draft.',
        })
        // Refresh file data so the editor shows the latest XML saved by the previous owner
        const freshFile = await queryClient.fetchQuery({
          queryKey: ['file', fileQ.data!.id],
          queryFn: () => apiClient.get<FileDetail>(`/starbase-api/files/${fileQ.data!.id}`),
          staleTime: 0,
        })
        if (freshFile?.xml && modelerRef.current) {
          try {
            isRestoringRef.current = true
            ignoreDirtyUntilRef.current = Date.now() + 2000
            await modelerRef.current.importXML(freshFile.xml)
            if (typeof freshFile.updatedAt === 'number') {
              updatedAtRef.current = freshFile.updatedAt
            }
            try { fitViewport(modelerRef.current) } catch {}
          } finally {
            isRestoringRef.current = false
          }
        }
      }
      collaborationLocksQ.refetch()
      return lock
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to acquire editing access')
      const holder = parsed.payload?.lockHolder as CollaborationHolder | undefined
      if (holder) {
        setCollaborationHolder(holder)
        setCollaborationMode(force ? 'blocked' : 'blocked')
        if (holder.sessionStatus === 'active') {
          openBlockingTakeoverPrompt()
        } else {
          setTakeoverModalOpen(false)
        }
        return null
      }
      setCollaborationError(parsed.message)
      setCollaborationMode('blocked')
      return null
    } finally {
      acquireInFlightRef.current = false
    }
  }, [fileQ.data?.id, currentUserId, notify, collaborationLocksQ, openBlockingTakeoverPrompt, queryClient])

  const releaseCollaborationLock = React.useCallback(async () => {
    const lockId = collaborationLockIdRef.current
    if (!lockId) return
    collaborationLockIdRef.current = null
    try {
      await gitApi.releaseLock(lockId)
    } catch {}
  }, [])

  React.useEffect(() => {
    if (!fileQ.data?.id || !currentUserId) return
    if (collaborationMode === 'superseded' && remoteFileLock && String(remoteFileLock.userId) === currentUserId) {
      return
    }
    if (remoteFileLock && String(remoteFileLock.userId) === currentUserId) {
      collaborationLockIdRef.current = remoteFileLock.id
      setCollaborationLock(remoteFileLock)
      setCollaborationHolder(null)
      setCollaborationMode('owner')
      setTakeoverModalOpen(false)
      return
    }
    if (remoteFileLock) {
      const holder = buildHolderFromLock(remoteFileLock)
      collaborationLockIdRef.current = null
      setCollaborationHolder(holder)
      setCollaborationLock(null)
      if (remoteFileLock.sessionStatus === 'active') {
        openBlockingTakeoverPrompt()
      }
      setCollaborationMode((current: 'acquiring' | 'owner' | 'blocked' | 'superseded') => (current === 'owner' ? 'superseded' : 'blocked'))
      return
    }
    if (editorMode !== 'view' && collaborationMode !== 'owner') {
      acquireCollaborationLock(false)
    }
  }, [fileQ.data?.id, currentUserId, remoteFileLock, buildHolderFromLock, acquireCollaborationLock, collaborationMode, editorMode, openBlockingTakeoverPrompt])

  React.useEffect(() => {
    lastInteractionAtRef.current = Date.now()
    const markInteraction = () => {
      lastInteractionAtRef.current = Date.now()
    }
    if (typeof window === 'undefined') return
    window.addEventListener('pointerdown', markInteraction)
    window.addEventListener('keydown', markInteraction)
    window.addEventListener('focus', markInteraction)
    return () => {
      window.removeEventListener('pointerdown', markInteraction)
      window.removeEventListener('keydown', markInteraction)
      window.removeEventListener('focus', markInteraction)
    }
  }, [fileId])

  React.useEffect(() => {
    if (!collaborationLockIdRef.current || collaborationMode !== 'owner') return
    let cancelled = false
    const sendHeartbeat = async () => {
      const hasInteraction = lastInteractionAtRef.current > lastHeartbeatInteractionAtRef.current
      try {
        const response = await gitApi.sendHeartbeat(collaborationLockIdRef.current!, {
          visibilityState: typeof document !== 'undefined' && document.hidden ? 'hidden' : 'visible',
          hasInteraction,
        })
        if (cancelled) return
        if (hasInteraction) {
          lastHeartbeatInteractionAtRef.current = lastInteractionAtRef.current
        }
        if (response.lock) {
          setCollaborationLock(response.lock)
        }
      } catch {}
    }
    // Heartbeat must be shorter than LOCK_TIMEOUT_MS (default 45s) to keep the lock alive.
    const interval = window.setInterval(sendHeartbeat, typeof document !== 'undefined' && document.hidden ? 40_000 : 30_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [collaborationMode, collaborationLock?.id])

  // SSE: Subscribe to lock events for instant takeover notification + live canvas sync
  React.useEffect(() => {
    const targetFileId = fileQ.data?.id
    if (!targetFileId || collaborationMode === 'acquiring') return
    if (editorMode === 'view') return

    // Build the SSE URL with tenant prefix (EventSource doesn't go through fetch interceptor)
    const tenantMatch = window.location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
    const tenantSlug = tenantMatch?.[1] ? decodeURIComponent(tenantMatch[1]) : 'default'
    const sseUrl = `/t/${encodeURIComponent(tenantSlug)}/git-api/locks/${encodeURIComponent(targetFileId)}/events`

    let es: EventSource | null = null
    try {
      es = new EventSource(sseUrl, { withCredentials: true })

      // Owner: listen for lock-revoked (someone took over)
      es.addEventListener('lock-revoked', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          // Ignore if this tab is the one performing the takeover
          if (acquireInFlightRef.current) {
            return
          }
          const takerName = data.newOwnerName || 'Another user'
          setCollaborationHolder({
            userId: data.newOwnerId,
            name: takerName,
            acquiredAt: Date.now(),
            heartbeatAt: Date.now(),
            lastInteractionAt: Date.now(),
            visibilityState: 'visible',
            visibilityChangedAt: Date.now(),
            sessionStatus: 'active',
          })
          collaborationLockIdRef.current = null
          setCollaborationLock(null)
          setCollaborationMode('superseded')
          setTakeoverModalOpen(true)
          void queryClient.invalidateQueries({ queryKey: ['git-locks', currentProjectId] })
        } catch {}
      })

      // Blocked/view-only: listen for file-updated (owner saved changes)
      es.addEventListener('file-updated', () => {
        if (collaborationReadOnlyRef.current && modelerRef.current) {
          (async () => {
            try {
              const freshFile = await queryClient.fetchQuery({
                queryKey: ['file', targetFileId],
                queryFn: () => apiClient.get<any>(`/starbase-api/files/${targetFileId}`),
                staleTime: 0,
              })
              if (freshFile?.xml && modelerRef.current) {
                isRestoringRef.current = true
                ignoreDirtyUntilRef.current = Date.now() + 2000
                await modelerRef.current.importXML(freshFile.xml)
                if (typeof freshFile.updatedAt === 'number') {
                  updatedAtRef.current = freshFile.updatedAt
                }
                isRestoringRef.current = false
              }
            } catch {
              isRestoringRef.current = false
            }
          })()
        }
      })

      es.onerror = () => {
        // SSE connection lost — no action needed, polling is the fallback
      }
    } catch {
      // EventSource not supported or URL construction failed — fall back to polling
    }

    return () => {
      if (es) {
        es.close()
        es = null
      }
    }
  }, [fileQ.data?.id, collaborationMode, editorMode, queryClient])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handlePageHide = () => {
      releaseCollaborationLock()
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [releaseCollaborationLock])

  React.useEffect(() => {
    return () => {
      releaseCollaborationLock()
    }
  }, [releaseCollaborationLock])

  const ensureCollaborationWriteAllowed = React.useCallback(() => {
    if (collaborationCanWrite) return
    if (collaborationMode === 'superseded') {
      throw new Error('Another user has taken over this draft. Your local changes are preserved, but editing is read-only until you take over again.')
    }
    throw new Error('This draft is currently read-only because another user owns the editing session.')
  }, [collaborationCanWrite, collaborationMode])

  const handleTakeover = React.useCallback(async () => {
    setTakeoverPending(true)
    try {
      await acquireCollaborationLock(true)
    } finally {
      setTakeoverPending(false)
    }
  }, [acquireCollaborationLock])

  const readCurrentEditorXml = React.useCallback(async () => {
    if (modelerRef.current) {
      try {
        const saved = await modelerRef.current.saveXML({ format: true })
        if (saved?.xml) return saved.xml
      } catch {
        try {
          const saved = await modelerRef.current.saveXML()
          if (saved?.xml) return saved.xml
        } catch {}
      }
    }

    return String(fileQ.data?.xml || '')
  }, [fileQ.data?.xml])

  const handleReloadSharedVersion = React.useCallback(() => {
    setRecoveryPending('reload')
    clearPendingAutosave()
    setLocalDirty(false)
    setLastEditedAt(null)
    setTakeoverModalOpen(false)
    try {
      if (fileId) {
        localStorage.removeItem(`xml-history-${fileId}`)
      }
      if (fileId) {
        sessionStorage.removeItem(`starbase:lastEditedAt:${fileId}`)
      }
    } catch {}
    if (fileId) {
      queryClient.invalidateQueries({ queryKey: ['file', fileId] })
    }
    replaceAndReloadToInternalPath(safeEditorTenantPath, toTenantPath('/starbase'))
  }, [clearPendingAutosave, fileId, queryClient, safeEditorTenantPath, toTenantPath])

  const handleSaveLocalWorkAsCopy = React.useCallback(async () => {
    if (!currentProjectId || !fileQ.data) return

    setRecoveryPending('copy')
    try {
      const xml = await readCurrentEditorXml()
      const baseName = toDisplayFileName(fileQ.data.name) || 'Recovered draft'
      const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
      const candidates = [
        `${baseName} (Recovered copy)`,
        `${baseName} (Recovered copy ${stamp})`,
      ]

      let created: { id?: string; name?: string } | null = null
      let lastError: unknown = null
      for (const candidate of candidates) {
        try {
          created = await apiClient.post<{ id?: string; name?: string }>(
            `/starbase-api/projects/${currentProjectId}/files`,
            {
              name: candidate,
              type: fileQ.data.type,
              folderId: currentFolderId,
              xml,
            }
          )
          break
        } catch (error) {
          lastError = error
          const parsed = parseApiError(error, 'Failed to save local work as copy')
          if (parsed.status === 409) continue
          throw error
        }
      }

      if (!created?.id) {
        throw lastError || new Error('Failed to save local work as copy')
      }

      await queryClient.invalidateQueries({ queryKey: ['starbase', 'project-files', currentProjectId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', currentProjectId] })

      notify({
        kind: 'success',
        title: 'Local work saved as copy',
        subtitle: `${String(created.name || 'Recovered copy')} was created from your local draft.`,
      })

      tenantNavigate(`/starbase/editor/${encodeURIComponent(sanitizePathParam(String(created.id)))}`, {
        state: buildCurrentEditorNavigationState(),
      })
    } catch (error) {
      const parsed = parseApiError(error, 'Failed to save local work as copy')
      notify({
        kind: 'error',
        title: 'Failed to save local work as copy',
        subtitle: parsed.message,
      })
    } finally {
      setRecoveryPending(null)
    }
  }, [currentProjectId, fileQ.data, readCurrentEditorXml, currentFolderId, queryClient, notify, tenantNavigate, buildCurrentEditorNavigationState])

  const buildFileCallersQueryKey = React.useCallback(
    (targetFile: Pick<ProjectFileMeta, 'id' | 'type' | 'bpmnProcessId' | 'dmnDecisionId'> | null | undefined) => {
      if (!currentProjectId || !targetFile?.id) return null
      return [
        'starbase',
        'file-callers',
        currentProjectId,
        targetFile.id,
        targetFile.type,
        targetFile.bpmnProcessId ?? null,
        targetFile.dmnDecisionId ?? null,
      ] as const
    },
    [currentProjectId]
  )

  const updateCallerCacheForTarget = React.useCallback(
    (
      targetFile: Pick<ProjectFileMeta, 'id' | 'type' | 'bpmnProcessId' | 'dmnDecisionId'> | null | undefined,
      mode: 'add' | 'remove'
    ) => {
      const queryKey = buildFileCallersQueryKey(targetFile)
      if (!queryKey || !fileId || !fileQ.data?.name || !elementLinkInfo) return

      const bo = selectedElement?.businessObject || selectedElement
      const rawName = typeof bo?.name === 'string' ? bo.name.trim() : ''
      const caller: CallerOccurrence = {
        parentFileId: String(fileId),
        parentFileName: fileQ.data.name,
        parentFolderId: fileQ.data.folderId ?? null,
        parentProcessId: fileQ.data.type === 'bpmn' ? (fileQ.data.bpmnProcessId ?? null) : null,
        callActivityId: elementLinkInfo.elementId,
        callActivityName: rawName || null,
      }

      queryClient.setQueryData(queryKey, (old: unknown) => {
        const existing = Array.isArray(old)
          ? old.filter((item): item is CallerOccurrence => Boolean(item && typeof item === 'object'))
          : []
        const matchesCaller = (item: CallerOccurrence) => item.parentFileId === caller.parentFileId && item.callActivityId === caller.callActivityId

        if (mode === 'remove') {
          return existing.filter((item) => !matchesCaller(item))
        }

        const withoutCurrent = existing.filter((item) => !matchesCaller(item))
        return [...withoutCurrent, caller]
      })
    },
    [buildFileCallersQueryKey, fileId, fileQ.data?.name, fileQ.data?.folderId, fileQ.data?.type, fileQ.data?.bpmnProcessId, elementLinkInfo, selectedElement, queryClient]
  )

  const openLinkedFile = React.useCallback(() => {
    if (!resolvedLink) return
    // Invalidate the target file query to ensure fresh data loads
    queryClient.invalidateQueries({ queryKey: ['file', resolvedLink.id] })
    if (currentProjectId) {
      queryClient.invalidateQueries({ queryKey: ['starbase', 'file-callers', currentProjectId, resolvedLink.id] })
    }
    ;(async () => {
      await snapshotBeforeEditorNavigation()
      tenantNavigate(`/starbase/editor/${resolvedLink.id}`, {
        state: buildCurrentEditorNavigationState(),
      })
    })()
  }, [tenantNavigate, resolvedLink, queryClient, buildCurrentEditorNavigationState, snapshotBeforeEditorNavigation, currentProjectId])

  const syncLinkedElementName = React.useCallback(async () => {
    if (!elementLinkInfo || !resolvedLink || !selectedElement || !modelerRef.current) return
    const targetKey = elementLinkInfo.linkType === 'decision' ? resolvedLink.dmnDecisionId : resolvedLink.bpmnProcessId
    if (!targetKey) return

    updateElementLink(modelerRef.current, selectedElement, {
      linkType: elementLinkInfo.linkType,
      targetKey,
      fileId: resolvedLink.id,
      fileName: resolvedLink.name,
      nameSyncMode: elementLinkInfo.nameSyncMode,
      syncName: true,
    })
    refreshLinkedElementState()

    const saved = await saveLinkUpdate('Linked name synced', 'Failed to sync the linked element name. Please try again.')
    if (!saved) {
      notify({
        kind: 'error',
        title: 'Name sync failed',
        subtitle: 'Failed to sync the linked element name. Please try again.',
      })
      return
    }
    updateCallerCacheForTarget(resolvedLink, 'add')
  }, [elementLinkInfo, resolvedLink, selectedElement, notify, updateCallerCacheForTarget, refreshLinkedElementState])

  const setElementNameSyncMode = React.useCallback(async (mode: 'manual' | 'auto') => {
    if (!elementLinkInfo || !resolvedLink || !selectedElement || !modelerRef.current) return
    const targetKey = elementLinkInfo.linkType === 'decision' ? resolvedLink.dmnDecisionId : resolvedLink.bpmnProcessId
    if (!targetKey) return

    updateElementLink(modelerRef.current, selectedElement, {
      linkType: elementLinkInfo.linkType,
      targetKey,
      fileId: resolvedLink.id,
      fileName: resolvedLink.name,
      nameSyncMode: mode,
      syncName: mode === 'auto',
    })
    refreshLinkedElementState()

    const saved = await saveLinkUpdate('Link sync updated', 'Failed to update linked name sync settings. Please try again.')
    if (!saved) {
      notify({
        kind: 'error',
        title: 'Sync settings failed',
        subtitle: 'Failed to update linked name sync settings. Please try again.',
      })
    }
  }, [elementLinkInfo, resolvedLink, selectedElement, notify, refreshLinkedElementState])

  const unlinkElement = React.useCallback(() => {
    if (!elementLinkInfo || !modelerRef.current || !selectedElement) return
    clearElementLink(modelerRef.current, selectedElement, elementLinkInfo.linkType)
    refreshLinkedElementState()
  }, [elementLinkInfo, selectedElement, refreshLinkedElementState])

  const openLinkModal = React.useCallback(() => {
    captureFocus()
    setLinkModalOpen(true)
  }, [captureFocus])

  const closeLinkModal = React.useCallback(() => {
    setLinkModalOpen(false)
    restoreFocus()
  }, [restoreFocus])

  React.useEffect(() => {
    if (!linkModalOpen) return
    setLinkModalError(null)
    setLinkSelectedFileId(resolvedLink?.id ?? null)
    projectFilesQ.refetch()
  }, [linkModalOpen, resolvedLink, projectFiles])

  const folderMap = React.useMemo(() => {
    const map = new Map<string, FolderSummary>()
    if (Array.isArray(allFolders)) {
      for (const folder of allFolders) map.set(folder.id, folder)
    }
    return map
  }, [allFolders])

  const callers = callersQ.data ?? []
  const callerGroups = React.useMemo(() => {
    const groups = new Map<string, { parentFileId: string; parentFileName: string; parentFolderId: string | null; items: CallerOccurrence[] }>()
    for (const caller of callers) {
      const key = `${caller.parentFileId}:${caller.parentProcessId || ''}`
      const existing = groups.get(key)
      if (existing) {
        existing.items.push(caller)
      } else {
        groups.set(key, {
          parentFileId: caller.parentFileId,
          parentFileName: caller.parentFileName,
          parentFolderId: caller.parentFolderId,
          items: [caller],
        })
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.parentFileName.localeCompare(b.parentFileName))
  }, [callers])
  const usedByButtonLabel = callersQ.isLoading ? 'Used in parent processes…' : formatUsedInParentProcessesLabel(callerGroups.length)
  const showUsedByAction = fileQ.data?.type === 'bpmn' || fileQ.data?.type === 'dmn'
  const callerTableHeaders = React.useMemo(
    () => ([
      { key: 'parent', header: 'Parent process' },
      { key: 'activity', header: 'Linked element' },
      { key: 'location', header: 'Location' },
      { key: 'actionLabel', header: 'Open' },
    ]),
    []
  )

  const getFolderPath = React.useCallback((folderId: string | null) => {
    if (!folderId) return []
    const parts: string[] = []
    let current: string | null = folderId
    while (current) {
      const folder = folderMap.get(current)
      if (!folder) break
      parts.unshift(folder.name)
      current = folder.parentFolderId
    }
    return parts
  }, [folderMap])

  const callerTableRows = React.useMemo<CallerTableRow[]>(() => {
    return callers
      .map((caller) => {
        const pathLabel = getFolderPath(caller.parentFolderId).join(' / ')
        return {
          id: `${caller.parentFileId}:${caller.callActivityId}`,
          parent: toDisplayFileName(caller.parentFileName),
          activity: caller.callActivityName || caller.callActivityId,
          location: pathLabel || 'Project root',
          actionLabel: 'Open',
          caller,
        }
      })
      .sort((a, b) => {
        const parentCompare = a.parent.localeCompare(b.parent)
        return parentCompare !== 0 ? parentCompare : a.activity.localeCompare(b.activity)
      })
  }, [callers, getFolderPath])

  const openCallersModal = React.useCallback(() => {
    captureFocus()
    setCallersModalOpen(true)
  }, [captureFocus])

  const closeCallersModal = React.useCallback(() => {
    setCallersModalOpen(false)
    restoreFocus()
  }, [restoreFocus])

  const openCallerOccurrence = React.useCallback((caller: CallerOccurrence) => {
    ;(async () => {
      await snapshotBeforeEditorNavigation()
      tenantNavigate(`/starbase/editor/${encodeURIComponent(sanitizePathParam(caller.parentFileId))}`, {
        state: buildCurrentEditorNavigationState({ focusElementId: caller.callActivityId }),
      })
      setCallersModalOpen(false)
    })()
  }, [tenantNavigate, buildCurrentEditorNavigationState, snapshotBeforeEditorNavigation])

  const linkTargetType = elementLinkInfo?.linkType === 'decision' ? 'dmn' : 'bpmn'
  const filteredLinkFiles = React.useMemo(() => {
    return projectFiles
      .filter((file) => file.type === linkTargetType)
      .filter((file) => !file.isSelf)
      .sort((a, b) => toDisplayFileName(a.name).localeCompare(toDisplayFileName(b.name)))
  }, [projectFiles, linkTargetType])

  const selectedLinkFile = React.useMemo(
    () => filteredLinkFiles.find((file) => file.id === linkSelectedFileId) || null,
    [filteredLinkFiles, linkSelectedFileId]
  )

  const completeInlineLabelEditing = React.useCallback(() => {
    if (!modelerRef.current) return
    try {
      const directEditing = modelerRef.current.get?.('directEditing')
      if (!directEditing) return
      if (typeof directEditing.isActive === 'function' && !directEditing.isActive()) return
      if (typeof directEditing.complete === 'function') {
        directEditing.complete()
      }
      window.setTimeout(() => {
        setLastEditedAt(Date.now())
      }, 0)
    } catch {}
  }, [])

  useElementLinkOverlay({
    modeler: modelerRef.current,
    elementId: elementLinkInfo?.elementId ?? null,
    visible: Boolean(elementLinkInfo),
    readOnly: collaborationReadOnly,
    status: linkStatus as any,
    isMessageEndEventLink,
    linkedLabel,
    linkTypeLabel,
    canOpen: canOpenLinked,
    canCreateProcess: Boolean(createLinkedProcessName),
    createProcessDisabled: creatingLinkedProcess,
    createActionLabel,
    nameSyncMode: elementLinkInfo?.nameSyncMode ?? 'manual',
    canSyncName: Boolean(resolvedLink),
    onTriggerClick: completeInlineLabelEditing,
    onLink: openLinkModal,
    onOpen: openLinkedFile,
    onCreateProcess: handleCreateLinkedFile,
    onSyncName: syncLinkedElementName,
    onSetNameSyncMode: setElementNameSyncMode,
    onUnlink: unlinkElement,
  })

  // Persistent XML history for undo/redo across page refreshes
  const xmlHistory = useXmlHistory(fileId)
  addXmlHistorySnapshotRef.current = xmlHistory.addSnapshot
  const gitRepositoryQ = useGitRepository(fileQ.data?.projectId)
  const hasGitRepository = Boolean(gitRepositoryQ.data)
  const versioningModeResolved = !fileQ.data?.projectId || gitRepositoryQ.isSuccess || gitRepositoryQ.isError
  
  // Query for uncommitted changes status
  const uncommittedQ = useQuery({
    queryKey: ['uncommitted-files', fileQ.data?.projectId, 'draft'],
    queryFn: () => apiClient.get<{ hasUncommittedChanges: boolean; uncommittedFileIds: string[] }>(
      `/vcs-api/projects/${fileQ.data?.projectId}/uncommitted-files`,
      { baseline: 'draft' }
    ),
    enabled: !!fileQ.data?.projectId && hasGitRepository,
    refetchInterval: 30000, // Refresh every 30 seconds
  })
  
  const hasUncommittedChanges = hasGitRepository ? (uncommittedQ.data?.hasUncommittedChanges ?? false) : false
  const fileIsUncommitted = Boolean(
    hasGitRepository &&
      fileId &&
      Array.isArray(uncommittedQ.data?.uncommittedFileIds) &&
      uncommittedQ.data!.uncommittedFileIds.includes(fileId)
  )

  const isAutoCommitMessage = React.useCallback((message: string | null | undefined) => {
    const msg = String(message || '').toLowerCase()
    return msg.startsWith('sync from starbase') ||
      msg.startsWith('merge from draft') ||
      msg.startsWith('pull from remote')
  }, [])

  const latestFileCommitQ = useQuery({
    queryKey: ['vcs', 'latest-file-commit', fileQ.data?.projectId, fileId],
    queryFn: async () => {
      if (!fileQ.data?.projectId || !fileId) return null as FileCommitRef | null
      const data = await apiClient.get<{ commits: FileCommitRef[] }>(
        `/vcs-api/projects/${fileQ.data.projectId}/commits`,
        { branch: 'all', fileId }
      )
      const commits = Array.isArray(data.commits) ? data.commits : []
      const nonAuto = commits.filter((commit: any) => !isAutoCommitMessage(commit?.message))
      return nonAuto.length > 0 ? nonAuto[0] : null
    },
    enabled: !!fileQ.data?.projectId && !!fileId && hasGitRepository,
    staleTime: 10_000,
    refetchOnMount: 'always',
  })
  const hasUnsavedVersion = Boolean(
    typeof lastEditedAt === 'number' && (
      localDirty ||
      fileIsUncommitted ||
      !hasGitRepository
    )
  )

  // Restore lastEditedAt across navigation within the same browser session.
  React.useEffect(() => {
    if (!lastEditedAtStorageKey) return
    try {
      const raw = sessionStorage.getItem(lastEditedAtStorageKey)
      const parsed = raw ? Number(raw) : NaN
      if (Number.isFinite(parsed)) {
        setLastEditedAt(parsed)
      } else {
        setLastEditedAt(null)
      }
    } catch {
      setLastEditedAt(null)
    } finally {
      setLastEditedAtHydrated(true)
    }
  }, [lastEditedAtStorageKey])

  // Persist lastEditedAt updates so the Versions panel can show "Edited X ago" after navigation.
  React.useEffect(() => {
    if (!lastEditedAtStorageKey || !lastEditedAtHydrated) return
    try {
      if (typeof lastEditedAt === 'number' && Number.isFinite(lastEditedAt)) {
        sessionStorage.setItem(lastEditedAtStorageKey, String(lastEditedAt))
      } else {
        sessionStorage.removeItem(lastEditedAtStorageKey)
      }
    } catch {}
  }, [lastEditedAt, lastEditedAtHydrated, lastEditedAtStorageKey])

  // Open overlay automatically in Implement tab (hook must be before any early return)
  React.useEffect(() => {
    setOverlayOpen(tabIndex === 1)
  }, [tabIndex])

  // When properties drawer opens with no selection, select the root (or first participant)
  React.useEffect(() => {
    if (!overlayOpen) return
    const m = modelerRef.current
    if (!m) return
    try {
      const selection = m.get('selection')
      const canvas = m.get('canvas')
      const elementRegistry = m.get('elementRegistry')
      const current = selection && selection.get && selection.get()
      if (current && current.length) return
      const root = canvas.getRootElement()
      let target = root
      const bo = root && root.businessObject
      if (bo && bo.$type === 'bpmn:Collaboration' && Array.isArray(bo.participants) && bo.participants.length) {
        const participant = bo.participants[0]
        const participantShape = elementRegistry.get(participant.id)
        if (participantShape) target = participantShape
      }
      selection.select(target)
    } catch {}
  }, [overlayOpen])

  // DMN evaluate mutation
  const selectedEngineId = useSelectedEngine()
  const setSelectedEngineId = useEngineSelectorStore((s) => s.setSelectedEngineId)
  const { data: platformSettings } = usePlatformSyncSettings()

  const deployMembershipQ = useQuery({
    queryKey: ['project-members', fileQ.data?.projectId, 'me'],
    queryFn: () => apiClient.get<ProjectMember | null>(`/starbase-api/projects/${fileQ.data?.projectId}/members/me`),
    enabled: !!fileQ.data?.projectId,
    staleTime: 60 * 1000,
  })

  const deployEngineAccessQ = useQuery({
    queryKey: ['project-engine-access', fileQ.data?.projectId],
    queryFn: () => apiClient.get<ProjectEngineAccessData>(`/starbase-api/projects/${fileQ.data?.projectId}/engine-access`),
    enabled: !!fileQ.data?.projectId,
    staleTime: 30 * 1000,
  })

  const canDeployCurrentFile = React.useMemo(() => {
    return canDeployProject(
      deployMembershipQ.data,
      deployEngineAccessQ.data,
      platformSettings?.defaultDeployRoles
    )
  }, [deployEngineAccessQ.data, deployMembershipQ.data, platformSettings?.defaultDeployRoles])

  const engineDeploymentsLatestQ = useQuery({
    queryKey: ['engine-deployments', fileQ.data?.projectId, 'latest'],
    queryFn: () => apiClient.get<LatestDeploymentByFile[]>(`/starbase-api/projects/${fileQ.data?.projectId}/engine-deployments/latest`),
    enabled: !!fileQ.data?.projectId,
    staleTime: 30_000,
    retry: false,
  })

  const buildMissionControlTarget = React.useCallback(
    (file: FileDetail | null | undefined, rows: LatestDeploymentByFile[] | undefined, engineIdOverride?: string | null) => {
      if (!file) return null

      const list = Array.isArray(rows) ? rows : []
      const forFile = list.filter((r) => String(r?.fileId || '') === String(file.id))
      if (forFile.length === 0) return null

      const selectedEngineMatch = engineIdOverride
        ? forFile.find((r) => String(r?.engineId || '') === String(engineIdOverride))
        : null
      const row = selectedEngineMatch || forFile[0]
      const engineId = String(row?.engineId || '')
      if (!engineId) return null

      const artifacts = Array.isArray(row?.artifacts) ? row.artifacts : []

      if (file.type === 'bpmn') {
        const processArtifacts = artifacts
          .filter((a) => String(a?.kind || '') === 'process' && String(a?.key || ''))
          .sort((a, b) => Number(b?.version || 0) - Number(a?.version || 0))
        const best = processArtifacts[0]
        const version = Number(best?.version)
        const key = String(best?.key || '')
        if (!key || !Number.isFinite(version)) return null

        return {
          engineId,
          path: '/mission-control/processes',
          keyParam: 'process',
          key,
          version,
        } as MissionControlTarget
      }

      if (file.type === 'dmn') {
        const decisionArtifacts = artifacts
          .filter((a) => String(a?.kind || '') === 'decision' && String(a?.key || ''))
          .sort((a, b) => Number(b?.version || 0) - Number(a?.version || 0))
        const best = decisionArtifacts[0]
        const version = Number(best?.version)
        const key = String(best?.key || '')
        if (!key || !Number.isFinite(version)) return null

        return {
          engineId,
          path: '/mission-control/decisions',
          keyParam: 'decision',
          key,
          version,
        } as MissionControlTarget
      }

      return null
    },
    []
  )

  const missionControlTarget = React.useMemo<MissionControlTarget | null>(
    () => buildMissionControlTarget(fileQ.data, engineDeploymentsLatestQ.data, selectedEngineId),
    [fileQ.data, engineDeploymentsLatestQ.data, selectedEngineId, buildMissionControlTarget]
  )

  const missionControlEngine = React.useMemo(() => {
    if (!phase2EngineId || !fileQ.data) return null
    const list = Array.isArray(engineDeploymentsLatestQ.data) ? engineDeploymentsLatestQ.data : []
    return list.find((row) => String(row?.engineId || '') === phase2EngineId && String(row?.fileId || '') === String(fileQ.data.id)) || null
  }, [phase2EngineId, fileQ.data, engineDeploymentsLatestQ.data])

  const missionControlEngineLabel = React.useMemo(() => {
    if (!phase2EngineId) return ''
    const env = missionControlEngine?.environmentTag || null
    const name = missionControlEngine?.engineName || null
    return String(env || name || `Engine ${phase2EngineId}`)
  }, [missionControlEngine, phase2EngineId])

  const missionControlDeployedLabel = React.useMemo(() => {
    if (typeof phase2ProcessVersion === 'number') return `v${phase2ProcessVersion}`
    return ''
  }, [phase2ProcessVersion])

  const missionControlStarbaseLabel = React.useMemo(() => {
    if (typeof phase2FileVersion === 'number') return `v${phase2FileVersion}`
    if (phase2CommitId) return `commit ${String(phase2CommitId).slice(0, 7)}`
    return ''
  }, [phase2FileVersion, phase2CommitId])


  const handleGoToMissionControl = React.useCallback(async () => {
    const file = fileQ.data
    if (!file) return

    let latestRows = engineDeploymentsLatestQ.data
    try {
      const refetchResult = await engineDeploymentsLatestQ.refetch()
      if (Array.isArray(refetchResult.data)) {
        latestRows = refetchResult.data
      }
    } catch {
      // Ignore refetch errors; fall back to cached data
    }

    const target = buildMissionControlTarget(file, latestRows, selectedEngineId)
    if (!target) return

    setSelectedEngineId(target.engineId)
    const params = new URLSearchParams({
      engineId: target.engineId,
      [target.keyParam]: target.key,
      version: String(target.version),
    })
    tenantNavigate(`${target.path}?${params.toString()}`)
  }, [fileQ.data, engineDeploymentsLatestQ.data, engineDeploymentsLatestQ.refetch, selectedEngineId, buildMissionControlTarget, setSelectedEngineId, tenantNavigate])

  const evaluateMutation = useMutation({
    mutationFn: async (variables: Record<string, { value: any; type: string }>) => {
      if (!decisionKey) throw new Error('No decision key')
      return apiClient.post(
        `/mission-control-api/decision-definitions/key/${decisionKey}/evaluate`,
        { variables, engineId: selectedEngineId }
      )
    }
  })

  // Snapshot query for view mode — fetch XML for the target deployed version
  const viewSnapshotQ = useQuery({
    queryKey: ['vcs', 'snapshots', fileQ.data?.projectId, phase2CommitId],
    queryFn: () => apiClient.get<{ files: Array<{ name: string; type: string; content: string | null; changeType: string }> }>(
      `/vcs-api/projects/${fileQ.data!.projectId}/commits/${phase2CommitId}/snapshots`
    ),
    enabled: !!fileQ.data?.projectId && !!phase2CommitId && editorMode === 'view',
    staleTime: Infinity,
  })

  // Import snapshot XML into modeler when entering view mode
  React.useEffect(() => {
    if (editorMode !== 'view' || !modelerReady || !modelerRef.current || viewModeImportedRef.current) return
    const files = viewSnapshotQ.data?.files
    if (!files || files.length === 0) return

    const fileName = fileQ.data?.name
    const fileType = fileQ.data?.type

    // Find the right file snapshot (same logic as GitVersionsPanel)
    let match = files.find((f) => f.name === fileName && f.type === fileType && f.content)
    if (!match) match = files.find((f) => f.name === fileName && f.content)
    if (!match) match = files.find((f) => f.type === fileType && f.content)
    if (!match) match = files.find((f) => f.content != null)

    if (match?.content) {
      viewModeImportedRef.current = true
      isRestoringRef.current = true
      modelerRef.current.importXML(match.content).then(() => {
        isRestoringRef.current = false
        try { fitViewport(modelerRef.current) } catch {}
      }).catch(() => {
        isRestoringRef.current = false
      })
    }
  }, [editorMode, modelerReady, viewSnapshotQ.data, fileQ.data?.name, fileQ.data?.type])

  // Extract decision key from DMN XML
  React.useEffect(() => {
    if (fileQ.data?.type === 'dmn' && fileQ.data.xml) {
      try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(fileQ.data.xml, 'text/xml')
        const decision = doc.querySelector('decision')
        const key = decision?.getAttribute('id')
        setDecisionKey(key || undefined)
      } catch {
        setDecisionKey(undefined)
      }
    }
  }, [fileQ.data])

  // Initialize history with the loaded XML (only once) - must be before early returns
  React.useEffect(() => {
    if (fileQ.data?.xml) {
      xmlHistory.initializeWithXml(fileQ.data.xml)
    }
  }, [fileQ.data?.xml, xmlHistory.initializeWithXml])

  // Handle restoring from history - must be before early returns
  const handleGoToSnapshot = React.useCallback((index: number) => {
    const xml = xmlHistory.goToSnapshot(index)
    if (xml && modelerRef.current) {
      isRestoringRef.current = true
      modelerRef.current.importXML(xml).then(() => {
        try {
          const m = modelerRef.current
          const selId = selectionIdRef.current
          if (m && selId) {
            const el = m.get('elementRegistry')?.get(selId)
            if (el) m.get('selection')?.select(el)
          }
        } catch {}
        setTimeout(() => { isRestoringRef.current = false }, 100)
      }).catch(() => {
        isRestoringRef.current = false
      })
    }
  }, [xmlHistory])

  const handleUndo = React.useCallback(() => {
    const xml = xmlHistory.undo()
    if (xml && modelerRef.current) {
      isRestoringRef.current = true
      modelerRef.current.importXML(xml).then(() => {
        try {
          const m = modelerRef.current
          const selId = selectionIdRef.current
          if (m && selId) {
            const el = m.get('elementRegistry')?.get(selId)
            if (el) m.get('selection')?.select(el)
          }
        } catch {}
        setTimeout(() => { isRestoringRef.current = false }, 100)
      }).catch(() => {
        isRestoringRef.current = false
      })
    }
  }, [xmlHistory])

  const handleRedo = React.useCallback(() => {
    const xml = xmlHistory.redo()
    if (xml && modelerRef.current) {
      isRestoringRef.current = true
      modelerRef.current.importXML(xml).then(() => {
        try {
          const m = modelerRef.current
          const selId = selectionIdRef.current
          if (m && selId) {
            const el = m.get('elementRegistry')?.get(selId)
            if (el) m.get('selection')?.select(el)
          }
        } catch {}
        setTimeout(() => { isRestoringRef.current = false }, 100)
      }).catch(() => {
        isRestoringRef.current = false
      })
    }
  }, [xmlHistory])

  const fitViewport = React.useCallback((m: any) => {
    try {
      const canvas = m?.get?.('canvas')
      if (!canvas) return
      window.setTimeout(() => {
        try {
          canvas.zoom('fit-viewport')
        } catch {}
      }, 0)
    } catch {}
  }, [])

  // Keyboard shortcuts for undo/redo using persistent history
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in an input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      
      // Ctrl+Z or Cmd+Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (xmlHistory.canUndo) {
          e.preventDefault()
          e.stopPropagation()
          handleUndo()
        }
      }
      
      // Ctrl+Y or Cmd+Shift+Z for redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        if (xmlHistory.canRedo) {
          e.preventDefault()
          e.stopPropagation()
          handleRedo()
        }
      }
    }
    
    // Use capture phase to intercept before bpmn-js
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [xmlHistory.canUndo, xmlHistory.canRedo, handleUndo, handleRedo])

  React.useEffect(() => {
    if (appliedInitialHistoryRef.current) return
    if (!modelerReady) return
    const m = modelerRef.current
    if (!m) return

    const snapshots = xmlHistory.snapshots
    if (!snapshots || snapshots.length === 0) {
      appliedInitialHistoryRef.current = true
      return
    }

    const hasValidIndex =
      xmlHistory.currentIndex >= 0 && xmlHistory.currentIndex < snapshots.length
    const index = hasValidIndex ? xmlHistory.currentIndex : snapshots.length - 1
    const snapshot = snapshots[index]
    const xml = snapshot?.xml
    if (!xml) {
      appliedInitialHistoryRef.current = true
      return
    }

    // Don't let old local history override newer server XML (common cause of "link disappears" after navigation).
    // server updatedAt is seconds; snapshot timestamp is ms.
    const serverUpdatedAt = typeof fileQ.data?.updatedAt === 'number' ? fileQ.data.updatedAt : null
    const snapshotUpdatedAt = typeof snapshot?.timestamp === 'number' ? Math.floor(snapshot.timestamp / 1000) : null
    if (typeof serverUpdatedAt === 'number' && typeof snapshotUpdatedAt === 'number' && snapshotUpdatedAt < serverUpdatedAt) {
      appliedInitialHistoryRef.current = true
      return
    }

    appliedInitialHistoryRef.current = true
    isRestoringRef.current = true
    m.importXML(xml)
      .then(() => {
        try {
          const selId = selectionIdRef.current
          if (selId) {
            const el = m.get('elementRegistry')?.get(selId)
            if (el) m.get('selection')?.select(el)
          }
        } catch {}
        fitViewport(m)
        setTimeout(() => {
          isRestoringRef.current = false
        }, 100)
      })
      .catch(() => {
        isRestoringRef.current = false
      })
  }, [modelerReady, xmlHistory.snapshots, xmlHistory.currentIndex, fileQ.data?.updatedAt, fitViewport])

  React.useEffect(() => {
    let cancelled = false
    if (!modelerReady) return
    if (selectionIdRef.current) return
    if (!lastSelectionStorageKey) return
    const m = modelerRef.current
    if (!m) return

    let removeImportListener: (() => void) | null = null

    const attemptRestore = (attempt: number) => {
      if (cancelled) return
      if (!modelerRef.current) return
      // Don't override a selection the user made while we're waiting.
      if (selectionIdRef.current) return
      try {
        const storedId = sessionStorage.getItem(lastSelectionStorageKey)
        if (!storedId) return
        const el = modelerRef.current.get('elementRegistry')?.get(storedId)
        if (el) {
          modelerRef.current.get('selection')?.select(el)
          return
        }
      } catch {}

      // Wait for initial importXML to finish populating elementRegistry.
      if (attempt < 20) {
        window.setTimeout(() => attemptRestore(attempt + 1), 50)
      }
    }

    try {
      const eventBus = m.get?.('eventBus')
      if (eventBus && typeof eventBus.on === 'function') {
        const onImportDone = () => {
          if (cancelled) return
          // Let the element registry settle.
          window.setTimeout(() => attemptRestore(0), 0)
        }
        eventBus.on('import.done', onImportDone)
        removeImportListener = () => {
          try {
            if (typeof eventBus.off === 'function') {
              eventBus.off('import.done', onImportDone)
            }
          } catch {}
        }
      }
    } catch {}

    attemptRestore(0)

    return () => {
      cancelled = true
      if (removeImportListener) {
        try {
          removeImportListener()
        } catch {}
        removeImportListener = null
      }
    }
  }, [modelerReady, lastSelectionStorageKey])

  React.useEffect(() => {
    const focusElementId = location.state?.focusElementId ? String(location.state.focusElementId) : null
    if (!modelerReady || !modelerRef.current || !focusElementId) return
    const focusKey = `${fileId}:${focusElementId}`
    if (focusElementAttemptedRef.current === focusKey) return
    focusElementAttemptedRef.current = focusKey

    let cancelled = false
    const attemptFocus = (attempt: number) => {
      if (cancelled || !modelerRef.current) return
      try {
        const elementRegistry = modelerRef.current.get('elementRegistry')
        const selectionSvc = modelerRef.current.get('selection')
        const canvas = modelerRef.current.get('canvas')
        const element = elementRegistry?.get(focusElementId)
        if (element) {
          selectionSvc?.select(element)
          canvas?.scrollToElement?.(element)
          return
        }
      } catch {}

      if (attempt < 20) {
        window.setTimeout(() => attemptFocus(attempt + 1), 50)
      }
    }

    window.setTimeout(() => attemptFocus(0), 0)
    return () => {
      cancelled = true
    }
  }, [modelerReady, location.state, fileId])

  const fileIdForSave = fileQ.data?.id
  const saveXmlWithRetryRef = React.useRef<(xml: string) => Promise<any>>(async () => { throw new Error('saveXmlWithRetry not ready') })
  const saveXmlWithRetry = React.useCallback(async (xml: string) => {
    if (!fileIdForSave) throw new Error('File ID unavailable')
    ensureCollaborationWriteAllowed()
    let saveRequestAttempted = false
    try {
      saveRequestAttempted = true
      const data = await apiClient.put<{ updatedAt?: number }>(`/starbase-api/files/${fileIdForSave}`, {
        xml,
        prevUpdatedAt: updatedAtRef.current ?? undefined,
      })
      if (typeof data?.updatedAt === 'number') {
        updatedAtRef.current = Number(data.updatedAt) || updatedAtRef.current
      }

      // Keep the editor query cache in sync so navigating away/back doesn't show stale XML.
      // Include the saved xml so the cache reflects the current modeler state.
      queryClient.setQueryData(['file', fileIdForSave], (old: any) => {
        if (!old) return old
        const nextUpdatedAt = typeof data?.updatedAt === 'number' ? data.updatedAt : old.updatedAt
        return { ...old, xml, updatedAt: nextUpdatedAt }
      })
      queryClient.setQueryData(['file-breadcrumb', fileIdForSave], (old: any) => {
        if (!old) return old
        const nextUpdatedAt = typeof data?.updatedAt === 'number' ? data.updatedAt : old.updatedAt
        return { ...old, updatedAt: nextUpdatedAt }
      })

      return data
    } catch (error) {
      const parsed = parseApiError(error, 'Failed to save')
      if (parsed.status === 409) {
        const holder = (parsed.payload?.details?.lockHolder || parsed.payload?.lockHolder || null) as CollaborationHolder | null
        if (holder) {
          collaborationLockIdRef.current = null
          setCollaborationHolder(holder)
          setCollaborationLock(null)
          setCollaborationMode('superseded')
          setTakeoverModalOpen(holder.sessionStatus === 'active')
        }
        const conflictUpdatedAt =
          typeof parsed.payload?.details?.currentUpdatedAt === 'number'
            ? parsed.payload.details.currentUpdatedAt
            : (typeof parsed.payload?.currentUpdatedAt === 'number' ? parsed.payload.currentUpdatedAt : null)
        if (typeof conflictUpdatedAt === 'number') {
          updatedAtRef.current = conflictUpdatedAt
        } else {
          const latest = await apiClient.get<{ updatedAt?: number }>(`/starbase-api/files/${fileIdForSave}`)
          if (typeof latest?.updatedAt === 'number') {
            updatedAtRef.current = Number(latest.updatedAt) || updatedAtRef.current
          }
        }
        const conflictError = new Error(holder
          ? `${holder.name} now owns this draft. Your current tab is read-only until you take over again.`
          : parsed.message)
        ;(conflictError as Error & { saveRequestAttempted?: boolean }).saveRequestAttempted = saveRequestAttempted
        throw conflictError
      }
      if (error instanceof Error) {
        ;(error as Error & { saveRequestAttempted?: boolean }).saveRequestAttempted = saveRequestAttempted
      }
      throw error
    }
  }, [fileIdForSave, queryClient, ensureCollaborationWriteAllowed])
  saveXmlWithRetryRef.current = saveXmlWithRetry

  async function saveLinkUpdate(historyLabel: string, errorMessage: string): Promise<boolean> {
    const saveToken = beginTrackedSaveFeedback()
    try {
      const { xml } = await modelerRef.current.saveXML({ format: true })
      await saveXmlWithRetry(xml)
      xmlHistory.addSnapshot(xml, historyLabel)
      finishTrackedSaveFeedback(saveToken, 'saved', 1500)
      queryClient.invalidateQueries({ queryKey: ['file', fileId] })
      if (currentProjectId) {
        queryClient.invalidateQueries({ queryKey: ['starbase', 'project-files', currentProjectId] })
        queryClient.invalidateQueries({ queryKey: ['starbase', 'file-callers', currentProjectId] })
        queryClient.invalidateQueries({ queryKey: ['contents', currentProjectId] })
      }
      return true
    } catch {
      finishTrackedSaveFeedback(saveToken, 'error', 3000)
      setLinkModalError(errorMessage)
      return false
    }
  }

  async function handleCreateLinkedFile(): Promise<void> {
    ensureCollaborationWriteAllowed()
    if (!elementLinkInfo || !selectedElement || !modelerRef.current) return
    if (!currentProjectId) return
    const linkedFileName = createLinkedProcessName
    if (!linkedFileName) return

    const isDecision = elementLinkInfo.linkType === 'decision'
    const payload = isDecision
      ? buildLinkedDecisionCreationPayload(linkedFileName)
      : buildLinkedProcessCreationPayload(linkedFileName, {
          startEventType: isMessageEndEventLink ? 'message' : 'none',
        })
    const createTitle = isDecision ? 'Decision created' : 'Process created'
    const createErrorTitle = isDecision ? 'Failed to create decision' : 'Failed to create process'
    const createSavedError = isDecision
      ? 'Decision created, but the link could not be saved automatically.'
      : 'Process created, but the link could not be saved automatically.'
    const historyLabel = isDecision ? 'Decision created and linked' : 'Process created and linked'

    try {
      setCreatingLinkedProcess(true)
      setLinkModalError(null)

      const created = await apiClient.post<{ id?: string; name?: string; bpmnProcessId?: string | null; dmnDecisionId?: string | null }>(
        `/starbase-api/projects/${currentProjectId}/files`,
        {
          name: payload.fileName,
          type: isDecision ? 'dmn' : 'bpmn',
          folderId: currentFolderId,
          xml: payload.xml,
        }
      )

      const createdFileId = created?.id ? String(created.id) : ''
      const targetKey = isDecision
        ? (created?.dmnDecisionId ? String(created.dmnDecisionId) : payload.targetKey)
        : (created?.bpmnProcessId ? String(created.bpmnProcessId) : payload.targetKey)
      const createdFileName = created?.name ? String(created.name) : payload.fileName
      if (!createdFileId || !targetKey) {
        throw new Error('Created linked file metadata is incomplete')
      }

      const createdTargetFile: ProjectFileMeta = {
        id: createdFileId,
        name: createdFileName,
        type: isDecision ? 'dmn' : 'bpmn',
        folderId: currentFolderId,
        bpmnProcessId: isDecision ? null : targetKey,
        dmnDecisionId: isDecision ? targetKey : null,
      }

      await queryClient.invalidateQueries({ queryKey: ['starbase', 'project-files', currentProjectId] })
      await queryClient.invalidateQueries({ queryKey: ['contents', currentProjectId] })

      updateElementLink(modelerRef.current, selectedElement, {
        linkType: elementLinkInfo.linkType,
        targetKey,
        fileId: createdFileId,
        fileName: createdFileName,
        nameSyncMode: elementLinkInfo.nameSyncMode,
        syncName: elementLinkInfo.nameSyncMode === 'auto',
      })
      refreshLinkedElementState()

      const saved = await saveLinkUpdate(historyLabel, createSavedError)

      if (!saved) {
        notify({
          kind: 'warning',
          title: createTitle,
          subtitle: createSavedError,
        })
        return
      }

      if (resolvedLink && resolvedLink.id !== createdTargetFile.id) {
        updateCallerCacheForTarget(resolvedLink, 'remove')
      }
      updateCallerCacheForTarget(createdTargetFile, 'add')

      notify({
        kind: 'success',
        title: createTitle,
        subtitle: `${payload.fileName} was created and linked.`,
      })
      tenantNavigate(`/starbase/editor/${encodeURIComponent(sanitizePathParam(createdFileId))}`, {
        state: buildCurrentEditorNavigationState(),
      })
    } catch (error) {
      const parsed = parseApiError(error, createErrorTitle)
      notify({
        kind: 'error',
        title: createErrorTitle,
        subtitle: parsed.message,
      })
    } finally {
      setCreatingLinkedProcess(false)
    }
  }

  const prepareVersionSave = React.useCallback(async () => {
    const saveToken = beginTrackedSaveFeedback()
    try {
      ignoreDirtyUntilRef.current = Date.now() + 2000
      clearPendingAutosave()

      if (!modelerRef.current) return

      let xml: string
      try {
        const saved = await modelerRef.current.saveXML({ format: true })
        xml = saved?.xml
      } catch {
        const saved = await modelerRef.current.saveXML()
        xml = saved?.xml
      }
      if (!xml) throw new Error('Failed to read XML from modeler')

      await saveXmlWithRetry(xml)
      finishTrackedSaveFeedback(saveToken, 'saved', 1500)
      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', fileQ.data?.projectId] })
    } catch (e) {
      finishTrackedSaveFeedback(saveToken, 'error', 3000)
      throw e
    }
  }, [fileQ.data?.projectId, queryClient, saveXmlWithRetry, clearPendingAutosave, beginTrackedSaveFeedback, finishTrackedSaveFeedback])

  const handleVersionSaveSuccess = React.useCallback(() => {
    ignoreDirtyUntilRef.current = Date.now() + 500
    setLocalDirty(false)
    setLastEditedAt(null)
  }, [])

  const restoreFromDeploymentMutation = useMutation({
    mutationFn: async () => {
      ensureCollaborationWriteAllowed()
      if (!fileId) throw new Error('Missing fileId')

      const payload: { commitId?: string; fileVersionNumber?: number } = {}
      if (phase2CommitId) payload.commitId = phase2CommitId
      if (typeof phase2FileVersion === 'number') payload.fileVersionNumber = phase2FileVersion

      return apiClient.post<RestoreFromCommitResponse>(
        `/starbase-api/files/${encodeURIComponent(sanitizePathParam(String(fileId)))}/restore-from-commit`,
        payload,
      )
    },
    onSuccess: () => {
      if (fileId) {
        localStorage.removeItem(`xml-history-${fileId}`)
      }
      const isHotfix = fileId && sessionStorage.getItem(`hotfix-context-${fileId}`)
      notify({
        kind: 'success',
        title: isHotfix ? 'Hotfix mode started' : 'Deployed snapshot restored',
        subtitle: isHotfix ? 'Your draft now contains the deployed version. Edit and save a new version when ready.' : 'Now editing the deployed baseline in your draft.',
      })
      replaceAndReloadToInternalPath(safeEditorTenantPath, toTenantPath('/starbase'))
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Failed to restore deployed snapshot')
      notify({ kind: 'error', title: 'Restore failed', subtitle: parsed.message })
    },
  })

  const handleKeepCurrentDraft = React.useCallback(() => {
    setPhase2Dismissed(true)
    tenantNavigate(cleanEditorPath, { replace: true })
  }, [tenantNavigate, cleanEditorPath])

  const handleEnterViewMode = React.useCallback(() => {
    // Kill any pending autosave timer so it doesn't save snapshot XML to the server
    clearPendingAutosave()
    setPhase2Dismissed(true)
    viewModeImportedRef.current = false
    setEditorMode('view')
  }, [clearPendingAutosave])

  const handleStartHotfix = React.useCallback(() => {
    // If there are unsaved changes (local edits or uncommitted server draft), prompt to save first
    if (localDirty || fileIsUncommitted) {
      setShowSaveFirstPrompt(true)
      return
    }
    // Proceed with hotfix restore
    if (!phase2CanRestore || restoreFromDeploymentMutation.isPending) return
    // Store hotfix context in sessionStorage so it survives page reload
    const ctx = { fromCommitId: phase2CommitId, fromFileVersion: phase2FileVersion }
    try { sessionStorage.setItem(`hotfix-context-${fileId}`, JSON.stringify(ctx)) } catch {}
    restoreFromDeploymentMutation.mutate()
  }, [localDirty, fileIsUncommitted, phase2CanRestore, restoreFromDeploymentMutation, phase2CommitId, phase2FileVersion, fileId])

  const handleCancelHotfix = React.useCallback(() => {
    if (!fileId) return
    try { sessionStorage.removeItem(`hotfix-context-${fileId}`) } catch {}
    setEditorMode('normal')
    setHotfixContext(null)
    // Reload file from server to restore original draft
    queryClient.invalidateQueries({ queryKey: ['file', fileId] })
    replaceAndReloadToInternalPath(safeEditorTenantPath, toTenantPath('/starbase'))
  }, [fileId, queryClient, safeEditorTenantPath, toTenantPath])

  const handleBackToDraft = React.useCallback(() => {
    viewModeImportedRef.current = false
    setEditorMode('normal')
    // Reimport the file's current XML
    if (modelerRef.current && fileQ.data?.xml) {
      isRestoringRef.current = true
      modelerRef.current.importXML(fileQ.data.xml).then(() => {
        isRestoringRef.current = false
        try { fitViewport(modelerRef.current) } catch {}
      }).catch(() => { isRestoringRef.current = false })
    }
  }, [fileQ.data?.xml])

  const handleDeploySuccess = React.useCallback(() => {
    ignoreDirtyUntilRef.current = Date.now() + 500
    setLocalDirty(false)
    setLastEditedAt(null)
    // Clear hotfix context on successful deploy
    if (fileId && editorMode === 'hotfix') {
      try { sessionStorage.removeItem(`hotfix-context-${fileId}`) } catch {}
      setEditorMode('normal')
      setHotfixContext(null)
    }
  }, [fileId, editorMode])

  const latestFileCommit = latestFileCommitQ.data || null
  const sameCommitAsCurrentDraft = Boolean(
    phase2CommitId && latestFileCommit?.id && String(latestFileCommit.id) === String(phase2CommitId)
  )
  const sameFileVersionAsCurrentDraft = Boolean(
    typeof phase2FileVersion === 'number' &&
    typeof latestFileCommit?.fileVersionNumber === 'number' &&
    latestFileCommit.fileVersionNumber === phase2FileVersion
  )
  const isAlreadyAtExactDeployedBaseline = Boolean(
    phase2IsMissionControl &&
    !localDirty &&
    !fileIsUncommitted &&
    (sameCommitAsCurrentDraft || sameFileVersionAsCurrentDraft)
  )
  const phase2QueryReady = latestFileCommitQ.isFetched && !latestFileCommitQ.isFetching

  // Show the modal when arriving from MC on a non-latest version
  const showPhase2Banner =
    phase2IsMissionControl &&
    phase2QueryReady &&
    !phase2Dismissed &&
    (!!phase2ProcessKey || !!phase2DecisionKey) &&
    !isAlreadyAtExactDeployedBaseline &&
    editorMode === 'normal'

  // Auto-dismiss when versions already match
  React.useEffect(() => {
    if (phase2AutoDismissedRef.current) return
    if (!phase2QueryReady || !isAlreadyAtExactDeployedBaseline) return
    phase2AutoDismissedRef.current = true
    setPhase2Dismissed(true)
  }, [phase2QueryReady, isAlreadyAtExactDeployedBaseline])

  if (fileQ.isLoading) return <p>Loading file…</p>
  if (fileQ.isError) {
    const accessErr = isProjectAccessError(fileQ.error)
    if (accessErr) {
      return <ProjectAccessError status={accessErr.status} message={accessErr.message} />
    }
    return <p>Failed to load file.</p>
  }
  if (!fileQ.data) return <p>Not found.</p>

  const f = fileQ.data
  const phase2TargetLabel = phase2ProcessKey
    ? `process ${phase2ProcessKey}${phase2ProcessVersion ? ` (v${phase2ProcessVersion})` : ''}`
    : `decision ${phase2DecisionKey}${phase2ProcessVersion ? ` (v${phase2ProcessVersion})` : ''}`
  const phase2RestoreLabel = typeof phase2FileVersion === 'number'
    ? `Starbase file v${phase2FileVersion}`
    : (phase2CommitId ? `commit ${phase2CommitId.substring(0, 8)}` : 'deployed snapshot correlation')

  // initialize last known updatedAt once (or if server returns a greater value later)
  if (updatedAtRef.current == null || f.updatedAt > (updatedAtRef.current as number)) {
    updatedAtRef.current = f.updatedAt
  }

  const handleLinkSubmit = async () => {
    if (!elementLinkInfo || !selectedElement || !modelerRef.current) return
    const target = selectedLinkFile
    if (!target) return
    const targetKey =
      elementLinkInfo.linkType === 'decision' ? target.dmnDecisionId : target.bpmnProcessId
    if (!targetKey) {
      setLinkModalError('Selected file is missing a process/decision ID. Open the file, make any edit, and save to generate the ID.')
      return
    }

    updateElementLink(modelerRef.current, selectedElement, {
      linkType: elementLinkInfo.linkType,
      targetKey,
      fileId: target.id,
      fileName: target.name,
      inheritNameIfEmpty: true,
      nameSyncMode: elementLinkInfo.nameSyncMode,
      syncName: elementLinkInfo.nameSyncMode === 'auto',
    })
    refreshLinkedElementState()

    const saved = await saveLinkUpdate('Link updated', 'Failed to save link. Please try again.')
    if (saved) {
      if (resolvedLink && resolvedLink.id !== target.id) {
        updateCallerCacheForTarget(resolvedLink, 'remove')
      }
      updateCallerCacheForTarget(target, 'add')
      setLinkModalOpen(false)
    }
  }

  const showPropertiesParent = overlayOpen ? propEl : undefined

  return (
    <div
      className={overlayOpen ? 'starbase-editor drawer-open' : 'starbase-editor'}
      style={{ height: 'calc(100vh - var(--header-height) - var(--spacing-4))', padding: 0, display: 'flex', flexDirection: 'column' }}
    >
      {/* Breadcrumb Bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--cds-background)', pointerEvents: 'auto' }}>
        <BreadcrumbBar
          rightActions={showUsedByAction ? (
            <Button kind="ghost" size="sm" renderIcon={Branch} onClick={openCallersModal} disabled={callersQ.isLoading}>
              {usedByButtonLabel}
            </Button>
          ) : undefined}
        >
          <BreadcrumbItem>
            <a href={toTenantPath('/starbase')} onClick={(e) => { e.preventDefault(); navigateFromBreadcrumb('/starbase'); }}>Starbase</a>
          </BreadcrumbItem>
          <BreadcrumbItem>
            <a href={toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}`)} onClick={(e) => { e.preventDefault(); navigateFromBreadcrumb(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}`); }}>
              {f.projectName}
            </a>
          </BreadcrumbItem>
          {f.folderBreadcrumb.map((folder) => (
            <BreadcrumbItem key={folder.id}>
              <a 
                href={toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}?folder=${encodeURIComponent(sanitizePathParam(folder.id))}`)} 
                onClick={(e) => { e.preventDefault(); navigateFromBreadcrumb(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}?folder=${encodeURIComponent(sanitizePathParam(folder.id))}`); }}
              >
                {folder.name}
              </a>
            </BreadcrumbItem>
          ))}
          {editorBreadcrumbTrail.map((entry, index) => (
            <BreadcrumbItem key={`${entry.fileId}-${index}`}>
              <a
                href={toTenantPath(`/starbase/editor/${encodeURIComponent(sanitizePathParam(entry.fileId))}`)}
                onClick={(e) => {
                  e.preventDefault()
                  snapshotBeforeEditorNavigation().catch(() => {})
                  navigateFromBreadcrumb(`/starbase/editor/${encodeURIComponent(sanitizePathParam(entry.fileId))}`, {
                    state: buildEditorBreadcrumbBackState(editorBreadcrumbTrail, index),
                  })
                }}
              >
                {toDisplayFileName(entry.fileName) || 'Previous file'}
              </a>
            </BreadcrumbItem>
          ))}
          <BreadcrumbItem isCurrentPage>{toDisplayFileName(f.name)}</BreadcrumbItem>
        </BreadcrumbBar>
      </div>

      {/* View mode banner */}
      {editorMode === 'view' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--spacing-2) var(--spacing-4)', background: '#d0e2ff', borderBottom: '1px solid #a6c8ff' }}>
          <span style={{ fontSize: 'var(--text-12)', fontWeight: 600, color: '#001d6c' }}>
            Viewing v{phase2FileVersion ?? '?'}{phase2ProcessVersion ? ` (version ${phase2ProcessVersion})` : ''} · Read-only · Changes won&apos;t be saved
          </span>
          <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
            <Button kind="ghost" size="sm" onClick={handleBackToDraft}>Back to draft</Button>
            <Button kind="primary" size="sm" disabled={!phase2CanRestore || restoreFromDeploymentMutation.isPending} onClick={handleStartHotfix}>
              {restoreFromDeploymentMutation.isPending ? 'Starting hotfix…' : 'Start Hotfix'}
            </Button>
          </div>
        </div>
      )}

      {/* Hotfix mode banner */}
      {editorMode === 'hotfix' && hotfixContext && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--spacing-2) var(--spacing-4)', background: '#fff1c2', borderBottom: '1px solid #f1c21b' }}>
          <span style={{ fontSize: 'var(--text-12)', fontWeight: 600, color: '#3a3000' }}>
            Hotfix mode — editing from v{hotfixContext.fromFileVersion ?? '?'}
          </span>
          <Button kind="ghost" size="sm" onClick={handleCancelHotfix}>Cancel hotfix</Button>
        </div>
      )}

      {collaborationError && (
        <div style={{ padding: 'var(--spacing-3) var(--spacing-4) 0' }}>
          <InlineNotification lowContrast kind="error" title="Collaboration session issue" subtitle={collaborationError} />
        </div>
      )}

      {editorMode !== 'view' && collaborationMode === 'blocked' && collaborationSummary && (
        <div role="status" style={{ padding: 'var(--spacing-3) var(--spacing-4)', fontSize: 'var(--text-13)', background: collaborationSummary.kind === 'warning' ? '#fff1c2' : collaborationSummary.kind === 'error' ? '#fff1f1' : '#edf5ff', borderBottom: '1px solid var(--cds-border-subtle)' }}>
          {collaborationSummary.title}
        </div>
      )}

      {projectFilesError && (
        <div style={{ padding: 'var(--spacing-3) var(--spacing-4)' }}>
          <InlineNotification lowContrast kind="error" title="Project files failed to load" subtitle={projectFilesError} />
        </div>
      )}

      {tabIndex === 1 && linkStatus === 'missing' && elementLinkInfo && (
        <div style={{ padding: '0 var(--spacing-4) var(--spacing-3)' }}>
          <InlineNotification
            lowContrast
            kind="warning"
            title="Linked file missing"
            subtitle={`The linked ${linkTypeLabel} could not be found. Choose a new file or unlink.`}
          />
        </div>
      )}

      {/* Secondary header */}
      {f.type === 'bpmn' ? (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--spacing-2) var(--spacing-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-4)' }}>
            <Tabs selectedIndex={tabIndex} onChange={({ selectedIndex }: { selectedIndex: number }) => setTabIndex(selectedIndex)}>
              <TabList aria-label="Editor modes">
                <Tab>Design</Tab>
                <Tab>Implement</Tab>
              </TabList>
              {/* Empty panels to satisfy Tabs API; we render canvas below */}
              <TabPanels>
                <TabPanel />
                <TabPanel />
              </TabPanels>
            </Tabs>
          </div>

          {/* Canvas controls - center, fixed relative to header */}
          {overlayOpen && (
            <div
              style={{
                position: 'fixed',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'auto',
              }}
            >
              <CanvasToolbar modeler={modelerRef.current} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginRight: 'var(--spacing-2)' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 'var(--text-12)',
                  fontWeight: 600,
                  background: collaborationHeaderStatus.background,
                  color: collaborationHeaderStatus.color,
                }}
              >
                {collaborationHeaderStatus.label}
              </span>
              {editorMode !== 'view' && collaborationReadOnly && collaborationHolder && (
                <Button kind="ghost" size="sm" onClick={() => setTakeoverModalOpen(true)} style={{ marginLeft: 4, fontSize: 'var(--text-12)' }}>
                  Take over
                </Button>
              )}
            </div>
            <div style={{ fontSize: 'var(--text-12)', color: saving === 'error' ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>
              {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
            </div>
            {canDeployCurrentFile && (
              <DeployButton projectId={f.projectId} fileIds={[f.id]} size="sm" kind="ghost" onDeploySuccess={handleDeploySuccess} />
            )}
            {missionControlTarget && (
              <Button kind="ghost" size="sm" renderIcon={Launch} onClick={handleGoToMissionControl}>
                Mission Control
              </Button>
            )}
            <button
              onClick={handleUndo}
              disabled={!xmlHistory.canUndo || collaborationReadOnly}
              title="Undo (Ctrl+Z)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canUndo && !collaborationReadOnly ? 'pointer' : 'default',
                color: xmlHistory.canUndo && !collaborationReadOnly ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Undo size={20} />
            </button>
            <button
              onClick={handleRedo}
              disabled={!xmlHistory.canRedo || collaborationReadOnly}
              title="Redo (Ctrl+Y)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canRedo && !collaborationReadOnly ? 'pointer' : 'default',
                color: xmlHistory.canRedo && !collaborationReadOnly ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Redo size={20} />
            </button>
            <Button kind="ghost" size="sm" onClick={() => setVersionsPanelOpen(!versionsPanelOpen)} disabled={collaborationReadOnly}>Versions</Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--spacing-2) var(--spacing-4)' }}>
          <Button kind="ghost" size="sm" onClick={() => setDmnEvaluateOpen(!dmnEvaluateOpen)}>
            {dmnEvaluateOpen ? 'Hide' : 'Show'} Evaluate Panel
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', marginRight: 'var(--spacing-2)' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 'var(--text-12)',
                  fontWeight: 600,
                  background: collaborationHeaderStatus.background,
                  color: collaborationHeaderStatus.color,
                }}
              >
                {collaborationHeaderStatus.label}
              </span>
              {editorMode !== 'view' && collaborationReadOnly && collaborationHolder && (
                <Button kind="ghost" size="sm" onClick={() => setTakeoverModalOpen(true)} style={{ marginLeft: 4, fontSize: 'var(--text-12)' }}>
                  Take over
                </Button>
              )}
            </div>
            <div style={{ fontSize: 'var(--text-12)', color: saving === 'error' ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>
              {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
            </div>
            {canDeployCurrentFile && (
              <DeployButton projectId={f.projectId} fileIds={[f.id]} size="sm" kind="ghost" onDeploySuccess={handleDeploySuccess} />
            )}
            {missionControlTarget && (
              <Button kind="ghost" size="sm" renderIcon={Launch} onClick={handleGoToMissionControl}>
                Mission Control
              </Button>
            )}
            <button
              onClick={handleUndo}
              disabled={!xmlHistory.canUndo || collaborationReadOnly}
              title="Undo (Ctrl+Z)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canUndo && !collaborationReadOnly ? 'pointer' : 'default',
                color: xmlHistory.canUndo && !collaborationReadOnly ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Undo size={20} />
            </button>
            <button
              onClick={handleRedo}
              disabled={!xmlHistory.canRedo || collaborationReadOnly}
              title="Redo (Ctrl+Y)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canRedo && !collaborationReadOnly ? 'pointer' : 'default',
                color: xmlHistory.canRedo && !collaborationReadOnly ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Redo size={20} />
            </button>
            <Button kind="ghost" size="sm" onClick={() => setVersionsPanelOpen(!versionsPanelOpen)} disabled={collaborationReadOnly}>Versions</Button>
          </div>
        </div>
      )}

      {/* Editor body (edge-to-edge under header) */}
      <div style={{ position: 'relative', flex: 1, background: 'var(--color-bg-primary)', overflow: 'hidden' }}>
        {f.type === 'bpmn' ? (
          <Canvas
            key={f.id}
            xml={f.xml}
            readOnly={collaborationReadOnly}
            onSelectionChange={handleSelectionChange}
            propertiesParent={showPropertiesParent as any}
            onModelerReady={(m) => { 
              modelerRef.current = m
              setModelerReady(true)
              fitViewport(m)
            }}
            implementMode={tabIndex === 1}
            onDirty={(label) => {
              // Skip if we're restoring from history
              if (isRestoringRef.current) return
              // Skip spurious dirty events right after saving/committing
              if (Date.now() < ignoreDirtyUntilRef.current) return
              if (collaborationReadOnlyRef.current) return

              const activeModeler = modelerRef.current
              lastInteractionAtRef.current = Date.now()

              setLastEditedAt(Date.now())
              setLocalDirty(true)
              
              // History snapshot immediately - only for drawing changes (label provided)
              if (label) {
                ;(async () => {
                  try {
                    if (!activeModeler) return
                    const { xml } = await activeModeler.saveXML({ format: true })
                    xmlHistory.addSnapshot(xml, label)
                  } catch {}
                })()
              }
              
              // Database save with longer debounce (800ms) - batches rapid changes
              clearPendingAutosave()
              autosaveTimerRef.current = window.setTimeout(async () => {
                let saveToken: number | null = null
                try {
                  if (!activeModeler) return
                  if (Date.now() < ignoreDirtyUntilRef.current) return
                  if (collaborationReadOnlyRef.current) return
                  const { xml } = await activeModeler.saveXML({ format: true })
                  if (!xml) return
                  saveToken = beginTrackedSaveFeedback()
                  
                  await saveXmlWithRetryRef.current(xml)
                  finishTrackedSaveFeedback(saveToken, 'saved', 1500)
                  // Invalidate uncommitted-files query so project page shows updated status
                  queryClient.invalidateQueries({ queryKey: ['uncommitted-files', f.projectId] })
                  // Ensure updated process/decision IDs are available without refresh.
                  queryClient.invalidateQueries({ queryKey: ['starbase', 'project-files', f.projectId] })
                } catch (e) {
                  if (saveToken == null) return
                  if (wasSaveRequestAttempted(e)) {
                    finishTrackedSaveFeedback(saveToken, 'error', 3000)
                  } else {
                    finishTrackedSaveFeedback(saveToken, 'idle', 0)
                  }
                } finally {
                  autosaveTimerRef.current = null
                }
              }, 800)
            }}
          />
        ) : (
          <React.Suspense fallback={<LoadingState message="Loading DMN..." />}>
            <div style={{ height: '100%', background: 'var(--color-bg-primary)' }}>
              <DMNCanvas
                key={f.id}
                xml={f.xml}
                readOnly={collaborationReadOnly}
                onModelerReady={(m) => { 
                  modelerRef.current = m
                  setModelerReady(true)
                }}
                onPendingDirty={() => {
                  if (isRestoringRef.current) return
                  if (Date.now() < ignoreDirtyUntilRef.current) return
                  if (collaborationReadOnlyRef.current) return

                  lastInteractionAtRef.current = Date.now()
                  setLastEditedAt(Date.now())
                  setLocalDirty(true)
                }}
                onDirty={() => {
                  // Skip if we're restoring from history
                  if (isRestoringRef.current) return
                  // Skip spurious dirty events right after saving/committing
                  if (Date.now() < ignoreDirtyUntilRef.current) return
                  if (collaborationReadOnlyRef.current) return

                  const activeModeler = modelerRef.current
                  lastInteractionAtRef.current = Date.now()

                  setLastEditedAt(Date.now())
                  setLocalDirty(true)

                  // History snapshot immediately for DMN changes
                  ;(async () => {
                    try {
                      if (!activeModeler) return
                      const { xml } = await activeModeler.saveXML({ format: true })
                      xmlHistory.addSnapshot(xml, 'DMN change')
                    } catch {}
                  })()

                  // Database save with debounce
                  clearPendingAutosave()
                  autosaveTimerRef.current = window.setTimeout(async () => {
                    let saveToken: number | null = null
                    try {
                      if (!activeModeler) return
                      if (Date.now() < ignoreDirtyUntilRef.current) return
                      if (collaborationReadOnlyRef.current) return
                      const { xml } = await activeModeler.saveXML({ format: true })
                      if (!xml) return
                      saveToken = beginTrackedSaveFeedback()
                      await saveXmlWithRetryRef.current(xml)
                      finishTrackedSaveFeedback(saveToken, 'saved', 1500)
                      // Invalidate uncommitted-files query so project page shows updated status
                      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', f.projectId] })
                      // Ensure updated process/decision IDs are available without refresh.
                      queryClient.invalidateQueries({ queryKey: ['starbase', 'project-files', f.projectId] })
                    } catch (e) {
                      if (saveToken == null) return
                      if (wasSaveRequestAttempted(e)) {
                        finishTrackedSaveFeedback(saveToken, 'error', 3000)
                      } else {
                        finishTrackedSaveFeedback(saveToken, 'idle', 0)
                      }
                    } finally {
                      autosaveTimerRef.current = null
                    }
                  }, 800)
                }}
              />
            </div>
          </React.Suspense>
        )}

        {/* DMN Evaluate Panel */}
        {f.type === 'dmn' && dmnEvaluateOpen && (
          <div style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 360, background: 'var(--color-bg-primary)', borderLeft: '1px solid var(--color-border-primary)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', zIndex: 'var(--z-overlay)' }}>
            <div style={{ padding: 'var(--spacing-2)', borderBottom: '1px solid var(--color-border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ fontSize: 'var(--text-14)', fontWeight: 'var(--font-weight-semibold)' }}>Evaluate</h4>
              <Button kind="ghost" size="sm" onClick={() => setDmnEvaluateOpen(false)}>Close</Button>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <React.Suspense fallback={<LoadingState message="Loading evaluate panel..." />}>
                <DMNEvaluatePanel
                  decisionKey={decisionKey}
                  onEvaluate={(vars) => evaluateMutation.mutate(vars)}
                  result={evaluateMutation.data}
                  error={evaluateMutation.error?.message}
                  isEvaluating={evaluateMutation.isPending}
                />
              </React.Suspense>
            </div>
          </div>
        )}

        {shouldRenderCollaborationOverlay && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(255,255,255,0.48)',
              backdropFilter: 'blur(1px)',
              zIndex: 'var(--z-overlay)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ background: 'white', border: '1px solid var(--color-border-primary)', boxShadow: 'var(--shadow-lg)', padding: 'var(--spacing-5)', maxWidth: 520, borderRadius: 8, display: 'grid', gap: 'var(--spacing-3)' }}>
              <strong style={{ fontSize: 'var(--text-14)' }}>{collaborationSummary?.title || 'Read-only collaboration mode'}</strong>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-13)' }}>
                {collaborationSummary?.subtitle || 'This draft is read-only until you explicitly take over editing again.'}
              </span>
              <div style={{ display: 'flex', gap: 'var(--spacing-2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {collaborationMode === 'superseded' ? (
                  <>
                    <Button kind="secondary" size="sm" onClick={() => { void handleSaveLocalWorkAsCopy() }} disabled={recoveryPending !== null}>
                      {recoveryPending === 'copy' ? 'Saving copy…' : 'Save local work as copy'}
                    </Button>
                    <Button kind="secondary" size="sm" onClick={handleReloadSharedVersion} disabled={recoveryPending !== null}>
                      {recoveryPending === 'reload' ? 'Reloading…' : 'Reload shared version'}
                    </Button>
                  </>
                ) : (
                  <Button kind="secondary" size="sm" onClick={() => setTakeoverModalOpen(false)}>
                    Keep read-only
                  </Button>
                )}
                <Button kind="primary" size="sm" onClick={() => { void handleTakeover() }} disabled={takeoverPending || recoveryPending !== null}>
                  {takeoverPending ? 'Taking over…' : 'Take over editing'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Versions Panel (right sidebar) */}
        {versionsPanelOpen && (
          <div style={{ position: 'absolute', top: 0, right: overlayOpen ? 360 : 0, height: '100%', width: 360, background: 'var(--cds-layer-01, #ffffff)', borderLeft: '1px solid var(--color-border-primary)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', zIndex: 'var(--z-overlay)' }}>
            <div style={{ 
              padding: 'var(--spacing-3)', 
              borderBottom: '1px solid var(--color-border-primary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--cds-layer-01, #ffffff)'
            }}>
              <Button 
              kind="tertiary"
              size="sm" 
              onClick={() => {
                if (collaborationReadOnly) return
                captureFocus()
                commitModal.openModal()
              }}
              disabled={collaborationReadOnly}
              style={{ background: '#24a148', borderColor: '#24a148', color: 'white', borderRadius: '4px', padding: '4px 12px', minHeight: 'auto', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Branch size={16} /> {hasUnsavedVersion ? 'Save version' : 'New version'}
            </Button>
              <Button kind="ghost" size="sm" onClick={() => setVersionsPanelOpen(false)}>Close</Button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: 'var(--cds-layer-01, #ffffff)' }}>
              {!versioningModeResolved ? (
                <LoadingState message="Loading versions..." />
              ) : f.projectId ? (
                <GitVersionsPanel
                  projectId={f.projectId}
                  fileId={fileId}
                  fileName={f.name}
                  fileType={f.type as 'bpmn' | 'dmn'}
                  hasUnsavedVersion={hasUnsavedVersion}
                  lastEditedAt={lastEditedAt}
                  saveMode={hasGitRepository ? 'git' : 'local'}
                  beforeVersionSave={prepareVersionSave}
                  onVersionSaveSuccess={handleVersionSaveSuccess}
                />
              ) : null}
            </div>
          </div>
        )}

        {/* History Panel */}
        {historyPanelOpen && (
          <div style={{ position: 'absolute', top: 0, right: overlayOpen ? 360 : (versionsPanelOpen ? 360 : 0), height: '100%', width: 320, background: 'var(--color-bg-primary)', borderLeft: '1px solid var(--color-border-primary)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', zIndex: 'var(--z-overlay)' }}>
            <HistoryPanel
              snapshots={xmlHistory.snapshots}
              currentIndex={xmlHistory.currentIndex}
              canUndo={xmlHistory.canUndo}
              canRedo={xmlHistory.canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onGoToSnapshot={handleGoToSnapshot}
              onClearHistory={xmlHistory.clearHistory}
              onClose={() => setHistoryPanelOpen(false)}
            />
          </div>
        )}

        {/* Overlay panel (BPMN only) */}
        {f.type === 'bpmn' && overlayOpen && (
          <div style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 360, background: 'var(--cds-layer-01, #ffffff)', borderLeft: '1px solid var(--color-border-primary)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', zIndex: 'var(--z-overlay)' }}>
            <div style={{ padding: 'var(--spacing-2)', borderBottom: '1px solid var(--color-border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Tabs selectedIndex={0}>
                <TabList aria-label="Overlay tabs">
                  <Tab>Properties</Tab>
                </TabList>
                <TabPanels>
                  <TabPanel />
                </TabPanels>
              </Tabs>
              <Button kind="ghost" size="sm" onClick={() => setOverlayOpen(false)}>Close</Button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: 'var(--cds-layer-01, #ffffff)' }}>
              <div
                className="starbase-properties-panel-host"
                ref={setPropHostRef}
                style={{ minHeight: '100%', background: 'var(--cds-layer-01, #ffffff)' }}
              />
            </div>
          </div>
        )}

        {/* Vertical details toggle (visible in both tabs; auto-opens in Implement via effect) */}
        {f.type === 'bpmn' && (
          <button
            type="button"
            aria-label="Toggle details"
            onClick={() => {
              setOverlayOpen((open) => !open)
            }}
            style={{
              position: 'absolute',
              top: '50%',
              right: overlayOpen ? 360 : 0,
              transform: 'translateY(-50%)',
              background: '#f4f4f4',
              border: '1px solid #e0e0e0',
              borderRight: 'none',
              padding: '16px 8px',
              width: 40,
              minHeight: 165,
              borderRadius: 'var(--border-radius-lg) 0 0 var(--border-radius-lg)',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              zIndex: 'var(--z-overlay-toggle)',
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'block',
                width: 18,
                height: 18,
                // background: "center / contain no-repeat url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23525252' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 6h18'/><path d='M3 12h18'/><path d='M3 18h18'/></svg>\")"
              }}
            />
            <span
              style={{
                position: 'absolute',
                top: 38,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'block',
                width: 22,
                height: 1,
                background: 'var(--color-border-primary)'
              }}
            />
            <span
              style={{
                fontSize: 'var(--text-14)',
                fontWeight: 'var(--font-weight-semibold)',
                writingMode: 'vertical-rl' as any,
                textOrientation: 'mixed' as any,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                textAlign: 'center'
              }}
            >
              Details
            </span>
          </button>
        )}
      </div>

      <ComposedModal open={linkModalOpen} size="md" onClose={closeLinkModal}>
        <ModalHeader label={undefined} title={`Link ${linkTypeLabel}`} closeModal={closeLinkModal} />
        <ModalBody style={{ overflow: 'visible', paddingBottom: 'var(--spacing-6)' }}>
          <div style={{ display: 'grid', gap: 'var(--spacing-5)', overflow: 'visible' }}>
          {linkModalError && (
            <InlineNotification lowContrast kind="error" title="Unable to link" subtitle={linkModalError} />
          )}
          {allFolders === null && <FolderLoader projectId={f.projectId} onLoaded={setAllFolders} />}
          <div style={{ width: '100%' }}>
            <ComboBox
              id="link-file-combo"
              titleText={`Select ${linkTypeLabel} file`}
              placeholder={`Search ${linkTypeLabel} files`}
              items={filteredLinkFiles}
              selectedItem={selectedLinkFile as any}
              style={{ width: '100%' }}
              autoAlign
              itemToString={(item) => (item ? toDisplayFileName(item.name) : '')}
              itemToElement={(item) => {
                if (!item) return null
                const pathParts = getFolderPath(item.folderId)
                const hasFolder = Boolean(item.folderId)
                const pathLabel = pathParts.length ? pathParts.join(' / ') : (hasFolder ? 'Unknown folder' : '')
                const hasKey = linkTargetType === 'dmn' ? Boolean(item.dmnDecisionId) : Boolean(item.bpmnProcessId)
                return (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, maxWidth: '100%', overflow: 'hidden', opacity: hasKey ? 1 : 0.6 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {toDisplayFileName(item.name)}
                    </div>
                    {pathLabel && (
                      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {pathLabel}
                      </div>
                    )}
                  </div>
                )
              }}
              onChange={({ selectedItem }) => {
                const next = selectedItem as ProjectFileMeta | null
                setLinkSelectedFileId(next?.id ?? null)
                setLinkModalError(null)
              }}
              shouldFilterItem={({ item, inputValue }) => {
                if (!inputValue) return true
                const search = inputValue.toLowerCase()
                const pathParts = getFolderPath(item.folderId)
                const pathLabel = pathParts.length ? pathParts.join(' / ') : 'root'
                return toDisplayFileName(item.name).toLowerCase().includes(search) || pathLabel.toLowerCase().includes(search)
              }}
            />
            {selectedLinkFile && selectedLinkFile.folderId && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                Folder: {getFolderPath(selectedLinkFile.folderId).join(' / ') || 'Loading...'}
              </div>
            )}
          </div>
          {filteredLinkFiles.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
              No {linkTypeLabel} files available in this project.
            </div>
          )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={closeLinkModal}>
            Cancel
          </Button>
          <Button
            kind="primary"
            disabled={!selectedLinkFile || selectedLinkFile.isSelf}
            onClick={handleLinkSubmit}
          >
            {linkStatus === 'linked' ? 'Update link' : 'Link'}
          </Button>
        </ModalFooter>
      </ComposedModal>

      <ComposedModal open={callersModalOpen} size="md" onClose={closeCallersModal}>
        <ModalHeader label={undefined} title={callersQ.isLoading ? 'Used in parent processes…' : formatUsedInParentProcessesLabel(callerGroups.length)} closeModal={closeCallersModal} />
        <ModalBody style={{ paddingBottom: 'var(--spacing-6)' }}>
          <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
            {callersModalOpen && allFolders === null && <FolderLoader projectId={f.projectId} onLoaded={setAllFolders} />}
            {callersQ.isError && (
              <InlineNotification lowContrast kind="error" title="Parent processes failed to load" subtitle="Unable to load parent process usage for this file." />
            )}
            {!callersQ.isLoading && !callersQ.isError && callerGroups.length === 0 && (
              <div style={{ fontSize: 14, color: 'var(--cds-text-secondary)' }}>
                This file is not currently used in any parent processes in the project.
              </div>
            )}
            {!callersQ.isLoading && !callersQ.isError && callerTableRows.length > 0 && (
              <DataTable rows={callerTableRows} headers={callerTableHeaders} size="sm">
                {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} size="sm">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => {
                            const { key, ...headerProps } = getHeaderProps({ header })
                            return (
                              <TableHeader key={key} {...headerProps}>
                                {header.header}
                              </TableHeader>
                            )
                          })}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => {
                          const original = callerTableRows.find((item) => item.id === row.id)
                          if (!original) return null
                          const { key, ...rowProps } = getRowProps({ row })
                          return (
                            <TableRow key={key} {...rowProps}>
                              {row.cells.map((cell) => {
                                if (cell.info.header === 'actionLabel') {
                                  return (
                                    <TableCell key={cell.id}>
                                      <CarbonLink
                                        href="#"
                                        size="sm"
                                        onClick={(event) => {
                                          event.preventDefault()
                                          openCallerOccurrence(original.caller)
                                        }}
                                      >
                                        Open
                                      </CarbonLink>
                                    </TableCell>
                                  )
                                }
                                return <TableCell key={cell.id}>{cell.value}</TableCell>
                              })}
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={closeCallersModal}>
            Close
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* Deployed version navigation modal — View / Hotfix / Go to draft */}
      <ComposedModal open={showPhase2Banner} size="sm" onClose={handleKeepCurrentDraft}>
        <ModalHeader label={undefined} title="Deployed Version" closeModal={handleKeepCurrentDraft} />
        <ModalBody>
          <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            <p style={{ margin: 0 }}>
              {phase2ProcessVersion
                ? `Engine version ${phase2ProcessVersion} corresponds to Starbase v${phase2FileVersion ?? '?'}.`
                : `You opened ${phase2TargetLabel}.`}
            </p>

            {(localDirty || fileIsUncommitted) && (
              <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                <InlineNotification
                  lowContrast
                  hideCloseButton
                  kind="warning"
                  title="You have unsaved changes"
                  subtitle="Save your current draft as a version before viewing or hotfixing, so you don't lose any work."
                />
                <Button
                  kind="tertiary"
                  size="sm"
                  onClick={() => {
                    setPhase2Dismissed(true)
                    captureFocus()
                    commitModal.openModal()
                  }}
                >
                  Save version now
                </Button>
              </div>
            )}

            {!phase2CanRestore && (
              <InlineNotification
                lowContrast
                hideCloseButton
                kind="info"
                title="Snapshot unavailable"
                subtitle="This deployment has no exact saved snapshot reference. You can continue with your current draft."
              />
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={handleKeepCurrentDraft}>
            Go to latest draft
          </Button>
          <Button
            kind="tertiary"
            disabled={!phase2CanRestore}
            onClick={handleEnterViewMode}
          >
            View v{phase2FileVersion ?? '?'}
          </Button>
          <Button
            kind="primary"
            disabled={!phase2CanRestore || restoreFromDeploymentMutation.isPending}
            onClick={handleStartHotfix}
          >
            {restoreFromDeploymentMutation.isPending ? 'Starting…' : `Hotfix v${phase2FileVersion ?? '?'}`}
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* Save-first prompt before hotfix */}
      <ComposedModal open={showSaveFirstPrompt} size="sm" onClose={() => setShowSaveFirstPrompt(false)}>
        <ModalHeader label={undefined} title="Unsaved changes" closeModal={() => setShowSaveFirstPrompt(false)} />
        <ModalBody>
          <p style={{ margin: 0 }}>
            You have unsaved changes in your current draft. Starting a hotfix will replace your draft with v{phase2FileVersion ?? '?'}.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={() => setShowSaveFirstPrompt(false)}>
            Cancel
          </Button>
          <Button
            kind="tertiary"
            onClick={() => {
              setShowSaveFirstPrompt(false)
              // Discard unsaved changes and proceed with hotfix
              setLocalDirty(false)
              if (!phase2CanRestore || restoreFromDeploymentMutation.isPending) return
              const ctx = { fromCommitId: phase2CommitId, fromFileVersion: phase2FileVersion }
              try { sessionStorage.setItem(`hotfix-context-${fileId}`, JSON.stringify(ctx)) } catch {}
              restoreFromDeploymentMutation.mutate()
            }}
          >
            Discard &amp; continue
          </Button>
          <Button
            kind="primary"
            onClick={() => {
              setShowSaveFirstPrompt(false)
              captureFocus()
              commitModal.openModal()
            }}
          >
            Save changes first
          </Button>
        </ModalFooter>
      </ComposedModal>

      {/* Version modal */}
      <CommitModal
        open={commitModal.isOpen}
        onClose={() => {
          commitModal.closeModal()
          restoreFocus()
        }}
        projectId={f.projectId}
        fileId={fileId}
        saveMode={hasGitRepository ? 'git' : 'local'}
        defaultMessage={editorMode === 'hotfix' && hotfixContext?.fromFileVersion ? `Hotfix from v${hotfixContext.fromFileVersion}` : undefined}
        hotfixFromCommitId={editorMode === 'hotfix' ? hotfixContext?.fromCommitId ?? undefined : undefined}
        hotfixFromFileVersion={editorMode === 'hotfix' ? hotfixContext?.fromFileVersion ?? undefined : undefined}
        beforeSubmit={prepareVersionSave}
        onSuccess={() => {
          handleVersionSaveSuccess()
          // Clear hotfix context after successful commit
          if (editorMode === 'hotfix' && fileId) {
            try { sessionStorage.removeItem(`hotfix-context-${fileId}`) } catch {}
            setEditorMode('normal')
            setHotfixContext(null)
          }
        }}
      />

      <ComposedModal open={takeoverModalOpen && !!collaborationHolder && editorMode !== 'view'} size="sm" onClose={() => setTakeoverModalOpen(false)}>
        <ModalHeader label={undefined} title="Take over editing?" closeModal={() => setTakeoverModalOpen(false)} />
        <ModalBody>
          <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
            <p style={{ margin: 0 }}>
              {collaborationTakeoverPrompt?.title || 'Another user is currently editing this draft.'}
            </p>
            <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
              {collaborationTakeoverPrompt?.subtitle || 'Taking over switches their editor to read-only. Your current tab will become writable immediately, and your unsaved local work stays in place.'}
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button kind="secondary" onClick={() => setTakeoverModalOpen(false)}>
            Keep read-only
          </Button>
          <Button kind="primary" onClick={() => { void handleTakeover() }} disabled={takeoverPending}>
            {takeoverPending ? 'Taking over…' : 'Take over'}
          </Button>
        </ModalFooter>
      </ComposedModal>
    </div>
  )
}
