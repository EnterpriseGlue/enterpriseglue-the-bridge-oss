import React, { useState } from 'react'
import { Modal, Checkbox, TextInput } from '@carbon/react'
import { Add, Close, ArrowRight, TrashCan } from '@carbon/icons-react'
import { ExecutionOptionsPanel } from '../../../../shared/components/ExecutionOptionsPanel'
import type { ModificationOperation } from '../types'

interface ApplyModificationsModalProps {
  open: boolean
  modPlan: ModificationOperation[]
  resolveActivityName: (id: string) => string
  onClose: () => void
  onApply: (options: { skipCustomListeners: boolean; skipIoMappings: boolean; annotation: string }) => void
  onRemoveItem: (index: number) => void
  applyBusy: boolean
}

function fmtRef(id: string | undefined, resolve: (id: string) => string): string {
  if (!id) return '?'
  return resolve(id)
}

function getOperationLabel(op: ModificationOperation, resolve: (id: string) => string): string {
  switch (op.kind) {
    case 'add':
      return `Start before ${fmtRef(op.activityId, resolve)}`
    case 'addAfter':
      return `Start after ${fmtRef(op.activityId, resolve)}`
    case 'cancel':
      return `Cancel active instances at ${fmtRef(op.activityId, resolve)}`
    case 'move':
      return `Move: cancel ${fmtRef(op.fromActivityId, resolve)} → start before ${fmtRef(op.toActivityId, resolve)}`
    default:
      return 'Unknown operation'
  }
}

function getOperationApiType(op: ModificationOperation): string {
  switch (op.kind) {
    case 'add':
      return 'startBeforeActivity'
    case 'addAfter':
      return 'startAfterActivity'
    case 'cancel':
      return 'cancel'
    case 'move':
      return 'cancel + startBeforeActivity'
    default:
      return 'unknown'
  }
}

function getOperationIcon(kind: ModificationOperation['kind']) {
  switch (kind) {
    case 'add':
    case 'addAfter':
      return <Add size={16} style={{ color: '#0f62fe', flexShrink: 0 }} />
    case 'cancel':
      return <Close size={16} style={{ color: '#da1e28', flexShrink: 0 }} />
    case 'move':
      return <ArrowRight size={16} style={{ color: '#ff832b', flexShrink: 0 }} />
    default:
      return null
  }
}

function buildApiPayload(modPlan: ModificationOperation[]): any[] {
  const instructions: any[] = []
  for (const op of modPlan) {
    if (op.kind === 'add' && op.activityId) {
      instructions.push({ type: 'startBeforeActivity', activityId: op.activityId })
    } else if (op.kind === 'addAfter' && op.activityId) {
      instructions.push({ type: 'startAfterActivity', activityId: op.activityId })
    } else if (op.kind === 'cancel' && op.activityId) {
      instructions.push({ type: 'cancel', activityId: op.activityId, cancelCurrentActiveActivityInstances: true })
    } else if (op.kind === 'move' && op.fromActivityId && op.toActivityId) {
      instructions.push({ type: 'cancel', activityId: op.fromActivityId, cancelCurrentActiveActivityInstances: true })
      instructions.push({ type: 'startBeforeActivity', activityId: op.toActivityId })
    }
  }
  return instructions
}

export function ApplyModificationsModal({
  open,
  modPlan,
  resolveActivityName,
  onClose,
  onApply,
  onRemoveItem,
  applyBusy,
}: ApplyModificationsModalProps) {
  const [skipCustomListeners, setSkipCustomListeners] = useState(false)
  const [skipIoMappings, setSkipIoMappings] = useState(false)
  const [annotation, setAnnotation] = useState('')
  const [showPayload, setShowPayload] = useState(false)

  if (!open) return null

  const apiInstructions = buildApiPayload(modPlan)

  return (
    <>
    <Modal
      open={open}
      modalHeading="Apply Modifications"
      primaryButtonText={applyBusy ? 'Applying...' : `Apply ${modPlan.length} modification${modPlan.length === 1 ? '' : 's'}`}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={modPlan.length === 0 || applyBusy}
      onRequestClose={onClose}
      onRequestSubmit={() => onApply({ skipCustomListeners, skipIoMappings, annotation })}
      size="md"
      hasScrollingContent
    >
      <div style={{ display: 'grid', gap: 'var(--spacing-4)', fontSize: 'var(--text-13)' }}>
        <div>
          <div style={{ fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>
            Planned Modifications ({modPlan.length})
          </div>
          <div style={{ border: '1px solid var(--color-border-primary)', borderRadius: '4px', maxHeight: 200, overflow: 'auto' }}>
            {modPlan.map((op, idx) => (
              <div
                key={`${op.kind}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--spacing-2)',
                  padding: '6px var(--spacing-3)',
                  fontSize: 'var(--text-12)',
                  borderBottom: idx < modPlan.length - 1 ? '1px solid var(--color-border-primary)' : 'none',
                  background: idx % 2 === 0 ? 'transparent' : 'var(--color-bg-secondary)',
                }}
              >
                {getOperationIcon(op.kind)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {getOperationLabel(op, resolveActivityName)}
                  </div>
                  <div style={{ fontSize: 'var(--text-11)', color: 'var(--color-text-tertiary)' }}>
                    API: {getOperationApiType(op)}
                  </div>
                  {op.variables && op.variables.length > 0 && (
                    <div style={{ fontSize: 'var(--text-11)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                      Variables: {op.variables.filter((v: any) => v.name.trim()).map((v: any) => `${v.name}=${v.value} (${v.type})`).join(', ')}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onRemoveItem(idx)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '4px', lineHeight: 0, color: 'var(--color-text-tertiary)',
                    flexShrink: 0,
                  }}
                  title="Remove this modification"
                >
                  <TrashCan size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div style={{ fontWeight: 'var(--font-weight-semibold)' }}>Options</div>
          <ExecutionOptionsPanel
            skipCustomListeners={skipCustomListeners}
            onSkipCustomListenersChange={setSkipCustomListeners}
            skipIoMappings={skipIoMappings}
            onSkipIoMappingsChange={setSkipIoMappings}
            idPrefix="mod"
          />
          <TextInput
            id="mod-annotation"
            labelText="Annotation (optional)"
            placeholder="e.g., Moving token past failed service task"
            size="sm"
            value={annotation}
            onChange={(e: any) => setAnnotation(e.target.value)}
          />
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
              {JSON.stringify({ instructions: apiInstructions, skipCustomListeners, skipIoMappings, annotation: annotation || undefined }, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </Modal>

    </>
  )
}
