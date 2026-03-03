import React, { ReactNode } from 'react'
import { Modal } from '@carbon/react'

interface FormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: () => void | Promise<void>
  title: string
  submitText?: string
  cancelText?: string
  busy?: boolean
  submitDisabled?: boolean
  children: ReactNode
  size?: 'xs' | 'sm' | 'md' | 'lg'
  danger?: boolean
}

/**
 * Reusable form modal component
 * Provides consistent form dialogs across the application
 * 
 * @example
 * <FormModal
 *   open={isOpen}
 *   onClose={closeModal}
 *   onSubmit={handleSubmit}
 *   title="Create User"
 *   submitText="Create"
 *   submitDisabled={!email}
 *   busy={isLoading}
 * >
 *   <TextInput
 *     id="email"
 *     labelText="Email"
 *     value={email}
 *     onChange={(e) => setEmail(e.target.value)}
 *   />
 * </FormModal>
 */
export default function FormModal({
  open,
  onClose,
  onSubmit,
  title,
  submitText = 'Submit',
  cancelText = 'Cancel',
  busy = false,
  submitDisabled = false,
  children,
  size = 'sm',
  danger = false
}: FormModalProps) {
  return (
    <Modal
      open={open}
      modalHeading={title}
      primaryButtonText={busy ? 'Processing...' : submitText}
      secondaryButtonText={cancelText}
      primaryButtonDisabled={busy || submitDisabled}
      danger={danger}
      onRequestClose={() => !busy && onClose()}
      onRequestSubmit={async () => {
        if (!busy && !submitDisabled) await onSubmit()
      }}
      size={size}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        {children}
      </div>
    </Modal>
  )
}
