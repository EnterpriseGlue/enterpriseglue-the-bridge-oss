import React from 'react'
import { ViewerApi } from './viewerTypes'
import { notifyViewportChange, applyZoomWithPadding } from './viewerUtils'
import { 
  ZOOM_STEP,
  ZOOM_ANIMATION_DURATION,
  MAX_ZOOM, 
  MIN_ZOOM, 
  HIGHLIGHT_SRC_CLASS,
  HIGHLIGHT_TGT_CLASS,
  HIGHLIGHT_SELECTED_CLASS,
  PADDING_FACTOR
} from './viewerConstants'

export function useViewerApi(
  viewerRef: React.MutableRefObject<any | null>,
  xmlRef: React.MutableRefObject<string>,
  containerRef: React.MutableRefObject<HTMLDivElement | null>,
  overlayKeysRef: React.MutableRefObject<string[]>,
  srcMarksRef: React.MutableRefObject<string[]>,
  tgtMarksRef: React.MutableRefObject<string[]>,
  selectedElementRef: React.MutableRefObject<string | null>,
  onViewportChange?: (viewport: { x: number; y: number; scale: number }) => void,
  onDiagramReset?: () => void
): ViewerApi | null {
  const [api, setApi] = React.useState<ViewerApi | null>(null)
  
  // Store onDiagramReset in a ref so we always call the latest version
  const onDiagramResetRef = React.useRef(onDiagramReset)
  React.useEffect(() => {
    onDiagramResetRef.current = onDiagramReset
  }, [onDiagramReset])

  React.useEffect(() => {
    const v = viewerRef.current
    if (!v) return

    try {
      const canvas: any = v.get('canvas')
      const elementRegistry: any = v.get('elementRegistry')
      const overlays: any = v.get('overlays')
      const eventBus: any = v.get('eventBus')

      // Animated zoom helper
      const animateZoom = (targetScale: number, duration = ZOOM_ANIMATION_DURATION) => {
        const startScale = canvas.viewbox().scale
        const startTime = performance.now()
        
        const animate = (currentTime: number) => {
          const elapsed = currentTime - startTime
          const progress = Math.min(elapsed / duration, 1)
          
          // Ease-out cubic for smooth deceleration
          const eased = 1 - Math.pow(1 - progress, 3)
          const currentScale = startScale + (targetScale - startScale) * eased
          
          canvas.zoom(currentScale)
          
          if (progress < 1) {
            requestAnimationFrame(animate)
          } else {
            notifyViewportChange(canvas, onViewportChange)
          }
        }
        
        requestAnimationFrame(animate)
      }

      const viewerApi: ViewerApi = {
        zoomIn: () => {
          try {
            const vb = canvas.viewbox()
            const targetScale = Math.min(MAX_ZOOM, vb.scale * ZOOM_STEP)
            animateZoom(targetScale)
          } catch {}
        },

        zoomOut: () => {
          try {
            const vb = canvas.viewbox()
            const targetScale = Math.max(MIN_ZOOM, vb.scale / ZOOM_STEP)
            animateZoom(targetScale)
          } catch {}
        },

        fitViewport: () => {
          try {
            const v = viewerRef.current
            if (!v) return

            // Force canvas to re-read container dimensions after window/pane resize
            canvas.resized()
            applyZoomWithPadding(canvas, PADDING_FACTOR)
            notifyViewportChange(canvas, onViewportChange)

            // Notify parent that diagram was reset so overlays can be re-applied
            // Use requestAnimationFrame to ensure rendering is complete
            if (onDiagramResetRef.current) {
              requestAnimationFrame(() => {
                onDiagramResetRef.current?.()
              })
            }
          } catch {}
        },

        focus: (id: string) => {
          try {
            const el = elementRegistry.get(id)
            if (!el) return
            const vb = canvas.viewbox()
            const cx = el.x + (el.width || 0) / 2
            const cy = el.y + (el.height || 0) / 2
            canvas.scrollTo(cx - vb.width / 2, cy - vb.height / 2)
            notifyViewportChange(canvas, onViewportChange)
          } catch {}
        },

        addBadge: (id: string, html: HTMLElement, position?: { top?: number; right?: number; bottom?: number; left?: number }) => {
          try {
            const pos = position || { top: -8, right: -8 }
            const key = overlays.add(id, { position: pos, html })
            overlayKeysRef.current.push(key)
          } catch {}
        },

        clearBadges: () => {
          try {
            overlays.clear()
          } catch {}
          overlayKeysRef.current = []
        },

        highlightSrc: (id: string) => {
          try {
            canvas.addMarker(id, HIGHLIGHT_SRC_CLASS)
            srcMarksRef.current.push(id)
          } catch {}
        },

        highlightTgt: (id: string) => {
          try {
            canvas.addMarker(id, HIGHLIGHT_TGT_CLASS)
            tgtMarksRef.current.push(id)
          } catch {}
        },

        clearHighlights: () => {
          try {
            for (const id of srcMarksRef.current) canvas.removeMarker(id, HIGHLIGHT_SRC_CLASS)
            for (const id of tgtMarksRef.current) canvas.removeMarker(id, HIGHLIGHT_TGT_CLASS)
          } catch {}
          srcMarksRef.current = []
          tgtMarksRef.current = []
        },

        selectElement: (id: string | null) => {
          try {
            // Clear previous selection
            if (selectedElementRef.current) {
              canvas.removeMarker(selectedElementRef.current, HIGHLIGHT_SELECTED_CLASS)
            }
            // Set new selection
            if (id) {
              canvas.addMarker(id, HIGHLIGHT_SELECTED_CLASS)
            }
            selectedElementRef.current = id
          } catch {}
        },

        getSelectedElement: () => {
          return selectedElementRef.current
        },

        getAllElements: () => {
          try {
            const elements: Array<{ id: string; name: string; type: string; x: number }> = []
            const all = elementRegistry.getAll()
            for (const el of all) {
              // Skip root element and labels
              if (!el.businessObject || el.type === 'label' || el.id === '__implicitroot') continue
              // Include flow nodes (tasks, events, gateways, subprocesses)
              const bo = el.businessObject
              const type = bo.$type || el.type || ''
              // Filter to include only flow nodes (not sequence flows, data objects, etc.)
              if (type.includes('Task') || type.includes('Event') || type.includes('Gateway') || 
                  type.includes('SubProcess') || type.includes('CallActivity')) {
                // Get element name - prefer businessObject.name, fallback to type-based name
                let name = bo.name
                if (!name) {
                  // For elements without names, create a readable name from the type
                  const shortType = type.replace('bpmn:', '')
                  // Add spaces to type name (e.g., "StartEvent" -> "Start Event")
                  const readableType = shortType.replace(/([a-z])([A-Z])/g, '$1 $2')
                  name = readableType
                }
                elements.push({
                  id: el.id,
                  name: name,
                  type: type.replace('bpmn:', ''),
                  x: el.x || 0  // Include x position for sorting
                })
              }
            }
            // Sort by x position (left to right in the flow)
            elements.sort((a, b) => a.x - b.x)
            return elements
          } catch {
            return []
          }
        },

        getViewport: () => {
          try {
            const vb = canvas.viewbox()
            return { x: vb.x, y: vb.y, scale: vb.scale }
          } catch {
            return null
          }
        },

        getContainerRef: () => {
          return containerRef
        },

        getInternals: () => ({
          viewer: v,
          canvas: canvas,
          overlays: overlays,
          elementRegistry: elementRegistry,
          eventBus: eventBus,
          container: containerRef.current!
        })
      }

      setApi(viewerApi)
    } catch {}
  }, [viewerRef.current])

  return api
}
