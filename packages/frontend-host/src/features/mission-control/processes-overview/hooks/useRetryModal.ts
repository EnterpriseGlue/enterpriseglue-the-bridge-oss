import { useState, useEffect } from 'react'

interface UseRetryModalProps {
  retryModalInstanceId: string | null
  allRetryItems: any[]
  retryJobsQData: any[] | undefined
}

export function useRetryModal({
  retryModalInstanceId,
  allRetryItems,
  retryJobsQData,
}: UseRetryModalProps) {
  const [retrySelectionMap, setRetrySelectionMap] = useState<Record<string, boolean>>({})
  const [retryDueMode, setRetryDueMode] = useState<'keep' | 'set'>('keep')
  const [retryDueInput, setRetryDueInput] = useState('')
  const [retryModalBusy, setRetryModalBusy] = useState(false)
  const [retryModalError, setRetryModalError] = useState<string | null>(null)
  const [retryModalSuccess, setRetryModalSuccess] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (retryModalInstanceId) {
      setRetrySelectionMap({})
      setRetryDueMode('keep')
      setRetryDueInput('')
      setRetryModalBusy(false)
      setRetryModalError(null)
      setRetryModalSuccess(false)
    }
  }, [retryModalInstanceId])

  // Auto-select all items when they load
  useEffect(() => {
    if (allRetryItems.length > 0) {
      const next: Record<string, boolean> = {}
      for (const item of allRetryItems) {
        if (item && item.id) next[item.id] = true
      }
      setRetrySelectionMap(next)
    }
  }, [allRetryItems])

  // Additional effect for jobs-only selection
  useEffect(() => {
    if (!retryModalInstanceId) return
    const jobs = (retryJobsQData || []) as any[]
    if (!jobs || jobs.length === 0) {
      setRetrySelectionMap({})
      return
    }
    const next: Record<string, boolean> = {}
    for (const j of jobs) {
      if (j && j.id) next[j.id] = true
    }
    setRetrySelectionMap(next)
  }, [retryModalInstanceId, retryJobsQData])

  return {
    retrySelectionMap,
    setRetrySelectionMap,
    retryDueMode,
    setRetryDueMode,
    retryDueInput,
    setRetryDueInput,
    retryModalBusy,
    setRetryModalBusy,
    retryModalError,
    setRetryModalError,
    retryModalSuccess,
    setRetryModalSuccess,
  }
}
