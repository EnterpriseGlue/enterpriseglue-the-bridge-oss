import React from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs, TabList, Tab, TabPanels, TabPanel, Button, BreadcrumbItem, InlineNotification, ComboBox, ComposedModal, ModalHeader, ModalBody, ModalFooter } from '@carbon/react'
import { Flag, Undo, Redo, Branch } from '@carbon/icons-react'
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

export default function Editor() {
  const { fileId } = useParams()
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation() as { state?: any }
  const queryClient = useQueryClient()
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
  const evaluateMutation = useMutation({
    mutationFn: async (variables: Record<string, { value: any; type: string }>) => {
      if (!decisionKey) throw new Error('No decision key')
      return apiClient.post(
        `/mission-control-api/decision-definitions/key/${decisionKey}/evaluate`,
        { variables }
      )
    }
  })

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
        setTimeout(() => {
          isRestoringRef.current = false
        }, 100)
      })
      .catch(() => {
        isRestoringRef.current = false
      })
  }, [modelerReady, xmlHistory.snapshots, xmlHistory.currentIndex, fileQ.data?.updatedAt])

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
          <a href={toTenantPath(`/starbase/project/${f.projectId}`)} onClick={(e) => { e.preventDefault(); tenantNavigate(`/starbase/project/${f.projectId}`); }}>
            {f.projectName}
          </a>
        </BreadcrumbItem>
        {f.folderBreadcrumb.map((folder) => (
          <BreadcrumbItem key={folder.id}>
            <a 
              href={toTenantPath(`/starbase/project/${f.projectId}?folder=${folder.id}`)} 
              onClick={(e) => { e.preventDefault(); tenantNavigate(`/starbase/project/${f.projectId}?folder=${folder.id}`); }}
            >
              {folder.name}
            </a>
          </BreadcrumbItem>
        ))}
        {location.state?.fromEditor?.fileId && location.state.fromEditor.fileId !== f.id && (
          <BreadcrumbItem>
            <a
              href={toTenantPath(`/starbase/editor/${location.state.fromEditor.fileId}`)}
              onClick={(e) => {
                e.preventDefault()
                tenantNavigate(`/starbase/editor/${location.state.fromEditor.fileId}`)
              }}
            >
              {location.state.fromEditor.fileName || 'Previous file'}
            </a>
          </BreadcrumbItem>
        )}
        <BreadcrumbItem isCurrentPage>{f.name}</BreadcrumbItem>
      </BreadcrumbBar>

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
            <DeployButton projectId={f.projectId} size="sm" kind="ghost" />
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
            <DeployButton projectId={f.projectId} size="sm" kind="ghost" />
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
              // Fit viewport on initial load with padding to clear the palette
              setTimeout(() => {
                try {
                  const canvas = m.get('canvas')
                  canvas.zoom('fit-viewport')
                } catch {}
              }, 100)
            }}
            implementMode={tabIndex === 1}
            onDirty={(label) => {
              // Skip if we're restoring from history
              if (isRestoringRef.current) return
              // Skip spurious dirty events right after saving/committing
              if (Date.now() < ignoreDirtyUntilRef.current) return

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
        <ModalHeader label={null} title={`Link ${linkTypeLabel}`} closeModal={closeLinkModal} />
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

      {/* Version modal */}
      <CommitModal
        open={commitModal.isOpen}
        onClose={() => {
          commitModal.closeModal()
          restoreFocus()
        }}
        projectId={f.projectId}
        fileId={fileId}
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
        }}
      />
    </div>
  )
}
