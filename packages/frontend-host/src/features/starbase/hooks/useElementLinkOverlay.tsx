import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Button, Toggletip, ToggletipButton, ToggletipContent } from '@carbon/react'
import { Link, WarningAltFilled } from '@carbon/icons-react'

export type LinkOverlayStatus = 'linked' | 'missing' | 'unlinked'

export interface UseElementLinkOverlayProps {
  modeler: any
  elementId: string | null
  visible: boolean
  status: LinkOverlayStatus
  linkedLabel: string | null
  linkTypeLabel: string
  canOpen: boolean
  canCreateProcess?: boolean
  createProcessDisabled?: boolean
  createActionLabel?: string
  onTriggerClick?: () => void
  onLink: () => void
  onOpen: () => void
  onCreateProcess?: () => void
  onUnlink: () => void
}

function OverlayContent({
  status,
  linkedLabel,
  linkTypeLabel,
  canOpen,
  canCreateProcess,
  createProcessDisabled,
  createActionLabel,
  onTriggerClick,
  onLink,
  onOpen,
  onCreateProcess,
  onUnlink,
}: Omit<UseElementLinkOverlayProps, 'modeler' | 'elementId' | 'visible'>) {
  const [unlinkHover, setUnlinkHover] = React.useState(false)
  const showUnlink = status !== 'unlinked'
  const showOpen = status === 'linked' && canOpen
  const showCreateProcess = status === 'unlinked' && Boolean(canCreateProcess && onCreateProcess)
  const statusLabel =
    status === 'linked'
      ? `Linked ${linkTypeLabel}`
      : status === 'missing'
        ? `Missing ${linkTypeLabel} link`
        : `No ${linkTypeLabel} linked`
  const pillStyle: React.CSSProperties = {
    height: 26,
    minWidth: 34,
    padding: '0 8px',
    borderRadius: 999,
    background: 'var(--cds-link-01, #0f62fe)',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    border: 'none',
  }

  return (
    <Toggletip align="bottom">
      <ToggletipButton label="Link file" onMouseDownCapture={onTriggerClick}>
        <div style={pillStyle}>
          <Link size={14} style={{ color: '#ffffff', fill: '#ffffff' }} />
          {status === 'missing' && <WarningAltFilled size={12} style={{ color: '#ffffff', fill: '#ffffff' }} />}
        </div>
      </ToggletipButton>
      <ToggletipContent>
        <div style={{ display: 'grid', gap: 'var(--spacing-3)', minWidth: 200 }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{statusLabel}</div>
            {status === 'linked' && (
              <div style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>
                {linkedLabel || 'Untitled'}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            <Button
              size="sm"
              kind="primary"
              onClick={onLink}
              style={{ width: '100%' }}
            >
              {status === 'unlinked' ? 'Link' : 'Change'}
            </Button>
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
            {showOpen && (
              <Button size="sm" kind="primary" onClick={onOpen} style={{ width: '100%' }}>
                Open
              </Button>
            )}
            {showUnlink && (
              <Button
                size="sm"
                kind="ghost"
                onClick={onUnlink}
                onMouseEnter={() => setUnlinkHover(true)}
                onMouseLeave={() => setUnlinkHover(false)}
                style={{
                  width: '100%',
                  background: unlinkHover ? 'var(--cds-layer-hover-01, #e8e8e8)' : 'var(--cds-layer-01, #f4f4f4)',
                  color: 'var(--cds-text-primary, #161616)',
                  border: '1px solid var(--cds-border-subtle-01, #e0e0e0)',
                }}
              >
                Unlink
              </Button>
            )}
          </div>
        </div>
      </ToggletipContent>
    </Toggletip>
  )
}

export function useElementLinkOverlay({
  modeler,
  elementId,
  visible,
  status,
  linkedLabel,
  linkTypeLabel,
  canOpen,
  canCreateProcess,
  createProcessDisabled,
  createActionLabel,
  onTriggerClick,
  onLink,
  onOpen,
  onCreateProcess,
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
      <OverlayContent
        status={status}
        linkedLabel={linkedLabel}
        linkTypeLabel={linkTypeLabel}
        canOpen={canOpen}
        canCreateProcess={canCreateProcess}
        createProcessDisabled={createProcessDisabled}
        createActionLabel={createActionLabel}
        onTriggerClick={onTriggerClick}
        onLink={onLink}
        onOpen={onOpen}
        onCreateProcess={onCreateProcess}
        onUnlink={onUnlink}
      />
    )
  }, [
    status,
    linkedLabel,
    linkTypeLabel,
    canOpen,
    canCreateProcess,
    createProcessDisabled,
    createActionLabel,
    onTriggerClick,
    onLink,
    onOpen,
    onCreateProcess,
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
