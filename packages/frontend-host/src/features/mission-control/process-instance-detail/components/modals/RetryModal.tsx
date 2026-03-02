import React from 'react'
import { Modal, InlineNotification, Checkbox } from '@carbon/react'

interface RetryModalProps {
  open: boolean
  retryBusy: boolean
  retryActivityFilter: string | null
  filteredRetryItems: any[]
  retrySelectionMap: Record<string, boolean>
  retryDueMode: 'keep' | 'set'
  retryDueInput: string
  onClose: () => void
  onSubmit: () => void
  onActivityFilterClear: () => void
  onDueModeChange: (mode: 'keep' | 'set') => void
  onDueInputChange: (value: string) => void
  onSelectionChange: (selectionMap: Record<string, boolean>) => void
}

/**
 * Modal for retrying failed jobs and external tasks
 * Allows selection of items to retry and optional due date configuration
 */
export function RetryModal({
  open,
  retryBusy,
  retryActivityFilter,
  filteredRetryItems,
  retrySelectionMap,
  retryDueMode,
  retryDueInput,
  onClose,
  onSubmit,
  onActivityFilterClear,
  onDueModeChange,
  onDueInputChange,
  onSelectionChange,
}: RetryModalProps) {
  if (!open) return null

  const allSelected = filteredRetryItems.length > 0 && filteredRetryItems.every(item => retrySelectionMap[item.id])
  const someSelected = filteredRetryItems.some(item => retrySelectionMap[item.id]) && !allSelected

  const handleSelectAll = (checked: boolean) => {
    const next: Record<string, boolean> = {}
    for (const item of filteredRetryItems) {
      if (item?.id) next[item.id] = checked
    }
    onSelectionChange(next)
  }

  const handleItemToggle = (itemId: string, checked: boolean) => {
    onSelectionChange({ ...retrySelectionMap, [itemId]: checked })
  }

  return (
    <Modal
      open={open}
      modalHeading="Retry Failed Jobs & Tasks"
      primaryButtonText={retryBusy ? 'Retrying...' : 'Retry'}
      secondaryButtonText="Cancel"
      onRequestClose={() => !retryBusy && onClose()}
      onRequestSubmit={onSubmit}
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
        {retryActivityFilter && (
          <InlineNotification
            kind="info"
            title={`Filtered to activity: ${retryActivityFilter}`}
            subtitle="Only showing failed items for this activity. Clear filter to see all."
            lowContrast
            onCloseButtonClick={onActivityFilterClear}
          />
        )}
        <div>
          <p style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--spacing-2)' }}>
            Select which items to retry and optionally set a new due date for jobs. External tasks will be retried when their worker polls next.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: 'var(--text-12)' }}>
              <input
                type="radio"
                name="retry-due-mode"
                value="keep"
                checked={retryDueMode === 'keep'}
                onChange={() => onDueModeChange('keep')}
              />
              <span>Keep existing due dates</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: 'var(--text-12)' }}>
              <input
                type="radio"
                name="retry-due-mode"
                value="set"
                checked={retryDueMode === 'set'}
                onChange={() => onDueModeChange('set')}
              />
              <span>Set new due date/time for jobs</span>
              <input
                type="datetime-local"
                value={retryDueInput}
                onChange={(e) => onDueInputChange(e.target.value)}
                disabled={retryDueMode !== 'set'}
                style={{ fontSize: 'var(--text-12)' }}
              />
            </label>
          </div>
        </div>
        <div style={{ maxHeight: 320, overflow: 'auto' }}>
          {filteredRetryItems.length === 0 ? (
            <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
              No failed items found{retryActivityFilter ? ' for this activity' : ''}.
            </div>
          ) : (
            <table className="cds--data-table" style={{ width: '100%', fontSize: 'var(--text-13)' }}>
              <thead>
                <tr>
                  <th>
                    <Checkbox
                      id="retry-sel-all"
                      labelText=""
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={(_, { checked }) => handleSelectAll(!!checked)}
                    />
                  </th>
                  <th>Type</th>
                  <th>Activity</th>
                  <th>Retries</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {filteredRetryItems.map((item: any) => {
                  const itemLabel = item.itemType === 'job' ? 'Job' : 'Ext Task'
                  return (
                    <tr key={item.id}>
                      <td>
                        <Checkbox
                          id={`retry-item-${item.id}`}
                          labelText=""
                          checked={!!retrySelectionMap[item.id]}
                          onChange={(_, { checked }) => handleItemToggle(item.id, !!checked)}
                        />
                      </td>
                      <td>{itemLabel}</td>
                      <td>{item.activityId || '-'}</td>
                      <td>{typeof item.retries === 'number' ? item.retries : '-'}</td>
                      <td title={item.exceptionMessage || item.errorMessage || item.errorDetails || ''}>
                        {(item.exceptionMessage || item.errorMessage || item.errorDetails || '').substring(0, 60)}
                        {(item.exceptionMessage || item.errorMessage || item.errorDetails || '').length > 60 ? '...' : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  )
}
