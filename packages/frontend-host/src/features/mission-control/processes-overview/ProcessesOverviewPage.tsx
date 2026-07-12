import React from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'
import { sanitizePathParam } from '../../../shared/utils/sanitize'
import { Pause, Play, TrashCan, Renew, Migrate, Launch, Save } from '@carbon/icons-react'
import { BreadcrumbItem, Button, Dropdown, InlineNotification, Modal, TextArea, TextInput } from '@carbon/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BreadcrumbBar } from '../../shared/components/BreadcrumbBar'
import { TableSearchBar } from '../../../shared/components/ui/TableSearchBar'
import { SplitPane, Pane } from 'react-split-pane'
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
import { createSavedProcessFilter, deleteSavedProcessFilter, listSavedProcessFilters } from './api/processDefinitions'
import { EngineAccessError, isEngineAccessError } from '../shared/components/EngineAccessError'
import { apiClient } from '../../../shared/api/client'
import { evaluateMissionControlStarbaseBridge } from '../../../shared/api/bridgeAuthz'
import { useSelectedEngine } from '../../../components/EngineSelector'
import { useEngineSelectorStore } from '../../../stores/engineSelectorStore'
import { LoadingState } from '../../shared/components/LoadingState'
import { evaluateActionSnapshot, summarizeBulkActionUnavailableReasons, WhyUnavailableLink } from '../../../shared/auth/guards'
import type { UiAuthzDecision } from '@enterpriseglue/shared/authz/permission-actions.js'
import { AuthContext } from '../../../contexts/AuthContext'
import { getUiErrorMessage } from '../../../shared/api/apiErrorUtils'

const SPLIT_PANE_STORAGE_KEY = 'processes-split-pane-size-v2'
const DEFAULT_SPLIT_SIZE = '75%'
const Viewer = React.lazy(() => import('../../shared/components/Viewer'))

type ProcessEditTarget = {
  canShowEditButton: boolean
  canEdit: boolean
  engineId: string
  processKey: string
  processVersion: number
  projectId: string
  fileId: string
  engineDeploymentId?: string
  commitId?: string | null
  fileVersionNumber?: number | null
  mappingSource?: string
}

function deniedReason(decision: UiAuthzDecision): string | null {
  if (decision.allowed) return null
  return decision.reason || 'Action unavailable'
}

type BulkProcessAction = 'retry' | 'activate' | 'suspend' | 'delete' | 'migrate'

type BulkProcessInstance = {
  id?: string
  state?: string | null
  hasIncident?: boolean
  processDefinitionKey?: string | null
  version?: number | string | null
}

type BulkProcessEligibility = {
  allowed: boolean
  deniedCount: number
  firstDeniedDecision: UiAuthzDecision | null
  firstDeniedReason: string | null
  summary: string | null
}

type SavedProcessFilter = Awaited<ReturnType<typeof listSavedProcessFilters>>[number]

const SAVED_FILTER_STATE_LABELS: Record<string, string> = {
  active: 'Active',
  incidents: 'Incidents',
  completed: 'Completed',
  canceled: 'Canceled',
}

function normalizedInstanceState(instance: BulkProcessInstance): string {
  return String(instance?.state || '').toUpperCase()
}

function isRunningInstance(instance: BulkProcessInstance): boolean {
  const state = normalizedInstanceState(instance)
  return state === 'ACTIVE' || state === 'SUSPENDED'
}

function stateReason(instance: BulkProcessInstance): string {
  const state = normalizedInstanceState(instance)
  if (state === 'ACTIVE') return 'instance is already active'
  if (state === 'SUSPENDED') return 'instance is already suspended'
  if (state === 'COMPLETED') return 'instance is completed'
  if (state === 'CANCELED' || state === 'CANCELLED') return 'instance is canceled'
  return state ? `instance state is ${state.toLowerCase()}` : 'instance state is unknown'
}

function actionPastTense(action: BulkProcessAction): string {
  if (action === 'retry') return 'retried'
  if (action === 'activate') return 'activated'
  if (action === 'suspend') return 'suspended'
  if (action === 'delete') return 'canceled'
  return 'migrated'
}

