import React from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { useQuery } from '@tanstack/react-query'
import styles from './styles/InstanceDetail.module.css'
import { Modal, Select, BreadcrumbItem, SelectItem, TextInput, TextArea, InlineNotification } from '@carbon/react'
import { BreadcrumbBar } from '../../shared/components/BreadcrumbBar'
import type { ElementLinkInfo } from '../../shared/components/viewer/viewerTypes'
import SplitPane from 'react-split-pane'
import { useAlert } from '../../../shared/hooks/useAlert'
import { PageLoader } from '../../../shared/components/PageLoader'
import { useInstanceData } from './components/hooks/useInstanceData'
import { useSelectedEngine } from '../../../components/EngineSelector'
import { useDiagramOverlays } from './components/hooks/useDiagramOverlays'
import { useVariableEditor } from './components/hooks/useVariableEditor'
import { useInstanceRetry } from './components/hooks/useInstanceRetry'
import { useInstanceModification } from './components/hooks/useInstanceModification'
import { useModificationOverlays } from './components/hooks/useModificationOverlays'
import { useModificationPopover } from './components/hooks/useModificationPopover'
import { useNodeMetadata } from './components/hooks/useNodeMetadata'
import { useSplitPaneState } from '../shared/hooks/useSplitPaneState'
import { useBpmnElementSelection } from './components/hooks/useBpmnElementSelection'
import { useElementLinkPillOverlay } from './components/hooks/useElementLinkPillOverlay'
import { useProcessesFilterStore } from '../shared/stores/processesFilterStore'
import { getUiErrorMessage } from '../../../shared/api/apiErrorUtils'
import { apiClient } from '../../../shared/api/client'
import {
  SPLIT_PANE_STORAGE_KEY,
  SPLIT_PANE_VERTICAL_STORAGE_KEY,
  DEFAULT_SPLIT_SIZE,
  DEFAULT_VERTICAL_SPLIT_SIZE,
} from './components/utils'
import type { DecisionIo, HistoricDecisionInstanceLite } from './components/types'
import { ProcessInstanceDiagramPane } from './components/ProcessInstanceDiagramPane'
import { ProcessInstanceBottomPane } from './components/ProcessInstanceBottomPane'
import { ProcessInstanceModals } from './components/ProcessInstanceModals'
import { EngineAccessError, isEngineAccessError } from '../shared/components/EngineAccessError'
import { ApplyModificationsModal } from './components/modals/ApplyModificationsModal'

