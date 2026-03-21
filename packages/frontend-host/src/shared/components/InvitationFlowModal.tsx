import React, { ReactNode } from 'react'
import { Button, ComposedModal, ModalBody, ModalFooter, ModalHeader } from '@carbon/react'

interface InvitationFlowModalProps {
  open: boolean
  onClose: () => void
  title: string
  label?: string
  children: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg'
  dataAttribute?: string
  revealMode?: boolean
  onSubmit?: () => void | Promise<void>
  submitText?: string
  submitDisabled?: boolean
  busy?: boolean
  busyText?: string
  cancelText?: string
  revealPrimaryText?: string
  revealSecondaryText?: string
  onRevealPrimary?: () => void
  onRevealSecondary?: () => void
}

export default function InvitationFlowModal({
  open,
  onClose,
  title,
  label,
  children,
  size = 'sm',
  dataAttribute,
  revealMode = false,
  onSubmit,
  submitText = 'Create invitation',
  submitDisabled = false,
  busy = false,
  busyText = 'Processing...',
  cancelText = 'Cancel',
  revealPrimaryText = 'Done',
  revealSecondaryText = 'Create another',
  onRevealPrimary,
  onRevealSecondary,
}: InvitationFlowModalProps) {
  const modalProps = dataAttribute ? { [dataAttribute]: true } : {}

  return (
    <ComposedModal open={open} size={size} onClose={onClose} {...modalProps}>
      <ModalHeader label={label} title={title} closeModal={onClose} />
      <ModalBody style={{ overflow: 'visible', paddingBottom: 'var(--spacing-7)' }}>
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          {children}
        </div>
      </ModalBody>
      <ModalFooter>
        {revealMode ? (
          <>
            <Button kind="secondary" onClick={onRevealSecondary}>
              {revealSecondaryText}
            </Button>
            <Button kind="primary" onClick={onRevealPrimary}>
              {revealPrimaryText}
            </Button>
          </>
        ) : (
          <>
            <Button kind="secondary" onClick={onClose}>
              {cancelText}
            </Button>
            <Button kind="primary" disabled={busy || submitDisabled} onClick={() => onSubmit?.()}>
              {busy ? busyText : submitText}
            </Button>
          </>
        )}
      </ModalFooter>
    </ComposedModal>
  )
}