export function getBulkProcessActionEligibility(
  action: BulkProcessAction,
  selectedInstances: BulkProcessInstance[],
  options: { currentKey?: string | null; diagnosticDecision?: UiAuthzDecision | null } = {}
): BulkProcessEligibility {
  if (selectedInstances.length === 0) {
    return { allowed: false, deniedCount: 0, firstDeniedDecision: null, firstDeniedReason: null, summary: null }
  }

  const baselineProcessKey = selectedInstances
    .map((instance) => instance.processDefinitionKey || options.currentKey || null)
    .find(Boolean) || null
  const baselineVersion = selectedInstances
    .map((instance) => instance.version)
    .find((version) => version !== undefined && version !== null)

  const summary = summarizeBulkActionUnavailableReasons(
    selectedInstances,
    (instance) => {
      if ((action === 'delete' || action === 'migrate' || action === 'retry') && !isRunningInstance(instance)) {
        return stateReason(instance)
      }
      if (action === 'activate' && normalizedInstanceState(instance) !== 'SUSPENDED') {
        return stateReason(instance)
      }
      if (action === 'suspend' && normalizedInstanceState(instance) !== 'ACTIVE') {
        return stateReason(instance)
      }
      if (action === 'retry' && !instance.hasIncident) {
        return 'instance has no incident'
      }
      if (action === 'migrate') {
        const processKey = instance.processDefinitionKey || options.currentKey || null
        if (baselineProcessKey && processKey && processKey !== baselineProcessKey) {
          return 'instance belongs to a different process definition'
        }
        if (
          baselineVersion !== undefined &&
          baselineVersion !== null &&
          instance.version !== undefined &&
          instance.version !== null &&
          instance.version !== baselineVersion
        ) {
          return 'instance has a different source version'
        }
      }
      return null
    },
    {
      actionPastTense: actionPastTense(action),
      getDiagnosticDecision: (_instance, reason) => options.diagnosticDecision
        ? {
            ...options.diagnosticDecision,
            allowed: false,
            diagnostics: options.diagnosticDecision.diagnostics ?? {
              explainUrl: '/admin/access-control?tab=effective-access',
              remediation: ['Ask a platform administrator to review effective access.'],
            },
            reason,
            state: 'disabled',
          }
        : null,
      itemLabelSingular: 'instance',
      itemLabelPlural: 'instances',
    }
  )

  return {
    allowed: summary.allowed,
    deniedCount: summary.deniedCount,
    firstDeniedDecision: summary.firstDeniedDecision,
    firstDeniedReason: summary.firstDeniedReason,
    summary: summary.reason,
  }
}

