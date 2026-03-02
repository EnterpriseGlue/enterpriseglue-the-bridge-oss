import React from 'react'
import { Modal, InlineNotification, Select, SelectItem, TextInput, Button } from '@carbon/react'
import type { BulkSyncResult, SyncDirection } from '../projectOverviewTypes'

interface ProjectOverviewBulkSyncModalProps {
  open: boolean
  bulkBusy: boolean
  bulkError: string | null
  bulkResult: BulkSyncResult | null
  bulkMessage: string
  setBulkMessage: (value: string) => void
  bulkDirection: SyncDirection
  setBulkDirection: (value: SyncDirection) => void
  bulkSyncIds: string[]
  canBulkSync: boolean
  credentialsCheckLoading: boolean
  sharingEnabled: boolean
  pushEnabled: boolean
  pullEnabled: boolean
  onClose: () => void
  onSubmit: () => void
  onClearError: () => void
  onConnectCredentials: () => void
}

export function ProjectOverviewBulkSyncModal({
  open,
  bulkBusy,
  bulkError,
  bulkResult,
  bulkMessage,
  setBulkMessage,
  bulkDirection,
  setBulkDirection,
  bulkSyncIds,
  canBulkSync,
  credentialsCheckLoading,
  sharingEnabled,
  pushEnabled,
  pullEnabled,
  onClose,
  onSubmit,
  onClearError,
  onConnectCredentials,
}: ProjectOverviewBulkSyncModalProps) {
  return (
    <Modal
      open={open}
      modalHeading="Sync selected projects"
      primaryButtonText={bulkBusy ? 'Syncing...' : 'Sync'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={
        bulkBusy ||
        bulkMessage.trim().length === 0 ||
        bulkSyncIds.length === 0 ||
        credentialsCheckLoading ||
        !canBulkSync
      }
      onRequestClose={onClose}
      onRequestSubmit={onSubmit}
    >
      {!sharingEnabled && !credentialsCheckLoading && !canBulkSync && (
        <InlineNotification
          kind="warning"
          title="Git credentials required"
          subtitle="This platform requires each user to connect their own Git credentials to sync."
          style={{ marginBottom: 'var(--spacing-5)' }}
          lowContrast
          hideCloseButton
        />
      )}

      {!sharingEnabled && credentialsCheckLoading && (
        <InlineNotification
          kind="info"
          title="Checking Git credentials"
          subtitle="Please wait..."
          style={{ marginBottom: 'var(--spacing-5)' }}
          lowContrast
          hideCloseButton
        />
      )}

      {bulkError && (
        <InlineNotification
          kind="error"
          title="Error"
          subtitle={bulkError}
          onCloseButtonClick={onClearError}
          style={{ marginBottom: 'var(--spacing-5)' }}
        />
      )}

      {bulkResult && bulkResult.failed.length > 0 && (
        <InlineNotification
          kind="error"
          title="Some projects failed to sync"
          subtitle={`${bulkResult.succeeded.length} succeeded, ${bulkResult.failed.length} failed, ${bulkResult.skipped.length} skipped`}
          style={{ marginBottom: 'var(--spacing-5)' }}
        />
      )}

      {bulkResult && bulkResult.failed.length === 0 && (bulkResult.succeeded.length > 0 || bulkResult.skipped.length > 0) && (
        <InlineNotification
          kind="success"
          title="Sync started"
          subtitle={`${bulkResult.succeeded.length} succeeded, ${bulkResult.skipped.length} skipped`}
          style={{ marginBottom: 'var(--spacing-5)' }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        {!sharingEnabled && !credentialsCheckLoading && !canBulkSync && (
          <div>
            <Button kind="secondary" size="sm" onClick={onConnectCredentials}>
              Connect Git credentials
            </Button>
          </div>
        )}

        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          Selected: {bulkSyncIds.length}
        </div>

        <Select
          id="bulk-sync-direction"
          labelText="Sync direction"
          value={bulkDirection}
          onChange={(e) => setBulkDirection(e.target.value as SyncDirection)}
          disabled={bulkBusy}
        >
          {pushEnabled && <SelectItem value="push" text="Push" />}
          {pullEnabled && <SelectItem value="pull" text="Pull" />}
        </Select>

        <InlineNotification
          kind="info"
          title="First sync note"
          subtitle="Projects syncing for the first time will push all files, which may take a moment."
          lowContrast
          hideCloseButton
          style={{ marginBottom: 0 }}
        />

        <TextInput
          id="bulk-sync-message"
          labelText="Commit message"
          value={bulkMessage}
          onChange={(e) => setBulkMessage(e.target.value)}
          disabled={bulkBusy}
        />

        {bulkResult?.failed?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
            {bulkResult.failed.slice(0, 5).map((f) => (
              <div key={f.id} style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {f.name}: {f.error}
              </div>
            ))}
            {bulkResult.failed.length > 5 && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                And {bulkResult.failed.length - 5} more…
              </div>
            )}
          </div>
        ) : null}

        {bulkResult?.skipped?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
            {bulkResult.skipped.slice(0, 5).map((s) => (
              <div key={s.id} style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                {s.name}: {s.reason}
              </div>
            ))}
            {bulkResult.skipped.length > 5 && (
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                And {bulkResult.skipped.length - 5} more…
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
