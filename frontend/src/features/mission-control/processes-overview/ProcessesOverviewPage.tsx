import React from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { sanitizePathParam } from '../../../shared/utils/sanitize'
import { Pause, Play, TrashCan, Renew, Migrate, Close } from '@carbon/icons-react'
import { BreadcrumbItem } from '@carbon/react'
import { BreadcrumbBar } from '../../shared/components/BreadcrumbBar'
import { TableSearchBar } from '../../../shared/components/ui/TableSearchBar'
import SplitPane from 'react-split-pane'
import { useProcessesFilterStore } from '../shared/stores/processesFilterStore'
import { useDiagramViewStore } from '../shared/stores/diagramViewStore'
import { createCountBadge, getBadgePosition } from '../../shared/components/viewer/viewerUtils'
import { ProcessesDataTable } from './components/ProcessesDataTable'
import { useAlert } from '../../../shared/hooks/useAlert'
import AlertModal from '../../../shared/components/AlertModal'
import { useModal } from '../../../shared/hooks/useModal'
import { InstanceDetailsModal, RetryModal, BulkOperationModals } from './components/modals'
import { PageLoader } from '../../../shared/components/PageLoader'
import {
  useProcessesData,
  useProcessesModalData,
  useBulkOperations,
  useRetryModal,
  useSplitPaneState,
} from './hooks'
import { EngineAccessError, isEngineAccessError } from '../shared/components/EngineAccessError'
import { apiClient } from '../../../shared/api/client'
import { useSelectedEngine } from '../../../components/EngineSelector'

const SPLIT_PANE_STORAGE_KEY = 'processes-split-pane-size-v2'
const DEFAULT_SPLIT_SIZE = '75%'
const Viewer = React.lazy(() => import('../../shared/components/Viewer'))

