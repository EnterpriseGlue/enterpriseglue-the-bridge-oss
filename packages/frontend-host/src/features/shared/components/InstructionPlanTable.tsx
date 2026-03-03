import React from 'react'
import { ArrowUp, ArrowDown, TrashCan } from '@carbon/icons-react'

export interface InstructionItem {
  label: string
  icon?: React.ReactNode
  removable?: boolean
  reorderable?: boolean
}

export interface InstructionPlanTableProps {
  instructions: InstructionItem[]
  onRemove?: (index: number) => void
  onMoveUp?: (index: number) => void
  onMoveDown?: (index: number) => void
  emptyMessage?: string
  maxHeight?: number
}

export function InstructionPlanTable({
  instructions,
  onRemove,
  onMoveUp,
  onMoveDown,
  emptyMessage = 'No instructions planned',
  maxHeight = 200,
}: InstructionPlanTableProps) {
  if (instructions.length === 0) {
    return (
      <div style={{ fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', padding: 'var(--spacing-2)' }}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div style={{ maxHeight, overflow: 'auto', border: '1px solid var(--color-border-primary)', borderRadius: '4px' }}>
      {instructions.map((item, idx) => (
        <div
          key={`instruction-${idx}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            padding: '4px var(--spacing-2)',
            fontSize: 'var(--text-12)',
            borderBottom: idx < instructions.length - 1 ? '1px solid var(--color-border-primary)' : 'none',
            background: idx % 2 === 0 ? 'transparent' : 'var(--color-bg-secondary)',
          }}
        >
          {(item.reorderable !== false && (onMoveUp || onMoveDown)) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <button
                onClick={() => onMoveUp?.(idx)}
                disabled={idx === 0}
                style={{
                  background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer',
                  padding: 0, opacity: idx === 0 ? 0.3 : 1, lineHeight: 0,
                }}
              >
                <ArrowUp size={12} />
              </button>
              <button
                onClick={() => onMoveDown?.(idx)}
                disabled={idx === instructions.length - 1}
                style={{
                  background: 'none', border: 'none', cursor: idx === instructions.length - 1 ? 'default' : 'pointer',
                  padding: 0, opacity: idx === instructions.length - 1 ? 0.3 : 1, lineHeight: 0,
                }}
              >
                <ArrowDown size={12} />
              </button>
            </div>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: 0 }}>
            {item.icon}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
          </span>
          {item.removable !== false && onRemove && (
            <button
              onClick={() => onRemove(idx)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', lineHeight: 0, color: 'var(--color-text-tertiary)' }}
              title="Remove"
            >
              <TrashCan size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
