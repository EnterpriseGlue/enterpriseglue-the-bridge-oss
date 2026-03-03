import React from 'react'
import { Modal } from '@carbon/react'

interface TerminateConfirmModalProps {
  open: boolean
  instanceId: string
  onClose: () => void
  onTerminate: (instanceId: string) => Promise<void>
}

/**
 * Confirmation modal for terminating a process instance
 * Warns user that this action is permanent and cannot be undone
 */
export function TerminateConfirmModal({
  open,
  instanceId,
  onClose,
  onTerminate,
}: TerminateConfirmModalProps) {
  if (!open) return null

  const handleTerminate = async () => {
    try {
      await onTerminate(instanceId)
      onClose()
      // Navigate back to process list after successful termination
      window.history.back()
    } catch (e) {
      console.error('Failed to terminate instance:', e)
    }
  }

  return (
    <Modal
      open={open}
      danger
      modalHeading="Cancel Process Instance"
      primaryButtonText="Cancel Instance"
      secondaryButtonText="Close"
      onRequestClose={onClose}
      onRequestSubmit={handleTerminate}
    >
      <p>Are you sure you want to cancel this process instance?</p>
      <p style={{ marginTop: 'var(--spacing-3)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
        This action cannot be undone. The instance will be canceled.
      </p>
    </Modal>
  )
}
