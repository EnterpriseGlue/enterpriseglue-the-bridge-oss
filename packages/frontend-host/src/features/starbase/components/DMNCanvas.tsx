import React from 'react'
import { CamundaPlatformModeler as DmnModeler } from 'camunda-dmn-js'
import 'camunda-dmn-js/dist/assets/camunda-platform-modeler.css'

export default function DMNCanvas({ xml, onModelerReady, onDirty }: { xml: string; onModelerReady?: (modeler: any) => void; onDirty?: () => void }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const modelerRef = React.useRef<any | null>(null)
  const ignoreChangesRef = React.useRef(false)
  // Keep onDirty in a ref so event listeners always call the current callback
  const onDirtyRef = React.useRef(onDirty)
  React.useEffect(() => { onDirtyRef.current = onDirty }, [onDirty])
  // Track pending changes
  const hasPendingChangesRef = React.useRef(false)
  
  // Mark as dirty (has unsaved changes)
  const markDirty = React.useCallback(() => {
    if (ignoreChangesRef.current) return
    hasPendingChangesRef.current = true
  }, [])

  // Save if there are pending changes (for blur/focus loss)
  const saveIfDirty = React.useCallback(() => {
    if (ignoreChangesRef.current) return
    if (hasPendingChangesRef.current) {
      hasPendingChangesRef.current = false
      onDirtyRef.current?.()
    }
  }, [])
  
  const attachViewBusListeners = React.useCallback(() => {
    try {
      const m = modelerRef.current
      if (!m) return
      const active = (m as any).getActiveViewer && (m as any).getActiveViewer()
      if (!active) return
      const vBus = active.get && active.get('eventBus')
      if (!vBus) return
      // Mark dirty on any change
      vBus.on('commandStack.changed', markDirty)
    } catch {}
  }, [markDirty])

  React.useEffect(() => {
    if (!containerRef.current) return
    const modeler = new DmnModeler({ container: containerRef.current })
    modelerRef.current = modeler
    onModelerReady && onModelerReady(modeler)

    try {
      const eventBus = (modeler as any).get('eventBus')
      // Mark dirty on any change
      eventBus.on('commandStack.changed', markDirty)
      // rewire on view changes to catch decision table specific events
      eventBus.on('views.changed', () => { attachViewBusListeners() })
    } catch {}

    // Save when focus leaves the canvas
    const handleFocusOut = (e: FocusEvent) => {
      // Check if focus is leaving the wrapper entirely
      const relatedTarget = e.relatedTarget as Node | null
      if (wrapperRef.current && (!relatedTarget || !wrapperRef.current.contains(relatedTarget))) {
        saveIfDirty()
      }
    }
    wrapperRef.current?.addEventListener('focusout', handleFocusOut)

    // Save on any click if there are pending changes (dirty flag prevents duplicate saves)
    const handleDocumentClick = () => saveIfDirty()
    document.addEventListener('click', handleDocumentClick)

    return () => {
      wrapperRef.current?.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('click', handleDocumentClick)
      try { (modeler as any).destroy() } catch {}
      modelerRef.current = null
    }
  }, [markDirty, saveIfDirty, attachViewBusListeners])

  React.useEffect(() => {
    const modeler = modelerRef.current
    if (!modeler || !xml) return
    ignoreChangesRef.current = true
    modeler.importXML(xml)
      .then(async () => {
        try {
          const views = (modeler as any).getViews?.() || []
          const table = views.find((v: any) => v.type === 'decisionTable' || v.type === 'literalExpression')
          if (table) await (modeler as any).open(table)
          else if (views[0]) await (modeler as any).open(views[0])
          // after opening, bind decision table events
          attachViewBusListeners()
        } catch {}
        setTimeout(() => { ignoreChangesRef.current = false }, 0)
      })
      .catch(() => {})
  }, [xml])

  return (
    <div ref={wrapperRef} style={{ height: '100%', background: 'var(--color-bg-primary)', position: 'relative' }}>
      <style>{`
        /* add spacing around table views only */
        .dmn-decision-table-container { padding: 40px 40px 0 40px; box-sizing: border-box; }
        .dmn-literal-expression-container { padding: 40px 40px 0 40px; box-sizing: border-box; }
      `}</style>
      <div ref={containerRef} style={{ height: '100%' }} />
    </div>
  )
}
