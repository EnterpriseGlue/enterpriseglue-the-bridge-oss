import React from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { sanitizePathParam } from '../../../shared/utils/sanitize'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs, TabList, Tab, TabPanels, TabPanel, Button, BreadcrumbItem, InlineNotification, ComboBox, ComposedModal, ModalHeader, ModalBody, ModalFooter, Toggletip, ToggletipButton, ToggletipContent } from '@carbon/react'
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
import { buildProjectFileIndex, resolveLinkedFile, type ProjectFileMeta } from '../utils/linkResolution'
import { FolderLoader, CurrentPath, TreePicker, type FolderSummary } from '../components/project-detail'
import { useElementLinkOverlay } from '../hooks/useElementLinkOverlay'
import { getElementLinkInfo, updateElementLink, clearElementLink } from '../utils/bpmnLinking'
const DMNCanvas = React.lazy(() => import('../components/DMNCanvas'))
const DMNDrdMini = React.lazy(() => import('../components/DMNDrdMini'))
const DMNEvaluatePanel = React.lazy(() => import('../components/DMNEvaluatePanel'))
// Properties panel is provided by camunda-bpmn-js and mounted by Canvas
import { DeployButton, GitVersionsPanel } from '../../git/components'
import { ProjectAccessError, isProjectAccessError } from '../components/ProjectAccessError'
import { useSelectedEngine } from '../../../components/EngineSelector'
import { useEngineSelectorStore } from '../../../stores/engineSelectorStore'
import { useToast } from '../../../shared/notifications/ToastProvider'

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
  createdAt: number
  updatedAt: number
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

