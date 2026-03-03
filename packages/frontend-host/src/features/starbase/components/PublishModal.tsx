import React from 'react'
import { Modal, InlineLoading } from '@carbon/react'
import { useMutation } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'

interface PublishModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  onSuccess?: () => void
}

export default function PublishModal({ open, onClose, projectId, onSuccess }: PublishModalProps) {
  const publishMutation = useMutation({
    mutationFn: async () => {
      try {
        return await apiClient.post<{ success?: boolean }>(`/vcs-api/projects/${projectId}/publish`)
      } catch (error) {
        const parsed = parseApiError(error, 'Publish failed')
        throw new Error(parsed.message || 'Publish failed')
      }
    },
    onSuccess: () => {
      onClose()
      onSuccess?.()
    },
  })

  const handleSubmit = () => {
    publishMutation.mutate()
  }

  const handleClose = () => {
    if (publishMutation.isPending) return
    publishMutation.reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      onRequestSubmit={handleSubmit}
      modalHeading="Publish to Main"
      modalLabel="Version Control"
      primaryButtonText={publishMutation.isPending ? 'Publishing...' : 'Publish'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={publishMutation.isPending}
      size="sm"
      danger={false}
    >
      <div style={{ marginBottom: 'var(--spacing-4)' }}>
        <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
          This will merge your committed changes from your draft branch to the main branch.
        </p>
        <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-secondary)' }}>
          Other users will see these changes after publishing.
        </p>
        
        {publishMutation.isError && (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-12)', marginTop: 'var(--spacing-3)' }}>
            {publishMutation.error?.message || 'Failed to publish'}
          </p>
        )}
        
        {publishMutation.isPending && (
          <div style={{ marginTop: 'var(--spacing-3)' }}>
            <InlineLoading description="Publishing changes..." />
          </div>
        )}
      </div>
    </Modal>
  )
}
