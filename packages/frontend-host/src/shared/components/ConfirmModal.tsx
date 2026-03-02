import React from 'react'
import { Modal, InlineNotification } from '@carbon/react'

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  warning?: boolean
  busy?: boolean
  showWarning?: boolean
  warningMessage?: string
}

/**
 * Reusable confirmation modal component
 * Provides consistent confirmation dialogs across the application
 * 
 * @example
 * <ConfirmModal
 *   open={isOpen}
 *   onClose={closeModal}
 *   onConfirm={handleDelete}
 *   title="Delete User"
 *   description="Are you sure you want to delete this user?"
 *   confirmText="Delete"
 *   danger
 *   showWarning
 * />
 */
export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
  warning = false,
  busy = false,
  showWarning = false,
  warningMessage = 'This action cannot be undone'
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      modalHeading={title}
      primaryButtonText={busy ? 'Processing...' : confirmText}
      secondaryButtonText={cancelText}
      primaryButtonDisabled={busy}
      danger={danger}
      onRequestClose={() => !busy && onClose()}
      onRequestSubmit={async () => {
        if (!busy) await onConfirm()
      }}
      size="sm"
    >
      <div style={{ marginBottom: showWarning ? 'var(--spacing-5)' : 0, color: 'var(--color-text-primary)' }}>
        {description}
      </div>
      
      {showWarning && (
        <InlineNotification
          kind={danger ? 'error' : warning ? 'warning' : 'info'}
          lowContrast
          hideCloseButton
          subtitle={warningMessage}
          title={danger ? 'Warning' : 'Note'}
        />
      )}
    </Modal>
  )
}
