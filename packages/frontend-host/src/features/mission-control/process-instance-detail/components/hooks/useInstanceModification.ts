import { useState, useEffect, useCallback } from 'react'
import type { ModificationOperation, ModificationVariable } from '../types'
import { apiClient } from '../../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../../shared/api/apiErrorUtils'
import { useToast } from '../../../../../shared/notifications/ToastProvider'

interface UseInstanceModificationProps {
  instanceId: string
  status: string
  actQ: any
  incidentsQ: any
  runtimeQ: any
  engineId?: string
}

export function useInstanceModification({ instanceId, status, actQ, incidentsQ, runtimeQ, engineId }: UseInstanceModificationProps) {
  const { notify } = useToast()
  const [isModMode, setIsModMode] = useState(false)
  const [modPlan, setModPlan] = useState<ModificationOperation[]>([])
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null)
  const [moveSourceActivityId, setMoveSourceActivityId] = useState<string | null>(null)
  const [showModIntro, setShowModIntro] = useState(false)
  const [suppressIntroNext, setSuppressIntroNext] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [applyBusy, setApplyBusy] = useState(false)
  const [queuedModActivityId, setQueuedModActivityId] = useState<string | null>(null)

  // Clear selection when exiting mod mode
  useEffect(() => {
    if (!isModMode) {
      setSelectedActivityId(null)
      setMoveSourceActivityId(null)
    }
  }, [isModMode])

  const openModificationIntro = useCallback(() => {
    if (status !== 'ACTIVE') return
    try {
      if (typeof window !== 'undefined') {
        const suppressed = window.localStorage.getItem('vt_mod_intro_suppressed') === '1'
        if (suppressed) {
          setIsModMode(true)
          return
        }
      }
    } catch {}
    setSuppressIntroNext(false)
    setShowModIntro(true)
  }, [status])

  const requestExitModificationMode = useCallback(() => {
    if (modPlan.length > 0) {
      setDiscardConfirmOpen(true)
      return
    }
    setIsModMode(false)
    setSelectedActivityId(null)
    setMoveSourceActivityId(null)
  }, [modPlan.length])

  const addPlanOperation = useCallback(
    (kind: 'add' | 'addAfter' | 'cancel') => {
      if (!selectedActivityId) return
      setModPlan(prev => {
        const alreadyExists = prev.some(op => op.kind === kind && op.activityId === selectedActivityId)
        if (alreadyExists) return prev
        // add and addAfter are mutually exclusive per node — replace the other if present
        const opposite = kind === 'add' ? 'addAfter' : kind === 'addAfter' ? 'add' : null
        const filtered = opposite
          ? prev.filter(op => !(op.kind === opposite && op.activityId === selectedActivityId))
          : prev
        return [...filtered, { kind, activityId: selectedActivityId }]
      })
    },
    [selectedActivityId]
  )

  const toggleMoveForSelection = useCallback(() => {
    if (!selectedActivityId) return
    if (!moveSourceActivityId) {
      setMoveSourceActivityId(selectedActivityId)
      return
    }
    if (moveSourceActivityId === selectedActivityId) {
      setMoveSourceActivityId(null)
      return
    }
    setModPlan(prev => [...prev, { kind: 'move', fromActivityId: moveSourceActivityId, toActivityId: selectedActivityId }])
    setMoveSourceActivityId(null)
  }, [selectedActivityId, moveSourceActivityId])

  const removePlanItem = useCallback((index: number) => {
    setModPlan(prev => prev.filter((_, i) => i !== index))
  }, [])

  const movePlanItem = useCallback((index: number, direction: 'up' | 'down') => {
    setModPlan(prev => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }, [])

  const undoLastOperation = useCallback(() => {
    setModPlan(prev => prev.length > 0 ? prev.slice(0, -1) : prev)
  }, [])

  const updatePlanItemVariables = useCallback((index: number, variables: ModificationVariable[]) => {
    setModPlan(prev => {
      if (index < 0 || index >= prev.length) return prev
      const next = [...prev]
      next[index] = { ...next[index], variables }
      return next
    })
  }, [])

  const addMoveToHere = useCallback((targetActivityId: string, sourceActivityIds: string[]) => {
    if (sourceActivityIds.length === 0) return
    setModPlan(prev => {
      const newOps = sourceActivityIds
        .filter(sourceId => !prev.some(op => op.kind === 'move' && op.fromActivityId === sourceId && op.toActivityId === targetActivityId))
        .map(sourceId => ({
          kind: 'move' as const,
          fromActivityId: sourceId,
          toActivityId: targetActivityId,
        }))
      if (newOps.length === 0) return prev
      return [...prev, ...newOps]
    })
  }, [])

  const applyModifications = useCallback(async (options?: { skipCustomListeners?: boolean; skipIoMappings?: boolean; annotation?: string }) => {
    if (modPlan.length === 0) return
    setApplyBusy(true)
    try {
      const instructions: any[] = []
      for (const op of modPlan) {
        const vars = op.variables?.filter(v => v.name.trim())
        const varsObj = vars && vars.length > 0
          ? Object.fromEntries(vars.map(v => {
              if (v.type === 'Object') {
                const serialized = typeof v.value === 'string' ? v.value : JSON.stringify(v.value)
                return [v.name, { value: serialized, type: 'Object', valueInfo: { serializationDataFormat: 'application/json', objectTypeName: 'java.lang.Object' } }]
              }
              return [v.name, { value: v.value, type: v.type }]
            }))
          : undefined
        if (op.kind === 'add' && op.activityId) {
          instructions.push({ type: 'startBeforeActivity', activityId: op.activityId, ...(varsObj && { variables: varsObj }) })
        } else if (op.kind === 'addAfter' && op.activityId) {
          instructions.push({ type: 'startAfterActivity', activityId: op.activityId, ...(varsObj && { variables: varsObj }) })
        } else if (op.kind === 'cancel' && op.activityId) {
          instructions.push({ type: 'cancel', activityId: op.activityId, cancelCurrentActiveActivityInstances: true })
        } else if (op.kind === 'move' && op.fromActivityId && op.toActivityId) {
          instructions.push({ type: 'cancel', activityId: op.fromActivityId, cancelCurrentActiveActivityInstances: true })
          instructions.push({ type: 'startBeforeActivity', activityId: op.toActivityId, ...(varsObj && { variables: varsObj }) })
        }
      }
      if (instructions.length === 0) {
        setApplyBusy(false)
        return
      }
      const payload: any = { instructions, engineId }
      if (options?.skipCustomListeners) payload.skipCustomListeners = true
      if (options?.skipIoMappings) payload.skipIoMappings = true
      if (options?.annotation) payload.annotation = options.annotation
      await apiClient.post(`/mission-control-api/process-instances/${instanceId}/modify`, payload, { credentials: 'include' })
      await Promise.allSettled([actQ.refetch(), incidentsQ.refetch(), runtimeQ.refetch()])
      const opCount = modPlan.length
      notify({ kind: 'success', title: `Successfully applied ${opCount} modification${opCount === 1 ? '' : 's'}` })
      setModPlan([])
      setIsModMode(false)
      setSelectedActivityId(null)
      setMoveSourceActivityId(null)
    } catch (e: any) {
      const message = getUiErrorMessage(e, 'Failed to apply modifications')
      notify({ kind: 'error', title: 'Modification failed', subtitle: message })
      throw e
    } finally {
      setApplyBusy(false)
    }
  }, [modPlan, instanceId, actQ, incidentsQ, runtimeQ])

  const confirmModIntro = useCallback(() => {
    if (suppressIntroNext) {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('vt_mod_intro_suppressed', '1')
        }
      } catch {}
    }
    setShowModIntro(false)
    setIsModMode(true)
  }, [suppressIntroNext])

  const discardModifications = useCallback(() => {
    setModPlan([])
    setIsModMode(false)
    setSelectedActivityId(null)
    setMoveSourceActivityId(null)
    setDiscardConfirmOpen(false)
  }, [])

  return {
    // State
    isModMode,
    modPlan,
    selectedActivityId,
    moveSourceActivityId,
    showModIntro,
    suppressIntroNext,
    discardConfirmOpen,
    applyBusy,
    queuedModActivityId,

    // Setters
    setIsModMode,
    setSelectedActivityId,
    setMoveSourceActivityId,
    setShowModIntro,
    setSuppressIntroNext,
    setDiscardConfirmOpen,
    setQueuedModActivityId,

    // Actions
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
    confirmModIntro,
    discardModifications,
  }
}
