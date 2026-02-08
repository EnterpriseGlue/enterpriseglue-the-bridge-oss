import React from 'react'
import { Button, Modal, Tag } from '@carbon/react'
import { Add, Close, ArrowRight, ArrowUp, ArrowDown, TrashCan, Undo, Information } from '@carbon/icons-react'
import type { ModificationOperation, ModificationVariable } from './types'

interface ModificationPlanPanelProps {
  modPlan: ModificationOperation[]
  selectedActivityId: string | null
  moveSourceActivityId: string | null
  activeActivityIds: Set<string>
  resolveActivityName: (id: string) => string
  addPlanOperation: (kind: 'add' | 'addAfter' | 'cancel') => void
  toggleMoveForSelection: () => void
  onMoveToHere: (targetActivityId: string) => void
  removePlanItem: (index: number) => void
  movePlanItem: (index: number, direction: 'up' | 'down') => void
  updatePlanItemVariables: (index: number, variables: ModificationVariable[]) => void
  undoLastOperation: () => void
  applyModifications: () => void
  setDiscardConfirmOpen: (open: boolean) => void
  applyBusy: boolean
  instanceVariables?: any[] | null
  onExitModificationMode: () => void
}

function formatActivityRef(id: string | undefined, resolve: (id: string) => string): string {
  if (!id) return '?'
  return resolve(id)
}

function getOperationLabel(op: ModificationOperation, resolve: (id: string) => string): string {
  switch (op.kind) {
    case 'add':
      return `Add token before ${formatActivityRef(op.activityId, resolve)}`
    case 'addAfter':
      return `Add token after ${formatActivityRef(op.activityId, resolve)}`
    case 'cancel':
      return `Cancel instances at ${formatActivityRef(op.activityId, resolve)}`
    case 'move':
      return `Move from ${formatActivityRef(op.fromActivityId, resolve)} → ${formatActivityRef(op.toActivityId, resolve)}`
    default:
      return 'Unknown operation'
  }
}

function getOperationIcon(kind: ModificationOperation['kind']) {
  switch (kind) {
    case 'add':
    case 'addAfter':
      return <Add size={14} style={{ color: '#0f62fe' }} />
    case 'cancel':
      return <Close size={14} style={{ color: '#da1e28' }} />
    case 'move':
      return <ArrowRight size={14} style={{ color: '#ff832b' }} />
    default:
      return null
  }
}

function canHaveVariables(kind: ModificationOperation['kind']): boolean {
  return kind === 'add' || kind === 'addAfter' || kind === 'move'
}

const VAR_TYPES = ['String', 'Integer', 'Long', 'Double', 'Boolean', 'Json', 'Object']