export default function ProcessesOverviewPage() {
  const { tenantNavigate, toTenantPath } = useTenantNavigate()
  const location = useLocation() as any
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { alertState, showAlert, closeAlert } = useAlert()
  const selectedEngineId = useSelectedEngine()
  const setSelectedEngineId = useEngineSelectorStore((s) => s.setSelectedEngineId)
  const { clearViewports } = useDiagramViewStore()
  const authContext = React.useContext(AuthContext)
  const selectedEngineResource = React.useMemo(
    () => ({ type: 'engine' as const, id: selectedEngineId ?? null }),
    [selectedEngineId]
  )
  const permissionSnapshot = authContext?.permissions ?? null
  const instanceSuspensionDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-instances.suspension.update', selectedEngineResource)
  const instanceRetryDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-instances.retry', selectedEngineResource)
  const instanceTerminateDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-instances.delete', selectedEngineResource)
  const instanceVariablesReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-instances.variables.read', selectedEngineResource)
  const instanceActivityHistoryReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-instances.activity-history.read', selectedEngineResource)
  const processDefinitionsReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-definitions.read', selectedEngineResource)
  const processInstancesReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-instances.read', selectedEngineResource)
  const bulkRetryDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.batches.jobs.retry', selectedEngineResource)
  const bulkDeleteDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.batches.process-instances.delete', selectedEngineResource)
  const bulkSuspendDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.batches.process-instances.suspend', selectedEngineResource)
  const bulkActivateDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.batches.process-instances.activate', selectedEngineResource)
  const migrationExecuteDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.migrations.execute-direct', selectedEngineResource)
  const processStartDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-definitions.start', selectedEngineResource)
  const processEditTargetReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.process-definitions.edit-target.read', selectedEngineResource)
  const jobsReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.jobs.read', selectedEngineResource)
  const externalTasksReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.runtime.external-tasks.read', selectedEngineResource)
  const savedFiltersReadDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.saved-filters.read', selectedEngineResource)
  const savedFiltersManageDecision = evaluateActionSnapshot(permissionSnapshot, 'engine.saved-filters.manage', selectedEngineResource)
  const notifyDeniedAction = React.useCallback((decision: UiAuthzDecision) => {
    if (decision.allowed) return false
    showAlert(decision.reason || 'Action unavailable', 'warning')
    return true
  }, [showAlert])

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
  const [startProcessOpen, setStartProcessOpen] = React.useState(false)
  const [startBusinessKey, setStartBusinessKey] = React.useState('')
  const [startVariablesJson, setStartVariablesJson] = React.useState('')
  const [startBusy, setStartBusy] = React.useState(false)
  const [startError, setStartError] = React.useState<string | null>(null)
  const [saveFilterOpen, setSaveFilterOpen] = React.useState(false)
  const [saveFilterName, setSaveFilterName] = React.useState('')
  const [saveFilterError, setSaveFilterError] = React.useState<string | null>(null)
  const [selectedSavedFilterId, setSelectedSavedFilterId] = React.useState<string | null>(null)
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
    processDefinitionsEnabled: processDefinitionsReadDecision.allowed,
    processInstancesEnabled: processInstancesReadDecision.allowed,
  })

  const modalData = useProcessesModalData({
    detailsModalInstanceId: detailsModal.data || null,
    detailsModalOpen: detailsModal.isOpen,
    retryModalInstanceId,
    engineId: selectedEngineId,
    variablesEnabled: instanceVariablesReadDecision.allowed,
    activityHistoryEnabled: instanceActivityHistoryReadDecision.allowed,
    jobsEnabled: jobsReadDecision.allowed,
    externalTasksEnabled: externalTasksReadDecision.allowed,
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

  const savedFiltersQ = useQuery({
    queryKey: ['mission-control', 'saved-filters', selectedEngineId],
    queryFn: listSavedProcessFilters,
    enabled: savedFiltersReadDecision.allowed && !!selectedEngineId,
    select: (filters) => filters
      .filter((filter) => filter.engineId === selectedEngineId)
      .sort((a, b) => a.name.localeCompare(b.name)),
    retry: false,
    staleTime: 15_000,
  })

  const savedFilters = savedFiltersQ.data || []
  const selectedSavedFilter = React.useMemo(
    () => savedFilters.find((filter) => filter.id === selectedSavedFilterId) || null,
    [savedFilters, selectedSavedFilterId]
  )

  const defaultSavedFilterName = React.useMemo(() => {
    const processLabel = selectedProcess?.label || selectedProcess?.key || 'All processes'
    const versionLabel = selectedVersion !== null ? ` v${selectedVersion}` : ''
    return `${processLabel}${versionLabel}`
  }, [selectedProcess?.key, selectedProcess?.label, selectedVersion])

  const saveFilterMutation = useMutation({
    mutationFn: createSavedProcessFilter,
    onSuccess: async (filter) => {
      setSelectedSavedFilterId(filter.id)
      setSaveFilterOpen(false)
      setSaveFilterName('')
      setSaveFilterError(null)
      await queryClient.invalidateQueries({ queryKey: ['mission-control', 'saved-filters', selectedEngineId] })
      showAlert('Saved filter created', 'info')
    },
    onError: (error) => {
      setSaveFilterError(getUiErrorMessage(error, 'Failed to save filter'))
    },
  })

  const deleteFilterMutation = useMutation({
    mutationFn: deleteSavedProcessFilter,
    onSuccess: async (_data, filterId) => {
      if (selectedSavedFilterId === filterId) {
        setSelectedSavedFilterId(null)
      }
      await queryClient.invalidateQueries({ queryKey: ['mission-control', 'saved-filters', selectedEngineId] })
      showAlert('Saved filter deleted', 'info')
    },
    onError: (error) => {
      showAlert(getUiErrorMessage(error, 'Failed to delete saved filter'), 'error')
    },
  })

  const handleApplySavedFilter = React.useCallback((filter: SavedProcessFilter | null) => {
    if (!filter) {
      setSelectedSavedFilterId(null)
      return
    }

    setSelectedSavedFilterId(filter.id)
    const processKey = filter.defKeys[0] || ''
    const matchingProcess = processKey
      ? defItems.find((item) => item.key === processKey)
      : null
    setSelectedProcess(matchingProcess || (processKey ? { id: processKey, key: processKey, label: processKey, version: 0 } as any : null))

    const parsedVersion = filter.version === null || filter.version === undefined || filter.version === ''
      ? null
      : Number(filter.version)
    setSelectedVersion(typeof parsedVersion === 'number' && Number.isFinite(parsedVersion) ? parsedVersion : null)
    setFlowNode('')
    clearViewports()
    setSelectedStates(
      Object.entries(SAVED_FILTER_STATE_LABELS)
        .filter(([state]) => Boolean((filter as any)[state]))
        .map(([id, label]) => ({ id, label }))
    )
  }, [clearViewports, defItems, setFlowNode, setSelectedProcess, setSelectedStates, setSelectedVersion])

  const openSaveFilterModal = React.useCallback(() => {
    if (notifyDeniedAction(savedFiltersManageDecision)) return
    if (!selectedEngineId) {
      showAlert('Select an engine before saving a filter', 'warning')
      return
    }
    setSaveFilterName(defaultSavedFilterName)
    setSaveFilterError(null)
    setSaveFilterOpen(true)
  }, [defaultSavedFilterName, notifyDeniedAction, savedFiltersManageDecision, selectedEngineId, showAlert])

  const handleSaveFilter = React.useCallback(async () => {
    if (notifyDeniedAction(savedFiltersManageDecision)) return
    const name = saveFilterName.trim()
    if (!name) {
      setSaveFilterError('Filter name is required')
      return
    }
    if (!selectedEngineId) {
      setSaveFilterError('Select an engine before saving a filter')
      return
    }

    setSaveFilterError(null)
    await saveFilterMutation.mutateAsync({
      name,
      engineId: selectedEngineId,
      defKeys: selectedProcess?.key ? [selectedProcess.key] : [],
      version: selectedVersion !== null ? String(selectedVersion) : null,
      active,
      incidents,
      completed,
      canceled,
    })
  }, [
    active,
    canceled,
    completed,
    incidents,
    notifyDeniedAction,
    saveFilterMutation,
    saveFilterName,
    savedFiltersManageDecision,
    selectedEngineId,
    selectedProcess?.key,
    selectedVersion,
  ])

  const handleDeleteSavedFilter = React.useCallback(() => {
    if (notifyDeniedAction(savedFiltersManageDecision)) return
    if (!selectedSavedFilter) return
    deleteFilterMutation.mutate(selectedSavedFilter.id)
  }, [deleteFilterMutation, notifyDeniedAction, savedFiltersManageDecision, selectedSavedFilter])

  React.useEffect(() => {
    const engineIdParam = String(searchParams.get('engineId') || '')
    if (!engineIdParam) return
    if (!selectedEngineId || selectedEngineId !== engineIdParam) {
      setSelectedEngineId(engineIdParam)
      return
    }

    searchParams.delete('engineId')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, selectedEngineId, setSelectedEngineId, setSearchParams])

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

  React.useEffect(() => {
    const rawVersion = searchParams.get('version')
    if (!rawVersion) return

    const parsedVersion = Number(rawVersion)
    if (!Number.isFinite(parsedVersion)) {
      searchParams.delete('version')
      setSearchParams(searchParams, { replace: true })
      return
    }

    if (versions.length === 0) return

    if (versions.includes(parsedVersion) && selectedVersion !== parsedVersion) {
      setSelectedVersion(parsedVersion)
    }

    searchParams.delete('version')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, versions, selectedVersion, setSelectedVersion, setSearchParams])

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

  const processEditTargetQ = useQuery({
    queryKey: ['mission-control', 'process-edit-target', selectedEngineId, selectedProcess?.key, selectedVersion, defIdForVersion],
    queryFn: () => apiClient.get<ProcessEditTarget>('/mission-control-api/process-definitions/edit-target', {
      engineId: selectedEngineId,
      key: selectedProcess?.key,
      version: selectedVersion,
      processDefinitionId: defIdForVersion,
    }),
    enabled: processEditTargetReadDecision.allowed && !!selectedEngineId && !!selectedProcess?.key && selectedVersion !== null,
    retry: false,
    staleTime: 15_000,
  })

  const processEditTarget = processEditTargetQ.data || null
  const showEditButton = Boolean(
    selectedProcess &&
    selectedVersion !== null &&
    processEditTargetReadDecision.allowed &&
    processEditTarget?.canShowEditButton &&
    processEditTarget?.fileId
  )

  const handleEditInStarbase = React.useCallback(async () => {
    if (notifyDeniedAction(processEditTargetReadDecision)) return
    if (!processEditTarget?.fileId || selectedVersion === null || !selectedProcess?.key) return
    try {
      const bridgeDecision = await evaluateMissionControlStarbaseBridge({
        engineId: String(selectedEngineId || processEditTarget.engineId || ''),
        projectId: processEditTarget.projectId,
        fileId: processEditTarget.fileId,
        definitionKey: selectedProcess.key,
        kind: 'process',
      })
      if (!bridgeDecision.allowed) {
        showAlert(bridgeDecision.reason || 'Starbase edit is unavailable for this deployment.', 'warning')
        return
      }
    } catch (error) {
      showAlert(getUiErrorMessage(error, 'Unable to evaluate Starbase edit access'), 'error')
      return
    }

    const params = new URLSearchParams({
      source: 'mission-control',
      engineId: String(selectedEngineId || processEditTarget.engineId || ''),
      process: selectedProcess.key,
      version: String(selectedVersion),
      deploymentId: String(processEditTarget.engineDeploymentId || ''),
      mappingSource: String(processEditTarget.mappingSource || ''),
    })

    if (processEditTarget.commitId) {
      params.set('commitId', String(processEditTarget.commitId))
    }
    if (typeof processEditTarget.fileVersionNumber === 'number') {
      params.set('fileVersion', String(processEditTarget.fileVersionNumber))
    }

    tenantNavigate(`/starbase/editor/${encodeURIComponent(sanitizePathParam(processEditTarget.fileId))}?${params.toString()}`)
  }, [notifyDeniedAction, processEditTarget, processEditTargetReadDecision, selectedVersion, selectedProcess?.key, selectedEngineId, showAlert, tenantNavigate])

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

  const retryPermissionReason = deniedReason(bulkRetryDecision)
  const activatePermissionReason = deniedReason(bulkActivateDecision)
  const suspendPermissionReason = deniedReason(bulkSuspendDecision)
  const deletePermissionReason = deniedReason(bulkDeleteDecision)
  const migratePermissionReason = deniedReason(migrationExecuteDecision)
  const startPermissionReason = deniedReason(processStartDecision)

  const retryEligibility = React.useMemo(
    () => getBulkProcessActionEligibility('retry', selectedInstances, { diagnosticDecision: bulkRetryDecision }),
    [bulkRetryDecision, selectedInstances]
  )
  const activateEligibility = React.useMemo(
    () => getBulkProcessActionEligibility('activate', selectedInstances, { diagnosticDecision: bulkActivateDecision }),
    [bulkActivateDecision, selectedInstances]
  )
  const suspendEligibility = React.useMemo(
    () => getBulkProcessActionEligibility('suspend', selectedInstances, { diagnosticDecision: bulkSuspendDecision }),
    [bulkSuspendDecision, selectedInstances]
  )
  const deleteEligibility = React.useMemo(
    () => getBulkProcessActionEligibility('delete', selectedInstances, { diagnosticDecision: bulkDeleteDecision }),
    [bulkDeleteDecision, selectedInstances]
  )
  const migrateEligibility = React.useMemo(
    () => getBulkProcessActionEligibility('migrate', selectedInstances, { currentKey, diagnosticDecision: migrationExecuteDecision }),
    [currentKey, migrationExecuteDecision, selectedInstances]
  )

  const canRetry = hasSelection && retryEligibility.allowed && !bulkOps.bulkRetryBusy && bulkRetryDecision.allowed
  const canActivate = hasSelection && activateEligibility.allowed && !bulkOps.bulkActivateBusy && bulkActivateDecision.allowed
  const canSuspend = hasSelection && suspendEligibility.allowed && !bulkOps.bulkSuspendBusy && bulkSuspendDecision.allowed
  const canDelete = hasSelection && deleteEligibility.allowed && !bulkOps.bulkDeleteBusy && bulkDeleteDecision.allowed
  const canMigrate = hasSelection && migrateEligibility.allowed && migrateSameProcess && migrateSameVersion && migrationExecuteDecision.allowed
  const retryTitle = retryPermissionReason || retryEligibility.summary || 'Retry failed jobs (Batch)'
  const activateTitle = activatePermissionReason || activateEligibility.summary || 'Activate (Batch)'
  const suspendTitle = suspendPermissionReason || suspendEligibility.summary || 'Suspend (Batch)'
  const deleteTitle = deletePermissionReason || deleteEligibility.summary || 'Cancel (Batch)'
  const migrateTitle = migratePermissionReason || migrateEligibility.summary || 'Migrate'
  const startTitle = startPermissionReason || 'Start process instance'
  const bulkDeleteDiagnosticDecision = hasSelection && deletePermissionReason ? bulkDeleteDecision : deleteEligibility.firstDeniedDecision
  const bulkSuspendDiagnosticDecision = hasSelection && suspendPermissionReason ? bulkSuspendDecision : suspendEligibility.firstDeniedDecision
  const bulkMigrateDiagnosticDecision = hasSelection && migratePermissionReason ? migrationExecuteDecision : migrateEligibility.firstDeniedDecision
  const bulkActivateDiagnosticDecision = hasSelection && activatePermissionReason ? bulkActivateDecision : activateEligibility.firstDeniedDecision
  const bulkRetryDiagnosticDecision = hasSelection && retryPermissionReason ? bulkRetryDecision : retryEligibility.firstDeniedDecision
  const firstBulkDiagnosticDecision = bulkDeleteDiagnosticDecision ||
    bulkSuspendDiagnosticDecision ||
    bulkMigrateDiagnosticDecision ||
    bulkActivateDiagnosticDecision ||
    bulkRetryDiagnosticDecision

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

  const closeStartProcessModal = React.useCallback(() => {
    if (startBusy) return
    setStartProcessOpen(false)
    setStartError(null)
  }, [startBusy])

  const handleStartProcess = React.useCallback(async () => {
    if (!selectedProcess?.key) return
    if (startPermissionReason) {
      setStartError(startPermissionReason)
      return
    }
    if (!selectedEngineId) {
      setStartError('Select an engine')
      return
    }

    let variables: unknown
    const trimmedVariables = startVariablesJson.trim()
    if (trimmedVariables) {
      try {
        variables = JSON.parse(trimmedVariables)
      } catch {
        setStartError('Variables must be valid JSON')
        return
      }
    }

    setStartBusy(true)
    setStartError(null)
    try {
      const payload: Record<string, unknown> = { engineId: selectedEngineId }
      const businessKey = startBusinessKey.trim()
      if (businessKey) payload.businessKey = businessKey
      if (variables !== undefined) payload.variables = variables
      const started = await apiClient.post<any>(
        `/mission-control-api/process-definitions/key/${encodeURIComponent(selectedProcess.key)}/start`,
        payload,
        { credentials: 'include' }
      )
      setStartProcessOpen(false)
      setStartBusinessKey('')
      setStartVariablesJson('')
      await instQ.refetch()
      const startedId = started?.id ? ` ${started.id}` : ''
      showAlert(`Process instance started${startedId}`, 'info')
    } catch (error) {
      setStartError(getUiErrorMessage(error, 'Failed to start process instance'))
    } finally {
      setStartBusy(false)
    }
  }, [instQ, selectedEngineId, selectedProcess?.key, showAlert, startBusinessKey, startPermissionReason, startVariablesJson])

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
      <BreadcrumbBar
        rightActions={(selectedProcess || showEditButton || savedFiltersReadDecision.allowed) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
            {savedFiltersReadDecision.allowed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)', minWidth: 0 }}>
                <div style={{ width: 180 }}>
                  <Dropdown
                    id="process-saved-filter"
                    titleText=""
                    label={savedFiltersQ.isLoading ? 'Loading filters' : savedFilters.length > 0 ? 'Saved filters' : 'No saved filters'}
                    items={savedFilters}
                    selectedItem={selectedSavedFilter}
                    itemToString={(item: SavedProcessFilter | null) => item?.name || ''}
                    onChange={({ selectedItem }: { selectedItem?: SavedProcessFilter | null }) => handleApplySavedFilter(selectedItem || null)}
                    disabled={savedFiltersQ.isLoading || savedFilters.length === 0}
                    size="sm"
                  />
                </div>
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={Save}
                  hasIconOnly
                  iconDescription="Save current filter"
                  disabled={!savedFiltersManageDecision.allowed || !selectedEngineId || saveFilterMutation.isPending}
                  title={savedFiltersManageDecision.allowed ? (selectedEngineId ? 'Save current filter' : 'Select an engine') : savedFiltersManageDecision.reason}
                  onClick={openSaveFilterModal}
                />
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={TrashCan}
                  hasIconOnly
                  iconDescription="Delete saved filter"
                  disabled={!savedFiltersManageDecision.allowed || !selectedSavedFilter || deleteFilterMutation.isPending}
                  title={savedFiltersManageDecision.allowed ? (selectedSavedFilter ? 'Delete saved filter' : 'Select a saved filter') : savedFiltersManageDecision.reason}
                  onClick={handleDeleteSavedFilter}
                />
              </div>
            ) : null}
            {selectedProcess && (
              <Button
                kind="primary"
                size="sm"
                renderIcon={Play}
                onClick={() => {
                  if (startPermissionReason) return
                  setStartError(null)
                  setStartProcessOpen(true)
                }}
                disabled={!!startPermissionReason}
                title={startTitle}
              >
                Start
              </Button>
            )}
            {showEditButton ? (
              <Button
                kind="ghost"
                size="sm"
                renderIcon={Launch}
                onClick={handleEditInStarbase}
                disabled={!processEditTarget?.canEdit || processEditTargetQ.isFetching}
                title={processEditTarget?.canEdit ? 'Edit deployed version in Starbase' : 'You do not have edit access for this project'}
              >
                Edit
              </Button>
            ) : null}
          </div>
        ) : null}
      >
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
        <SplitPane
          direction="vertical"
          dividerClassName="eg-split-divider"
          dividerSize={5}
          onResize={(sizes) => handleSplitChange(sizes[0])}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
        <Pane size={splitSize} minSize={200} style={{ overflow: 'hidden' }}>
        <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', position: 'relative', overflow: 'hidden', height: '100%', width: '100%' }}>
          {!currentKey && (
            <div style={{ color: 'var(--color-text-tertiary)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-base)' }}>To view a Diagram, select a Process in the Filters panel</div>
          )}
          {currentKey && selectedVersion === null && (
            <div style={{ color: 'var(--color-text-tertiary)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-base)' }}>To see a Diagram, select a single Version</div>
          )}
          {currentKey && selectedVersion !== null && xmlQ.data && (
            <React.Suspense fallback={<LoadingState message="Loading diagram..." />}>
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
        </Pane>

        {/* DataTable area */}
        <Pane minSize={200} style={{ overflow: 'auto' }}>
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
            {firstBulkDiagnosticDecision ? (
              <WhyUnavailableLink
                decision={firstBulkDiagnosticDecision}
                style={{ color: 'var(--cds-text-on-color)', fontSize: 'var(--cds-label-01-font-size, 0.75rem)' }}
              />
            ) : null}

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
                  if (notifyDeniedAction(bulkDeleteDecision)) return
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkDeleteModal.openModal()
                }}
                aria-label="Cancel (Batch)"
                title={deleteTitle}
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
                  if (notifyDeniedAction(bulkSuspendDecision)) return
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkSuspendModal.openModal()
                }}
                aria-label="Suspend (Batch)"
                title={suspendTitle}
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
                  if (notifyDeniedAction(migrationExecuteDecision)) return
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
                title={migrateTitle}
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
                  if (notifyDeniedAction(bulkActivateDecision)) return
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkActivateModal.openModal()
                }}
                aria-label="Activate (Batch)"
                title={activateTitle}
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
                  if (notifyDeniedAction(bulkRetryDecision)) return
                  const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
                  if (ids.length === 0) return
                  bulkRetryModal.openModal()
                }}
                aria-label="Retry failed jobs (Batch)"
                title={retryTitle}
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
              onTerminate={(id) => {
                if (notifyDeniedAction(instanceTerminateDecision)) return
                terminateModal.openModal(id)
              }}
              onRetry={(id) => {
                if (notifyDeniedAction(instanceRetryDecision)) return
                setRetryModalInstanceId(id)
              }}
              onActivate={(id) => {
                if (notifyDeniedAction(instanceSuspensionDecision)) return Promise.resolve()
                return callAction('PUT', `/mission-control-api/process-instances/${id}/activate${selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''}`).then(() => instQ.refetch())
              }}
              onSuspend={(id) => {
                if (notifyDeniedAction(instanceSuspensionDecision)) return Promise.resolve()
                return callAction('PUT', `/mission-control-api/process-instances/${id}/suspend${selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''}`).then(() => instQ.refetch())
              }}
              actionDecisions={{
                retry: instanceRetryDecision,
                suspension: instanceSuspensionDecision,
                terminate: instanceTerminateDecision,
              }}
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
        </Pane>
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
        retryDecision={instanceRetryDecision}
      />

      <BulkOperationModals
        bulkRetryOpen={bulkRetryModal.isOpen}
        bulkRetryBusy={bulkOps.bulkRetryBusy}
        onBulkRetryClose={bulkRetryModal.closeModal}
        onBulkRetryConfirm={async (reason) => {
          if (notifyDeniedAction(bulkRetryDecision)) return
          await bulkOps.bulkRetry(reason)
        }}
        selectedCount={selectedCount}
        bulkDeleteOpen={bulkDeleteModal.isOpen}
        bulkDeleteBusy={bulkOps.bulkDeleteBusy}
        onBulkDeleteClose={bulkDeleteModal.closeModal}
        onBulkDeleteConfirm={async (reason) => {
          if (notifyDeniedAction(bulkDeleteDecision)) return
          await bulkOps.bulkDelete(reason)
        }}
        bulkSuspendOpen={bulkSuspendModal.isOpen}
        bulkSuspendBusy={bulkOps.bulkSuspendBusy}
        onBulkSuspendClose={bulkSuspendModal.closeModal}
        onBulkSuspendConfirm={async (reason) => {
          if (notifyDeniedAction(bulkSuspendDecision)) return
          await bulkOps.bulkSuspend(reason)
        }}
        bulkActivateOpen={bulkActivateModal.isOpen}
        bulkActivateBusy={bulkOps.bulkActivateBusy}
        onBulkActivateClose={bulkActivateModal.closeModal}
        onBulkActivateConfirm={async (reason) => {
          if (notifyDeniedAction(bulkActivateDecision)) return
          await bulkOps.bulkActivate(reason)
        }}
        terminateOpen={terminateModal.isOpen}
        onTerminateClose={terminateModal.closeModal}
        onTerminateConfirm={async (reason) => {
          if (!terminateModal.data) return
          if (notifyDeniedAction(instanceTerminateDecision)) return
          try {
            await bulkOps.callAction(
              'DELETE',
              `/mission-control-api/process-instances/${terminateModal.data}?deleteReason=${encodeURIComponent(reason || 'Canceled via Mission Control')}&skipCustomListeners=true&skipIoMappings=true${selectedEngineId ? `&engineId=${encodeURIComponent(selectedEngineId)}` : ''}`
            )
            await instQ.refetch()
            terminateModal.closeModal()
          } catch (e) {
            console.error('Failed to terminate instance:', e)
            showAlert('Failed to terminate instance', 'error')
          }
        }}
      />

      <Modal
        open={saveFilterOpen}
        modalHeading="Save filter"
        primaryButtonText={saveFilterMutation.isPending ? 'Saving...' : 'Save'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={saveFilterMutation.isPending || !saveFilterName.trim() || !savedFiltersManageDecision.allowed}
        onRequestClose={() => {
          if (saveFilterMutation.isPending) return
          setSaveFilterOpen(false)
          setSaveFilterError(null)
        }}
        onRequestSubmit={handleSaveFilter}
        size="sm"
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          {!savedFiltersManageDecision.allowed ? (
            <InlineNotification
              lowContrast
              kind="warning"
              title="Save unavailable"
              subtitle={savedFiltersManageDecision.reason || 'Action unavailable'}
            />
          ) : null}
          {saveFilterError ? (
            <InlineNotification
              lowContrast
              kind="error"
              title="Failed to save filter"
              subtitle={saveFilterError}
            />
          ) : null}
          <TextInput
            id="save-process-filter-name"
            labelText="Name"
            value={saveFilterName}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSaveFilterName(event.target.value)}
            disabled={saveFilterMutation.isPending}
            placeholder="Filter name"
          />
        </div>
      </Modal>

      <Modal
        open={startProcessOpen}
        modalHeading={`Start ${selectedProcess?.label || selectedProcess?.key || 'process'}`}
        primaryButtonText={startBusy ? 'Starting...' : 'Start process'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={startBusy || !!startPermissionReason || !selectedProcess?.key}
        onRequestClose={closeStartProcessModal}
        onRequestSubmit={handleStartProcess}
        size="sm"
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          {startPermissionReason ? (
            <InlineNotification
              lowContrast
              kind="warning"
              title="Start unavailable"
              subtitle={startPermissionReason}
            />
          ) : null}
          {startError ? (
            <InlineNotification
              lowContrast
              kind="error"
              title="Failed to start process"
              subtitle={startError}
            />
          ) : null}
          <TextInput
            id="start-process-business-key"
            labelText="Business key"
            value={startBusinessKey}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setStartBusinessKey(event.target.value)}
            disabled={startBusy}
            placeholder="Optional business key"
          />
          <TextArea
            id="start-process-variables"
            labelText="Variables JSON"
            value={startVariablesJson}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setStartVariablesJson(event.target.value)}
            disabled={startBusy}
            placeholder={'{\n  "customerId": { "value": "C-100", "type": "String" }\n}'}
            rows={6}
          />
        </div>
      </Modal>

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