export default function ProcessInstanceDetailPage() {
  const { instanceId } = useParams<{ instanceId: string }>()
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation()
  const { alertState, showAlert, closeAlert } = useAlert()
  const selectedEngineId = useSelectedEngine()


  // Get filter state from Zustand store (persisted)
  const { selectedProcess, selectedVersion } = useProcessesFilterStore()
  
  // Build process label with version for breadcrumb
  const processLabel = selectedProcess 
    ? `${selectedProcess.label}${selectedVersion !== null ? ` (v${selectedVersion})` : ''}`
    : null
  
  // Early return if no instanceId
  if (!instanceId) {
    return (
      <div className={styles.notFoundContainer}>
        <h3>Instance not found</h3>
        <p>No instance ID provided</p>
      </div>
    )
  }
  
  // Split pane state with localStorage persistence
  const { size: splitSize, handleChange: handleSplitChange } = useSplitPaneState({
    storageKey: SPLIT_PANE_STORAGE_KEY,
    defaultSize: DEFAULT_SPLIT_SIZE,
  })

  const { size: verticalSplitSize, handleChange: handleVerticalSplitChange } = useSplitPaneState({
    storageKey: SPLIT_PANE_VERTICAL_STORAGE_KEY,
    defaultSize: DEFAULT_VERTICAL_SPLIT_SIZE,
  })

  // ========== HOOK INTEGRATIONS ==========
  
  // 1. Data Fetching Hook
  const instanceData = useInstanceData(instanceId!)
  const {
    histQ,
    runtimeQ,
    defsQ,
    xmlQ,
    varsQ,
    histVarsQ,
    actQ,
    incidentsQ,
    retryJobsQ,
    retryExtTasksQ,
    defKey,
    defName,
    sortedActs,
    allRetryItems,
    jobById,
    incidentActivityIds,
    activityIdToInstances,
    clickableActivityIds,
    lookupVarType,
    parentId,
    status,
  } = instanceData

  const showModifyAction = status === 'ACTIVE'

  // Compute set of activity IDs with currently active (running) instances
  const activeActivityIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const a of actQ.data || []) {
      if (a.activityId && !a.endTime && !(a as any).canceled) {
        ids.add(a.activityId)
      }
    }
    return ids
  }, [actQ.data])

  // Build a lookup from activityId → activityName using activity history data
  const activityNameMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const a of actQ.data || []) {
      if (a.activityId && a.activityName && !map.has(a.activityId)) {
        map.set(a.activityId, a.activityName)
      }
    }
    return map
  }, [actQ.data])

  // 2. Diagram Overlays Hook
  // Check if process instance is suspended (from runtime data)
  const isSuspended = !!(runtimeQ.data as any)?.suspended
  const { viewerApi, setViewerApi, bpmnRef, applyOverlays } = useDiagramOverlays(actQ, incidentsQ, { isSuspended })

  // 3. Variable Editor Hook
  const variableEditor = useVariableEditor({ instanceId: instanceId!, varsQ, engineId: selectedEngineId })
  const {
    editingVarKey,
    editingVarType,
    editingVarValue,
    setEditingVarType,
    setEditingVarValue,
    editVarBusy,
    editVarError,
    setEditVarError,
    openVariableEditor,
    closeVariableEditor,
    submitVariableEdit,
  } = variableEditor

  // 4. Retry Logic Hook
  const retry = useInstanceRetry({
    instanceId: instanceId!,
    allRetryItems,
    retryJobsQ,
    retryExtTasksQ,
    incidentsQ,
    actQ,
    engineId: selectedEngineId,
  })
  const {
    retryModalOpen,
    setRetryModalOpen,
    retryActivityFilter,
    setRetryActivityFilter,
    retrySelectionMap,
    setRetrySelectionMap,
    retryDueMode,
    setRetryDueMode,
    retryDueInput,
    setRetryDueInput,
    retryBusy,
    filteredRetryItems,
    submitRetrySelection,
  } = retry

  // 4. Modification Mode Hook
  const modification = useInstanceModification({
    instanceId: instanceId!,
    status,
    actQ,
    incidentsQ,
    runtimeQ,
    engineId: selectedEngineId,
  })
  const {
    isModMode,
    modPlan,
    selectedActivityId,
    moveSourceActivityId,
    showModIntro,
    suppressIntroNext,
    discardConfirmOpen,
    applyBusy,
    queuedModActivityId,
    setIsModMode,
    setSelectedActivityId,
    setShowModIntro,
    setSuppressIntroNext,
    setDiscardConfirmOpen,
    setQueuedModActivityId,
    openModificationIntro,
    requestExitModificationMode,
    addPlanOperation,
    toggleMoveForSelection,
    removePlanItem,
    movePlanItem,
    updatePlanItemVariables,
    undoLastOperation,
    addMoveToHere,
    applyModifications,
    discardModifications,
  } = modification

  // 5. Modification Diagram Overlays Hook
  useModificationOverlays({
    bpmnRef,
    modPlan,
    isModMode,
    moveSourceActivityId,
  })

  // 5b. Modification Popover Hook (click-to-modify on diagram)
  const handleMoveToHere = React.useCallback((targetActivityId: string) => {
    const activeIds = [...activeActivityIds].filter(id => id !== targetActivityId)
    if (activeIds.length === 0) return
    addMoveToHere(targetActivityId, activeIds)
  }, [activeActivityIds, addMoveToHere])

  useModificationPopover({
    bpmnRef,
    isModMode,
    selectedActivityId,
    moveSourceActivityId,
    activeActivityIds,
    addPlanOperation,
    toggleMoveForSelection,
    onMoveToHere: handleMoveToHere,
  })

  // 6. Node Metadata Hook (I/O mappings and node info)
  const { ioMappings, selectedNodeMeta, formatMappingValue, formatMappingType } = useNodeMetadata({
    selectedActivityId,
    bpmnRef,
    xmlData: xmlQ.data,
    lookupVarType,
  })

  // 7. BPMN Element Selection Hook
  const { selectedActivityName } = useBpmnElementSelection({
    bpmnRef,
    clickableActivityIds,
    selectedActivityId,
    setSelectedActivityId,
    viewerApi,
    xmlData: xmlQ.data,
    actQData: actQ.data || [],
    isModMode,
    queuedModActivityId,
    setQueuedModActivityId,
  })

  // Local state (not from hooks)
  const [rightTab, setRightTab] = React.useState<'variables' | 'io'>('variables')
  const [incidentDetails, setIncidentDetails] = React.useState<any | null>(null)
  const [filterFlowNode, setFilterFlowNode] = React.useState('')
  const [filterIncidentType, setFilterIncidentType] = React.useState('')
  const [terminateConfirmOpen, setTerminateConfirmOpen] = React.useState(false)
  const [hoveredActivityId, setHoveredActivityId] = React.useState<string | null>(null)
  const [historyContext, setHistoryContext] = React.useState<any | null>(null)

  const [addVariableOpen, setAddVariableOpen] = React.useState(false)
  const [addVariableName, setAddVariableName] = React.useState('')
  const [addVariableType, setAddVariableType] = React.useState<string>('String')
  const [addVariableValue, setAddVariableValue] = React.useState('')
  const [addVariableBusy, setAddVariableBusy] = React.useState(false)
  const [addVariableError, setAddVariableError] = React.useState<string | null>(null)

  const [applyModalOpen, setApplyModalOpen] = React.useState(false)
  const [bulkUploadOpen, setBulkUploadOpen] = React.useState(false)
  const [bulkUploadValue, setBulkUploadValue] = React.useState('')
  const [bulkUploadBusy, setBulkUploadBusy] = React.useState(false)
  const [bulkUploadError, setBulkUploadError] = React.useState<string | null>(null)

  const parseTypedValue = React.useCallback((raw: string, type: string) => {
    if (type === 'String') return raw
    if (raw.trim() === '') return null
    if (type === 'Boolean') {
      if (/^(true|false)$/i.test(raw.trim())) return raw.trim().toLowerCase() === 'true'
      throw new Error('Boolean values must be true or false')
    }
    if (type === 'Integer' || type === 'Long') {
      const num = Number(raw)
      if (Number.isNaN(num)) throw new Error('Value must be a number')
      return type === 'Integer' ? Math.trunc(num) : num
    }
    if (type === 'Double') {
      const num = Number(raw)
      if (Number.isNaN(num)) throw new Error('Value must be a number')
      return num
    }
    if (type === 'Object' || type === 'Json') {
      return JSON.parse(raw || '{}')
    }
    return raw
  }, [])

  const openAddVariableModal = React.useCallback(() => {
    setAddVariableName('')
    setAddVariableType('String')
    setAddVariableValue('')
    setAddVariableError(null)
    setAddVariableOpen(true)
  }, [])

  const openBulkUploadModal = React.useCallback(() => {
    setBulkUploadValue('')
    setBulkUploadError(null)
    setBulkUploadOpen(true)
  }, [])

  const submitAddVariable = React.useCallback(async () => {
    if (!instanceId) return
    const key = addVariableName.trim()
    if (!key) {
      setAddVariableError('Variable name is required')
      return
    }
    setAddVariableBusy(true)
    setAddVariableError(null)
    try {
      const parsed = parseTypedValue(addVariableValue, addVariableType)
      const body = { modifications: { [key]: { value: parsed, type: addVariableType } }, engineId: selectedEngineId }
      await apiClient.post(`/mission-control-api/process-instances/${instanceId}/variables`, body, { credentials: 'include' })
      await varsQ.refetch()
      setAddVariableOpen(false)
    } catch (e: any) {
      setAddVariableError(getUiErrorMessage(e, 'Failed to add variable'))
    } finally {
      setAddVariableBusy(false)
    }
  }, [instanceId, addVariableName, addVariableType, addVariableValue, parseTypedValue, varsQ])

  const submitBulkUpload = React.useCallback(async () => {
    if (!instanceId) return
    setBulkUploadBusy(true)
    setBulkUploadError(null)
    try {
      const parsed = JSON.parse(bulkUploadValue || '{}')
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Bulk upload JSON must be an object')
      }

      const modifications: Record<string, { value: any; type: string }> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (!k) continue
        if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in (v as any) && 'type' in (v as any)) {
          modifications[k] = { value: (v as any).value, type: String((v as any).type) }
          continue
        }
        const jsType = typeof v
        if (v === null) {
          modifications[k] = { value: null, type: 'String' }
        } else if (jsType === 'boolean') {
          modifications[k] = { value: v, type: 'Boolean' }
        } else if (jsType === 'number') {
          modifications[k] = { value: v, type: 'Double' }
        } else if (jsType === 'object') {
          modifications[k] = { value: v, type: 'Json' }
        } else {
          modifications[k] = { value: String(v), type: 'String' }
        }
      }

      if (Object.keys(modifications).length === 0) {
        throw new Error('No variables found to upload')
      }

      const body = { modifications, engineId: selectedEngineId }
      await apiClient.post(`/mission-control-api/process-instances/${instanceId}/variables`, body, { credentials: 'include' })
      await varsQ.refetch()
      setBulkUploadOpen(false)
    } catch (e: any) {
      setBulkUploadError(getUiErrorMessage(e, 'Failed to upload variables'))
    } finally {
      setBulkUploadBusy(false)
    }
  }, [instanceId, bulkUploadValue, varsQ])

  // Incident filtering (keeping local for now - could be extracted later)
  const flowNodeOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const inc of incidentsQ.data || []) {
      if (inc?.activityId) set.add(inc.activityId)
    }
    return Array.from(set.values()).sort()
  }, [incidentsQ.data])

  const incidentTypeOptions = React.useMemo(() => {
    const set = new Set<string>()
    for (const inc of incidentsQ.data || []) {
      const key = inc?.incidentType || inc?.type
      if (key) set.add(key)
    }
    return Array.from(set.values()).sort()
  }, [incidentsQ.data])

  const filteredIncidents = React.useMemo(() => {
    return (incidentsQ.data || []).filter((inc: any) => {
      if (filterFlowNode && inc.activityId !== filterFlowNode) return false
      const type = inc.incidentType || inc.type || ''
      if (filterIncidentType && type !== filterIncidentType) return false
      return true
    })
  }, [incidentsQ.data, filterFlowNode, filterIncidentType])

  const selectedNodeVariables = React.useMemo(() => {
    if (!selectedActivityId) return null
    const ids = new Set(activityIdToInstances.get(selectedActivityId) || [])
    if (!ids.size) return []
    return (histVarsQ.data || []).filter((v: any) => v?.activityInstanceId && ids.has(v.activityInstanceId))
  }, [selectedActivityId, histVarsQ.data, activityIdToInstances])

  const withEngineId = (path: string) => {
    if (!selectedEngineId) return path
    const joiner = path.includes('?') ? '&' : '?'
    return `${path}${joiner}engineId=${encodeURIComponent(selectedEngineId)}`
  }

  const selectedDecisionInstanceQ = useQuery<HistoricDecisionInstanceLite | null>({
    queryKey: ['mission-control', 'selected-decision', instanceId, selectedActivityId, selectedNodeMeta?.decisionRef || ''],
    queryFn: async () => {
      if (!instanceId || (!selectedActivityId && !selectedNodeMeta?.decisionRef)) return null
      const params = new URLSearchParams()
      params.set('processInstanceId', instanceId)
      params.set('sortBy', 'evaluationTime')
      params.set('sortOrder', 'desc')
      params.set('maxResults', '50')
      const all = await apiClient.get<HistoricDecisionInstanceLite[]>(withEngineId(`/mission-control-api/history/decisions?${params.toString()}`), undefined, { credentials: 'include' })
      if (!all || all.length === 0) return null

      let candidates: HistoricDecisionInstanceLite[] = []

      if (selectedActivityId) {
        candidates = all.filter((d) => d.activityId === selectedActivityId)
      }

      if ((!candidates || candidates.length === 0) && selectedNodeMeta?.decisionRef) {
        candidates = all.filter((d) => d.decisionDefinitionKey === selectedNodeMeta.decisionRef)
      }

      if (!candidates || candidates.length === 0) return null
      return candidates[0]
    },
    enabled: !!instanceId && (!!selectedActivityId || !!selectedNodeMeta?.decisionRef),
  })

  const selectedDecisionInstance = selectedDecisionInstanceQ.data || null
  const shouldShowDecisionPanel = React.useMemo(() => !!selectedDecisionInstance, [selectedDecisionInstance])

  const decisionInputsQ = useQuery<DecisionIo[]>({
    queryKey: ['mission-control', 'selected-decision-inputs', selectedDecisionInstance?.id],
    queryFn: () => apiClient.get<DecisionIo[]>(withEngineId(`/mission-control-api/history/decisions/${selectedDecisionInstance?.id}/inputs`), undefined, { credentials: 'include' }),
    enabled: !!selectedDecisionInstance?.id,
  })

  const decisionOutputsQ = useQuery<DecisionIo[]>({
    queryKey: ['mission-control', 'selected-decision-outputs', selectedDecisionInstance?.id],
    queryFn: () => apiClient.get<DecisionIo[]>(withEngineId(`/mission-control-api/history/decisions/${selectedDecisionInstance?.id}/outputs`), undefined, { credentials: 'include' }),
    enabled: !!selectedDecisionInstance?.id,
  })

  // Hover highlight marker (Camunda-like): highlight BPMN element when hovering history list
  const lastHoverRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!bpmnRef.current) return
    const canvas = bpmnRef.current.get && bpmnRef.current.get('canvas')
    if (!canvas) return

    // Remove previous hover marker
    if (lastHoverRef.current) {
      try {
        canvas.removeMarker(lastHoverRef.current, 'highlight-hover')
      } catch {}
      lastHoverRef.current = null
    }

    // Add new hover marker
    if (hoveredActivityId) {
      try {
        canvas.addMarker(hoveredActivityId, 'highlight-hover')
        lastHoverRef.current = hoveredActivityId
      } catch {}
    }

    return () => {
      if (!lastHoverRef.current) return
      try {
        canvas.removeMarker(lastHoverRef.current, 'highlight-hover')
      } catch {}
      lastHoverRef.current = null
    }
  }, [hoveredActivityId, bpmnRef])

  // Re-apply overlays when activity/incident data changes or viewer becomes ready
  React.useEffect(() => {
    if (viewerApi && xmlQ.data) {
      applyOverlays()
    }
  }, [viewerApi, xmlQ.data, actQ.data, incidentsQ.data, isModMode, modPlan, applyOverlays])

  const execCounts = React.useMemo(() => {
    // Count activity executions only for the current instance
    const map = new Map<string, number>()
    for (const a of sortedActs || []) {
      const id = a.activityId || 'unknown'
      map.set(id, (map.get(id) || 0) + 1)
    }
    return map
  }, [sortedActs])


  function fmt(ts?: string|null) {
    if (!ts) return '--'
    const d = new Date(ts)
    if (isNaN(d.getTime())) return '--'
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    const seconds = String(d.getSeconds()).padStart(2, '0')
    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`
  }

  async function callAction(method: 'PUT'|'DELETE', path: string) {
    try {
      if (method === 'DELETE') {
        await apiClient.delete(path, { credentials: 'include' })
      } else {
        await apiClient.put(path, {}, { credentials: 'include' })
      }
    } catch (e: any) {
      const message = getUiErrorMessage(e, 'Action failed')
      console.error('Action failed:', message)
      showAlert(`Action failed: ${message}`, 'error')
      throw e
    }
  }

  React.useEffect(() => {
    if (!bpmnRef.current) return
    const eventBus = bpmnRef.current.get('eventBus')
    if (!eventBus) return
    const handler = (e: any) => {
      if (!isModMode) return
      const el = e?.element
      if (!el || !el.businessObject) return
      if (el.waypoints) return
      const id = el.businessObject.id || el.id
      if (!id) return
      setSelectedActivityId(id)
    }
    eventBus.on('element.click', handler)
    return () => {
      eventBus.off('element.click', handler)
    }
  }, [isModMode])

  const incidentCount = (incidentsQ.data || []).length
  const showIncidentBanner = incidentCount > 0

  // Handle navigation to linked resources
  const handleElementNavigate = React.useCallback((linkInfo: ElementLinkInfo) => {
    switch (linkInfo.linkType) {
      case 'process':
        {
        const acts = (actQ.data || []) as any[]
        const candidates = acts
          .filter((a: any) => a?.activityId === linkInfo.elementId && a?.calledProcessInstanceId)
          .sort((a: any, b: any) => {
            const ta = a?.startTime ? new Date(a.startTime).getTime() : 0
            const tb = b?.startTime ? new Date(b.startTime).getTime() : 0
            return tb - ta
          })

        const calledPid = candidates[0]?.calledProcessInstanceId as string | undefined

        // If Camunda provides the called subprocess instance id, navigate directly to it.
        if (calledPid) {
          const params = new URLSearchParams()
          params.set('fromInstance', instanceId)
          tenantNavigate(`/mission-control/processes/instances/${encodeURIComponent(calledPid)}?${params.toString()}`)
          break
        }

        // Fallback: Navigate to the current process overview page with node selection
        const params = new URLSearchParams()
        params.set('process', defKey)
        params.set('node', linkInfo.elementId)
        params.set('fromInstance', instanceId)
        tenantNavigate(`/mission-control/processes?${params.toString()}`)
        break
        }
        
      case 'decision':
        {
        // Navigate to the specific decision instance that was executed (similar to CallActivity)
        const decisionInstances = (selectedDecisionInstanceQ.data ? [selectedDecisionInstanceQ.data] : []) as any[]
        const decisionId = decisionInstances[0]?.id as string | undefined
        
        // If we have the executed decision instance id, navigate directly to it
        if (decisionId) {
          const params = new URLSearchParams()
          params.set('fromInstance', instanceId)
          if (processLabel) params.set('processLabel', processLabel)
          tenantNavigate(`/mission-control/decisions/instances/${encodeURIComponent(decisionId)}?${params.toString()}`)
          break
        }
        
        // Fallback: Navigate to the decisions page with decision key filter
        {
          const formKey = linkInfo.targetKey
          if (formKey.startsWith('embedded:app:')) {
            // Extract form path: embedded:app:forms/approve-invoice.html -> forms/approve-invoice.html
            const formPath = formKey.replace('embedded:app:', '')
            // Open in Starbase forms viewer (if exists) or show alert
            window.open(`/starbase/forms?form=${encodeURIComponent(formPath)}`, '_blank')
          } else if (formKey.startsWith('embedded:deployment:')) {
            // Deployment-based form
            const formPath = formKey.replace('embedded:deployment:', '')
            window.open(`/starbase/forms?form=${encodeURIComponent(formPath)}`, '_blank')
          } else {
            // External form URL - open directly
            window.open(formKey, '_blank')
          }
        }
        break
      }
      case 'externalTopic':
        // Navigate to external tasks filtered by topic
        // TODO: Add external tasks page with topic filter when available
        window.open(`/mission-control/batches?topic=${encodeURIComponent(linkInfo.targetKey)}`, '_blank')
        break
        
      case 'script':
        // For scripts, we could show a modal or navigate to a script viewer
        // For now, log to console and show alert (scripts are inline, not navigable)
        console.log('Script content:', linkInfo.metadata?.fullScript)
        showAlert(`Script (${linkInfo.metadata?.scriptFormat}): ${linkInfo.targetKey}`, 'info')
        break
    }
  }, [actQ.data, defKey, instanceId, processLabel, showAlert, selectedDecisionInstanceQ.data])

  // Show a bottom-center clickable link pill on navigable elements when selected
  useElementLinkPillOverlay({
    bpmnRef,
    selectedActivityId,
    onNavigate: handleElementNavigate,
    linkInfoOverride:
      selectedActivityId && (selectedDecisionInstanceQ.data || selectedNodeMeta?.decisionRef)
        ? {
            elementId: selectedActivityId,
            elementType: 'BusinessRuleTask',
            linkType: 'decision',
            targetKey:
              (selectedDecisionInstanceQ.data as any)?.decisionDefinitionKey ||
              selectedNodeMeta?.decisionRef ||
              '',
          }
        : null,
  })

  // Check if initial data is loading
  const isInitialLoading = histQ.isLoading || xmlQ.isLoading

  // Check for engine access errors (403/503)
  const engineAccessError = isEngineAccessError(histQ.error)
  if (engineAccessError) {
    return <EngineAccessError status={engineAccessError.status} message={engineAccessError.message} />
  }

  return (
    <PageLoader isLoading={isInitialLoading} skeletonType="instance-detail">
    <div className={styles.container}>
      
      {/* Breadcrumb Bar - shared component */}
      <BreadcrumbBar>
        <BreadcrumbItem>
          <a href={toTenantPath('/mission-control')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control'); }}>
            Mission Control
          </a>
        </BreadcrumbItem>
        <BreadcrumbItem>
          <a href={toTenantPath('/mission-control/processes')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control/processes'); }}>
            Processes
          </a>
        </BreadcrumbItem>
        {processLabel && (
          <BreadcrumbItem>
            <a href={toTenantPath('/mission-control/processes')} onClick={(e) => { e.preventDefault(); tenantNavigate('/mission-control/processes'); }}>
              {processLabel}
            </a>
          </BreadcrumbItem>
        )}
        {(() => {
          const fromInstance = new URLSearchParams(location.search).get('fromInstance')
          if (!fromInstance) return null
          return (
            <BreadcrumbItem>
              <a
                href={toTenantPath(`/mission-control/processes/instances/${fromInstance}`)}
                onClick={(e) => {
                  e.preventDefault()
                  tenantNavigate(`/mission-control/processes/instances/${fromInstance}`)
                }}
              >
                Instance {fromInstance.substring(0, 8)}...
              </a>
            </BreadcrumbItem>
          )
        })()}
        <BreadcrumbItem isCurrentPage>
          {instanceId}
        </BreadcrumbItem>
      </BreadcrumbBar>

      {/* SplitPane wrapper - needed because react-split-pane uses absolute positioning */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {/* @ts-expect-error - react-split-pane has type incompatibility with React 19 */}
        <SplitPane
          split="horizontal"
          size={splitSize}
          onChange={handleSplitChange}
          minSize={200}
          maxSize={-200}
          className={styles.splitPane}
          pane1Style={{ overflow: 'hidden' }}
          pane2Style={{ overflow: 'auto' }}
        >
        <ProcessInstanceDiagramPane
          instanceId={instanceId}
          xml={xmlQ.data as string}
          onReady={setViewerApi}
          onDiagramReset={applyOverlays}
          onElementNavigate={handleElementNavigate}
        />

        <ProcessInstanceBottomPane
          historyContext={historyContext}
          defName={defName}
          instanceId={instanceId}
          defs={defsQ.data || []}
          defKey={defKey}
          histData={histQ.data as any}
          parentId={parentId}
          status={status}
          showModifyAction={showModifyAction}
          fmt={fmt}
          onNavigate={tenantNavigate}
          onCopy={(value) => navigator.clipboard.writeText(value)}
          onSuspend={() => callAction('PUT', `/mission-control-api/process-instances/${instanceId}/suspend${selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''}`).then(() => runtimeQ.refetch())}
          onResume={() => callAction('PUT', `/mission-control-api/process-instances/${instanceId}/activate${selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''}`).then(() => runtimeQ.refetch())}
          onModify={() => openModificationIntro()}
          onTerminate={() => setTerminateConfirmOpen(true)}
          showIncidentBanner={showIncidentBanner}
          incidentCount={incidentCount}
          onRetry={() => setRetryModalOpen(true)}
          onViewIncident={() => {
            const first = (incidentsQ.data || [])[0] || null
            if (first) setIncidentDetails(first)
          }}
          isModMode={isModMode}
          moveSourceActivityId={moveSourceActivityId}
          selectedActivityId={selectedActivityId}
          onExitModificationMode={requestExitModificationMode}
          onUndoLastOperation={undoLastOperation}
          modPlanLength={modPlan.length}
          verticalSplitSize={verticalSplitSize}
          onVerticalSplitChange={handleVerticalSplitChange}
          activityPanelProps={{
            actQ,
            sortedActs,
            processName: defName,
            incidentActivityIds,
            execCounts,
            clickableActivityIds,
            bpmnRef,
            selectedActivityId,
            setSelectedActivityId,
            selectedActivityName,
            fmt,
            isModMode,
            moveSourceActivityId,
            onActivityHover: (id) => setHoveredActivityId(id),
            onHistoryContextChange: (ctx) => setHistoryContext(ctx),
            rightTab,
            setRightTab,
            varsQ,
            selectedNodeVariables,
            shouldShowDecisionPanel,
            status,
            openVariableEditor,
            showAlert,
            onAddVariable: openAddVariableModal,
            onBulkUploadVariables: openBulkUploadModal,
            selectedDecisionInstance,
            decisionInputs: decisionInputsQ.data || [],
            decisionOutputs: decisionOutputsQ.data || [],
            selectedNodeInputMappings: ioMappings.inputs,
            selectedNodeOutputMappings: ioMappings.outputs,
            formatMappingType,
            formatMappingValue,
            modPlan,
            activeActivityIds,
            resolveActivityName: (id: string) => {
              // Try activity history data first, then BPMN element registry
              const fromHistory = activityNameMap.get(id)
              if (fromHistory) return fromHistory
              try {
                const reg = bpmnRef.current?.get?.('elementRegistry')
                const el = reg?.get?.(id)
                const name = el?.businessObject?.name
                if (name) return name
              } catch {}
              return id
            },
            addPlanOperation,
            removePlanItem,
            movePlanItem,
            updatePlanItemVariables,
            undoLastOperation,
            toggleMoveForSelection,
            onMoveToHere: handleMoveToHere,
            applyModifications: () => setApplyModalOpen(true),
            setDiscardConfirmOpen,
            applyBusy,
            onExitModificationMode: requestExitModificationMode,
          }}
        />
      </SplitPane>
      </div>

      <ProcessInstanceModals
        incidentDetails={incidentDetails}
        jobById={jobById}
        onCloseIncident={() => setIncidentDetails(null)}
        editingVarKey={editingVarKey}
        editingVarType={editingVarType}
        editingVarValue={editingVarValue}
        editVarBusy={editVarBusy}
        editVarError={editVarError}
        setEditingVarType={setEditingVarType}
        setEditingVarValue={setEditingVarValue}
        setEditVarError={setEditVarError}
        closeVariableEditor={closeVariableEditor}
        submitVariableEdit={submitVariableEdit}
        addVariableOpen={addVariableOpen}
        addVariableName={addVariableName}
        addVariableType={addVariableType}
        addVariableValue={addVariableValue}
        addVariableBusy={addVariableBusy}
        addVariableError={addVariableError}
        setAddVariableName={setAddVariableName}
        setAddVariableType={setAddVariableType}
        setAddVariableValue={setAddVariableValue}
        setAddVariableError={setAddVariableError}
        setAddVariableOpen={setAddVariableOpen}
        submitAddVariable={submitAddVariable}
        bulkUploadOpen={bulkUploadOpen}
        bulkUploadValue={bulkUploadValue}
        bulkUploadBusy={bulkUploadBusy}
        bulkUploadError={bulkUploadError}
        setBulkUploadValue={setBulkUploadValue}
        setBulkUploadError={setBulkUploadError}
        setBulkUploadOpen={setBulkUploadOpen}
        submitBulkUpload={submitBulkUpload}
        showModIntro={showModIntro}
        suppressIntroNext={suppressIntroNext}
        setSuppressIntroNext={setSuppressIntroNext}
        setShowModIntro={setShowModIntro}
        setIsModMode={setIsModMode}
        discardConfirmOpen={discardConfirmOpen}
        setDiscardConfirmOpen={setDiscardConfirmOpen}
        discardModifications={discardModifications}
        terminateConfirmOpen={terminateConfirmOpen}
        instanceId={instanceId}
        setTerminateConfirmOpen={setTerminateConfirmOpen}
        onTerminate={async (id) => {
          await callAction(
            'DELETE',
            `/mission-control-api/process-instances/${id}?deleteReason=${encodeURIComponent('Canceled via Mission Control')}&skipCustomListeners=true&skipIoMappings=true${selectedEngineId ? `&engineId=${encodeURIComponent(selectedEngineId)}` : ''}`
          )
        }}
        retryModalOpen={retryModalOpen}
        retryBusy={retryBusy}
        retryActivityFilter={retryActivityFilter}
        filteredRetryItems={filteredRetryItems}
        retrySelectionMap={retrySelectionMap}
        retryDueMode={retryDueMode}
        retryDueInput={retryDueInput}
        setRetryModalOpen={setRetryModalOpen}
        setRetrySelectionMap={setRetrySelectionMap}
        setRetryDueMode={setRetryDueMode}
        setRetryDueInput={setRetryDueInput}
        setRetryActivityFilter={setRetryActivityFilter}
        submitRetrySelection={submitRetrySelection}
        alertState={alertState}
        closeAlert={closeAlert}
      />

      <ApplyModificationsModal
        open={applyModalOpen}
        modPlan={modPlan}
        resolveActivityName={(id: string) => {
          const fromHistory = activityNameMap.get(id)
          if (fromHistory) return fromHistory
          try {
            const reg = bpmnRef.current?.get?.('elementRegistry')
            const el = reg?.get?.(id)
            const name = el?.businessObject?.name
            if (name) return name
          } catch {}
          return id
        }}
        onClose={() => setApplyModalOpen(false)}
        onApply={async (options) => {
          try {
            await applyModifications(options)
            setApplyModalOpen(false)
          } catch {
            // Error already shown via showAlert - keep modal open
          }
        }}
        onRemoveItem={removePlanItem}
        applyBusy={applyBusy}
      />
    </div>
    </PageLoader>
  )
}