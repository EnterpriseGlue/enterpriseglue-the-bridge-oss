import React from 'react'
import { InlineNotification, Modal, TextArea } from '@carbon/react'

interface TerminateConfirmModalProps {
  open: boolean
  instanceId: string
  onClose: () => void
  onTerminate: (instanceId: string, reason: string) => Promise<void>
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
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) setReason('')
  }, [open])

  if (!open) return null

  const reasonValue = reason.trim()
  const reasonMissing = reasonValue.length === 0

  const handleTerminate = async () => {
    if (reasonMissing) return
    try {
      await onTerminate(instanceId, reasonValue)
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
      primaryButtonDisabled={reasonMissing}
      onRequestClose={onClose}
      onRequestSubmit={handleTerminate}
    >
      <p>Are you sure you want to cancel this process instance?</p>
      <p style={{ marginTop: 'var(--spacing-3)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
        This action cannot be undone. The instance will be canceled.
      </p>
      <div style={{ marginTop: 'var(--spacing-4)' }}>
        <TextArea
          id="terminate-reason"
          labelText="Cancel reason"
          placeholder="e.g., Duplicate process instance started by mistake."
          value={reason}
          rows={3}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setReason(event.target.value)}
        />
      </div>
      {reasonMissing ? (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Reason required"
          subtitle="A cancel reason is required before this action can be submitted."
        />
      ) : null}
    </Modal>
  )
}
