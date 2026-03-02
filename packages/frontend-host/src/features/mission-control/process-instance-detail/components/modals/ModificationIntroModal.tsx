import React from 'react'
import { Modal } from '@carbon/react'

interface ModificationIntroModalProps {
  open: boolean
  suppressIntroNext: boolean
  onSuppressChange: (checked: boolean) => void
  onClose: () => void
  onStart: () => void
}

/**
 * Introductory modal explaining modification mode functionality
 * Shown when user first enters modification mode (unless suppressed)
 */
export function ModificationIntroModal({
  open,
  suppressIntroNext,
  onSuppressChange,
  onClose,
  onStart,
}: ModificationIntroModalProps) {
  if (!open) return null

  const handleStart = () => {
    try {
      if (suppressIntroNext && typeof window !== 'undefined') {
        window.localStorage.setItem('vt_mod_intro_suppressed', '1')
      }
    } catch {}
    onStart()
  }

  return (
    <Modal
      open={open}
      modalHeading="Process Instance Modification Mode"
      primaryButtonText="Start modification mode"
      secondaryButtonText="Cancel"
      onRequestClose={onClose}
      onRequestSubmit={handleStart}
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-3)', fontSize: 'var(--text-13)' }}>
        <div>
          Modification mode lets you plan token changes on this process instance. You can add tokens before a node, cancel
          active tokens at a node, or conceptually move tokens from one node to another.
        </div>
        <div>
          Changes are only applied when you click <strong>Apply modifications</strong>. Until then, they are just a local plan
          and can be discarded safely.
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: 'var(--text-12)' }}>
          <input
            type="checkbox"
            checked={suppressIntroNext}
            onChange={(e) => onSuppressChange(e.target.checked)}
          />
          <span>Do not show this message again</span>
        </label>
      </div>
    </Modal>
  )
}