export default function Editor() {
  const { fileId } = useParams()
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation() as { state?: any; search: string }
  const { notify } = useToast()
  const queryClient = useQueryClient()
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

  const projectFilesQ = useQuery({
    queryKey: ['starbase', 'project-files', fileQ.data?.projectId],
    queryFn: () => apiClient.get<StarbaseFile[]>(`/starbase-api/projects/${fileQ.data?.projectId}/files`),
    enabled: !!fileQ.data?.projectId,
    refetchOnMount: 'always',
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
  const updatedAtRef = React.useRef<number | null>(null)
  const [lastEditedAt, setLastEditedAt] = React.useState<number | null>(null)
  const [localDirty, setLocalDirty] = React.useState(false)
  const [decisionKey, setDecisionKey] = React.useState<string | undefined>(undefined)
  const [historyPanelOpen, setHistoryPanelOpen] = React.useState(false)
  const isRestoringRef = React.useRef(false)
  const appliedInitialHistoryRef = React.useRef(false)
  const ignoreDirtyUntilRef = React.useRef(0)
  const [projectFilesError, setProjectFilesError] = React.useState<string | null>(null)
  const [linkModalOpen, setLinkModalOpen] = React.useState(false)
  const [linkSelectedFileId, setLinkSelectedFileId] = React.useState<string | null>(null)
  const [linkModalError, setLinkModalError] = React.useState<string | null>(null)
  const [allFolders, setAllFolders] = React.useState<FolderSummary[] | null>(null)
  const lastFocusRef = React.useRef<HTMLElement | null>(null)

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
    setSelection(null)
    selectionIdRef.current = null
    setTabIndex(0)
    setOverlayOpen(false)
    setVersionsPanelOpen(false)
    setDmnEvaluateOpen(false)
    modelerRef.current = null
    setModelerReady(false)
    setSaving('idle')
    setLocalDirty(false)
    setHistoryPanelOpen(false)
    setLinkModalOpen(false)
    setLinkSelectedFileId(null)
    setLinkModalError(null)
    updatedAtRef.current = null
    appliedInitialHistoryRef.current = false
    ignoreDirtyUntilRef.current = 0
    setEditorMode('normal')
    setHotfixContext(null)
    setShowSaveFirstPrompt(false)
    viewModeImportedRef.current = false
  }, [fileId])

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
    [selectedElement, lastEditedAt]
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
    })
  }, [modelerReady, selectedElement, elementLinkInfo, resolvedLink])

  const linkTypeLabel = elementLinkInfo?.linkType === 'decision' ? 'decision' : 'process'
  const linkedLabel = resolvedLink?.name ?? elementLinkInfo?.fileName ?? null
  const canOpenLinked = Boolean(resolvedLink)

  const openLinkedFile = React.useCallback(() => {
    if (!resolvedLink) return
    // Invalidate the target file query to ensure fresh data loads
    queryClient.invalidateQueries({ queryKey: ['file', resolvedLink.id] })
    tenantNavigate(`/starbase/editor/${resolvedLink.id}`, {
      state: {
        fromEditor: {
          fileId: fileId ? String(fileId) : null,
          fileName: fileQ.data?.name ?? null,
        },
      },
    })
  }, [tenantNavigate, resolvedLink, queryClient, fileId, fileQ.data?.name])

  const unlinkElement = React.useCallback(() => {
    if (!elementLinkInfo || !modelerRef.current || !selectedElement) return
    clearElementLink(modelerRef.current, selectedElement, elementLinkInfo.linkType)
  }, [elementLinkInfo, selectedElement])

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

  const linkTargetType = elementLinkInfo?.linkType === 'decision' ? 'dmn' : 'bpmn'
  const filteredLinkFiles = React.useMemo(() => {
    return projectFiles
      .filter((file) => file.type === linkTargetType)
      .filter((file) => !file.isSelf)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [projectFiles, linkTargetType])

  const selectedLinkFile = React.useMemo(
    () => filteredLinkFiles.find((file) => file.id === linkSelectedFileId) || null,
    [filteredLinkFiles, linkSelectedFileId]
  )

  useElementLinkOverlay({
    modeler: modelerRef.current,
    elementId: elementLinkInfo?.elementId ?? null,
    visible: Boolean(elementLinkInfo),
    status: linkStatus as any,
    linkedLabel,
    linkTypeLabel,
    canOpen: canOpenLinked,
    onLink: openLinkModal,
    onOpen: openLinkedFile,
    onUnlink: unlinkElement,
  })

  // Persistent XML history for undo/redo across page refreshes
  const xmlHistory = useXmlHistory(fileId)
  
  // Query for uncommitted changes status
  const uncommittedQ = useQuery({
    queryKey: ['uncommitted-files', fileQ.data?.projectId, 'draft'],
    queryFn: () => apiClient.get<{ hasUncommittedChanges: boolean; uncommittedFileIds: string[] }>(
      `/vcs-api/projects/${fileQ.data?.projectId}/uncommitted-files`,
      { baseline: 'draft' }
    ),
    enabled: !!fileQ.data?.projectId,
    refetchInterval: 30000, // Refresh every 30 seconds
  })
  
  const hasUncommittedChanges = uncommittedQ.data?.hasUncommittedChanges ?? false
  const fileIsUncommitted = Boolean(
    fileId && Array.isArray(uncommittedQ.data?.uncommittedFileIds) && uncommittedQ.data!.uncommittedFileIds.includes(fileId)
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
    enabled: !!fileQ.data?.projectId && !!fileId,
    staleTime: 10_000,
    refetchOnMount: 'always',
  })
  const hasUnsavedVersion = Boolean(
    // Only show "Unsaved version" once the user has actually edited the diagram.
    // We persist lastEditedAt in sessionStorage so this also survives navigation.
    (localDirty || fileIsUncommitted) && typeof lastEditedAt === 'number'
  )

  // Restore lastEditedAt across navigation within the same browser session.
  React.useEffect(() => {
    if (!lastEditedAtStorageKey) return
    try {
      const raw = sessionStorage.getItem(lastEditedAtStorageKey)
      const parsed = raw ? Number(raw) : NaN
      if (Number.isFinite(parsed)) {
        setLastEditedAt(parsed)
      }
    } catch {}
  }, [lastEditedAtStorageKey])

  // Persist lastEditedAt updates so the Versions panel can show "Edited X ago" after navigation.
  React.useEffect(() => {
    if (!lastEditedAtStorageKey) return
    try {
      if (typeof lastEditedAt === 'number' && Number.isFinite(lastEditedAt)) {
        sessionStorage.setItem(lastEditedAtStorageKey, String(lastEditedAt))
      } else {
        sessionStorage.removeItem(lastEditedAtStorageKey)
      }
    } catch {}
  }, [lastEditedAt, lastEditedAtStorageKey])

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
      modelerRef.current.importXML(match.content).then(async () => {
        isRestoringRef.current = false
        // DMN: auto-open decision table / literal expression view (mirrors DMNCanvas logic)
        try {
          const m = modelerRef.current
          const views = m?.getViews?.() || []
          if (views.length > 0) {
            const table = views.find((v: any) => v.type === 'decisionTable' || v.type === 'literalExpression')
            if (table) await m.open(table)
            else if (views[0]) await m.open(views[0])
          }
        } catch {}
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

  const fileIdForSave = fileQ.data?.id
  const saveXmlWithRetry = React.useCallback(async (xml: string) => {
    if (!fileIdForSave) throw new Error('File ID unavailable')
    try {
      const data = await apiClient.put<{ updatedAt?: number }>(`/starbase-api/files/${fileIdForSave}`, {
        xml,
        prevUpdatedAt: updatedAtRef.current ?? undefined,
      })
      if (typeof data?.updatedAt === 'number') {
        updatedAtRef.current = Number(data.updatedAt) || updatedAtRef.current
      }

      // Keep the editor query cache in sync so navigating away/back doesn't show stale XML.
      queryClient.setQueryData(['file', fileIdForSave], (old: any) => {
        if (!old) return old
        const nextUpdatedAt = typeof data?.updatedAt === 'number' ? data.updatedAt : old.updatedAt
        return { ...old, updatedAt: nextUpdatedAt }
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
        if (typeof parsed.payload?.currentUpdatedAt === 'number') {
          updatedAtRef.current = parsed.payload.currentUpdatedAt
        }
        const data = await apiClient.put<{ updatedAt?: number }>(`/starbase-api/files/${fileIdForSave}`, {
          xml,
          prevUpdatedAt: updatedAtRef.current ?? undefined,
        })
        if (typeof data?.updatedAt === 'number') {
          updatedAtRef.current = Number(data.updatedAt) || updatedAtRef.current
        }

        queryClient.setQueryData(['file', fileIdForSave], (old: any) => {
          if (!old) return old
          const nextUpdatedAt = typeof data?.updatedAt === 'number' ? data.updatedAt : old.updatedAt
          return { ...old, updatedAt: nextUpdatedAt }
        })
        queryClient.setQueryData(['file-breadcrumb', fileIdForSave], (old: any) => {
          if (!old) return old
          const nextUpdatedAt = typeof data?.updatedAt === 'number' ? data.updatedAt : old.updatedAt
          return { ...old, updatedAt: nextUpdatedAt }
        })

        return data
      }
      throw error
    }
  }, [fileIdForSave, queryClient])

  const restoreFromDeploymentMutation = useMutation({
    mutationFn: async () => {
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
      window.location.assign(toTenantPath(cleanEditorPath))
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
    if ((window as any).__autosaveTimer) {
      clearTimeout((window as any).__autosaveTimer)
      ;(window as any).__autosaveTimer = null
    }
    setPhase2Dismissed(true)
    viewModeImportedRef.current = false
    setEditorMode('view')
  }, [])

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
    window.location.assign(toTenantPath(cleanEditorPath))
  }, [fileId, queryClient, toTenantPath, cleanEditorPath])

  const handleBackToDraft = React.useCallback(() => {
    viewModeImportedRef.current = false
    setEditorMode('normal')
    // Reimport the file's current XML
    if (modelerRef.current && fileQ.data?.xml) {
      isRestoringRef.current = true
      modelerRef.current.importXML(fileQ.data.xml).then(async () => {
        isRestoringRef.current = false
        // DMN: re-open decision table / literal expression view
        try {
          const m = modelerRef.current
          const views = m?.getViews?.() || []
          if (views.length > 0) {
            const table = views.find((v: any) => v.type === 'decisionTable' || v.type === 'literalExpression')
            if (table) await m.open(table)
            else if (views[0]) await m.open(views[0])
          }
        } catch {}
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

  const showPropertiesParent = overlayOpen ? propEl : undefined

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
    })

    try {
      setSaving('saving')
      const { xml } = await modelerRef.current.saveXML({ format: true })
      await saveXmlWithRetry(xml)
      xmlHistory.addSnapshot(xml, 'Link updated')
      setSaving('saved')
      setTimeout(() => setSaving('idle'), 1500)
      setLinkModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['file', fileId] })
    } catch {
      setSaving('error')
      setTimeout(() => setSaving('idle'), 3000)
      setLinkModalError('Failed to save link. Please try again.')
    }
  }

  return (
    <div
      className={overlayOpen ? 'starbase-editor drawer-open' : 'starbase-editor'}
      style={{ height: 'calc(100vh - var(--header-height) - var(--spacing-4))', padding: 0, display: 'flex', flexDirection: 'column' }}
    >
      {/* Breadcrumb Bar */}
      <BreadcrumbBar>
        <BreadcrumbItem>
          <a href={toTenantPath('/starbase')} onClick={(e) => { e.preventDefault(); tenantNavigate('/starbase'); }}>Starbase</a>
        </BreadcrumbItem>
        <BreadcrumbItem>
          <a href={toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}`)} onClick={(e) => { e.preventDefault(); tenantNavigate(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}`); }}>
            {f.projectName}
          </a>
        </BreadcrumbItem>
        {f.folderBreadcrumb.map((folder) => (
          <BreadcrumbItem key={folder.id}>
            <a 
              href={toTenantPath(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}?folder=${encodeURIComponent(sanitizePathParam(folder.id))}`)} 
              onClick={(e) => { e.preventDefault(); tenantNavigate(`/starbase/project/${encodeURIComponent(sanitizePathParam(f.projectId))}?folder=${encodeURIComponent(sanitizePathParam(folder.id))}`); }}
            >
              {folder.name}
            </a>
          </BreadcrumbItem>
        ))}
        {location.state?.fromEditor?.fileId && location.state.fromEditor.fileId !== f.id && (
          <BreadcrumbItem>
            <a
              href={toTenantPath(`/starbase/editor/${encodeURIComponent(sanitizePathParam(location.state.fromEditor.fileId))}`)}
              onClick={(e) => {
                e.preventDefault()
                tenantNavigate(`/starbase/editor/${encodeURIComponent(sanitizePathParam(location.state.fromEditor.fileId))}`)
              }}
            >
              {location.state.fromEditor.fileName || 'Previous file'}
            </a>
          </BreadcrumbItem>
        )}
        <BreadcrumbItem isCurrentPage>{f.name.replace(/\.(bpmn|dmn)$/i, '')}</BreadcrumbItem>
      </BreadcrumbBar>

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
            <Tabs selectedIndex={tabIndex} onChange={({ selectedIndex }) => setTabIndex(selectedIndex)}>
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
          {modelerReady && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'auto',
              }}
            >
              <CanvasToolbar modeler={modelerRef.current} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <div style={{ fontSize: 'var(--text-12)', color: saving === 'error' ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>
              {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
            </div>
            <DeployButton projectId={f.projectId} fileIds={[f.id]} size="sm" kind="ghost" onDeploySuccess={handleDeploySuccess} />
            {missionControlTarget && (
              <Button kind="ghost" size="sm" renderIcon={Launch} onClick={handleGoToMissionControl}>
                Mission Control
              </Button>
            )}
            <button
              onClick={handleUndo}
              disabled={!xmlHistory.canUndo}
              title="Undo (Ctrl+Z)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canUndo ? 'pointer' : 'default',
                color: xmlHistory.canUndo ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Undo size={20} />
            </button>
            <button
              onClick={handleRedo}
              disabled={!xmlHistory.canRedo}
              title="Redo (Ctrl+Y)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canRedo ? 'pointer' : 'default',
                color: xmlHistory.canRedo ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Redo size={20} />
            </button>
            <Button kind="ghost" size="sm" onClick={() => setVersionsPanelOpen(!versionsPanelOpen)}>Versions</Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--spacing-2) var(--spacing-4)' }}>
          <Button kind="ghost" size="sm" onClick={() => setDmnEvaluateOpen(!dmnEvaluateOpen)}>
            {dmnEvaluateOpen ? 'Hide' : 'Show'} Evaluate Panel
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            <div style={{ fontSize: 'var(--text-12)', color: saving === 'error' ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>
              {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : saving === 'error' ? 'Save failed' : ''}
            </div>
            <DeployButton projectId={f.projectId} fileIds={[f.id]} size="sm" kind="ghost" onDeploySuccess={handleDeploySuccess} />
            {missionControlTarget && (
              <Button kind="ghost" size="sm" renderIcon={Launch} onClick={handleGoToMissionControl}>
                Mission Control
              </Button>
            )}
            <button
              onClick={handleUndo}
              disabled={!xmlHistory.canUndo}
              title="Undo (Ctrl+Z)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canUndo ? 'pointer' : 'default',
                color: xmlHistory.canUndo ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Undo size={20} />
            </button>
            <button
              onClick={handleRedo}
              disabled={!xmlHistory.canRedo}
              title="Redo (Ctrl+Y)"
              style={{
                background: 'none',
                border: 'none',
                cursor: xmlHistory.canRedo ? 'pointer' : 'default',
                color: xmlHistory.canRedo ? '#0f62fe' : '#c6c6c6',
                display: 'flex',
                alignItems: 'center',
                padding: '4px'
              }}
            >
              <Redo size={20} />
            </button>
            <Button kind="ghost" size="sm" onClick={() => setVersionsPanelOpen(!versionsPanelOpen)}>Versions</Button>
          </div>
        </div>
      )}

      {/* Editor body (edge-to-edge under header) */}
      <div style={{ position: 'relative', flex: 1, background: 'var(--color-bg-primary)', overflow: 'hidden' }}>
        {f.type === 'bpmn' ? (
          <Canvas
            key={f.id}
            xml={f.xml}
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
              // Suppress all saves in view mode (use ref to avoid stale closure)
              if (editorModeRef.current === 'view') return

              setLastEditedAt(Date.now())
              setLocalDirty(true)
              
              // History snapshot immediately - only for drawing changes (label provided)
              if (label) {
                ;(async () => {
                  try {
                    if (!modelerRef.current) return
                    const { xml } = await modelerRef.current.saveXML({ format: true })
                    xmlHistory.addSnapshot(xml, label)
                  } catch {}
                })()
              }
              
              // Database save with longer debounce (800ms) - batches rapid changes
              if ((window as any).__autosaveTimer) clearTimeout((window as any).__autosaveTimer)
              ;(window as any).__autosaveTimer = setTimeout(async () => {
                try {
                  if (!modelerRef.current) return
                  if (Date.now() < ignoreDirtyUntilRef.current) return
                  // Double-check: don't save if we switched to view mode while the timer was pending
                  if (editorModeRef.current === 'view') return
                  setSaving('saving')
                  const { xml } = await modelerRef.current.saveXML({ format: true })
                  
                  await saveXmlWithRetry(xml)
                  setSaving('saved')
                  setTimeout(() => setSaving('idle'), 1500)
                  // Invalidate uncommitted-files query so project page shows updated status
                  queryClient.invalidateQueries({ queryKey: ['uncommitted-files', f.projectId] })
                  // Ensure updated process/decision IDs are available without refresh.
                  queryClient.invalidateQueries({ queryKey: ['starbase', 'project-files', f.projectId] })
                } catch (e) {
                  setSaving('error')
                  setTimeout(() => setSaving('idle'), 3000)
                }
              }, 800)
            }}
          />
        ) : (
          <React.Suspense fallback={<div style={{ padding: 'var(--spacing-4)' }}>Loading DMN…</div>}>
            <div style={{ height: '100%', background: 'var(--color-bg-primary)' }}>
              <DMNCanvas
                key={f.id}
                xml={f.xml}
                onModelerReady={(m) => { 
                  modelerRef.current = m
                  setModelerReady(true)
                }}
                onDirty={() => {
                  // Skip if we're restoring from history
                  if (isRestoringRef.current) return
                  // Skip spurious dirty events right after saving/committing
                  if (Date.now() < ignoreDirtyUntilRef.current) return
                  // Suppress all saves in view mode (use ref to avoid stale closure)
                  if (editorModeRef.current === 'view') return

                  setLastEditedAt(Date.now())
                  setLocalDirty(true)

                  // History snapshot immediately for DMN changes
                  ;(async () => {
                    try {
                      if (!modelerRef.current) return
                      const { xml } = await modelerRef.current.saveXML({ format: true })
                      xmlHistory.addSnapshot(xml, 'DMN change')
                    } catch {}
                  })()

                  // Database save with debounce
                  if ((window as any).__autosaveTimer) clearTimeout((window as any).__autosaveTimer)
                  ;(window as any).__autosaveTimer = setTimeout(async () => {
                    try {
                      if (!modelerRef.current) return
                      if (Date.now() < ignoreDirtyUntilRef.current) return
                      // Double-check: don't save if we switched to view mode while the timer was pending
                      if (editorModeRef.current === 'view') return
                      setSaving('saving')
                      const { xml } = await modelerRef.current.saveXML({ format: true })
                      await saveXmlWithRetry(xml)
                      setSaving('saved')
                      setTimeout(() => setSaving('idle'), 1500)
                      // Invalidate uncommitted-files query so project page shows updated status
                      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', f.projectId] })
                      // Ensure updated process/decision IDs are available without refresh.
                      queryClient.invalidateQueries({ queryKey: ['starbase', 'project-files', f.projectId] })
                    } catch (e) {
                      setSaving('error')
                      setTimeout(() => setSaving('idle'), 3000)
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
              <React.Suspense fallback={<div style={{ padding: 'var(--spacing-4)' }}>Loading…</div>}>
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
                captureFocus()
                commitModal.openModal()
              }}
              style={{ background: '#24a148', borderColor: '#24a148', color: 'white', borderRadius: '4px', padding: '4px 12px', minHeight: 'auto', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Branch size={16} /> {hasUnsavedVersion ? 'Save version' : 'New version'}
            </Button>
              <Button kind="ghost" size="sm" onClick={() => setVersionsPanelOpen(false)}>Close</Button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: 'var(--cds-layer-01, #ffffff)' }}>
              {f.projectId ? (
                <GitVersionsPanel
                  projectId={f.projectId}
                  fileId={fileId}
                  fileName={f.name}
                  fileType={f.type as 'bpmn' | 'dmn'}
                  hasUnsavedVersion={hasUnsavedVersion}
                  lastEditedAt={lastEditedAt}
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
              itemToString={(item) => (item ? item.name : '')}
              itemToElement={(item) => {
                if (!item) return null
                const pathParts = getFolderPath(item.folderId)
                const hasFolder = Boolean(item.folderId)
                const pathLabel = pathParts.length ? pathParts.join(' / ') : (hasFolder ? 'Unknown folder' : '')
                const hasKey = linkTargetType === 'dmn' ? Boolean(item.dmnDecisionId) : Boolean(item.bpmnProcessId)
                return (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, maxWidth: '100%', overflow: 'hidden', opacity: hasKey ? 1 : 0.6 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.name}
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
                return item.name.toLowerCase().includes(search) || pathLabel.toLowerCase().includes(search)
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
        defaultMessage={editorMode === 'hotfix' && hotfixContext?.fromFileVersion ? `Hotfix from v${hotfixContext.fromFileVersion}` : undefined}
        hotfixFromCommitId={editorMode === 'hotfix' ? hotfixContext?.fromCommitId ?? undefined : undefined}
        hotfixFromFileVersion={editorMode === 'hotfix' ? hotfixContext?.fromFileVersion ?? undefined : undefined}
        beforeSubmit={async () => {
          try {
            // Suppress any modeler churn while we flush/save/commit.
            ignoreDirtyUntilRef.current = Date.now() + 2000
            if ((window as any).__autosaveTimer) {
              clearTimeout((window as any).__autosaveTimer)
              ;(window as any).__autosaveTimer = null
            }

            if (!modelerRef.current) return

            setSaving('saving')
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
            setSaving('saved')
            setTimeout(() => setSaving('idle'), 1500)
            // Invalidate uncommitted-files query so project page shows updated status
            queryClient.invalidateQueries({ queryKey: ['uncommitted-files', f.projectId] })
          } catch (e) {
            setSaving('error')
            setTimeout(() => setSaving('idle'), 3000)
            throw e
          }
        }}
        onSuccess={() => {
          // Suppress any immediate post-commit modeler churn from showing as a new unsaved version.
          ignoreDirtyUntilRef.current = Date.now() + 500
          setLocalDirty(false)
          setLastEditedAt(null)
          // Clear hotfix context after successful commit
          if (editorMode === 'hotfix' && fileId) {
            try { sessionStorage.removeItem(`hotfix-context-${fileId}`) } catch {}
            setEditorMode('normal')
            setHotfixContext(null)
          }
        }}
      />
    </div>
  )
}
