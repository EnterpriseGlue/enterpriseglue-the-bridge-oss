import React, { useState } from 'react'
import { Modal, Checkbox, TextInput } from '@carbon/react'
import { Add, Close, ArrowRight, TrashCan, Information } from '@carbon/icons-react'
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
  const [listenersInfoOpen, setListenersInfoOpen] = useState(false)
  const [ioInfoOpen, setIoInfoOpen] = useState(false)

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
          <div>
            <Checkbox
              id="mod-skip-listeners"
              labelText={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  Skip custom listeners
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setListenersInfoOpen(true) }}
                    title="Learn more about Skip custom listeners"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-tertiary)', lineHeight: 0 }}
                  >
                    <Information size={14} />
                  </button>
                </span>
              }
              checked={skipCustomListeners}
              onChange={(_: any, data: any) => setSkipCustomListeners(!!data.checked)}
            />
          </div>
          <div>
            <Checkbox
              id="mod-skip-io"
              labelText={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  Skip IO mappings
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIoInfoOpen(true) }}
                    title="Learn more about Skip IO mappings"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-tertiary)', lineHeight: 0 }}
                  >
                    <Information size={14} />
                  </button>
                </span>
              }
              checked={skipIoMappings}
              onChange={(_: any, data: any) => setSkipIoMappings(!!data.checked)}
            />
          </div>
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

    <Modal
      open={listenersInfoOpen}
      onRequestClose={() => setListenersInfoOpen(false)}
      modalHeading="Skip Custom Listeners"
      passiveModal
      size="sm"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', padding: 'var(--spacing-3) 0' }}>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>What it does</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            When enabled, execution listeners and task listeners attached to the affected activities will not be triggered during the modification.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>When to use</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Use this if listeners cause side effects (e.g. sending emails, calling external services, updating audit logs) that you want to avoid during the modification. This is common when re-running an activity or moving tokens past a failed step.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>Impact</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Any logic in execution or task listeners (e.g. notifications, variable initialization, external API calls) will be skipped. The activity itself will still execute its core business logic.
          </p>
        </div>
      </div>
    </Modal>

    <Modal
      open={ioInfoOpen}
      onRequestClose={() => setIoInfoOpen(false)}
      modalHeading="Skip IO Mappings"
      passiveModal
      size="sm"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', padding: 'var(--spacing-3) 0' }}>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>What it does</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            When enabled, input/output variable mappings defined on the affected activities will not be executed during the modification.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>When to use</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Use this if the activity&apos;s variable mappings would overwrite data you want to preserve, or if the source variables referenced by the mappings are not available at the new execution point.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>Impact</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Input mappings will not copy variables into the activity&apos;s local scope, and output mappings will not write results back to the parent scope. The activity will use whatever variables are already available in its scope.
          </p>
        </div>
      </div>
    </Modal>
    </>
  )
}
