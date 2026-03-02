import React, { useMemo } from 'react'
import { Modal, InlineNotification, Checkbox, Loading } from '@carbon/react'
import { apiClient } from '../../../../../shared/api/client'
import { getUiErrorMessage } from '../../../../../shared/api/apiErrorUtils'

interface RetryModalProps {
  open: boolean
  instanceId: string | null
  onClose: () => void
  allRetryItems: any[]
  retryJobsQLoading: boolean
  retryExtTasksQLoading: boolean
  retryJobsQError: any
  retryExtTasksQError: any
  retrySelectionMap: Record<string, boolean>
  setRetrySelectionMap: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  retryDueMode: 'keep' | 'set'
  setRetryDueMode: (mode: 'keep' | 'set') => void
  retryDueInput: string
  setRetryDueInput: (input: string) => void
  retryModalBusy: boolean
  setRetryModalBusy: (busy: boolean) => void
  retryModalError: string | null
  setRetryModalError: (error: string | null) => void
  retryModalSuccess: boolean
  setRetryModalSuccess: (success: boolean) => void
  retryJobsQRefetch: () => void
  retryExtTasksQRefetch: () => void
  instQRefetch: () => void
  engineId?: string
}

export function RetryModal({
  open,
  instanceId,
  onClose,
  allRetryItems,
  retryJobsQLoading,
  retryExtTasksQLoading,
  retryJobsQError,
  retryExtTasksQError,
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
  retryJobsQRefetch,
  retryExtTasksQRefetch,
  instQRefetch,
  engineId,
}: RetryModalProps) {
  const handleSubmit = async () => {
    if (!instanceId || retryModalBusy) return

    if (retryModalSuccess) {
      onClose()
      return
    }

    const selectedJobs = allRetryItems.filter(item => item.itemType === 'job' && retrySelectionMap[item.id]).map(item => item.id)
    const selectedExtTasks = allRetryItems.filter(item => item.itemType === 'externalTask' && retrySelectionMap[item.id]).map(item => item.id)
    
    if (selectedJobs.length === 0 && selectedExtTasks.length === 0) {
      setRetryModalError('Please select at least one item to retry.')
      return
    }

    setRetryModalBusy(true)
    setRetryModalError(null)
    setRetryModalSuccess(false)

    try {
      const payload: any = {}
      if (selectedJobs.length > 0) payload.jobIds = selectedJobs
      if (selectedExtTasks.length > 0) payload.externalTaskIds = selectedExtTasks
      if (retryDueMode === 'set' && retryDueInput) {
        const dt = new Date(retryDueInput)
        if (!isNaN(dt.getTime())) {
          payload.dueDate = dt.toISOString()
        }
      }

      if (engineId) payload.engineId = engineId
      await apiClient.post(`/mission-control-api/process-instances/${instanceId}/retry`, payload, { credentials: 'include' })

      // Refresh data
      await Promise.allSettled([retryJobsQRefetch(), retryExtTasksQRefetch(), instQRefetch()])

      setRetryModalSuccess(true)
      setRetryModalError(null)

      // Auto-close after 1.5 seconds
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (e: any) {
      setRetryModalError(getUiErrorMessage(e, 'Failed to retry instance'))
      setRetryModalSuccess(false)
    } finally {
      setRetryModalBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      modalHeading="Retry Failed Jobs & Tasks"
      primaryButtonText={retryModalBusy ? 'Retrying...' : (retryModalSuccess ? 'Done' : 'Retry')}
      secondaryButtonText="Cancel"
      onRequestClose={() => !retryModalBusy && onClose()}
      onRequestSubmit={handleSubmit}
    >
      {retryModalSuccess && (
        <InlineNotification
          kind="success"
          title="Retry submitted successfully"
          subtitle="The selected items have been queued for retry."
          lowContrast
          hideCloseButton
          style={{ marginBottom: 'var(--spacing-3)' }}
        />
      )}
      {retryModalError && (
        <InlineNotification
          kind="error"
          title="Retry failed"
          subtitle={retryModalError}
          lowContrast
          onCloseButtonClick={() => setRetryModalError(null)}
          style={{ marginBottom: 'var(--spacing-3)' }}
        />
      )}
      {(retryJobsQLoading || retryExtTasksQLoading) ? (
        <div>Loading failed items...</div>
      ) : retryJobsQError || retryExtTasksQError ? (
        <InlineNotification
          kind="error"
          title="Failed to load retry items"
          subtitle={String(retryJobsQError || retryExtTasksQError)}
          lowContrast
          hideCloseButton
        />
      ) : allRetryItems.length === 0 ? (
        <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
          There are currently no failed jobs or external tasks for this process instance.
        </div>
      ) : (
        <div style={{ maxHeight: 320, overflow: 'auto', display: 'grid', gap: 'var(--spacing-3)' }}>
          <div>
            <p style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--spacing-2)' }}>
              Select which items to retry and optionally set a new due date for jobs. External tasks will be retried immediately when their worker polls next.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: 'var(--text-12)' }}>
                <input
                  type="radio"
                  name="retry-due-mode"
                  value="keep"
                  checked={retryDueMode === 'keep'}
                  onChange={() => setRetryDueMode('keep')}
                />
                <span>Keep existing due dates</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: 'var(--text-12)' }}>
                <input
                  type="radio"
                  name="retry-due-mode"
                  value="set"
                  checked={retryDueMode === 'set'}
                  onChange={() => setRetryDueMode('set')}
                />
                <span>Set new due date/time for selected jobs</span>
                <input
                  type="datetime-local"
                  value={retryDueInput}
                  onChange={(e) => setRetryDueInput(e.target.value)}
                  disabled={retryDueMode !== 'set'}
                  style={{ fontSize: 'var(--text-12)' }}
                />
              </label>
            </div>
          </div>
          <div>
            <table className="cds--data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>
                    <Checkbox
                      id="retry-sel-all"
                      labelText=""
                      checked={allRetryItems.length > 0 && allRetryItems.every(item => retrySelectionMap[item.id])}
                      indeterminate={allRetryItems.some(item => retrySelectionMap[item.id]) && !allRetryItems.every(item => retrySelectionMap[item.id])}
                      onChange={(_: unknown, { checked }: { checked: boolean }) => {
                        const next: Record<string, boolean> = {}
                        for (const item of allRetryItems) {
                          if (item && item.id) next[item.id] = !!checked
                        }
                        setRetrySelectionMap(next)
                      }}
                    />
                  </th>
                  <th>Type</th>
                  <th>ID</th>
                  <th>Activity</th>
                  <th>Retries</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {allRetryItems.map((item: any) => {
                  const itemId = item.id
                  const itemLabel = item.itemType === 'job' ? 'Job' : 'Ext Task'
                  return (
                    <tr key={itemId}>
                      <td>
                        <Checkbox
                          id={`retry-item-${itemId}`}
                          labelText=""
                          checked={!!retrySelectionMap[itemId]}
                          onChange={(_: unknown, { checked }: { checked: boolean }) =>
                            setRetrySelectionMap((prev) => ({ ...prev, [itemId]: !!checked }))
                          }
                        />
                      </td>
                      <td>{itemLabel}</td>
                      <td title={itemId}>{itemId.length > 12 ? `${itemId.substring(0, 8)}...` : itemId}</td>
                      <td>{item.activityId || '-'}</td>
                      <td>{typeof item.retries === 'number' ? item.retries : '-'}</td>
                      <td title={item.exceptionMessage || item.errorMessage || item.errorDetails || ''}>
                        {(item.exceptionMessage || item.errorMessage || item.errorDetails || '').substring(0, 50)}
                        {(item.exceptionMessage || item.errorMessage || item.errorDetails || '').length > 50 ? '...' : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
