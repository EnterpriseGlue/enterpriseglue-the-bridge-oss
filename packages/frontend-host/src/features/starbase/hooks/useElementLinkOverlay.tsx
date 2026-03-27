import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Button, Theme, Toggletip, ToggletipButton, ToggletipContent, Toggle } from '@carbon/react'
import { Link, Settings, WarningAltFilled } from '@carbon/icons-react'
import type { NameSyncMode } from '../utils/bpmnLinking'

export type LinkOverlayStatus = 'linked' | 'missing' | 'unlinked'

export interface UseElementLinkOverlayProps {
  modeler: any
  elementId: string | null
  visible: boolean
  readOnly?: boolean
  status: LinkOverlayStatus
  isMessageEndEventLink?: boolean
  linkedLabel: string | null
  linkTypeLabel: string
  canOpen: boolean
  canCreateProcess?: boolean
  createProcessDisabled?: boolean
  createActionLabel?: string
  nameSyncMode?: NameSyncMode
  canSyncName?: boolean
  onTriggerClick?: () => void
  onLink: () => void
  onOpen: () => void
  onCreateProcess?: () => void
  onSyncName?: () => void
  onSetNameSyncMode?: (mode: NameSyncMode) => void
  onUnlink: () => void
}

function getPillStyle(background: string): React.CSSProperties {
  return {
    height: 26,
    minWidth: 34,
    padding: '0 8px',
    borderRadius: 999,
    background,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    border: 'none',
    cursor: 'pointer',
  }
}

export type ElementLinkOverlayContentProps = Omit<UseElementLinkOverlayProps, 'modeler' | 'elementId' | 'visible'>

