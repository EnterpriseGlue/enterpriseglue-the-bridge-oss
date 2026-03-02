import React from 'react'
import { CamundaPlatformModeler as DmnModeler } from 'camunda-dmn-js'
import { Button } from '@carbon/react'
import { FitToScreen, Add, Subtract } from '@carbon/icons-react'
import 'camunda-dmn-js/dist/assets/camunda-platform-modeler.css'

type DMNDrdMiniProps = {
  xml: string
  preferDecisionTable?: boolean
  decisionId?: string
  decisionName?: string
  /** Optional list of decision rule IDs to highlight in the decision table view (rows hit by evaluation). */
  hitRuleIds?: string[]
}

/** Read-only CSS: hide all editing affordances from the Camunda modeler */
const READ_ONLY_CSS = `
  /* Hide add-row / add-column buttons, context pads, drag handles, popups */
  .dmn-decision-table-container .add-rule,
  .dmn-decision-table-container .add-input,
  .dmn-decision-table-container .add-output,
  .dmn-decision-table-container .context-menu,
  .dmn-decision-table-container .context-menu-container,
  .dmn-decision-table-container .tjs-table .add-rule-add,
  .djs-palette,
  .djs-context-pad,
  .djs-popup,
  .dmn-decision-table-container .input-cell .add,
  .dmn-decision-table-container .output-cell .add,
  .dmn-decision-table-container .tjs-table .icon-button {
    display: none !important;
  }

  /* Block ALL interactions on the decision table (cells, selects, inputs, etc.) */
  .dmn-decision-table-container .tjs-container {
    pointer-events: none !important;
  }
  .dmn-decision-table-container [contenteditable] {
    pointer-events: none !important;
    cursor: default !important;
    -webkit-user-modify: read-only !important;
  }
  .dmn-decision-table-container .tjs-table td,
  .dmn-decision-table-container .tjs-table th {
    cursor: default !important;
    user-select: text;
  }

  /* Fully disable hit policy and all dropdowns/inputs */
  .dmn-decision-table-container select,
  .dmn-decision-table-container input {
    pointer-events: none !important;
    appearance: none !important;
    -webkit-appearance: none !important;
    cursor: default !important;
  }

  /* Hide the hit-policy editor dropdown arrow */
  .dmn-decision-table-container .hit-policy,
  .dmn-decision-table-container .hit-policy select {
    pointer-events: none !important;
    cursor: default !important;
  }
  .dmn-decision-table-container .hit-policy select {
    background-image: none !important;
  }

  /* Allow the View DRD / View Table button to remain interactive */
  .dmn-decision-table-container .tjs-container .view-drd,
  .dmn-decision-table-container .dmn-decision-table-container__header .view-drd,
  .dmn-decision-table-container [class*="view-drd"] {
    pointer-events: auto !important;
    cursor: pointer !important;
  }

  /* Spacing matching Starbase editor */
  .dmn-decision-table-container { padding: 40px 40px 0 40px; box-sizing: border-box; }
  .dmn-literal-expression-container { padding: 40px 40px 0 40px; box-sizing: border-box; }
`

