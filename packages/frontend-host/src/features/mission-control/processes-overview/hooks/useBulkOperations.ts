import { useState, useCallback, useEffect, useRef } from 'react'
import { useTenantNavigate } from '../../../../shared/hooks/useTenantNavigate'
import { apiClient } from '../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../shared/api/apiErrorUtils'
import {
  createBulkRetryBatch,
  createBulkDeleteBatch,
  createBulkSuspendBatch,
  createBulkActivateBatch,
} from '../../batches/api/batches'
import { withEngineContext } from '../../shared/engineContext'

interface UseBulkOperationsProps {
  selectedMap: Record<string, boolean>
  setSelectedMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  instQRefetch: () => void
  showAlert: (message: string, kind: 'error' | 'warning' | 'success' | 'info') => void
  engineId: string | null
}

export function useBulkOperations({
  selectedMap,
  setSelectedMap,
  instQRefetch,
  showAlert,
  engineId,
}: UseBulkOperationsProps) {
  const { tenantNavigate } = useTenantNavigate()
  const [bulkRetryBusy, setBulkRetryBusy] = useState(false)
  const [bulkSuspendBusy, setBulkSuspendBusy] = useState(false)
  const [bulkActivateBusy, setBulkActivateBusy] = useState(false)
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false)
  const currentEngineIdRef = useRef(engineId)
  const lastRenderedEngineIdRef = useRef(engineId)
  const engineRevisionRef = useRef(0)
  if (lastRenderedEngineIdRef.current !== engineId) {
    lastRenderedEngineIdRef.current = engineId
    engineRevisionRef.current += 1
  }
  currentEngineIdRef.current = engineId

  useEffect(() => {
    setBulkRetryBusy(false)
    setBulkSuspendBusy(false)
    setBulkActivateBusy(false)
    setBulkDeleteBusy(false)
  }, [engineId])

  const currentInteraction = useCallback(() => {
    const requestEngineId = engineId
    const requestEngineRevision = engineRevisionRef.current
    const isCurrent = () => (
      Boolean(requestEngineId)
      && currentEngineIdRef.current === requestEngineId
      && engineRevisionRef.current === requestEngineRevision
    )
    return { requestEngineId, isCurrent }
  }, [engineId])

  const callAction = useCallback(async (method: 'PUT' | 'DELETE', path: string) => {
    const { isCurrent } = currentInteraction()
    if (!isCurrent()) return false
    try {
      if (method === 'DELETE') {
        await apiClient.delete(path, { credentials: 'include' })
      } else {
        await apiClient.put(path, {}, { credentials: 'include' })
      }
      return isCurrent()
    } catch (e: any) {
      if (!isCurrent()) return false
      console.error('Action failed:', e)
      const message = getUiErrorMessage(e, 'Action failed')
      showAlert(`Action failed: ${message}`, 'error')
      throw e
    }
  }, [currentInteraction, showAlert])

  const bulkRetry = useCallback(async (auditReason?: string) => {
    const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
    if (ids.length === 0) return
    const { requestEngineId, isCurrent } = currentInteraction()
    if (!requestEngineId || !isCurrent()) return

    setBulkRetryBusy(true)
    try {
      await createBulkRetryBatch(ids, requestEngineId, auditReason)
      if (!isCurrent()) return
      tenantNavigate(withEngineContext('/mission-control/batches', requestEngineId))
      setSelectedMap({})
    } catch (e: any) {
      if (!isCurrent()) return
      console.error('Failed to create retry batch:', e)
      const message = getUiErrorMessage(e, 'Failed to create retry batch')
      showAlert(`Failed to create retry batch: ${message}`, 'error')
      throw e
    } finally {
      if (isCurrent()) setBulkRetryBusy(false)
    }
  }, [selectedMap, setSelectedMap, tenantNavigate, showAlert, currentInteraction])

  const bulkDelete = useCallback(async (deleteReason?: string) => {
    const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
    if (ids.length === 0) return
    const { requestEngineId, isCurrent } = currentInteraction()
    if (!requestEngineId || !isCurrent()) return

    setBulkDeleteBusy(true)
    try {
      await createBulkDeleteBatch(ids, deleteReason, requestEngineId)
      if (!isCurrent()) return
      tenantNavigate(withEngineContext('/mission-control/batches', requestEngineId))
      setSelectedMap({})
    } catch (e: any) {
      if (!isCurrent()) return
      console.error('Failed to create delete batch:', e)
      const message = getUiErrorMessage(e, 'Failed to create delete batch')
      showAlert(`Failed to create delete batch: ${message}`, 'error')
      throw e
    } finally {
      if (isCurrent()) setBulkDeleteBusy(false)
    }
  }, [selectedMap, setSelectedMap, tenantNavigate, showAlert, currentInteraction])

  const bulkSuspend = useCallback(async (auditReason?: string) => {
    const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
    if (ids.length === 0) return
    const { requestEngineId, isCurrent } = currentInteraction()
    if (!requestEngineId || !isCurrent()) return

    setBulkSuspendBusy(true)
    try {
      await createBulkSuspendBatch(ids, requestEngineId, auditReason)
      if (!isCurrent()) return
      tenantNavigate(withEngineContext('/mission-control/batches', requestEngineId))
      setSelectedMap({})
    } catch (e: any) {
      if (!isCurrent()) return
      console.error('Failed to create suspend batch:', e)
      const message = getUiErrorMessage(e, 'Failed to create suspend batch')
      showAlert(`Failed to create suspend batch: ${message}`, 'error')
      throw e
    } finally {
      if (isCurrent()) setBulkSuspendBusy(false)
    }
  }, [selectedMap, setSelectedMap, tenantNavigate, showAlert, currentInteraction])

  const bulkActivate = useCallback(async (auditReason?: string) => {
    const ids = Object.keys(selectedMap).filter(k => selectedMap[k])
    if (ids.length === 0) return
    const { requestEngineId, isCurrent } = currentInteraction()
    if (!requestEngineId || !isCurrent()) return

    setBulkActivateBusy(true)
    try {
      await createBulkActivateBatch(ids, requestEngineId, auditReason)
      if (!isCurrent()) return
      tenantNavigate(withEngineContext('/mission-control/batches', requestEngineId))
      setSelectedMap({})
    } catch (e: any) {
      if (!isCurrent()) return
      console.error('Failed to create activate batch:', e)
      const message = getUiErrorMessage(e, 'Failed to create activate batch')
      showAlert(`Failed to create activate batch: ${message}`, 'error')
      throw e
    } finally {
      if (isCurrent()) setBulkActivateBusy(false)
    }
  }, [selectedMap, setSelectedMap, tenantNavigate, showAlert, currentInteraction])

  return {
    bulkRetryBusy,
    bulkSuspendBusy,
    bulkActivateBusy,
    bulkDeleteBusy,
    callAction,
    bulkRetry,
    bulkDelete,
    bulkSuspend,
    bulkActivate,
  }
}
