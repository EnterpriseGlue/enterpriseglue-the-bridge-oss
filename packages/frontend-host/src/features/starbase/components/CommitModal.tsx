import React from 'react'
import { Modal, TextArea, InlineLoading } from '@carbon/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'

interface CommitModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  fileId?: string // If provided, only commit this file
  onSuccess?: () => void
  beforeSubmit?: () => void | Promise<void>
  defaultMessage?: string
  hotfixFromCommitId?: string
  hotfixFromFileVersion?: number
}

export default function CommitModal({ open, onClose, projectId, fileId, onSuccess, beforeSubmit, defaultMessage, hotfixFromCommitId, hotfixFromFileVersion }: CommitModalProps) {
  const [message, setMessage] = React.useState('')

  // Pre-fill message from defaultMessage when modal opens
  React.useEffect(() => {
    if (open && defaultMessage && !message) {
      setMessage(defaultMessage)
    }
  }, [open, defaultMessage])
  const [preparing, setPreparing] = React.useState(false)
  const [preSubmitError, setPreSubmitError] = React.useState<string | null>(null)
  const queryClient = useQueryClient()
  
  const commitMutation = useMutation({
    mutationFn: async (commitMessage: string) => {
      const body: { message: string; fileIds?: string[]; hotfixFromCommitId?: string; hotfixFromFileVersion?: number } = { message: commitMessage }
      if (fileId) {
        body.fileIds = [fileId]
      }
      if (hotfixFromCommitId) body.hotfixFromCommitId = hotfixFromCommitId
      if (typeof hotfixFromFileVersion === 'number') body.hotfixFromFileVersion = hotfixFromFileVersion
      
      try {
        return await apiClient.post<{ commitId?: string }>(`/vcs-api/projects/${projectId}/commit`, body)
      } catch (error) {
        const parsed = parseApiError(error, 'Commit failed')
        throw new Error(parsed.message || 'Commit failed')
      }
    },
    onSuccess: () => {
      setMessage('')
      // Optimistically clear uncommitted state to avoid UI briefly showing an "Unsaved version"
      // right after a successful commit.
      queryClient.setQueryData(
        ['uncommitted-files', projectId, 'draft'],
        (prev: any) => {
          if (!prev) return prev
          const prevIds = Array.isArray(prev.uncommittedFileIds) ? prev.uncommittedFileIds : []
          const nextIds = fileId ? prevIds.filter((id: any) => id !== fileId) : []
          return {
            ...prev,
            uncommittedFileIds: nextIds,
            hasUncommittedChanges: nextIds.length > 0,
          }
        }
      )
      // Let the caller clear any local dirty/edited state before we trigger refetches.
      onSuccess?.()
      // Invalidate VCS commits query to refresh the versions panel
      queryClient.invalidateQueries({ queryKey: ['vcs', 'commits', projectId] })
      queryClient.invalidateQueries({ queryKey: ['uncommitted-files', projectId, 'draft'] })
      onClose()
    },
  })

  const handleSubmit = async () => {
    if (commitMutation.isPending || preparing) return
    setPreparing(true)
    setPreSubmitError(null)
    try {
      await beforeSubmit?.()
    } catch (e) {
      // If pre-submit fails, don't create a commit.
      setPreSubmitError(e instanceof Error ? e.message : 'Failed to prepare version')
      setPreparing(false)
      return
    }
    setPreparing(false)
    commitMutation.mutate(message.trim() || 'Version')
  }

  const handleClose = () => {
    if (commitMutation.isPending || preparing) return
    setMessage('')
    setPreSubmitError(null)
    commitMutation.reset()
    setPreparing(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      onRequestSubmit={handleSubmit}
      modalHeading="Create Version"
      primaryButtonText={(commitMutation.isPending || preparing) ? 'Saving...' : 'Create'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={commitMutation.isPending || preparing}
      size="sm"
    >
      <div style={{ marginBottom: 'var(--spacing-4)' }}>
        <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
          {fileId 
            ? 'Save a version of this file that you can restore later.'
            : 'Save a version of all files that you can restore later.'
          }
        </p>
        
        <TextArea
          id="commit-message"
          labelText="Version description (optional but recommended)"
          placeholder="Describe your changes..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          disabled={commitMutation.isPending || preparing}
        />
        
        {(preSubmitError || commitMutation.isError) && (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-12)', marginTop: 'var(--spacing-2)' }}>
            {preSubmitError || commitMutation.error?.message || 'Failed to save version'}
          </p>
        )}
        
        {(commitMutation.isPending || preparing) && (
          <div style={{ marginTop: 'var(--spacing-2)' }}>
            <InlineLoading description="Saving version..." />
          </div>
        )}
      </div>
    </Modal>
  )
}
