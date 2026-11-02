import React from 'react'
import { Modal, TextArea, InlineLoading, InlineNotification } from '@carbon/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { useAuth } from '../../../shared/hooks/useAuth'
import { ProjectPermission } from '../../../shared/auth/permissions'
import { permissionSnapshotAuthorityKey } from '../../../contexts/authSessionPermissions'
import { getBrowserSessionRevision } from '../../../utils/browserSession'
import { evaluateActionSnapshot } from '../../../shared/auth/guards'

interface CommitModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  fileId?: string // If provided, only commit this file
  saveMode?: 'git' | 'local'
  onSuccess?: () => void
  beforeSubmit?: () => void | Promise<void>
  defaultMessage?: string
  hotfixFromCommitId?: string
  hotfixFromFileVersion?: number
}

interface CommitIntent {
  projectId: string
  fileId?: string
  saveMode: 'git' | 'local'
  message: string
  hotfixFromCommitId?: string
  hotfixFromFileVersion?: number
  assertCurrent: () => void
  isCurrent: () => boolean
}

export default function CommitModal({ open, onClose, projectId, fileId, saveMode = 'git', onSuccess, beforeSubmit, defaultMessage, hotfixFromCommitId, hotfixFromFileVersion }: CommitModalProps) {
  const [message, setMessage] = React.useState('')
  const { permissions, hasProjectPermission, user, sessionRevision } = useAuth()
  const createVersionActionId = saveMode === 'local' ? 'project.versions.create' : 'project.vcs.commit.create'
  const createVersionDecision = evaluateActionSnapshot(
    permissions,
    createVersionActionId,
    { type: 'project', id: projectId }
  )
  const canCreateVersion = createVersionDecision.allowed ||
    hasProjectPermission(projectId, ProjectPermission.VERSIONS_CREATE)
  const createVersionUnavailableReason = canCreateVersion
    ? null
    : createVersionDecision.reason || `Missing permission ${ProjectPermission.VERSIONS_CREATE}`

  const [preparing, setPreparing] = React.useState(false)
  const [preSubmitError, setPreSubmitError] = React.useState<string | null>(null)
  const queryClient = useQueryClient()
  const scope = JSON.stringify([open, projectId, fileId, saveMode, hotfixFromCommitId, hotfixFromFileVersion,
    createVersionUnavailableReason, user?.session?.principal.id || user?.id || null,
    user?.session?.tenant.id || null, sessionRevision ?? null, permissionSnapshotAuthorityKey(permissions)])
  const scopeRef = React.useRef(scope)
  const lifetimeRef = React.useRef(0)
  const activeAttemptRef = React.useRef<number | null>(null)
  const submittedRef = React.useRef<number | null>(null)
  const defaultMessageRef = React.useRef(defaultMessage)
  defaultMessageRef.current = defaultMessage
  if (scopeRef.current !== scope) {
    scopeRef.current = scope
    lifetimeRef.current += 1
  }
  React.useEffect(() => () => { lifetimeRef.current += 1 }, [])
  React.useEffect(() => {
    setMessage(open ? defaultMessageRef.current || '' : '')
    setPreSubmitError(null)
    setPreparing(false)
  }, [scope, open])
  React.useEffect(() => {
    if (open && defaultMessage) setMessage(current => current || defaultMessage)
  }, [open, defaultMessage])

  const commitMutation = useMutation({
    mutationFn: async (intent: CommitIntent) => {
      intent.assertCurrent()
      if (intent.saveMode === 'local') {
        if (!intent.fileId) throw new Error('Missing fileId for local version save')
        const result = await apiClient.post<{ id?: string }>(
          `/starbase-api/files/${encodeURIComponent(intent.fileId)}/versions`, { message: intent.message })
        if (typeof result?.id !== 'string' || !result.id.trim()) throw new Error('Saved version was not verified')
        return result
      }
      const body: { message: string; fileIds?: string[]; hotfixFromCommitId?: string; hotfixFromFileVersion?: number } = { message: intent.message }
      if (intent.fileId !== undefined) body.fileIds = [intent.fileId]
      if (intent.hotfixFromCommitId) body.hotfixFromCommitId = intent.hotfixFromCommitId
      if (typeof intent.hotfixFromFileVersion === 'number') body.hotfixFromFileVersion = intent.hotfixFromFileVersion
      const result = await apiClient.post<{ commitId?: string }>(`/vcs-api/projects/${encodeURIComponent(intent.projectId)}/commit`, body)
      if (typeof result?.commitId !== 'string' || !result.commitId.trim()) throw new Error('Saved version was not verified')
      return result
    },
    onSuccess: (_data, intent) => {
      if (!intent.isCurrent()) return
      const { projectId, fileId, saveMode } = intent
      setMessage('')
      if (saveMode === 'git') {
        queryClient.setQueryData(['uncommitted-files', projectId, 'draft'], (prev: any) => {
          if (!prev) return prev
          const prevIds = Array.isArray(prev.uncommittedFileIds) ? prev.uncommittedFileIds : []
          const nextIds = fileId ? prevIds.filter((id: any) => id !== fileId) : []
          return { ...prev, uncommittedFileIds: nextIds, hasUncommittedChanges: nextIds.length > 0 }
        })
      }
      onSuccess?.()
      if (!intent.isCurrent()) return
      if (saveMode === 'local') {
        if (fileId) {
          queryClient.invalidateQueries({ queryKey: ['versions', fileId] })
          queryClient.invalidateQueries({ queryKey: ['versions-panel', 'local', projectId, fileId] })
          queryClient.refetchQueries({ queryKey: ['versions-panel', 'local', projectId, fileId], type: 'active' })
        }
      } else {
        queryClient.invalidateQueries({ queryKey: ['versions-panel', 'git', projectId, fileId] })
        queryClient.refetchQueries({ queryKey: ['versions-panel', 'git', projectId, fileId], type: 'active' })
        queryClient.invalidateQueries({ queryKey: ['vcs', 'latest-file-commit', projectId, fileId] })
        queryClient.invalidateQueries({ queryKey: ['uncommitted-files', projectId, 'draft'] })
      }
      onClose()
    },
  })
  const ownsAttempt = submittedRef.current === lifetimeRef.current
  const isSaving = ownsAttempt && (commitMutation.isPending || preparing)
  const currentError = ownsAttempt ? preSubmitError || (commitMutation.isError ? parseApiError(commitMutation.error, 'Failed to save version').message : null) : null

  const handleSubmit = async () => {
    if (!open || isSaving || activeAttemptRef.current === lifetimeRef.current) return
    const lifetime = lifetimeRef.current
    const session = getBrowserSessionRevision()
    const isCurrent = () => lifetime === lifetimeRef.current && session === getBrowserSessionRevision()
    submittedRef.current = lifetime
    commitMutation.reset()
    if (createVersionUnavailableReason) { setPreSubmitError(createVersionUnavailableReason); return }
    if ((saveMode === 'local' || fileId !== undefined) && (typeof fileId !== 'string' || !fileId.trim())) {
      setPreSubmitError('Missing fileId for file version save'); return
    }
    const intent: CommitIntent = {
      projectId, fileId, saveMode, message: message.trim() || 'Version', hotfixFromCommitId, hotfixFromFileVersion, isCurrent,
      assertCurrent: () => { if (!isCurrent()) throw new Error('Version context changed; review the target again') },
    }
    activeAttemptRef.current = lifetime
    setPreparing(true)
    setPreSubmitError(null)
    let prepared = false
    try {
      await beforeSubmit?.()
      intent.assertCurrent()
      prepared = true
      setPreparing(false)
      await commitMutation.mutateAsync(intent)
    } catch (error) {
      if (isCurrent() && !prepared) setPreSubmitError(error instanceof Error ? error.message : 'Failed to prepare version')
    } finally {
      if (isCurrent()) { setPreparing(false); activeAttemptRef.current = null }
    }
  }

  const handleClose = () => {
    // Closing cancels the continuation; already-issued HTTP writes may settle.
    lifetimeRef.current += 1
    setMessage('')
    setPreSubmitError(null)
    setPreparing(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onRequestClose={handleClose}
      onRequestSubmit={handleSubmit}
      modalHeading="Create Version"
      primaryButtonText={isSaving ? 'Saving...' : 'Create'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={isSaving || Boolean(createVersionUnavailableReason)}
      size="sm"
    >
      <div style={{ marginBottom: 'var(--spacing-4)' }}>
        <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
          {fileId 
            ? 'Save a version of this file that you can restore later.'
            : 'Save a version of all files that you can restore later.'
          }
        </p>

        {createVersionUnavailableReason && (
          <InlineNotification
            kind="warning"
            title="Create version unavailable"
            subtitle={createVersionUnavailableReason}
            lowContrast
            hideCloseButton
            style={{ marginBottom: 'var(--spacing-3)' }}
          />
        )}
        
        <TextArea
          id="commit-message"
          labelText="Version description (optional but recommended)"
          placeholder="Describe your changes..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          disabled={isSaving || Boolean(createVersionUnavailableReason)}
        />
        
        {currentError && (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-12)', marginTop: 'var(--spacing-2)' }}>
            {currentError}
          </p>
        )}
        
        {isSaving && (
          <div style={{ marginTop: 'var(--spacing-2)' }}>
            <InlineLoading description="Saving version..." />
          </div>
        )}
      </div>
    </Modal>
  )
}
