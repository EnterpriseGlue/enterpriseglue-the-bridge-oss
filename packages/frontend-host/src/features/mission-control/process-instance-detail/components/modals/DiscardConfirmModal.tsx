import React from 'react'
import { Modal } from '@carbon/react'

interface DiscardConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Confirmation modal for discarding planned modifications
 * Warns user that all planned changes will be lost
 */
export function DiscardConfirmModal({
  open,
  onClose,
  onConfirm,
}: DiscardConfirmModalProps) {
  if (!open) return null

  return (
    <Modal
      open={open}
      modalHeading="Discard Modifications"
      primaryButtonText="Discard"
      secondaryButtonText="Cancel"
      danger
      onRequestClose={onClose}
      onRequestSubmit={onConfirm}
    >
      <div style={{ fontSize: 'var(--text-13)' }}>
        All planned modifications for this process instance will be discarded and modification mode will be exited.
      </div>
    </Modal>
  )
}
