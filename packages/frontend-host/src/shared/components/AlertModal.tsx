import React from 'react'
import { Modal } from '@carbon/react'

interface AlertModalProps {
  open: boolean
  onClose: () => void
  title?: string
  message: string
  kind?: 'error' | 'warning' | 'info'
}

/**
 * Reusable alert modal component to replace browser alert()
 * Uses Carbon Design System Modal for consistent look and feel
 */
export default function AlertModal({ open, onClose, title, message, kind = 'info' }: AlertModalProps) {
  const getTitle = () => {
    if (title) return title
    switch (kind) {
      case 'error': return 'Error'
      case 'warning': return 'Warning'
      case 'info': return 'Information'
      default: return 'Alert'
    }
  }

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      modalHeading={getTitle()}
      primaryButtonText="OK"
      onRequestSubmit={onClose}
      size="sm"
      danger={kind === 'error'}
    >
      <p style={{ marginBottom: 'var(--spacing-5)' }}>{message}</p>
    </Modal>
  )
}
