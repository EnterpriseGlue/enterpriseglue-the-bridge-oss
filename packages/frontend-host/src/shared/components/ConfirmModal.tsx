import React from 'react'
import { Modal, InlineNotification, TextArea } from '@carbon/react'

interface ConfirmModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (reason?: string) => void | Promise<void>
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  warning?: boolean
  busy?: boolean
  confirmDisabled?: boolean
  disabledReason?: string | null
  showWarning?: boolean
  warningMessage?: string
  requireReason?: boolean
  reasonLabel?: string
  reasonPlaceholder?: string
  reasonDescription?: string
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
  confirmDisabled = false,
  disabledReason,
  showWarning = false,
  warningMessage = 'This action cannot be undone',
  requireReason = false,
  reasonLabel = 'Audit reason',
  reasonPlaceholder = 'Describe why this action is needed.',
  reasonDescription,
}: ConfirmModalProps) {
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) setReason('')
  }, [open])

  const reasonValue = reason.trim()
  const reasonMissing = requireReason && reasonValue.length === 0
  const primaryDisabled = busy || confirmDisabled || reasonMissing

  return (
    <Modal
      open={open}
      modalHeading={title}
      primaryButtonText={busy ? 'Processing...' : confirmText}
      secondaryButtonText={cancelText}
      primaryButtonDisabled={primaryDisabled}
      danger={danger}
      onRequestClose={() => !busy && onClose()}
      onRequestSubmit={async () => {
        if (!primaryDisabled) await onConfirm(reasonValue || undefined)
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

      {requireReason && (
        <div style={{ marginTop: 'var(--spacing-4)' }}>
          <TextArea
            id="confirm-audit-reason"
            labelText={reasonLabel}
            helperText={reasonDescription}
            placeholder={reasonPlaceholder}
            value={reason}
            rows={3}
            disabled={busy}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
          />
        </div>
      )}

      {disabledReason && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          subtitle={disabledReason}
          title="Action unavailable"
        />
      )}

      {reasonMissing && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          subtitle="An audit reason is required before this action can be submitted."
          title="Reason required"
        />
      )}
    </Modal>
  )
}