export function ModificationPlanPanel({
  modPlan,
  selectedActivityId,
  moveSourceActivityId,
  activeActivityIds,
  resolveActivityName,
  addPlanOperation,
  toggleMoveForSelection,
  onMoveToHere,
  removePlanItem,
  movePlanItem,
  updatePlanItemVariables,
  undoLastOperation,
  applyModifications,
  setDiscardConfirmOpen,
  applyBusy,
  instanceVariables,
  onExitModificationMode,
}: ModificationPlanPanelProps) {
  const nodeHasActiveTokens = selectedActivityId ? activeActivityIds.has(selectedActivityId) : false
  const [infoOpen, setInfoOpen] = React.useState(false)
  const [varsModalIdx, setVarsModalIdx] = React.useState<number | null>(null)
  const [varsModalDraft, setVarsModalDraft] = React.useState<ModificationVariable[]>([])

  const openVarsModal = (idx: number) => {
    setVarsModalDraft(modPlan[idx]?.variables ? [...modPlan[idx].variables!.map(v => ({ ...v }))] : [])
    setVarsModalIdx(idx)
  }
  const saveVarsModal = () => {
    if (varsModalIdx !== null) {
      updatePlanItemVariables(varsModalIdx, varsModalDraft.filter(v => v.name.trim()))
    }
    setVarsModalIdx(null)
    setVarsModalDraft([])
  }
  const inheritInstanceVars = () => {
    if (!instanceVariables || instanceVariables.length === 0) return
    const inherited: ModificationVariable[] = instanceVariables.map((v: any) => ({
      name: v.name ?? '',
      type: v.type ?? 'String',
      value: typeof v.value === 'object' ? JSON.stringify(v.value) : String(v.value ?? ''),
    }))
    setVarsModalDraft(prev => {
      const existingNames = new Set(prev.map(v => v.name))
      const newVars = inherited.filter(v => !existingNames.has(v.name))
      return [...prev, ...newVars]
    })
  }

  // Check if an add/addAfter already exists for the selected node
  const existingAddKind = selectedActivityId
    ? modPlan.find(op => (op.kind === 'add' || op.kind === 'addAfter') && op.activityId === selectedActivityId)?.kind ?? null
    : null

  return (
    <>
    <Modal
      open={infoOpen}
      onRequestClose={() => setInfoOpen(false)}
      modalHeading="Modification Actions Reference"
      passiveModal
      size="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)', padding: 'var(--spacing-3) 0' }}>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>Add token (<code>startBeforeActivity</code>)</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Creates a new token that enters the selected activity from the beginning. The activity will execute its input mappings, then run its logic. This is the default mode. Use this to re-run an activity or start a new parallel path.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>Start after (override: <code>startAfterActivity</code>)</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Creates a new token that starts after the selected activity, skipping it entirely. The token proceeds along the outgoing sequence flow. Use the toggle to switch to this mode when you want to skip an activity.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>Cancel</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Cancels all running instances at the selected activity. Only available on activities that currently have active tokens.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>Move</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            Combines a cancel and an add token into one operation. Cancels the token at the source and creates a new token at the target. Process-scope variables are preserved; local variables from the source are lost.
          </p>
        </div>
        <div>
          <h5 style={{ margin: '0 0 4px', fontSize: 'var(--text-13)' }}>Variables</h5>
          <p style={{ margin: 0, fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
            You can attach variables to any add/move instruction. Variables are set before the activity executes. Use this when the target activity needs variables that don&apos;t exist at process scope, or to override existing values.
          </p>
        </div>
      </div>
    </Modal>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', padding: '16px var(--spacing-3) var(--spacing-3)' }}>
      {/* Exit button + Node Actions */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--spacing-2)' }}>
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          {selectedActivityId ? (
            <>
              {!existingAddKind ? (
                <Button size="sm" kind="tertiary" renderIcon={Add} onClick={() => addPlanOperation('add')}>
                  Add token
                </Button>
              ) : (
                <Button size="sm" kind="tertiary" renderIcon={Add} onClick={() => addPlanOperation(existingAddKind === 'add' ? 'addAfter' : 'add')}>
                  {existingAddKind === 'add' ? 'Switch to: after' : 'Switch to: before'}
                </Button>
              )}
              {nodeHasActiveTokens && (
                <Button size="sm" kind="danger--tertiary" renderIcon={Close} onClick={() => addPlanOperation('cancel')}>
                  Cancel
                </Button>
              )}
              {moveSourceActivityId === selectedActivityId ? (
                <Button size="sm" kind="tertiary" renderIcon={ArrowRight} onClick={() => toggleMoveForSelection()}>
                  Cancel move
                </Button>
              ) : moveSourceActivityId ? (
                <Button size="sm" kind="tertiary" renderIcon={ArrowRight} onClick={() => toggleMoveForSelection()}>
                  Move → here
                </Button>
              ) : nodeHasActiveTokens ? (
                <Button size="sm" kind="tertiary" renderIcon={ArrowRight} onClick={() => toggleMoveForSelection()}>
                  Move from here
                </Button>
              ) : (
                <Button size="sm" kind="tertiary" renderIcon={ArrowRight} onClick={() => onMoveToHere(selectedActivityId!)}>
                  Move to here
                </Button>
              )}
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                title="What do these actions mean?"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                  display: 'inline-flex', alignItems: 'center', color: 'var(--color-text-tertiary)', flexShrink: 0,
                }}
              >
                <Information size={16} />
              </button>
            </>
          ) : (
            <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
              {moveSourceActivityId
                ? `Select the target node to move tokens from ${resolveActivityName(moveSourceActivityId)}.`
                : 'Select a flow node in the diagram to plan modifications.'}
            </div>
          )}
        </div>
        <Button
          size="sm"
          kind="danger--tertiary"
          onClick={onExitModificationMode}
          style={{ flexShrink: 0 }}
        >
          Exit modification mode
        </Button>
      </div>
      {selectedActivityId && moveSourceActivityId && moveSourceActivityId !== selectedActivityId && (
        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
          Moving from {resolveActivityName(moveSourceActivityId)} → {resolveActivityName(selectedActivityId)}
        </div>
      )}

      {/* Plan List */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-2)' }}>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>
            {modPlan.length === 0
              ? 'No modifications planned'
              : `${modPlan.length} modification${modPlan.length === 1 ? '' : 's'} planned`}
          </div>
          {modPlan.length > 0 && (
            <Button size="sm" kind="ghost" renderIcon={Undo} onClick={undoLastOperation} iconDescription="Undo last">
              Undo
            </Button>
          )}
        </div>

        {modPlan.length > 0 && (
          <div style={{ border: '1px solid var(--color-border-primary)', borderRadius: '4px' }}>
            {modPlan.map((op, idx) => {
              const varsCount = op.variables?.filter((v: ModificationVariable) => v.name.trim()).length ?? 0
              return (
                <div
                  key={`${op.kind}-${idx}`}
                  style={{
                    borderBottom: idx < modPlan.length - 1 ? '1px solid var(--color-border-primary)' : 'none',
                    background: idx % 2 === 0 ? 'transparent' : 'var(--color-bg-secondary)',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)',
                    padding: '6px var(--spacing-2)', fontSize: '13px',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <button
                        onClick={() => movePlanItem(idx, 'up')}
                        disabled={idx === 0}
                        style={{
                          background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer',
                          padding: 0, opacity: idx === 0 ? 0.3 : 1, lineHeight: 0,
                        }}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => movePlanItem(idx, 'down')}
                        disabled={idx === modPlan.length - 1}
                        style={{
                          background: 'none', border: 'none', cursor: idx === modPlan.length - 1 ? 'default' : 'pointer',
                          padding: 0, opacity: idx === modPlan.length - 1 ? 0.3 : 1, lineHeight: 0,
                        }}
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
                      {getOperationIcon(op.kind)}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getOperationLabel(op, resolveActivityName)}
                      </span>
                      {(op.kind === 'add' || op.kind === 'addAfter') && (
                        <button
                          type="button"
                          onClick={() => setInfoOpen(true)}
                          title={op.kind === 'add'
                            ? 'Token will enter the activity and execute it (startBeforeActivity)'
                            : 'Token will skip the activity and continue from its output (startAfterActivity)'}
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, color: 'var(--color-text-tertiary)', cursor: 'pointer',
                            background: 'none', border: 'none', padding: 0, lineHeight: 0,
                          }}
                        >
                          <Information size={14} />
                        </button>
                      )}
                      {varsCount > 0 && (
                        <Tag size="sm" type="blue" style={{ flexShrink: 0 }}>{varsCount} var{varsCount > 1 ? 's' : ''}</Tag>
                      )}
                    </span>
                    {canHaveVariables(op.kind) && (
                      <button
                        onClick={() => openVarsModal(idx)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                          fontSize: 'var(--text-11)', color: 'var(--cds-interactive-01)', whiteSpace: 'nowrap',
                        }}
                        title="Set variables for this instruction"
                      >
                        {varsCount > 0 ? `${varsCount} var${varsCount > 1 ? 's' : ''}` : '+ vars'}
                      </button>
                    )}
                    <button
                      onClick={() => removePlanItem(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', lineHeight: 0, color: 'var(--color-text-tertiary)' }}
                      title="Remove"
                    >
                      <TrashCan size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      </div>

      {/* Apply / Discard / Exit — pinned at bottom */}
      <div style={{ flexShrink: 0, display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--color-border-primary)', padding: '12px var(--spacing-3) 16px' }}>
        <Button
          size="sm"
          kind="primary"
          onClick={() => applyModifications()}
          disabled={modPlan.length === 0 || applyBusy}
        >
          {applyBusy ? 'Applying...' : `Apply ${modPlan.length > 0 ? `(${modPlan.length})` : ''}`}
        </Button>
        <Button
          size="sm"
          kind="danger--ghost"
          onClick={() => setDiscardConfirmOpen(true)}
          disabled={modPlan.length === 0}
        >
          Discard all
        </Button>
      </div>
    </div>

    {/* Variables Modal */}
    <Modal
      open={varsModalIdx !== null}
      onRequestClose={() => { setVarsModalIdx(null); setVarsModalDraft([]) }}
      onRequestSubmit={saveVarsModal}
      modalHeading={varsModalIdx !== null ? `Variables for: ${getOperationLabel(modPlan[varsModalIdx], resolveActivityName)}` : 'Variables'}
      primaryButtonText="Save variables"
      secondaryButtonText="Cancel"
      size="md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)', padding: 'var(--spacing-3) 0' }}>
        <div>
          <Button
            size="sm"
            kind="tertiary"
            onClick={inheritInstanceVars}
            disabled={!instanceVariables || instanceVariables.length === 0}
          >
            Inherit instance variables
          </Button>
        </div>

        {varsModalDraft.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr 28px', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-12)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Name</span>
            <span style={{ fontSize: 'var(--text-12)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Type</span>
            <span style={{ fontSize: 'var(--text-12)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Value</span>
            <span />
            {varsModalDraft.map((v, i) => (
              <React.Fragment key={i}>
                <input
                  value={v.name}
                  onChange={e => {
                    const next = [...varsModalDraft]
                    next[i] = { ...next[i], name: e.target.value }
                    setVarsModalDraft(next)
                  }}
                  placeholder="variable name"
                  style={{
                    border: '1px solid var(--color-border-primary)', borderRadius: 3, padding: '6px 8px',
                    fontSize: 'var(--text-12)', fontFamily: 'var(--font-mono)',
                    background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                  }}
                />
                <select
                  value={v.type}
                  onChange={e => {
                    const next = [...varsModalDraft]
                    next[i] = { ...next[i], type: e.target.value }
                    setVarsModalDraft(next)
                  }}
                  style={{
                    border: '1px solid var(--color-border-primary)', borderRadius: 3, padding: '6px 4px',
                    fontSize: 'var(--text-12)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                  }}
                >
                  {VAR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  value={v.value}
                  onChange={e => {
                    const next = [...varsModalDraft]
                    next[i] = { ...next[i], value: e.target.value }
                    setVarsModalDraft(next)
                  }}
                  placeholder="value"
                  style={{
                    border: '1px solid var(--color-border-primary)', borderRadius: 3, padding: '6px 8px',
                    fontSize: 'var(--text-12)', fontFamily: 'var(--font-mono)',
                    background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)',
                  }}
                />
                <button
                  onClick={() => setVarsModalDraft(prev => prev.filter((_, idx) => idx !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', lineHeight: 0, color: 'var(--color-text-tertiary)' }}
                >
                  <TrashCan size={14} />
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        <Button
          size="sm"
          kind="ghost"
          renderIcon={Add}
          onClick={() => setVarsModalDraft(prev => [...prev, { name: '', type: 'String', value: '' }])}
        >
          Add variable
        </Button>

        {varsModalDraft.length === 0 && (
          <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
            No variables attached. Click &quot;Inherit from instance&quot; to copy existing process variables, or add them manually.
          </div>
        )}
      </div>
    </Modal>
    </>
  )
}
