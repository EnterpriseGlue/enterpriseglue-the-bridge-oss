import React from 'react'
import ConfirmModal from '../../../../../shared/components/ConfirmModal'

interface BulkOperationModalsProps {
  // Bulk Retry
  bulkRetryOpen: boolean
  bulkRetryBusy: boolean
  onBulkRetryClose: () => void
  onBulkRetryConfirm: () => Promise<void>
  selectedCount: number
  
  // Bulk Delete
  bulkDeleteOpen: boolean
  bulkDeleteBusy: boolean
  onBulkDeleteClose: () => void
  onBulkDeleteConfirm: () => Promise<void>
  
  // Bulk Suspend
  bulkSuspendOpen: boolean
  bulkSuspendBusy: boolean
  onBulkSuspendClose: () => void
  onBulkSuspendConfirm: () => Promise<void>
  
  // Bulk Activate
  bulkActivateOpen: boolean
  bulkActivateBusy: boolean
  onBulkActivateClose: () => void
  onBulkActivateConfirm: () => Promise<void>
  
  // Terminate
  terminateOpen: boolean
  onTerminateClose: () => void
  onTerminateConfirm: () => Promise<void>
}

export function BulkOperationModals({
  bulkRetryOpen,
  bulkRetryBusy,
  onBulkRetryClose,
  onBulkRetryConfirm,
  selectedCount,
  bulkDeleteOpen,
  bulkDeleteBusy,
  onBulkDeleteClose,
  onBulkDeleteConfirm,
  bulkSuspendOpen,
  bulkSuspendBusy,
  onBulkSuspendClose,
  onBulkSuspendConfirm,
  bulkActivateOpen,
  bulkActivateBusy,
  onBulkActivateClose,
  onBulkActivateConfirm,
  terminateOpen,
  onTerminateClose,
  onTerminateConfirm,
}: BulkOperationModalsProps) {
  return (
    <>
      {/* Bulk Retry Modal */}
      <ConfirmModal
        open={bulkRetryOpen}
        onClose={onBulkRetryClose}
        onConfirm={onBulkRetryConfirm}
        title="Set Job Retries"
        description={`About to retry ${selectedCount} instance${selectedCount === 1 ? '' : 's'}. All failed jobs and external tasks will be retried once. A batch operation will be created and processed asynchronously.`}
        confirmText="Apply"
        busy={bulkRetryBusy}
      />

      {/* Bulk Delete Modal */}
      <ConfirmModal
        open={bulkDeleteOpen}
        onClose={onBulkDeleteClose}
        onConfirm={onBulkDeleteConfirm}
        title="Cancel Process Instances"
        description={`About to cancel ${selectedCount} instance${selectedCount === 1 ? '' : 's'}. In case there are called instances, these will be canceled too.`}
        confirmText="Apply"
        danger
        busy={bulkDeleteBusy}
        showWarning
        warningMessage="This action cannot be undone"
      />

      {/* Bulk Suspend Modal */}
      <ConfirmModal
        open={bulkSuspendOpen}
        onClose={onBulkSuspendClose}
        onConfirm={onBulkSuspendConfirm}
        title="Suspend Process Instances"
        description={`${selectedCount} instance${selectedCount === 1 ? '' : 's'} selected for suspend operation. A batch operation will be created and processed asynchronously.`}
        confirmText="Apply"
        busy={bulkSuspendBusy}
      />

      {/* Bulk Activate Modal */}
      <ConfirmModal
        open={bulkActivateOpen}
        onClose={onBulkActivateClose}
        onConfirm={onBulkActivateConfirm}
        title="Activate Process Instances"
        description={`${selectedCount} instance${selectedCount === 1 ? '' : 's'} selected for activate operation. A batch operation will be created and processed asynchronously.`}
        confirmText="Apply"
        busy={bulkActivateBusy}
      />

      {/* Terminate Confirmation Modal */}
      <ConfirmModal
        open={terminateOpen}
        onClose={onTerminateClose}
        onConfirm={onTerminateConfirm}
        title="Cancel Process Instance"
        description="Are you sure you want to cancel this process instance? This action cannot be undone."
        confirmText="Cancel Instance"
        danger
        showWarning
        warningMessage="This action cannot be undone"
      />
    </>
  )
}
