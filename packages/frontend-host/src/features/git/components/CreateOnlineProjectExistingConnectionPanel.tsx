import React from 'react'

export type ExistingRepoInfo = {
  providerId?: string | null
  remoteUrl?: string | null
  defaultBranch?: string | null
}

interface ExistingConnectionPanelProps {
  existingRepo: ExistingRepoInfo | null
  providerName?: string
}

export function CreateOnlineProjectExistingConnectionPanel({
  existingRepo,
  providerName,
}: ExistingConnectionPanelProps) {
  return (
    <div
      style={{
        padding: 'var(--spacing-4)',
        backgroundColor: 'var(--cds-layer-01)',
        borderRadius: '4px',
        border: '1px solid var(--cds-border-subtle-01)',
        display: 'grid',
        gap: 'var(--spacing-3)',
      }}
    >
      <div style={{ fontWeight: 500 }}>Current connection</div>
      <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>Provider</div>
      <div style={{ fontSize: '14px' }}>{providerName || existingRepo?.providerId || '—'}</div>
      <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>Remote URL</div>
      <code style={{ fontSize: '12px', wordBreak: 'break-all' }}>{existingRepo?.remoteUrl || '—'}</code>
      <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>Branch</div>
      <div style={{ fontSize: '14px' }}>{existingRepo?.defaultBranch || 'main'}</div>
      <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)' }}>
        To change the repository connection, disconnect Git from the project and connect again.
      </div>
    </div>
  )
}
