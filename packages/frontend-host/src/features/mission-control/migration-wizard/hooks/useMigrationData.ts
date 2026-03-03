import React from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { apiClient } from '../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'
import { useSelectedEngine } from '../../../../components/EngineSelector'
import { useToast } from '../../../../shared/notifications/ToastProvider'

export interface MigrationDataParams {
  instanceIds: string[]
  preselectedKey?: string
  preselectedVersion?: number
}

export function useMigrationData({ instanceIds, preselectedKey, preselectedVersion }: MigrationDataParams) {
  const { tenantNavigate } = useTenantNavigate()
  const selectedEngineId = useSelectedEngine()
  const { notify } = useToast()

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
  const [srcKey, setSrcKey] = React.useState<string | undefined>(preselectedKey)
  const [srcVer, setSrcVer] = React.useState<number | undefined>(preselectedVersion)
  const [tgtKey, setTgtKey] = React.useState<string | undefined>(preselectedKey)
  const [tgtVer, setTgtVer] = React.useState<number | undefined>(undefined)
  const [updateEventTriggers, setUpdateEventTriggers] = React.useState(false)

  // Plan state
  const [plan, setPlan] = React.useState<any | null>(null)
  const [validation, setValidation] = React.useState<any | null>(null)
  const [overrides, setOverrides] = React.useState<Record<number, string>>({})
  const [triggerOverrides, setTriggerOverrides] = React.useState<Record<number, boolean>>({})
  const [removed, setRemoved] = React.useState<Record<number, boolean>>({})
  const [generating, setGenerating] = React.useState(false)

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
    try {
      setGenerating(true)
      if (!selectedEngineId) throw new Error('Select an engine')
      const sourceDefinitionId = idFor(srcKey, srcVer)
      const targetDefinitionId = idFor(tgtKey, tgtVer)
      if (!sourceDefinitionId || !targetDefinitionId)
        throw new Error('Select both source and target process+version')
      const next = await apiClient.post<any>(
        '/mission-control-api/migration/generate',
        {
          engineId: selectedEngineId,
          sourceProcessDefinitionId: sourceDefinitionId,
          targetProcessDefinitionId: targetDefinitionId,
        },
        { credentials: 'include' }
      )
      const enginePlan =
        next && typeof next === 'object' && Array.isArray((next as any).instructions)
          ? next
          : (next as any)?.migrationPlan || next
      setPlan(enginePlan)
      setOverrides({})
      setValidation(null)
    } catch (e: any) {
      notify({ kind: 'error', title: 'Failed to generate plan', subtitle: getUiErrorMessage(e, 'Failed to generate plan') })
    } finally {
      setGenerating(false)
    }
  }

  // Auto-generate plan when selections change (includes defsQ.data so plan generates after defs load on refresh)
  React.useEffect(() => {
    if (!srcKey || !srcVer || !tgtKey || !tgtVer) return
    if (generating) return
    if (!idFor(srcKey, srcVer) || !idFor(tgtKey, tgtVer)) return
    handleGeneratePlan()
  }, [srcKey, srcVer, tgtKey, tgtVer, defsQ.data])

  // Normalize plan object
  const basePlan = React.useMemo(() => {
    if (!plan) return null
    const p = Array.isArray((plan as any).instructions) ? plan : (plan as any)?.migrationPlan
    return p || null
  }, [plan])

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
      (planWithOverrides as any)?.sourceProcessDefinitionId,
      instanceIds.join(','),
    ],
    queryFn: async () =>
      await apiClient.post<{ count: number }>(
        '/mission-control-api/migration/preview',
        { engineId: selectedEngineId, plan: planWithOverrides, processInstanceIds: instanceIds },
        { credentials: 'include' }
      ),
    enabled: !!planWithOverrides,
  })

  // Validate mutation — result handling is done by the component via mutateAsync
  const validateMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<any>(
        '/mission-control-api/migration/plan/validate',
        { engineId: selectedEngineId, plan: planWithOverrides },
        { credentials: 'include' }
      ),
    onError: (e: any) => notify({ kind: 'error', title: 'Validation failed', subtitle: getUiErrorMessage(e, 'Failed to validate plan') }),
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
    mutationFn: async () =>
      apiClient.post<{ id: string }>(
        '/mission-control-api/migration/execute-async',
        {
          engineId: selectedEngineId,
          plan: planWithOverrides,
          processInstanceIds: instanceIds,
          skipCustomListeners,
          skipIoMappings,
          variables: varsObj,
        },
        { credentials: 'include' }
      ),
    onSuccess: (data) => tenantNavigate(`/mission-control/batches/${data.id}`),
    onError: (e: any) => notify({ kind: 'error', title: 'Migration failed', subtitle: getUiErrorMessage(e, 'Failed to start migration') }),
  })

  const executeDirectMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<{ ok: boolean }>(
        '/mission-control-api/migration/execute-direct',
        {
          engineId: selectedEngineId,
          plan: planWithOverrides,
          processInstanceIds: instanceIds,
          skipCustomListeners,
          skipIoMappings,
          variables: varsObj,
        },
        { credentials: 'include' }
      ),
    onSuccess: () => {
      notify({ kind: 'success', title: 'Migration completed' })
      setTimeout(() => tenantNavigate('/mission-control/processes'), 1200)
    },
    onError: (e: any) => notify({ kind: 'error', title: 'Migration failed', subtitle: getUiErrorMessage(e, 'Failed to execute migration directly') }),
  })

  // Fetch XML for source and target
  const tgtDefId = React.useMemo(() => idFor(tgtKey, tgtVer), [tgtKey, tgtVer, defsQ.data])
  const srcDefId = React.useMemo(() => idFor(srcKey, srcVer), [srcKey, srcVer, defsQ.data])

  const targetXmlQ = useQuery({
    queryKey: ['mission-control', 'migration', 'tgt-xml', tgtDefId, selectedEngineId],
    queryFn: async () => {
      if (!tgtDefId) return null as any
      const params = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''
      const data = await apiClient.get<{ bpmn20Xml: string }>(
        `/mission-control-api/process-definitions/${tgtDefId}/xml${params}`,
        undefined,
        { credentials: 'include' }
      )
      return data?.bpmn20Xml || null
    },
    enabled: !!tgtDefId && !!selectedEngineId,
  })

  const sourceXmlQ = useQuery({
    queryKey: ['mission-control', 'migration', 'src-xml', srcDefId, selectedEngineId],
    queryFn: async () => {
      if (!srcDefId) return null as any
      const params = selectedEngineId ? `?engineId=${encodeURIComponent(selectedEngineId)}` : ''
      const data = await apiClient.get<{ bpmn20Xml: string }>(
        `/mission-control-api/process-definitions/${srcDefId}/xml${params}`,
        undefined,
        { credentials: 'include' }
      )
      return data?.bpmn20Xml || null
    },
    enabled: !!srcDefId && !!selectedEngineId,
  })

  // Active source activities
  const activeCountsQ = useQuery({
    queryKey: ['mission-control', 'migration', 'active-src', instanceIds.join(',')],
    queryFn: async () => {
      if (instanceIds.length === 0) return {} as Record<string, number>
      return await apiClient.post<Record<string, number>>(
        '/mission-control-api/migration/active-sources',
        { engineId: selectedEngineId, processInstanceIds: instanceIds },
        { credentials: 'include' }
      )
    },
    enabled: instanceIds.length > 0,
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
    !!preselectedKey &&
    preselectedVersion !== undefined &&
    preselectedVersion !== null

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
