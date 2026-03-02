import React from 'react'
import { Pause, Play, TrashCan, Renew, Migrate, Close } from '@carbon/icons-react'

interface ProcessActionsProps {
  hasSelection: boolean
  selectedCount: number
  totalCount: number
  canRetry: boolean
  canActivate: boolean
  canSuspend: boolean
  canDelete: boolean
  canMigrate: boolean
  onRetry: () => void
  onActivate: () => void
  onSuspend: () => void
  onDelete: () => void
  onMigrate: () => void
  onDiscard: () => void
}

export function ProcessActions({
  hasSelection,
  selectedCount,
  totalCount,
  canRetry,
  canActivate,
  canSuspend,
  canDelete,
  canMigrate,
  onRetry,
  onActivate,
  onSuspend,
  onDelete,
  onMigrate,
  onDiscard,
}: ProcessActionsProps) {
  const actionBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: hasSelection ? 'var(--cds-text-on-color)' : 'var(--cds-text-primary)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0 1rem',
    fontSize: 'var(--cds-body-compact-01-font-size, 0.875rem)',
    lineHeight: 'var(--cds-body-compact-01-line-height, 1.28572)',
    height: '2rem',
  }

  const getActionBtnStyle = (enabled: boolean): React.CSSProperties => ({
    ...actionBtnStyle,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.5,
  })

  return (
    <div style={{ 
      background: hasSelection ? 'var(--cds-background-brand)' : 'var(--cds-layer-01)', 
      color: hasSelection ? 'var(--cds-text-on-color)' : 'var(--cds-text-primary)', 
      padding: '0 16px', 
      display: 'flex', 
      alignItems: 'center', 
      gap: '16px',
      height: '2rem',
      minHeight: '2rem',
      borderBottom: hasSelection ? 'none' : '1px solid var(--cds-border-subtle-01)',
      zIndex: 1,
      fontSize: 'var(--cds-body-compact-01-font-size, 0.875rem)',
      transition: 'background-color 110ms, color 110ms',
    }}>
      <div style={{ fontSize: 'var(--cds-body-compact-01-font-size, 0.875rem)', fontWeight: 400, whiteSpace: 'nowrap' }}>
        {hasSelection 
          ? `${selectedCount} of ${totalCount} Process Instances selected`
          : `${totalCount} Process Instances`
        }
      </div>
      
      {/* Spacer to push search and actions to the right */}
      <div style={{ flex: 1 }} />
      
      {/* Action buttons - slide out from search bar's left */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'row-reverse',
        gap: 0, 
        alignItems: 'center',
        overflow: 'hidden',
        maxWidth: hasSelection ? '600px' : '0px',
        opacity: hasSelection ? 1 : 0,
        transition: 'max-width 0.36s ease, opacity 0.24s ease',
      }}>
        <button
          style={getActionBtnStyle(canDelete)}
          disabled={!canDelete}
          onMouseEnter={(e) => { 
            e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
          }}
          onMouseLeave={(e) => { 
            e.currentTarget.style.background = 'transparent'
          }}
          onClick={onDelete}
          aria-label="Cancel (Batch)"
          title="Cancel (Batch)"
        >
          <TrashCan size={16} />
          Cancel
        </button>
        <button
          style={getActionBtnStyle(canSuspend)}
          disabled={!canSuspend}
          onMouseEnter={(e) => { 
            e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
          }}
          onMouseLeave={(e) => { 
            e.currentTarget.style.background = 'transparent'
          }}
          onClick={onSuspend}
          aria-label="Suspend (Batch)"
          title="Suspend (Batch)"
        >
          <Pause size={16} />
          Suspend
        </button>
        <button
          style={getActionBtnStyle(canMigrate)}
          disabled={!canMigrate}
          onMouseEnter={(e) => { 
            e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
          }}
          onMouseLeave={(e) => { 
            e.currentTarget.style.background = 'transparent'
          }}
          onClick={onMigrate}
          aria-label="Migrate"
          title="Migrate"
        >
          <Migrate size={16} />
          Migrate
        </button>
        <button
          style={getActionBtnStyle(canActivate)}
          disabled={!canActivate}
          onMouseEnter={(e) => { 
            e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
          }}
          onMouseLeave={(e) => { 
            e.currentTarget.style.background = 'transparent'
          }}
          onClick={onActivate}
          aria-label="Activate (Batch)"
          title="Activate (Batch)"
        >
          <Play size={16} />
          Activate
        </button>
        <button
          style={getActionBtnStyle(canRetry)}
          disabled={!canRetry}
          onMouseEnter={(e) => { 
            e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
          }}
          onMouseLeave={(e) => { 
            e.currentTarget.style.background = 'transparent'
          }}
          onClick={onRetry}
          aria-label="Retry failed jobs (Batch)"
          title="Retry failed jobs (Batch)"
        >
          <Renew size={16} />
          Retry
        </button>
        <button
          style={getActionBtnStyle(hasSelection)}
          onMouseEnter={(e) => { 
            e.currentTarget.style.background = 'var(--cds-button-primary-hover)'
          }}
          onMouseLeave={(e) => { 
            e.currentTarget.style.background = 'transparent'
          }}
          onClick={onDiscard}
          aria-label="Discard selection"
          title="Discard selection"
        >
          Discard
        </button>
      </div>
    </div>
  )
}
