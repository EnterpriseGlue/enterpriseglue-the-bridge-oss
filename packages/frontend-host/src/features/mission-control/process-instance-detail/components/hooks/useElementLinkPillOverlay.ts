import { useEffect, useRef, type MutableRefObject } from 'react'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link } from '@carbon/icons-react'
import type { ElementLinkInfo } from '../../../../shared/components/viewer/viewerTypes'

interface UseElementLinkPillOverlayProps {
  bpmnRef: MutableRefObject<any>
  selectedActivityId: string | null
  onNavigate: (linkInfo: ElementLinkInfo) => void
  linkInfoOverride?: ElementLinkInfo | null
}

export function useElementLinkPillOverlay({
  bpmnRef,
  selectedActivityId,
  onNavigate,
  linkInfoOverride,
}: UseElementLinkPillOverlayProps) {
  const overlayKeyRef = useRef<string | null>(null)
  const iconRootRef = useRef<Root | null>(null)

  useEffect(() => {
    const viewer = bpmnRef.current
    if (!viewer) return
    const overlays = viewer.get?.('overlays')
    if (!overlays) return

    const isViewerConnected = () => {
      try {
        const canvas = viewer.get?.('canvas')
        const container = canvas?._container as HTMLElement | undefined
        if (!container) return true
        return container.isConnected
      } catch {
        return false
      }
    }

    const safeRemove = (key: string) => {
      try {
        overlays.remove(key)
      } catch {
        // ignore
      }
    }

    const clear = () => {
      if (overlayKeyRef.current) {
        safeRemove(overlayKeyRef.current)
        overlayKeyRef.current = null
      }

      if (iconRootRef.current) {
        try {
          iconRootRef.current.unmount()
        } catch {
          // ignore
        }
        iconRootRef.current = null
      }
    }

    if (!selectedActivityId) {
      clear()
      return
    }

    const elementRegistry = viewer.get?.('elementRegistry')
    if (!elementRegistry) {
      clear()
      return
    }

    const el: any = elementRegistry.get(selectedActivityId)
    const bo = el?.businessObject
    const type: string = bo?.$type || el?.type || ''

    let linkInfo: ElementLinkInfo | null = linkInfoOverride || null

    if (!linkInfo && type === 'bpmn:CallActivity') {
      const calledElement = bo?.calledElement || bo?.get?.('calledElement') || bo?.$attrs?.['camunda:calledElement']
      if (calledElement) {
        linkInfo = {
          elementId: selectedActivityId,
          elementType: 'CallActivity',
          linkType: 'process',
          targetKey: calledElement,
        }
      }
    }

    if (!linkInfo && type === 'bpmn:BusinessRuleTask') {
      const decisionRef =
        bo?.decisionRef ||
        bo?.get?.('decisionRef') ||
        bo?.$attrs?.['camunda:decisionRef'] ||
        bo?.$attrs?.decisionRef ||
        bo?.$attrs?.['decisionRef']
      if (decisionRef) {
        linkInfo = {
          elementId: selectedActivityId,
          elementType: 'BusinessRuleTask',
          linkType: 'decision',
          targetKey: decisionRef,
        }
      }
    }

    if (!linkInfo || !el) {
      clear()
      return
    }

    // Replace existing overlay (if any)
    clear()

    const pill = document.createElement('button')
    pill.type = 'button'
    pill.setAttribute('aria-label', 'Open linked details')
    pill.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      'height:20px;min-width:28px;padding:0 8px;border-radius:9999px;' +
      'background:var(--cds-link-01);color:#ffffff;border:0;cursor:pointer;' +
      'pointer-events:auto;position:relative;z-index:5;' +
      'box-shadow:0 1px 2px rgba(0,0,0,0.25);' +
      'transform:translateX(-50%);'

    const iconHost = document.createElement('span')
    iconHost.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;'
    pill.appendChild(iconHost)

    try {
      const root = createRoot(iconHost)
      root.render(React.createElement(Link as any, { size: 14, 'aria-hidden': true }))
      iconRootRef.current = root
    } catch {
      // ignore
    }

    const stop = (e: Event) => {
      e.stopPropagation()
    }
    pill.addEventListener('pointerdown', stop)
    pill.addEventListener('mousedown', stop)

    pill.addEventListener('click', (e) => {
      e.stopPropagation()
      onNavigate(linkInfo!)
    })

    const width = Number(el.width || 0)

    // Center-bottom, slightly outside the element
    const position = {
      left: width ? width / 2 : 0,
      bottom: -10,
    }

    try {
      if (!isViewerConnected()) return
      const key = overlays.add(selectedActivityId, { position, html: pill })
      overlayKeyRef.current = key
    } catch {
      // ignore
    }

    return () => {
      clear()
    }
  }, [bpmnRef, selectedActivityId, onNavigate, linkInfoOverride])
}
