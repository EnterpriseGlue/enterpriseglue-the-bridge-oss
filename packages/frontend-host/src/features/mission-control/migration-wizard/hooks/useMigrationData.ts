import React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { apiClient } from '../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'
import { useSelectedEngine } from '../../../../components/EngineSelector'
import { useToast } from '../../../../shared/notifications/ToastProvider'
import { fetchProcessDefinitionXml } from '../../shared/api/definitions'
import { withEngineContext } from '../../shared/engineContext'
import type {
  MigrationActiveSourcesRequest,
  MigrationActiveSourcesResponse,
  MigrationAsyncExecuteResponse,
  MigrationDirectExecuteResponse,
  MigrationExecuteRequest,
  MigrationPlan,
  MigrationPlanValidationRequest,
  MigrationPreviewRequest,
  MigrationPreviewResponse,
  MigrationValidationResult,
} from '@enterpriseglue/shared/schemas/mission-control/migration.js'

export interface MigrationDataParams {
  instanceIds: string[]
  originEngineId?: string
  preselectedKey?: string
  preselectedVersion?: number
}

export function useMigrationData({ instanceIds: candidateInstanceIds, originEngineId, preselectedKey, preselectedVersion }: MigrationDataParams) {
  const { tenantNavigate } = useTenantNavigate()
  const selectedEngineId = useSelectedEngine()
  const { notify } = useToast()
  const currentEngineIdRef = React.useRef(selectedEngineId)
  const lastRenderedEngineIdRef = React.useRef(selectedEngineId)
  const engineRevisionRef = React.useRef(0)
  if (lastRenderedEngineIdRef.current !== selectedEngineId) {
    lastRenderedEngineIdRef.current = selectedEngineId
    engineRevisionRef.current += 1
  }
  currentEngineIdRef.current = selectedEngineId
  const originMatchesEngine = Boolean(selectedEngineId && originEngineId === selectedEngineId)
  const instanceIds = originMatchesEngine ? candidateInstanceIds : []
  const initialSelectedKey = originMatchesEngine ? preselectedKey : undefined
  const initialSelectedVersion = originMatchesEngine ? preselectedVersion : undefined

  // Process definitions query
  const defsQ = useQuery({
    queryKey: ['mission-control', 'defs', selectedEngineId],
    queryFn: () => {
      const params = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''
      return apiClient.get<Array<{ id: string; key: string; name?: string; version: number }>>(
        `/mission-control-api/process-definitions${params}`,
        undefined,
        { credentials: 'include' }
      )
    },
    enabled: !!selectedEngineId,
  })
  const defs = defsQ.data || []

  // Build process items with key and label
  const processItems = React.useMemo(() => {
    const byKey = new Map<string, { key: string; label: string }>()
    for (const d of defs) {
      if (!byKey.has(d.key)) {
        byKey.set(d.key, { key: d.key, label: d.name || d.key })
      }
    }
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [defs])

  function versionsForKey(k?: string) {
    return defs
      .filter((d) => d.key === k)
      .map((d) => d.version)
      .sort((a, b) => b - a)
  }

  function idFor(k?: string, v?: number) {
    if (k == null || v == null) return undefined
    const numV = Number(v)
    const m = defs.find((d) => d.key === k && d.version === numV)
    return m?.id
  }

  // Selection state
  const [srcKey, setSrcKey] = React.useState<string | undefined>(initialSelectedKey)
  const [srcVer, setSrcVer] = React.useState<number | undefined>(initialSelectedVersion)
  const [tgtKey, setTgtKey] = React.useState<string | undefined>(initialSelectedKey)
  const [tgtVer, setTgtVer] = React.useState<number | undefined>(undefined)
  const [updateEventTriggers, setUpdateEventTriggers] = React.useState(false)

  // Plan state
  const [plan, setPlan] = React.useState<MigrationPlan | null>(null)
  const [planEngineId, setPlanEngineId] = React.useState<string | null>(null)
  const [validation, setValidation] = React.useState<MigrationValidationResult | null>(null)
  const [overrides, setOverrides] = React.useState<Record<number, string>>({})
  const [triggerOverrides, setTriggerOverrides] = React.useState<Record<number, boolean>>({})
  const [removed, setRemoved] = React.useState<Record<number, boolean>>({})
  const [generating, setGenerating] = React.useState(false)
  const generationRequestRef = React.useRef(0)

  // Filter state
  const [showErrorsOnly, setShowErrorsOnly] = React.useState(false)
  const [showWarningsOnly, setShowWarningsOnly] = React.useState(false)
  const [showIncompatibleTargets, setShowIncompatibleTargets] = React.useState(false)
  const [showOnlyMapped, setShowOnlyMapped] = React.useState(false)
  const [showOnlyUnmapped, setShowOnlyUnmapped] = React.useState(false)
  const [showActiveOnly, setShowActiveOnly] = React.useState(instanceIds.length > 0)

  // Variables modal state
  const [varsOpen, setVarsOpen] = React.useState(false)
  const [varRows, setVarRows] = React.useState<Array<{ name: string; type: string; value: string; scope: 'GLOBAL' | 'LOCAL' }>>([])

  // Execution options
  const [skipCustomListeners, setSkipCustomListeners] = React.useState(false)
  const [skipIoMappings, setSkipIoMappings] = React.useState(false)
  const [pinnedIdx, setPinnedIdx] = React.useState<number | null>(null)

  const previousEngineIdRef = React.useRef(selectedEngineId)
  React.useEffect(() => {
    if (previousEngineIdRef.current === selectedEngineId) return
    const canRestoreOrigin = Boolean(selectedEngineId && selectedEngineId === originEngineId)
    setSrcKey(canRestoreOrigin ? preselectedKey : undefined)
    setSrcVer(canRestoreOrigin ? preselectedVersion : undefined)
    setTgtKey(canRestoreOrigin ? preselectedKey : undefined)
    setTgtVer(undefined)
    setPlan(null)
    setPlanEngineId(null)
    setValidation(null)
    setOverrides({})
    setTriggerOverrides({})
    setRemoved({})
    setVarRows([])
    setVarsOpen(false)
    setPinnedIdx(null)
    generationRequestRef.current += 1
    setGenerating(false)
    previousEngineIdRef.current = selectedEngineId
  }, [originEngineId, preselectedKey, preselectedVersion, selectedEngineId])

  // Auto-pick or fix versions when definitions load
  React.useEffect(() => {
    if (!defsQ.data) return
    if (srcKey) {
      const versions = versionsForKey(srcKey)
      if (versions.length > 0 && (!srcVer || !versions.includes(srcVer))) {
        setSrcVer(versions[0])
      }
    }
    if (tgtKey) {
      const versions = versionsForKey(tgtKey)
      if (versions.length > 0 && (!tgtVer || !versions.includes(tgtVer))) {
        setTgtVer(versions[0])
      }
    }
  }, [srcKey, tgtKey, defsQ.data])

  // Generate plan handler
  async function handleGeneratePlan() {
    const requestEngineId = selectedEngineId
    const requestEngineRevision = engineRevisionRef.current
    const requestId = ++generationRequestRef.current
    const isCurrentRequest = () => (
      generationRequestRef.current === requestId
      && engineRevisionRef.current === requestEngineRevision
      && currentEngineIdRef.current === requestEngineId
    )
    try {
      setGenerating(true)
      if (!requestEngineId) throw new Error('Select an engine')
      const sourceDefinitionId = idFor(srcKey, srcVer)
      const targetDefinitionId = idFor(tgtKey, tgtVer)
      if (!sourceDefinitionId || !targetDefinitionId)
        throw new Error('Select both source and target process+version')
      const next = await apiClient.post<MigrationPlan>(
        '/mission-control-api/migration/generate',
        {
          engineId: requestEngineId,
          sourceProcessDefinitionId: sourceDefinitionId,
          targetProcessDefinitionId: targetDefinitionId,
        },
        { credentials: 'include' }
      )
      if (!isCurrentRequest()) return
      setPlan(next)
      setPlanEngineId(requestEngineId)
      setOverrides({})
      setValidation(null)
    } catch (e: any) {
      if (isCurrentRequest()) {
        notify({ kind: 'error', title: 'Failed to generate plan', subtitle: getUiErrorMessage(e, 'Failed to generate plan') })
      }
    } finally {
      if (isCurrentRequest()) setGenerating(false)
    }
  }

  // Auto-generate plan when selections change (includes defsQ.data so plan generates after defs load on refresh)
  React.useEffect(() => {
    if (!srcKey || !srcVer || !tgtKey || !tgtVer) return
    if (generating) return
    if (!idFor(srcKey, srcVer) || !idFor(tgtKey, tgtVer)) return
    handleGeneratePlan()
  }, [srcKey, srcVer, tgtKey, tgtVer, defsQ.data, selectedEngineId])

  // Normalize plan object
  const basePlan = React.useMemo(() => {
    if (!plan || !selectedEngineId || planEngineId !== selectedEngineId) return null
    const p = Array.isArray((plan as any).instructions) ? plan : (plan as any)?.migrationPlan
    return p || null
  }, [plan, planEngineId, selectedEngineId])

  // Plan with overrides applied
  const planWithOverrides = React.useMemo(() => {
    if (!basePlan) return null
    const core = Array.isArray((basePlan as any)?.instructions)
      ? (basePlan as any).instructions.map((i: any, idx: number) => ({
          sourceActivityIds: Array.isArray(i?.sourceActivityIds) ? i.sourceActivityIds : [],
          targetActivityId:
            overrides[idx] ||
            i?.targetActivityId ||
            (Array.isArray(i?.targetActivityIds) ? i.targetActivityIds[0] : undefined),
          ...(triggerOverrides.hasOwnProperty(String(idx))
            ? { updateEventTrigger: !!triggerOverrides[idx] }
            : i?.updateEventTrigger !== undefined
              ? { updateEventTrigger: !!i.updateEventTrigger }
              : {}),
        }))
      : []
    const kept = core.filter((_: any, idx: number) => !removed[idx])
    return { ...(basePlan as any), instructions: kept }
  }, [basePlan, overrides, triggerOverrides, removed])

  const planInstructions: any[] = Array.isArray((basePlan as any)?.instructions)
    ? (basePlan as any).instructions
    : []

  // Preview affected instances
  const previewQ = useQuery({
    queryKey: [
      'mission-control',
      'migration',
      'preview',
      selectedEngineId,
      (planWithOverrides as any)?.sourceProcessDefinitionId,
      instanceIds.join(','),
    ],
    queryFn: async () => {
      if (!selectedEngineId) throw new Error('An engine must be selected to preview migration instances')
      const request: MigrationPreviewRequest = {
        engineId: selectedEngineId,
        plan: planWithOverrides,
        processInstanceIds: instanceIds,
      }
      return await apiClient.post<MigrationPreviewResponse>(
        '/mission-control-api/migration/preview',
        request,
        { credentials: 'include' }
      )
    },
    // Migration guards resolve the selected source and target definitions
    // server-side. Permission snapshots deliberately omit that lineage.
    enabled: !!selectedEngineId && !!planWithOverrides,
  })

  // Validate mutation — result handling is done by the component via mutateAsync
  const validateMutation = useMutation({
    mutationFn: async () => {
      const requestEngineId = selectedEngineId
      const requestEngineRevision = engineRevisionRef.current
      try {
        if (!requestEngineId) throw new Error('An engine must be selected to validate a migration plan')
        if (!planWithOverrides || planEngineId !== requestEngineId) throw new Error('The migration plan belongs to a different engine')
        const request: MigrationPlanValidationRequest = {
          engineId: requestEngineId,
          plan: planWithOverrides,
        }
        const response = await apiClient.post<MigrationValidationResult>(
          '/mission-control-api/migration/plan/validate',
          request,
          { credentials: 'include' }
        )
        const stale = (
          currentEngineIdRef.current !== requestEngineId
          || engineRevisionRef.current !== requestEngineRevision
        )
        return { response, stale }
      } catch (e: any) {
        if (
          currentEngineIdRef.current === requestEngineId
          && engineRevisionRef.current === requestEngineRevision
        ) {
          notify({ kind: 'error', title: 'Validation failed', subtitle: getUiErrorMessage(e, 'Failed to validate plan') })
        }
        throw e
      }
    },
  })

  // Variables object
  const varsObj = React.useMemo(() => {
    const out: Record<string, any> = {}
    for (const r of varRows) {
      const name = (r.name || '').trim()
      if (!name) continue
      let value: any = r.value
      if (r.type === 'Boolean') value = String(r.value).toLowerCase() === 'true'
      else if (r.type === 'Long' || r.type === 'Double') {
        const n = Number(r.value)
        if (!isNaN(n)) value = n
      } else if (r.type === 'JSON') {
        try {
          value = JSON.parse(r.value)
        } catch {}
      }
      out[name] = { value, type: r.type, ...(r.scope === 'LOCAL' ? { local: true } : {}) }
    }
    return out
  }, [varRows])
  // Execute mutations
  const executeMutation = useMutation({
    mutationFn: async (auditReason?: string) => {
      const requestEngineId = selectedEngineId
      const requestEngineRevision = engineRevisionRef.current
      try {
        if (!auditReason?.trim()) throw new Error('Audit reason is required')
        if (!requestEngineId || !planWithOverrides || planEngineId !== requestEngineId) {
          throw new Error('The migration plan belongs to a different engine')
        }
        const request: MigrationExecuteRequest = {
          engineId: requestEngineId,
          plan: planWithOverrides,
          processInstanceIds: instanceIds,
          skipCustomListeners,
          skipIoMappings,
          variables: varsObj,
          auditReason: auditReason.trim(),
        }
        const response = await apiClient.post<MigrationAsyncExecuteResponse>(
          '/mission-control-api/migration/execute-async',
          request,
          { credentials: 'include' }
        )
        return { response, engineId: requestEngineId, engineRevision: requestEngineRevision }
      } catch (e: any) {
        if (
          currentEngineIdRef.current === requestEngineId
          && engineRevisionRef.current === requestEngineRevision
        ) {
          notify({ kind: 'error', title: 'Migration failed', subtitle: getUiErrorMessage(e, 'Failed to start migration') })
        }
        throw e
      }
    },
    onSuccess: ({ response, engineId, engineRevision }) => {
      if (currentEngineIdRef.current !== engineId || engineRevisionRef.current !== engineRevision) return
      tenantNavigate(withEngineContext(`/mission-control/batches/${response.id}`, engineId))
    },
  })

  const executeDirectMutation = useMutation({
    mutationFn: async (auditReason?: string) => {
      const requestEngineId = selectedEngineId
      const requestEngineRevision = engineRevisionRef.current
      try {
        if (!auditReason?.trim()) throw new Error('Audit reason is required')
        if (!requestEngineId || !planWithOverrides || planEngineId !== requestEngineId) {
          throw new Error('The migration plan belongs to a different engine')
        }
        const request: MigrationExecuteRequest = {
          engineId: requestEngineId,
          plan: planWithOverrides,
          processInstanceIds: instanceIds,
          skipCustomListeners,
          skipIoMappings,
          variables: varsObj,
          auditReason: auditReason.trim(),
        }
        const response = await apiClient.post<MigrationDirectExecuteResponse>(
          '/mission-control-api/migration/execute-direct',
          request,
          { credentials: 'include' }
        )
        return { response, engineId: requestEngineId, engineRevision: requestEngineRevision }
      } catch (e: any) {
        if (
          currentEngineIdRef.current === requestEngineId
          && engineRevisionRef.current === requestEngineRevision
        ) {
          notify({ kind: 'error', title: 'Migration failed', subtitle: getUiErrorMessage(e, 'Failed to execute migration directly') })
        }
        throw e
      }
    },
    onSuccess: ({ engineId, engineRevision }) => {
      if (currentEngineIdRef.current !== engineId || engineRevisionRef.current !== engineRevision) return
      notify({ kind: 'success', title: 'Migration completed' })
      setTimeout(() => {
        if (currentEngineIdRef.current !== engineId || engineRevisionRef.current !== engineRevision) return
        tenantNavigate(withEngineContext('/mission-control/processes', engineId))
      }, 1200)
    },
  })

  // Fetch XML for source and target
  const tgtDefId = React.useMemo(() => idFor(tgtKey, tgtVer), [tgtKey, tgtVer, defsQ.data])
  const srcDefId = React.useMemo(() => idFor(srcKey, srcVer), [srcKey, srcVer, defsQ.data])

  const targetXmlQ = useQuery({
    queryKey: ['mission-control', 'migration', 'tgt-xml', tgtDefId, selectedEngineId],
    queryFn: () => tgtDefId ? fetchProcessDefinitionXml(tgtDefId, selectedEngineId) : Promise.resolve(null),
    enabled: !!tgtDefId && !!selectedEngineId,
  })

  const sourceXmlQ = useQuery({
    queryKey: ['mission-control', 'migration', 'src-xml', srcDefId, selectedEngineId],
    queryFn: () => srcDefId ? fetchProcessDefinitionXml(srcDefId, selectedEngineId) : Promise.resolve(null),
    enabled: !!srcDefId && !!selectedEngineId,
  })

  // Active source activities
  const activeCountsQ = useQuery({
    queryKey: ['mission-control', 'migration', 'active-src', selectedEngineId, instanceIds.join(',')],
    queryFn: async () => {
      if (instanceIds.length === 0) return {} as Record<string, number>
      if (!selectedEngineId) return {} as Record<string, number>
      const request: MigrationActiveSourcesRequest = {
        engineId: selectedEngineId,
        processInstanceIds: instanceIds,
      }
      return await apiClient.post<MigrationActiveSourcesResponse>(
        '/mission-control-api/migration/active-sources',
        request,
        { credentials: 'include' }
      )
    },
    enabled: !!selectedEngineId && instanceIds.length > 0,
  })

  const activeSet = React.useMemo(
    () => new Set(Object.keys((activeCountsQ.data as any) || {})),
    [activeCountsQ.data]
  )

  // Compute target counts from active counts and current mapping
  const targetPlannedCounts = React.useMemo(() => {
    const out: Record<string, number> = {}
    try {
      const srcCounts: Record<string, number> = (activeCountsQ.data as any) || {}
      const instr: any[] = Array.isArray((planWithOverrides as any)?.instructions)
        ? (planWithOverrides as any).instructions
        : []
      for (const ins of instr) {
        const tgt = (ins?.targetActivityId ||
          (Array.isArray(ins?.targetActivityIds) ? ins.targetActivityIds[0] : undefined)) as
          | string
          | undefined
        if (!tgt) continue
        const srcIds: string[] = Array.isArray(ins?.sourceActivityIds) ? ins.sourceActivityIds : []
        let sum = 0
        for (const sid of srcIds) sum += Number(srcCounts[sid] || 0)
        if (sum > 0) out[tgt] = (out[tgt] || 0) + sum
      }
    } catch {}
    return out
  }, [planWithOverrides, activeCountsQ.data])

  const lockSource =
    instanceIds.length > 0 &&
    !!initialSelectedKey &&
    initialSelectedVersion !== undefined &&
    initialSelectedVersion !== null

  return {
    // Queries
    defsQ,
    sourceXmlQ,
    targetXmlQ,
    activeCountsQ,
    previewQ,
    // Mutations
    validateMutation,
    executeMutation,
    executeDirectMutation,
    // Derived data
    defs,
    processItems,
    versionsForKey,
    idFor,
    basePlan,
    planWithOverrides,
    planInstructions,
    activeSet,
    targetPlannedCounts,
    varsObj,
    lockSource,
    generating,
    selectedEngineId,
    instanceIds,
    // State and setters
    srcKey,
    setSrcKey,
    srcVer,
    setSrcVer,
    tgtKey,
    setTgtKey,
    tgtVer,
    setTgtVer,
    updateEventTriggers,
    setUpdateEventTriggers,
    plan,
    setPlan,
    validation,
    setValidation,
    overrides,
    setOverrides,
    triggerOverrides,
    setTriggerOverrides,
    removed,
    setRemoved,
    showErrorsOnly,
    setShowErrorsOnly,
    showWarningsOnly,
    setShowWarningsOnly,
    showIncompatibleTargets,
    setShowIncompatibleTargets,
    showOnlyMapped,
    setShowOnlyMapped,
    showOnlyUnmapped,
    setShowOnlyUnmapped,
    showActiveOnly,
    setShowActiveOnly,
    varsOpen,
    setVarsOpen,
    varRows,
    setVarRows,
    skipCustomListeners,
    setSkipCustomListeners,
    skipIoMappings,
    setSkipIoMappings,
    pinnedIdx,
    setPinnedIdx,
    // Actions
    handleGeneratePlan,
  }
}