export default function ProcessesOverviewPage() {
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation() as any
  const [searchParams, setSearchParams] = useSearchParams()
  const { alertState, showAlert, closeAlert } = useAlert()
  const selectedEngineId = useSelectedEngine()
  const { clearViewports } = useDiagramViewStore()

  // Split pane state with localStorage persistence
  const { size: splitSize, handleChange: handleSplitChange } = useSplitPaneState({
    storageKey: SPLIT_PANE_STORAGE_KEY,
    defaultSize: DEFAULT_SPLIT_SIZE,
  })

  
  // Filter store
  const {
    selectedProcess, setSelectedProcess,
    selectedVersion, setSelectedVersion,
    flowNode, setFlowNode,
    setFlowNodes,
    selectedStates, setSelectedStates,
    searchValue, setSearchValue,
    dateFrom,
    dateTo,
    timeFrom,
    timeTo,
  } = useProcessesFilterStore()

  // Derived boolean flags from selectedStates
  const active = selectedStates.some(s => s.id === 'active')
  const incidents = selectedStates.some(s => s.id === 'incidents')
  const completed = selectedStates.some(s => s.id === 'completed')
  const suspendedFlag = selectedStates.some(s => s.id === 'suspended')
  const canceled = selectedStates.some(s => s.id === 'canceled')

  // If no process is selected, version/node filters are not meaningful.
  // Clear them immediately to avoid showing stale cached results (instQ can be disabled while
  // waiting for a processDefinitionId that can never be resolved without a process).
  React.useEffect(() => {
    if (selectedProcess) return
    if (selectedVersion !== null) setSelectedVersion(null)
    if (flowNode) setFlowNode('')
  }, [selectedProcess])

  // Advanced filter state (currently hidden)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [varName, setVarName] = React.useState('')
  const [varType, setVarType] = React.useState<'String'|'Boolean'|'Long'|'Double'|'JSON'>('String')
  const [varOp, setVarOp] = React.useState<'equals'|'notEquals'|'like'|'greaterThan'|'lessThan'|'greaterThanOrEquals'|'lessThanOrEquals'>('equals')
  const [varValue, setVarValue] = React.useState('')
  const [isResetting, setIsResetting] = React.useState(false)

  // Local UI state
  const [selectedMap, setSelectedMap] = React.useState<Record<string, boolean>>({})
  const [hoveredRowId, setHoveredRowId] = React.useState<string | null>(null)
  const [retryingMap, setRetryingMap] = React.useState<Record<string, boolean>>({})
  const [retryModalInstanceId, setRetryModalInstanceId] = React.useState<string | null>(null)
  // tableSearchValue now comes from the store as searchValue

  // Modal hooks
  const terminateModal = useModal<string>()
  const bulkRetryModal = useModal()
  const bulkSuspendModal = useModal()
  const bulkActivateModal = useModal()
  const bulkDeleteModal = useModal()
  const detailsModal = useModal<string>()

  // Data fetching hooks
  const processesData = useProcessesData({
    selectedProcess,
    selectedVersion,
    setSelectedVersion,
    active,
    suspended: suspendedFlag,
    incidents,
    completed,
    canceled,
    flowNode,
    dateFrom,
    dateTo,
    timeFrom,
    timeTo,
    varName,
    varType,
    varOp,
    varValue,
    advancedOpen,
  })

  const modalData = useProcessesModalData({
    detailsModalInstanceId: detailsModal.data || null,
    detailsModalOpen: detailsModal.isOpen,
    retryModalInstanceId,
    engineId: selectedEngineId,
  })

  const bulkOps = useBulkOperations({
    selectedMap,
    setSelectedMap,
    instQRefetch: () => processesData.instQ.refetch(),
    showAlert: (msg: string, kind: 'error' | 'warning' | 'info' | 'success') => showAlert(msg, kind as any),
    engineId: selectedEngineId ?? null,
  })

  const retryModalState = useRetryModal({
    retryModalInstanceId,
    allRetryItems: modalData.allRetryItems,
    retryJobsQData: modalData.retryJobsQ.data,
  })

  // Destructure data from hooks
  const { defItems, versions, currentKey, defIdForVersion, xmlQ, countsQ, countsByStateQ, previewCountQ, instQ, defsQ, defIdQ } = processesData

  // If we were navigated here from a call activity link pill, auto-select the process from the URL
  React.useEffect(() => {
    const processKey = searchParams.get('process')
    if (!processKey || defItems.length === 0) return
    const matching = defItems.find((d) => d.key === processKey)
    if (matching) {
      setSelectedProcess(matching as any)
      // Clear the URL parameter after applying
      searchParams.delete('process')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, defItems, setSelectedProcess, setSearchParams])

  // If we were navigated here from a link pill, auto-select the node (activity id)
  React.useEffect(() => {
    const nodeId = searchParams.get('node')
    if (!nodeId) return

    setFlowNode(nodeId)

    // Clear the URL parameter after applying
    searchParams.delete('node')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setFlowNode, setSearchParams])

  const fromInstanceId = location?.state?.fromInstanceId as string | undefined || searchParams.get('fromInstance') || undefined

  // Viewer API for managing BPMN diagram
  const [viewerApi, setViewerApi] = React.useState<any>(null)
  
  // Flow nodes extracted from the diagram for the filter dropdown
  const [diagramFlowNodes, setDiagramFlowNodes] = React.useState<Array<{ id: string; name: string; type: string; x: number }>>([])
  
  // Extract flow nodes - called after diagram is ready (via onDiagramReset)
  const extractFlowNodes = React.useCallback(() => {
    if (viewerApi) {
      const elements = viewerApi.getAllElements()
      setDiagramFlowNodes(elements)
      setFlowNodes(elements)
    }
  }, [viewerApi, setFlowNodes])

  // When a node is selected (e.g. from URL deep-link), focus it in the diagram
  React.useEffect(() => {
    if (!viewerApi) return
    if (!flowNode) return

    try {
      viewerApi.focus(flowNode)
      viewerApi.selectElement(flowNode)
    } catch {}
  }, [viewerApi, flowNode])
  
  // Extract flow nodes when viewerApi becomes available or changes
  // This ensures nodes are listed even when navigating back to the page
  React.useEffect(() => {
    if (viewerApi) {
      // Small delay to ensure the diagram is fully rendered
      const timer = setTimeout(() => {
        const elements = viewerApi.getAllElements()
        setDiagramFlowNodes(elements)
        setFlowNodes(elements)
      }, 100)
      return () => clearTimeout(timer)
    } else {
      setDiagramFlowNodes([])
      setFlowNodes([])
    }
  }, [viewerApi, setFlowNodes])
  
  // Handle element click on diagram - toggle selection
  const handleElementClick = React.useCallback((elementId: string, elementName: string, elementType: string) => {
    // If clicking the same element, deselect it
    if (flowNode === elementId) {
      setFlowNode('')
    } else {
      setFlowNode(elementId)
    }
  }, [flowNode, setFlowNode])

  // Handle canvas click (click on empty space) - deselect any selected node
  const handleCanvasClick = React.useCallback(() => {
    if (flowNode) {
      setFlowNode('')
    }
  }, [flowNode, setFlowNode])

  // Function to apply activity count badges for selected states only
  const applyBadges = React.useCallback(() => {
    if (!viewerApi || !countsByStateQ.data || countsByStateQ.isLoading) return
    
    // Clear existing badges
    viewerApi.clearBadges()
    
    // Get element registry to access shape dimensions
    const elementRegistry = viewerApi.getInternals().elementRegistry
    
    const { active: activeCounts, incidents: incidentCounts, suspended: suspendedCounts, canceled: canceledCounts, completed: completedCounts } = countsByStateQ.data
    
    // Add badges only for selected states
    // Active -> Bottom Left (green)
    if (active) {
      for (const [actId, count] of Object.entries(activeCounts || {})) {
        const element = elementRegistry.get(actId)
        if (!element || !count) continue
        const badge = createCountBadge(count, 'active')
        const position = getBadgePosition('active')
        viewerApi.addBadge(actId, badge, position)
      }
    }
    
    // Incidents -> Bottom Right (red)
    if (incidents) {
      for (const [actId, count] of Object.entries(incidentCounts || {})) {
        const element = elementRegistry.get(actId)
        if (!element || !count) continue
        const badge = createCountBadge(count, 'incidents')
        const position = getBadgePosition('incidents')
        viewerApi.addBadge(actId, badge, position)
      }
    }
    
    // Suspended -> Top Right (yellow)
    if (suspendedFlag) {
      for (const [actId, count] of Object.entries(suspendedCounts || {})) {
        const element = elementRegistry.get(actId)
        if (!element || !count) continue
        const badge = createCountBadge(count, 'suspended')
        const position = getBadgePosition('suspended')
        viewerApi.addBadge(actId, badge, position)
      }
    }
    
    // Canceled -> Top Left (brown)
    if (canceled) {
      for (const [actId, count] of Object.entries(canceledCounts || {})) {
        const element = elementRegistry.get(actId)
        if (!element || !count) continue
        const badge = createCountBadge(count, 'canceled')
        const position = getBadgePosition('canceled')
        viewerApi.addBadge(actId, badge, position)
      }
    }
    
    // Completed -> Top Right (gray) - for end events
    if (completed) {
      for (const [actId, count] of Object.entries(completedCounts || {})) {
        const element = elementRegistry.get(actId)
        if (!element || !count) continue
        const badge = createCountBadge(count, 'completed')
        const position = getBadgePosition('completed')
        viewerApi.addBadge(actId, badge, position)
      }
    }
  }, [viewerApi, countsByStateQ.data, countsByStateQ.isLoading, active, incidents, suspendedFlag, canceled, completed])

  // Combined callback for onDiagramReset - applies badges AND extracts flow nodes
  const handleDiagramReset = React.useCallback(() => {
    applyBadges()
    extractFlowNodes()
  }, [applyBadges, extractFlowNodes])

  // Apply activity count overlays when viewer is ready and counts change
  React.useEffect(() => {
    applyBadges()
  }, [applyBadges])

  // Utility functions for formatting
  function fmt(ts?: string|null) {
    if (!ts) return '--'
    const d = new Date(ts)
    return isNaN(d.getTime()) ? '--' : d.toISOString().replace('T',' ').slice(0,19)
  }
  function fmtDateOnly(ts?: string|null) {
    if (!ts) return '--'
    const d = new Date(ts)
    return isNaN(d.getTime()) ? '--' : d.toISOString().slice(0,10)
  }
  function formatNumberComma(value: number) {
    const rounded = Math.round(value * 10) / 10
    if (rounded === Math.floor(rounded)) return Math.floor(rounded).toString()
    return rounded.toFixed(1).replace('.', ',')
  }
  function formatDuration(ms?: number) {
    if (ms === undefined || ms === null || isNaN(ms)) return '--'
    if (ms < 1000) return `${Math.round(ms)} ms`
    if (ms < 60_000) return `${formatNumberComma(ms / 1000)} sec`
    if (ms < 3_600_000) return `${formatNumberComma(ms / 60_000)} min`
    if (ms < 86_400_000) return `${formatNumberComma(ms / 3_600_000)} h`
    return `${formatNumberComma(ms / 86_400_000)} d`
  }

  const rows = React.useMemo(() => {
    const list = instQ.data || []
    // Filter by selected process if one is chosen
    const filtered = selectedProcess
      ? list.filter(i => i.processDefinitionKey === selectedProcess.key)
      : list
    return filtered.map(i => ({
      id: i.id,
      state: '',
      name: (() => {
        const key = i.processDefinitionKey || currentKey
        if (!key) return '--'
        const match = (defsQ.data || []).find(d => d.key === key)
        return match?.name || key
      })(),
      key: i.id,
      version: (i as any).version ? `${(i as any).version}` : (selectedVersion ? `${selectedVersion}` : ''),
      start: fmtDateOnly(i.startTime),
      startFull: fmt(i.startTime),
      duration: (() => {
        const start = i.startTime ? new Date(i.startTime).getTime() : NaN
        const end = i.endTime ? new Date(i.endTime).getTime() : Date.now()
        const dur = isNaN(start) || isNaN(end) ? undefined : (end - start)
        return formatDuration(dur)
      })(),
      parent: (() => {
        const parentId = (i as any).superProcessInstanceId as string | null | undefined
        if (!parentId || parentId === i.id) return 'None'
        return parentId
      })(),
      ops: ''
    }))
  }, [instQ.data, currentKey, selectedVersion, defsQ.data, selectedProcess])

  // Build a map of process key -> name for the data table
  const processNameMap = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const d of defsQ.data || []) {
      if (d.key && d.name) {
        map[d.key] = d.name
      }
    }
    return map
  }, [defsQ.data])

  const tableHeaders = [
    { key: 'state', header: '' },
    { key: 'name', header: 'Name' },
    { key: 'key', header: 'Instance Key' },
    { key: 'version', header: 'Version' },
    { key: 'start', header: 'Start Date' },
    { key: 'duration', header: 'Duration' },
    { key: 'parent', header: 'Parent Instance' },
    { key: 'ops', header: 'Actions' },
  ]

  const selectedInstances = React.useMemo(() => {
    const ids = new Set(Object.keys(selectedMap).filter((k) => selectedMap[k]))
    return (instQ.data || []).filter((i) => ids.has(i.id))
  }, [instQ.data, selectedMap])

  const selectedCount = selectedInstances.length
  const hasSelection = selectedCount > 0

  const allRunningSelected = hasSelection
    ? selectedInstances.every((i: any) => i?.state === 'ACTIVE' || i?.state === 'SUSPENDED')
    : false
  const anyActiveSelected = hasSelection ? selectedInstances.some((i: any) => i?.state === 'ACTIVE') : false
  const anySuspendedSelected = hasSelection ? selectedInstances.some((i: any) => i?.state === 'SUSPENDED') : false
  const allActiveSelected = hasSelection ? selectedInstances.every((i: any) => i?.state === 'ACTIVE') : false
  const allSuspendedSelected = hasSelection ? selectedInstances.every((i: any) => i?.state === 'SUSPENDED') : false
  const anyIncidentSelected = hasSelection ? selectedInstances.some((i: any) => !!i?.hasIncident) : false

  const migrateSameProcess = React.useMemo(() => {
    if (!hasSelection) return false
    const keys = selectedInstances
      .map((i: any) => i?.processDefinitionKey || currentKey)
      .filter(Boolean) as string[]
    return new Set(keys).size <= 1
  }, [currentKey, hasSelection, selectedInstances])

  const migrateSameVersion = React.useMemo(() => {
    if (!hasSelection) return false
    const vers = selectedInstances.map((i: any) => i?.version).filter((v: any) => v !== undefined && v !== null)
    return new Set(vers).size <= 1
  }, [hasSelection, selectedInstances])

  const canRetry = hasSelection && allRunningSelected && anyIncidentSelected && !bulkOps.bulkRetryBusy
  const canActivate = hasSelection && allRunningSelected && anySuspendedSelected && !bulkOps.bulkActivateBusy
  const canSuspend = hasSelection && allRunningSelected && anyActiveSelected && !bulkOps.bulkSuspendBusy
  const canDelete = hasSelection && allRunningSelected && !bulkOps.bulkDeleteBusy
  const canMigrate = hasSelection && allRunningSelected && migrateSameProcess && migrateSameVersion

  const actionBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: hasSelection ? 'var(--cds-text-on-color)' : 'var(--cds-text-primary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0 1rem',
    fontSize: 'var(--cds-body-compact-01-font-size, 0.875rem)',
    lineHeight: 'var(--cds-body-compact-01-line-height, 1.28572)',
    height: '2rem',
  }

  const getActionBtnStyle = (enabled: boolean): React.CSSProperties => ({
    ...actionBtnStyle,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
  })

  // Destructure action functions from bulkOps hook
  const { callAction } = bulkOps

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  async function retryInstance(id: string, body?: any) {
    setRetryingMap((prev) => ({ ...prev, [id]: true }))
    try {
      const retryBody = { ...(body || {}), engineId: selectedEngineId }
      await apiClient.post(`/mission-control-api/process-instances/${id}/retry`, retryBody, { credentials: 'include' })
      // Poll incidents a few times to see if the failure clears
      const engineQs = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''
      for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(1000)
        try {
          const incidents = await apiClient.get<any[]>(`/mission-control-api/process-instances/${id}/incidents${engineQs}`, undefined, { credentials: 'include' })
          const stillHas = Array.isArray(incidents) && incidents.length > 0
          if (!stillHas) {
            await instQ.refetch()
            return
          }
        } catch {
          // Ignore polling errors; we will refresh at the end
        }
      }
      await instQ.refetch()
    } finally {
      setRetryingMap((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const onRowClick = (rowId: string) => {
    detailsModal.openModal(rowId)
  }

  // Destructure modal data from hooks
  const { varsQ, histQ, retryJobsQ, retryExtTasksQ, allRetryItems } = modalData
  const {
    retrySelectionMap, setRetrySelectionMap,
    retryDueMode, setRetryDueMode,
    retryDueInput, setRetryDueInput,
    retryModalBusy, setRetryModalBusy,
    retryModalError, setRetryModalError,
    retryModalSuccess, setRetryModalSuccess,
  } = retryModalState

  // Show skeleton while initial data is loading (after all hooks have been called)
  const isInitialLoading = defsQ.isLoading || (!!currentKey && defIdQ.isLoading)

  // Check for engine access errors (403/503)
  const engineAccessError = isEngineAccessError(defsQ.error)
  if (engineAccessError) {
    return <EngineAccessError status={engineAccessError.status} message={engineAccessError.message} />
  }

  return (
    <PageLoader isLoading={isInitialLoading} skeletonType="processes">
      <div style={{
      height: 'calc(100vh - var(--header-height))',
      overflow: 'hidden',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Breadcrumb Bar - shared component */}
      <BreadcrumbBar>
        <BreadcrumbItem>
          <a href={toTenantPath('/mission-control')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control'); }}>
            Mission Control
          </a>
        </BreadcrumbItem>
        {fromInstanceId && (
          <BreadcrumbItem>
            <a
              href={toTenantPath(`/mission-control/processes/instances/${encodeURIComponent(sanitizePathParam(fromInstanceId))}`)}
              onClick={(e) => {
                e.preventDefault()
                tenantNavigate(`/mission-control/processes/instances/${encodeURIComponent(sanitizePathParam(fromInstanceId))}`)
              }}
            >
              Instance {sanitizePathParam(fromInstanceId).substring(0, 8)}...
            </a>
          </BreadcrumbItem>
        )}
        <BreadcrumbItem isCurrentPage={!selectedProcess}>
          {selectedProcess ? (
            <a href={toTenantPath('/mission-control/processes')} onClick={(e) => { e.preventDefault(); setSelectedProcess(null); }}>
              Processes
            </a>
          ) : (
            'Processes'
          )}
        </BreadcrumbItem>
        {selectedProcess && (
          <BreadcrumbItem isCurrentPage>
            {`${selectedProcess.label || selectedProcess.key}${selectedVersion ? ` (v${selectedVersion})` : ''}`}
          </BreadcrumbItem>
        )}
      </BreadcrumbBar>

      {/* SplitPane wrapper - needed because react-split-pane uses absolute positioning */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* @ts-ignore - react-split-pane types not compatible with React 19 */}
        <SplitPane
          split="horizontal"
          size={splitSize}
          onChange={handleSplitChange}
          minSize={200}
          maxSize={-200}
          style={{ 
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
          pane1Style={{ overflow: 'hidden' }}
          pane2Style={{ overflow: 'auto' }}
        >
        <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', position: 'relative', overflow: 'hidden', height: '100%', width: '100%' }}>
          {!currentKey && (
            <div style={{ color: 'var(--color-text-tertiary)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-base)' }}>To view a Diagram, select a Process in the Filters panel</div>
          )}
          {currentKey && selectedVersion === null && (
            <div style={{ color: 'var(--color-text-tertiary)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-base)' }}>To see a Diagram, select a single Version</div>
          )}
          {currentKey && selectedVersion !== null && xmlQ.data && (
            <React.Suspense fallback={<div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', background: 'var(--color-bg-primary)', zIndex: 10 }}>Loading diagram...</div>}>
              <Viewer 
                key={`${defIdForVersion || currentKey}-${selectedVersion || 'all'}`}
                xml={xmlQ.data as string} 
                onReady={setViewerApi}
                onDiagramReset={handleDiagramReset}
                onElementClick={handleElementClick}
                onCanvasClick={handleCanvasClick}
                selectedElementId={flowNode || null}
              />
            </React.Suspense>
          )}
          {currentKey && (
            <>
              {defIdQ.isLoading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', background: 'var(--color-bg-primary)', zIndex: 10 }}>
                  Loading diagram...
                </div>
              )}
              {defIdQ.error && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-error)', background: 'var(--color-bg-primary)', zIndex: 10 }}>
                  <div>Error resolving definition</div>
                  <div style={{ fontSize: 'var(--text-12)', marginTop: 'var(--spacing-1)' }}>{String(defIdQ.error)}</div>
                </div>
              )}
              {xmlQ.isLoading && !defIdQ.isLoading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', background: 'var(--color-bg-primary)', zIndex: 10 }}>
                  Loading BPMN XML...
                </div>
              )}
              {xmlQ.error && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--color-error)', background: 'var(--color-bg-primary)', zIndex: 10 }}>
                  <div>Error loading XML</div>
                  <div style={{ fontSize: 'var(--text-12)', marginTop: 'var(--spacing-1)' }}>{String(xmlQ.error)}</div>
                </div>
              )}
              {defIdForVersion && xmlQ.status === 'success' && !xmlQ.data ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)', background: 'var(--color-bg-primary)', zIndex: 10 }}>
                  No diagram XML for the selected version
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* DataTable area */}
        <div style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--cds-layer-01)' }}>
          {/* Action bar - Carbon DataTable toolbar style */}
          <div style={{ 
            background: hasSelection ? 'var(--cds-background-brand)' : 'var(--cds-layer-01)', 
            color: hasSelection ? 'var(--cds-text-on-color)' : 'var(--cds-text-primary)', 
            padding: '0 16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px',
            height: '2rem',
            minHeight: '2rem',
            borderBottom: hasSelection ? 'none' : '1px solid var(--cds-border-subtle-01)',
            zIndex: 1,
            fontSize: 'var(--cds-body-compact-01-font-size, 0.875rem)',
            transition: 'background-color 110ms, color 110ms',
          }}>
            <div style={{ fontSize: 'var(--cds-body-compact-01-font-size, 0.875rem)', fontWeight: 400, whiteSpace: 'nowrap' }}>
              {hasSelection 
                ? `${selectedCount} of ${instQ.data?.length || 0} Process Instances selected`
                : `${instQ.data?.length || 0} Process Instances`
              }
            </div>
            
            {/* Spacer to push search and actions to the right */}
            <div style={{ flex: 1 }} />
            
            {/* Action buttons - slide out from search bar's left */}
            <div style={{ 
              display: 'flex', 
              flexDirection: 'row-reverse',
              gap: 0, 
              alignItems: 'center',
              overflow: 'hidden',
              maxWidth: hasSelection ? '600px' : '0px',
              opacity: hasSelection ? 1 : 0,
              transition: 'max-width 0.36s ease, opacity 0.24s ease',
            }}>
              <button
                style={getActionBtnStyle(canDelete)}
                disabled={!canDelete}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.background = 'transparent'
                }}
                onClick={() => {
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkDeleteModal.openModal()
                }}
                aria-label="Cancel (Batch)"
                title="Cancel (Batch)"
              >
                <TrashCan size={16} />
                Cancel
              </button>
              <button
                style={getActionBtnStyle(canSuspend)}
                disabled={!canSuspend}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.background = 'transparent'
                }}
                onClick={() => {
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkSuspendModal.openModal()
                }}
                aria-label="Suspend (Batch)"
                title="Suspend (Batch)"
              >
                <Pause size={16} />
                Suspend
              </button>
              <button
                style={getActionBtnStyle(canMigrate)}
                disabled={!canMigrate}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.background = 'transparent'
                }}
                onClick={() => {
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  const selKeys = ids.map(id => (instQ.data || []).find(i => i.id === id)?.processDefinitionKey || currentKey).filter(Boolean)
                  const unique = Array.from(new Set(selKeys))
                  if (unique.length > 1) {
                    showAlert('Mixed selection of different process definitions. Please select instances of the same process to migrate.', 'warning')
                    return
                  }
                  const selVers = ids.map(id => (instQ.data || []).find(i => i.id === id) as any).map(i => i?.version).filter((v: any) => v !== undefined && v !== null)
                  const uniqueVers = Array.from(new Set(selVers)) as any[]
                  if (uniqueVers.length > 1) {
                    showAlert('Mixed selection of different source versions. Please select instances from the same version to migrate together.', 'warning')
                    return
                  }
                  const selectedVersion = uniqueVers[0]
                  tenantNavigate('/mission-control/migration/new', { state: { instanceIds: ids, selectedKey: unique[0] || currentKey, selectedVersion } })
                }}
                aria-label="Migrate"
                title="Migrate"
              >
                <Migrate size={16} />
                Migrate
              </button>
              <button
                style={getActionBtnStyle(canActivate)}
                disabled={!canActivate}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.background = 'transparent'
                }}
                onClick={() => {
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkActivateModal.openModal()
                }}
                aria-label="Activate (Batch)"
                title="Activate (Batch)"
              >
                <Play size={16} />
                Activate
              </button>
              <button
                style={getActionBtnStyle(canRetry)}
                disabled={!canRetry}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.background = 'transparent'
                }}
                onClick={() => {
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkRetryModal.openModal()
                }}
                aria-label="Retry failed jobs (Batch)"
                title="Retry failed jobs (Batch)"
              >
                <Renew size={16} />
                Retry
              </button>
              <button
                style={getActionBtnStyle(hasSelection)}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.background = 'transparent'
                }}
                onClick={() => setSelectedMap({})}
                aria-label="Discard selection"
                title="Discard selection"
              >
                Discard
              </button>
            </div>
            
            {/* Search input */}
            {/* Search moved to sidebar */}
          </div>

          {/* Data Table (scrollable) */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <ProcessesDataTable
              data={instQ.data || []}
              onTerminate={(id) => terminateModal.openModal(id)}
              onRetry={(id) => setRetryModalInstanceId(id)}
              onActivate={(id) => callAction('PUT', `/mission-control-api/process-instances/${id}/activate${selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''}`).then(() => instQ.refetch())}
              onSuspend={(id) => callAction('PUT', `/mission-control-api/process-instances/${id}/suspend${selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''}`).then(() => instQ.refetch())}
              selectedMap={selectedMap}
              setSelectedMap={setSelectedMap}
              retryingMap={retryingMap}
              hoveredRowId={hoveredRowId}
              setHoveredRowId={setHoveredRowId}
              processNameMap={processNameMap}
              searchValue={searchValue}
            />
          </div>
        </div>
      </SplitPane>
      </div>

      {/* Modals */}
      <InstanceDetailsModal
        open={detailsModal.isOpen}
        instanceId={detailsModal.data || null}
        onClose={detailsModal.closeModal}
        histQLoading={histQ.isLoading}
        histQData={histQ.data}
        varsQLoading={varsQ.isLoading}
        varsQData={varsQ.data}
      />

      <RetryModal
        open={!!retryModalInstanceId}
        instanceId={retryModalInstanceId}
        onClose={() => setRetryModalInstanceId(null)}
        allRetryItems={allRetryItems}
        retryJobsQLoading={retryJobsQ.isLoading}
        retryExtTasksQLoading={retryExtTasksQ.isLoading}
        retryJobsQError={retryJobsQ.error}
        retryExtTasksQError={retryExtTasksQ.error}
        retrySelectionMap={retrySelectionMap}
        setRetrySelectionMap={setRetrySelectionMap}
        retryDueMode={retryDueMode}
        setRetryDueMode={setRetryDueMode}
        retryDueInput={retryDueInput}
        setRetryDueInput={setRetryDueInput}
        retryModalBusy={retryModalBusy}
        setRetryModalBusy={setRetryModalBusy}
        retryModalError={retryModalError}
        setRetryModalError={setRetryModalError}
        retryModalSuccess={retryModalSuccess}
        setRetryModalSuccess={setRetryModalSuccess}
        retryJobsQRefetch={() => retryJobsQ.refetch()}
        retryExtTasksQRefetch={() => retryExtTasksQ.refetch()}
        instQRefetch={() => instQ.refetch()}
        engineId={selectedEngineId}
      />

      <BulkOperationModals
        bulkRetryOpen={bulkRetryModal.isOpen}
        bulkRetryBusy={bulkOps.bulkRetryBusy}
        onBulkRetryClose={bulkRetryModal.closeModal}
        onBulkRetryConfirm={bulkOps.bulkRetry}
        selectedCount={selectedCount}
        bulkDeleteOpen={bulkDeleteModal.isOpen}
        bulkDeleteBusy={bulkOps.bulkDeleteBusy}
        onBulkDeleteClose={bulkDeleteModal.closeModal}
        onBulkDeleteConfirm={bulkOps.bulkDelete}
        bulkSuspendOpen={bulkSuspendModal.isOpen}
        bulkSuspendBusy={bulkOps.bulkSuspendBusy}
        onBulkSuspendClose={bulkSuspendModal.closeModal}
        onBulkSuspendConfirm={bulkOps.bulkSuspend}
        bulkActivateOpen={bulkActivateModal.isOpen}
        bulkActivateBusy={bulkOps.bulkActivateBusy}
        onBulkActivateClose={bulkActivateModal.closeModal}
        onBulkActivateConfirm={bulkOps.bulkActivate}
        terminateOpen={terminateModal.isOpen}
        onTerminateClose={terminateModal.closeModal}
        onTerminateConfirm={async () => {
          if (!terminateModal.data) return
          try {
            await bulkOps.callAction(
              'DELETE',
              `/mission-control-api/process-instances/${terminateModal.data}?deleteReason=${encodeURIComponent('Canceled via Mission Control')}&skipCustomListeners=true&skipIoMappings=true${selectedEngineId ? `&engineId=${encodeURIComponent(selectedEngineId)}` : ''}`
            )
            await instQ.refetch()
            terminateModal.closeModal()
          } catch (e) {
            console.error('Failed to terminate instance:', e)
            showAlert('Failed to terminate instance', 'error')
          }
        }}
      />

      <AlertModal
        open={alertState.open}
        onClose={closeAlert}
        kind={alertState.kind}
        title={alertState.title}
        message={alertState.message}
      />
    </div>
    </PageLoader>
  )
}
