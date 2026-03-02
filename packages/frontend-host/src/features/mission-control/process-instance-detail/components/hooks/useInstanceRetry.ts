import { useState, useMemo, useEffect, useCallback } from 'react'
import { useAlert } from '../../../../../shared/hooks/useAlert'
import { apiClient } from '../../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../../shared/api/apiErrorUtils'

interface UseInstanceRetryProps {
  instanceId: string
  allRetryItems: any[]
  retryJobsQ: any
  retryExtTasksQ: any
  incidentsQ: any
  actQ: any
  engineId?: string
}

export function useInstanceRetry({ instanceId, allRetryItems, retryJobsQ, retryExtTasksQ, incidentsQ, actQ, engineId }: UseInstanceRetryProps) {
  const { showAlert } = useAlert()
  const [retryModalOpen, setRetryModalOpen] = useState(false)
  const [retryActivityFilter, setRetryActivityFilter] = useState<string | null>(null)
  const [retrySelectionMap, setRetrySelectionMap] = useState<Record<string, boolean>>({})
  const [retryDueMode, setRetryDueMode] = useState<'keep' | 'set'>('keep')
  const [retryDueInput, setRetryDueInput] = useState('')
  const [retryBusy, setRetryBusy] = useState(false)

  // Auto-select all items when modal opens
  useEffect(() => {
    if (retryModalOpen) {
      const next: Record<string, boolean> = {}
      const items = retryActivityFilter ? allRetryItems.filter((item: any) => item?.activityId === retryActivityFilter) : allRetryItems
      for (const item of items) {
        if (item?.id) next[item.id] = true
      }
      setRetrySelectionMap((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(next)
        if (prevKeys.length !== nextKeys.length) return next
        for (const k of nextKeys) {
          if (prev[k] !== next[k]) return next
        }
        return prev
      })
    }
  }, [retryModalOpen, allRetryItems, retryActivityFilter])

  const filteredRetryItems = useMemo(() => {
    if (!retryActivityFilter) return allRetryItems
    return allRetryItems.filter((item: any) => item?.activityId === retryActivityFilter)
  }, [allRetryItems, retryActivityFilter])

  const submitRetrySelection = useCallback(async () => {
    if (!instanceId) return
    const selectedJobs = allRetryItems.filter(item => item.itemType === 'job' && retrySelectionMap[item.id]).map(item => item.id)
    const selectedExtTasks = allRetryItems
      .filter(item => item.itemType === 'externalTask' && retrySelectionMap[item.id])
      .map(item => item.id)
    if (selectedJobs.length === 0 && selectedExtTasks.length === 0) {
      showAlert('Please select at least one item to retry.', 'warning')
      return
    }
    setRetryBusy(true)
    try {
      const payload: any = {}
      if (selectedJobs.length > 0) payload.jobIds = selectedJobs
      if (selectedExtTasks.length > 0) payload.externalTaskIds = selectedExtTasks
      if (retryDueMode === 'set' && retryDueInput) {
        const dt = new Date(retryDueInput)
        if (!isNaN(dt.getTime())) payload.dueDate = dt.toISOString()
      }
      if (engineId) payload.engineId = engineId
      await apiClient.post(`/mission-control-api/process-instances/${instanceId}/retry`, payload, { credentials: 'include' })
      await Promise.allSettled([retryJobsQ.refetch(), retryExtTasksQ.refetch(), incidentsQ.refetch(), actQ.refetch()])
      setRetryModalOpen(false)
    } catch (e: any) {
      const message = getUiErrorMessage(e, 'Failed to retry')
      showAlert(`Failed to retry: ${message}`, 'error')
    } finally {
      setRetryBusy(false)
    }
  }, [instanceId, allRetryItems, retrySelectionMap, retryDueMode, retryDueInput, retryJobsQ, retryExtTasksQ, incidentsQ, actQ])

  const openRetryModal = useCallback((activityId?: string) => {
    setRetryActivityFilter(activityId || null)
    setRetryModalOpen(true)
  }, [])

  return {
    // State
    retryModalOpen,
    retryActivityFilter,
    retrySelectionMap,
    retryDueMode,
    retryDueInput,
    retryBusy,
    filteredRetryItems,

    // Setters
    setRetryModalOpen,
    setRetryActivityFilter,
    setRetrySelectionMap,
    setRetryDueMode,
    setRetryDueInput,

    // Actions
    submitRetrySelection,
    openRetryModal,
  }
}