export default function DMNDrdMini({ xml, preferDecisionTable, decisionId, decisionName, hitRuleIds }: DMNDrdMiniProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const viewerRef = React.useRef<any | null>(null)
  const [hasCanvas, setHasCanvas] = React.useState(false)

  React.useEffect(() => {
    if (!ref.current) return
    const modeler = new DmnModeler({ container: ref.current })
    viewerRef.current = modeler
    return () => { try { (modeler as any).destroy() } catch {} viewerRef.current = null }
  }, [])

  React.useEffect(() => {
    const v = viewerRef.current
    if (!v || !xml) return
    v.importXML(xml).then(async () => {
      try {
        const views = (v as any).getViews?.() || []
        let target: any = null

        if (preferDecisionTable) {
          const candidates = views.filter((vw: any) => vw.type === 'decisionTable')
          if (decisionId) target = candidates.find((vw: any) => vw?.element?.id === decisionId)
          if (!target && decisionName) target = candidates.find((vw: any) => vw?.element?.name === decisionName)
          if (!target) target = candidates[0] || null
        }
        if (!target) {
          target = views.find((vw: any) => vw.type === 'drd') || views[0] || null
        }
        if (target) {
          setHasCanvas(target.type === 'drd')
          await (v as any).open(target)
          if (target.type === 'drd') {
            try {
              const canvas = (v as any).getActiveViewer?.().get('canvas')
              if (canvas) {
                canvas.zoom('fit-viewport')
                setTimeout(() => { try { canvas.zoom('fit-viewport') } catch {} }, 50)
              }
            } catch {}
          }
        } else {
          setHasCanvas(false)
        }
      } catch {}
    }).catch(() => {})
  }, [xml, preferDecisionTable, decisionId, decisionName])

  // Keep hasCanvas in sync with active view (DRD vs decisionTable) when user switches via toolbar
  React.useEffect(() => {
    const v = viewerRef.current
    if (!v) return

    const update = () => {
      try {
        const active: any = (v as any).getActiveView?.()
        setHasCanvas(!!active && active.type === 'drd')
        if (active && active.type === 'drd') {
          try {
            const canvas = (v as any).getActiveViewer?.().get('canvas')
            if (canvas) {
              canvas.zoom('fit-viewport')
              setTimeout(() => { try { canvas.zoom('fit-viewport') } catch {} }, 50)
            }
          } catch {}
        }
      } catch {}
    }

    update()
    try { (v as any).on?.('views.changed', update) } catch {}
    return () => { try { (v as any).off?.('views.changed', update) } catch {} }
  }, [])

  const withCanvas = React.useCallback((fn: (canvas: any) => void) => {
    const v = viewerRef.current
    if (!v) return
    try {
      const canvas = (v as any).getActiveViewer?.().get('canvas')
      if (canvas) fn(canvas)
    } catch {}
  }, [])

  const handleFit = React.useCallback(() => {
    withCanvas((canvas) => canvas.zoom('fit-viewport'))
  }, [withCanvas])

  const handleZoomIn = React.useCallback(() => {
    withCanvas((canvas) => {
      const z = canvas.zoom()
      canvas.zoom(Math.min(2, typeof z === 'number' && isFinite(z) ? z * 1.2 : 1.2))
    })
  }, [withCanvas])

  const handleZoomOut = React.useCallback(() => {
    withCanvas((canvas) => {
      const z = canvas.zoom()
      canvas.zoom(Math.max(0.2, typeof z === 'number' && isFinite(z) ? z * 0.8 : 0.8))
    })
  }, [withCanvas])

  const ruleHighlightCss = React.useMemo(() => {
    if (!hitRuleIds || hitRuleIds.length === 0) return ''
    return hitRuleIds
      .filter((id) => !!id)
      .map((id) => {
        const base = `.dmn-decision-table-container .tjs-table tbody`
        return [
          // Viewer: data attributes on <td>
          `${base} td.rule-index[data-element-id="${id}"]`,
          `${base} td.rule-index[data-row-id="${id}"]`,
          `${base} td[data-row-id="${id}"]`,
          // Modeler: data-element-id on <tr>
          `${base} tr[data-element-id="${id}"]`,
          `${base} tr[data-element-id="${id}"] td`,
        ]
          .map((selector) => `${selector} { background-color: #cce5ff !important; }`)
          .join('\n')
      })
      .join('\n')
  }, [hitRuleIds])

  return (
    <div
      ref={ref}
      style={{
        height: '100%',
        position: 'relative',
        overflow: 'auto',
        backgroundColor: '#ffffff'
      }}
    >
      <style>{READ_ONLY_CSS}{ruleHighlightCss}</style>
      {hasCanvas && (
        <div
          style={{
            position: 'absolute',
            right: 'var(--spacing-3)',
            top: 'var(--spacing-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-2)',
            zIndex: 10,
          }}
        >
          <Button hasIconOnly size="sm" kind="ghost" renderIcon={FitToScreen} iconDescription="Fit" onClick={handleFit} />
          <Button hasIconOnly size="sm" kind="ghost" renderIcon={Add} iconDescription="Zoom in" onClick={handleZoomIn} />
          <Button hasIconOnly size="sm" kind="ghost" renderIcon={Subtract} iconDescription="Zoom out" onClick={handleZoomOut} />
        </div>
      )}
    </div>
  )
}
