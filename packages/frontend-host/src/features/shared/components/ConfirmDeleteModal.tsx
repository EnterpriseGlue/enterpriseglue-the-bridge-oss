import React from 'react'
import ConfirmModal from '../../../shared/components/ConfirmModal'

/**
 * Legacy wrapper for ConfirmDeleteModal
 * Maintained for backward compatibility
 * New code should use ConfirmModal directly
 */
export default function ConfirmDeleteModal({ 
  open, 
  title, 
  description, 
  dangerLabel, 
  onCancel, 
  onConfirm, 
  busy 
}: { 
  open: boolean
  title: string
  description: string
  dangerLabel: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
  busy?: boolean 
}) {
  return (
    <ConfirmModal
      open={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      title={title}
      description={description}
      confirmText={dangerLabel}
      danger
      busy={busy}
      showWarning
    />
  )
}
