import React, { useState } from 'react'
import { Modal, Button, Tag, Checkbox, Toggletip, ToggletipButton, ToggletipContent, InlineNotification, TextArea } from '@carbon/react'
import { Information } from '@carbon/icons-react'
import { ExecutionOptionsPanel } from '../../../shared/components/ExecutionOptionsPanel'

interface ApplyMigrationModalProps {
  open: boolean
  instanceCount: number
  instructionCount: number
  mappedCount: number
  unmappedCount: number
  unmappedWithActiveTokens: number
  affectedCount: number | undefined
  variableCount: number
  skipCustomListeners: boolean
  onSkipCustomListenersChange: (checked: boolean) => void
  skipIoMappings: boolean
  onSkipIoMappingsChange: (checked: boolean) => void
  updateEventTriggers: boolean
  onUpdateEventTriggersChange: (checked: boolean) => void
  eventInstructionCount: number
  payload: any
  onClose: () => void
  onExecuteBatch: (auditReason: string) => void
  onExecuteDirect: (auditReason: string) => void
  batchPending: boolean
  directPending: boolean
  batchDeniedReason?: string | null
  directDeniedReason?: string | null
}

export function ApplyMigrationModal({
  open,
  instanceCount,
  instructionCount,
  mappedCount,
  unmappedCount,
  unmappedWithActiveTokens,
  affectedCount,
  variableCount,
  skipCustomListeners,
  onSkipCustomListenersChange,
  skipIoMappings,
  onSkipIoMappingsChange,
  updateEventTriggers,
  onUpdateEventTriggersChange,
  eventInstructionCount,
  payload,
  onClose,
  onExecuteBatch,
  onExecuteDirect,
  batchPending,
  directPending,
  batchDeniedReason,
  directDeniedReason,
}: ApplyMigrationModalProps) {
  const [showPayload, setShowPayload] = useState(false)
  const [auditReason, setAuditReason] = useState('')
  const busy = batchPending || directPending
  const batchUnavailableReason = batchDeniedReason || null
  const directUnavailableReason = directDeniedReason || null
  const auditReasonValue = auditReason.trim()
  const auditReasonMissing = auditReasonValue.length === 0

  if (!open) return null

  return (
    <Modal
      open={open}
      modalHeading="Review & Execute Migration"
      primaryButtonText={batchPending ? 'Creating batch...' : 'Create migration batch'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={busy || !!batchUnavailableReason || auditReasonMissing}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (batchUnavailableReason || auditReasonMissing) return
        onExecuteBatch(auditReasonValue)
      }}
      size="md"
      hasScrollingContent
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-4)', fontSize: 'var(--text-13)' }}>
        {(batchUnavailableReason || directUnavailableReason) && (
          <InlineNotification
            lowContrast
            kind="warning"
            title="Execution mode unavailable"
            subtitle={[batchUnavailableReason, directUnavailableReason].filter(Boolean).join(' ')}
          />
        )}

        <div>
          <div style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>Summary</div>
          <div style={{ display: 'grid', gap: 'var(--spacing-1)', fontSize: 'var(--text-12)' }}>
            <div>Instances selected: <strong>{instanceCount}</strong></div>
            <div>Affected instances: <strong>{affectedCount ?? '—'}</strong></div>
            <div>Plan instructions: <strong>{instructionCount}</strong></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
              Mapped: <Tag size="sm" type="green">{mappedCount}</Tag>
              Unmapped: <Tag size="sm" type={unmappedCount > 0 ? 'red' : 'gray'}>{unmappedCount}</Tag>
            </div>
            {unmappedWithActiveTokens > 0 && (
              <div style={{ color: 'var(--cds-support-error, #da1e28)', fontSize: 'var(--text-12)', marginTop: 'var(--spacing-1)' }}>
                Warning: {unmappedWithActiveTokens} unmapped instruction{unmappedWithActiveTokens === 1 ? '' : 's'} with active tokens. Tokens will be lost during migration.
              </div>
            )}
            {variableCount > 0 && (
              <div>Variables: <strong>{variableCount}</strong></div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Options</div>
          <ExecutionOptionsPanel
            skipCustomListeners={skipCustomListeners}
            onSkipCustomListenersChange={onSkipCustomListenersChange}
            skipIoMappings={skipIoMappings}
            onSkipIoMappingsChange={onSkipIoMappingsChange}
            idPrefix="mig-modal"
          />
          <div>
            <Checkbox
              id="mig-modal-update-triggers"
              labelText={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  {`Update event triggers${eventInstructionCount > 0 ? ` (${eventInstructionCount} event${eventInstructionCount === 1 ? '' : 's'})` : ''}`}
                  <Toggletip align="bottom" autoAlign>
                    <ToggletipButton label="Learn more about Update event triggers">
                      <Information size={14} />
                    </ToggletipButton>
                    <ToggletipContent>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                          <strong>What it does:</strong> Event subscriptions (message, timer, signal) on migrated activities are updated to match the target process definition.
                        </p>
                        <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                          <strong>When to use:</strong> Enable when the target version has changed event definitions that should take effect immediately after migration.
                        </p>
                        <p style={{ margin: 0, fontSize: 'var(--text-12)' }}>
                          <strong>Impact:</strong> Existing event subscriptions are replaced. Disable to keep original subscriptions from the source version.
                        </p>
                      </div>
                    </ToggletipContent>
                  </Toggletip>
                </span>
              }
              checked={updateEventTriggers}
              onChange={(_: any, data: any) => onUpdateEventTriggersChange(!!data.checked)}
            />
          </div>
        </div>

        <TextArea
          id="migration-audit-reason"
          labelText="Audit reason"
          placeholder="e.g., Migrating stalled instances after target process hotfix deployment."
          value={auditReason}
          rows={3}
          disabled={busy}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setAuditReason(event.target.value)}
        />
        {auditReasonMissing ? (
          <InlineNotification
            lowContrast
            kind="warning"
            title="Reason required"
            subtitle="An audit reason is required before migration can be executed."
          />
        ) : null}

        <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
          <Button
            size="sm"
            kind="secondary"
            disabled={busy || !!directUnavailableReason || auditReasonMissing}
            title={directUnavailableReason || (auditReasonMissing ? 'Audit reason is required' : undefined)}
            onClick={() => {
              if (directUnavailableReason || auditReasonMissing) return
              onExecuteDirect(auditReasonValue)
            }}
          >
            {directPending ? 'Executing...' : 'Run directly (no batch)'}
          </Button>
        </div>

        <div>
          <button
            onClick={() => setShowPayload(!showPayload)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 'var(--text-12)', color: 'var(--cds-link-01)',
              padding: 0, textDecoration: 'underline',
            }}
          >
            {showPayload ? 'Hide' : 'Show'} API payload
          </button>
          {showPayload && (
            <pre style={{
              marginTop: 'var(--spacing-2)',
              padding: 'var(--spacing-3)',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-primary)',
              borderRadius: '4px',
              fontSize: 'var(--text-11)',
              fontFamily: 'var(--font-mono)',
              overflow: 'auto',
              maxHeight: 200,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {JSON.stringify({ ...payload, auditReason: auditReasonValue || undefined }, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </Modal>
  )
}