export function ElementLinkOverlayContent({
  readOnly = false,
  status,
  isMessageEndEventLink = false,
  linkedLabel,
  linkTypeLabel,
  canOpen,
  canCreateProcess,
  createProcessDisabled,
  createActionLabel,
  nameSyncMode = 'manual',
  canSyncName,
  onTriggerClick,
  onLink,
  onOpen,
  onCreateProcess,
  onSyncName,
  onSetNameSyncMode,
  onUnlink,
}: ElementLinkOverlayContentProps) {
  const showUnlink = status !== 'unlinked'
  const showLinkedPill = status === 'linked' && canOpen
  const showCreateProcess = status === 'unlinked' && Boolean(canCreateProcess && onCreateProcess)
  const showNameSyncControls = status === 'linked' && Boolean(onSetNameSyncMode)
  const stackConfigBelowLinkedPill = showLinkedPill && isMessageEndEventLink
  const statusLabel =
    status === 'linked'
      ? `Linked ${linkTypeLabel}`
      : status === 'missing'
        ? `Missing ${linkTypeLabel} link`
        : `No ${linkTypeLabel} linked`
  const linkPillStyle = getPillStyle('var(--cds-link-01, #0f62fe)')
  const configPillStyle = getPillStyle('var(--cds-button-secondary, #393939)')

  return (
    <div style={{ display: 'flex', flexDirection: stackConfigBelowLinkedPill ? 'column' : 'row', alignItems: stackConfigBelowLinkedPill ? 'flex-start' : 'center', gap: 8 }}>
      {showLinkedPill && (
        <button
          type="button"
          aria-label={`Open linked ${linkTypeLabel}`}
          onMouseDownCapture={onTriggerClick}
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
          style={linkPillStyle}
        >
          <Link size={14} style={{ color: '#ffffff', fill: '#ffffff' }} />
        </button>
      )}
      {!readOnly && (
        <Toggletip align="bottom">
          <ToggletipButton label={`Configure ${linkTypeLabel} link`} onMouseDownCapture={onTriggerClick}>
            <div style={configPillStyle}>
              <Settings size={14} style={{ color: '#ffffff', fill: '#ffffff' }} />
              {status === 'missing' && <WarningAltFilled size={12} style={{ color: '#ffffff', fill: '#ffffff' }} />}
            </div>
          </ToggletipButton>
          <ToggletipContent>
            <Theme theme="g100">
              <div style={{ display: 'grid', gap: 'var(--spacing-4)', minWidth: 280, maxWidth: 320, padding: 'var(--spacing-5)', background: 'var(--cds-layer-01)', color: 'var(--cds-text-primary)', border: '1px solid var(--cds-border-subtle-01)' }}>
                <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                  <div style={{ fontSize: 12, color: 'var(--cds-text-secondary)' }}>{statusLabel}</div>
                  {status !== 'unlinked' && (
                    <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-word' }}>
                      {linkedLabel || 'Untitled'}
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
                  <Button
                    size="sm"
                    kind="primary"
                    onClick={onLink}
                    style={{ width: '100%' }}
                  >
                    {status === 'unlinked' ? 'Link' : 'Change'}
                  </Button>
                  {showNameSyncControls && (
                    <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
                      {canSyncName && onSyncName && (
                        <Button
                          size="sm"
                          kind="secondary"
                          onClick={onSyncName}
                          style={{ width: '100%', whiteSpace: 'nowrap' }}
                        >
                          Sync element name
                        </Button>
                      )}
                      <Toggle
                        id={`name-sync-${linkTypeLabel}`}
                        labelText="Auto-sync element name"
                        toggled={nameSyncMode === 'auto'}
                        onToggle={(checked) => onSetNameSyncMode?.(checked ? 'auto' : 'manual')}
                        size="sm"
                      />
                    </div>
                  )}
                  {showCreateProcess && (
                    <Button
                      size="sm"
                      kind="primary"
                      onClick={onCreateProcess}
                      disabled={createProcessDisabled}
                      style={{ width: '100%' }}
                    >
                      {createActionLabel || 'Create process'}
                    </Button>
                  )}
                  {showUnlink && (
                    <Button
                      size="sm"
                      kind="ghost"
                      onClick={onUnlink}
                      style={{ width: '100%' }}
                    >
                      Unlink
                    </Button>
                  )}
                </div>
              </div>
            </Theme>
          </ToggletipContent>
        </Toggletip>
      )}
    </div>
  )
}

export function useElementLinkOverlay({
  modeler,
  elementId,
  visible,
  readOnly,
  status,
  isMessageEndEventLink,
  linkedLabel,
  linkTypeLabel,
  canOpen,
  canCreateProcess,
  createProcessDisabled,
  createActionLabel,
  nameSyncMode,
  canSyncName,
  onTriggerClick,
  onLink,
  onOpen,
  onCreateProcess,
  onSyncName,
  onSetNameSyncMode,
  onUnlink,
}: UseElementLinkOverlayProps) {
  const overlayKeyRef = React.useRef<string | null>(null)
  const rootRef = React.useRef<Root | null>(null)
  const overlaysRef = React.useRef<any>(null)
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const renderOverlayRef = React.useRef<() => void>(() => {})

  const clear = React.useCallback(() => {
    if (overlayKeyRef.current && overlaysRef.current) {
      try {
        overlaysRef.current.remove(overlayKeyRef.current)
      } catch {}
    }
    overlayKeyRef.current = null

    if (rootRef.current) {
      try {
        rootRef.current.unmount()
      } catch {}
      rootRef.current = null
    }

    hostRef.current = null
  }, [])

  const renderOverlay = React.useCallback(() => {
    if (!rootRef.current) return
    rootRef.current.render(
      <ElementLinkOverlayContent
        readOnly={readOnly}
        status={status}
        isMessageEndEventLink={isMessageEndEventLink}
        linkedLabel={linkedLabel}
        linkTypeLabel={linkTypeLabel}
        canOpen={canOpen}
        canCreateProcess={canCreateProcess}
        createProcessDisabled={createProcessDisabled}
        createActionLabel={createActionLabel}
        nameSyncMode={nameSyncMode}
        canSyncName={canSyncName}
        onTriggerClick={onTriggerClick}
        onLink={onLink}
        onOpen={onOpen}
        onCreateProcess={onCreateProcess}
        onSyncName={onSyncName}
        onSetNameSyncMode={onSetNameSyncMode}
        onUnlink={onUnlink}
      />
    )
  }, [
    readOnly,
    status,
    isMessageEndEventLink,
    linkedLabel,
    linkTypeLabel,
    canOpen,
    canCreateProcess,
    createProcessDisabled,
    createActionLabel,
    nameSyncMode,
    canSyncName,
    onTriggerClick,
    onLink,
    onOpen,
    onCreateProcess,
    onSyncName,
    onSetNameSyncMode,
    onUnlink,
  ])

  React.useEffect(() => {
    renderOverlayRef.current = renderOverlay
    renderOverlay()
  }, [renderOverlay])

  React.useEffect(() => {
    let cancelled = false
    let removeImportListener: (() => void) | null = null

    const attach = (attempt: number) => {
      if (cancelled) return

      if (!visible || !modeler || !elementId) {
        clear()
        return
      }

      const overlays = modeler.get?.('overlays')
      const elementRegistry = modeler.get?.('elementRegistry')
      if (!overlays || !elementRegistry) {
        clear()
        return
      }

      const element = elementRegistry.get(elementId)
      if (!element) {
        // Right after navigation/import, selection can happen before registry is populated.
        // Retry briefly so the pill appears without requiring a refresh.
        if (attempt < 15) {
          window.setTimeout(() => attach(attempt + 1), 50)
          return
        }
        clear()
        return
      }

      clear()
      overlaysRef.current = overlays

      const host = document.createElement('div')
      host.style.pointerEvents = 'auto'
      host.style.transform = 'translate(-50%, 0)'
      host.style.display = 'flex'
      host.style.flexDirection = 'column'
      host.style.alignItems = 'center'
      host.style.gap = '8px'

      const stop = (e: Event) => {
        e.stopPropagation()
      }
      host.addEventListener('pointerdown', stop)
      host.addEventListener('mousedown', stop)
      hostRef.current = host

      const root = createRoot(host)
      rootRef.current = root
      renderOverlayRef.current()

      const width = Number(element.width || 0)
      const height = Number(element.height || 0)
      const position = {
        left: width ? width / 2 : 0,
        top: height ? height + 8 : 0,
      }

      try {
        overlayKeyRef.current = overlays.add(elementId, { position, html: host })
      } catch {
        clear()
      }
    }

    attach(0)

    // importXML clears overlays; re-attach after imports so returning to a file doesn't require refresh.
    try {
      const eventBus = modeler?.get?.('eventBus')
      if (eventBus && typeof eventBus.on === 'function') {
        const onImportDone = () => {
          if (cancelled) return
          // Let the element registry settle.
          window.setTimeout(() => attach(0), 0)
        }
        eventBus.on('import.done', onImportDone)
        removeImportListener = () => {
          try {
            if (typeof eventBus.off === 'function') {
              eventBus.off('import.done', onImportDone)
            }
          } catch {}
        }
      }
    } catch {}

    return () => {
      cancelled = true
      if (removeImportListener) {
        try {
          removeImportListener()
        } catch {}
        removeImportListener = null
      }
      clear()
    }
  }, [
    modeler,
    elementId,
    visible,
    clear,
  ])
}
