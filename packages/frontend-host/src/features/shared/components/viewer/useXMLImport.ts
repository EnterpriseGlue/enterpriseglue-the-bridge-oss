import React from 'react'
import { applyZoomWithPadding } from './viewerUtils'
import { PADDING_FACTOR } from './viewerConstants'

export function useXMLImport(
  viewerRef: React.MutableRefObject<any | null>,
  xmlRef: React.MutableRefObject<string>,
  xml: string,
  initialViewport?: { x: number; y: number; scale: number },
  onImportComplete?: () => void
) {
  // Store callback in ref to always call latest version
  const onImportCompleteRef = React.useRef(onImportComplete)
  React.useEffect(() => {
    onImportCompleteRef.current = onImportComplete
  }, [onImportComplete])

  React.useEffect(() => {
    const v = viewerRef.current
    if (!v || !xml) return

    xmlRef.current = xml // Store current XML for fitViewport reset

    v.importXML(xml).then(() => {
      try {
        const canvas: any = v.get('canvas')
        
        // If we have an initial viewport, restore it; otherwise fit to viewport
        if (initialViewport) {
          // First zoom to the saved scale
          canvas.zoom(initialViewport.scale)
          // Then set the viewbox position
          const currentVb = canvas.viewbox()
          canvas.viewbox({
            x: initialViewport.x,
            y: initialViewport.y,
            width: currentVb.width,
            height: currentVb.height
          })
        } else {
          // Fit to viewport with padding
          applyZoomWithPadding(canvas, PADDING_FACTOR)
        }
        
        // Notify that import is complete (for applying overlays, extracting elements, etc.)
        if (onImportCompleteRef.current) {
          requestAnimationFrame(() => {
            onImportCompleteRef.current?.()
          })
        }
      } catch {}
    }).catch(() => {})
  }, [xml, initialViewport])
}
