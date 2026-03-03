import { useEffect, useRef, useState, useCallback } from 'react'
import { createCountBadge, getBadgePosition, getCompletionDotPosition } from '../../../../shared/components/viewer/viewerUtils'

interface UseDiagramOverlaysOptions {
  isSuspended?: boolean
  showTokenPassCounts?: boolean
}

export function useDiagramOverlays(actQ: any, incidentsQ: any, options?: UseDiagramOverlaysOptions) {
  const isSuspended = options?.isSuspended ?? false
  const showTokenPassCounts = options?.showTokenPassCounts ?? false
  const [viewerApi, setViewerApi] = useState<any>(null)
  const bpmnRef = useRef<any>(null)
  const overlayKeysRef = useRef<string[]>([])

  // Store internals when viewer is ready
  useEffect(() => {
    if (viewerApi) {
      const internals = viewerApi.getInternals()
      bpmnRef.current = internals.viewer
    }
  }, [viewerApi])

  const applyOverlays = useCallback(() => {
    if (!bpmnRef.current || !actQ.data) return
    const overlays = bpmnRef.current.get('overlays')
    const elementRegistry = bpmnRef.current.get('elementRegistry')
    const canvas = bpmnRef.current.get('canvas')
    if (!overlays || !elementRegistry) return

    const safeAddOverlay = (
      elementId: string,
      position: Record<string, number>,
      html: HTMLElement,
    ) => {
      try {
        const container = canvas?._container as HTMLElement | undefined
        if (container && !container.isConnected) return
        const key = overlays.add(elementId, { position, html })
        overlayKeysRef.current.push(key)
      } catch {
        // ignore
      }
    }
    for (const key of overlayKeysRef.current) {
      try {
        overlays.remove(key)
      } catch {}
    }
    overlayKeysRef.current = []

    // Categorize activities by state
    const activeCounts = new Map<string, number>()
    const suspendedCounts = new Map<string, number>()
    const canceledCounts = new Map<string, number>()
    const completedCounts = new Map<string, number>()
    const tokenPassCounts = new Map<string, number>()
    
    for (const a of actQ.data || []) {
      const id = a.activityId
      if (!id) continue

      tokenPassCounts.set(id, (tokenPassCounts.get(id) || 0) + 1)
      
      if (a.canceled) {
        // Canceled activity
        canceledCounts.set(id, (canceledCounts.get(id) || 0) + 1)
      } else if (!a.endTime) {
        // Still running - check if suspended
        if (isSuspended) {
          suspendedCounts.set(id, (suspendedCounts.get(id) || 0) + 1)
        } else {
          activeCounts.set(id, (activeCounts.get(id) || 0) + 1)
        }
      } else {
        // Finished normally - count completions
        completedCounts.set(id, (completedCounts.get(id) || 0) + 1)
      }
    }

    const incidentCounts = new Map<string, number>()
    for (const inc of incidentsQ.data || []) {
      const actId = (inc as any).activityId as string | undefined
      if (!actId) continue
      incidentCounts.set(actId, (incidentCounts.get(actId) || 0) + 1)
    }

    // Active badges - Bottom Left (green)
    // Skip activities that have incidents (they get incident badge instead)
    for (const [actId, count] of activeCounts) {
      if (incidentCounts.has(actId)) continue
      const el = elementRegistry.get(actId)
      if (!el) continue
      try {
        canvas.addMarker(actId, 'highlight-active')
      } catch {}
      const badge = createCountBadge(count, 'active')
      const position = getBadgePosition('active')
      safeAddOverlay(actId, position, badge)
    }

    // Incident badges - Bottom Right (red)
    for (const [actId, count] of incidentCounts) {
      const el = elementRegistry.get(actId)
      if (!el) continue
      const badge = createCountBadge(count, 'incidents')
      const position = getBadgePosition('incidents')
      safeAddOverlay(actId, position, badge)
    }

    // Suspended badges - Top Right (yellow)
    for (const [actId, count] of suspendedCounts) {
      if (incidentCounts.has(actId)) continue  // Incidents take priority
      const el = elementRegistry.get(actId)
      if (!el) continue
      const badge = createCountBadge(count, 'suspended')
      const position = getBadgePosition('suspended')
      safeAddOverlay(actId, position, badge)
    }

    // Canceled badges - Top Left (brown)
    for (const [actId, count] of canceledCounts) {
      const el = elementRegistry.get(actId)
      if (!el) continue
      const badge = createCountBadge(count, 'canceled')
      const position = getBadgePosition('canceled')
      safeAddOverlay(actId, position, badge)
    }

    // Historic token pass count badges - Top Center (toggleable)
    // Top-center avoids collision with existing corner badges and bottom-center link pills.
    if (showTokenPassCounts) {
      for (const [actId, count] of tokenPassCounts) {
        const el: any = elementRegistry.get(actId)
        if (!el) continue

        const badge = createCountBadge(count, {
          backgroundColor: '#343a3f',
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: '600',
          borderRadius: '9999px',
          padding: '0 6px',
          lineHeight: '16px',
          height: '16px',
          minWidth: '22px',
          noIcon: true,
        })
        badge.style.transform = 'translateX(-50%)'
        badge.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.25)'
        badge.style.pointerEvents = 'none'

        const width = Number(el.width || 0)
        const position = {
          top: -20,
          left: width ? width / 2 : 0,
        }
        safeAddOverlay(actId, position, badge)
      }
    }

    // Completed badges - Top Right (gray) for end events only
    for (const [actId, count] of completedCounts) {
      // Skip if activity is also active, suspended, or canceled
      if (activeCounts.has(actId) || suspendedCounts.has(actId) || canceledCounts.has(actId)) continue
      const el = elementRegistry.get(actId)
      if (!el) continue
      try {
        canvas.addMarker(actId, 'highlight-completed')
      } catch {}
      
      // Add completed badge for end events (circles)
      const elType = el.businessObject?.$type || ''
      if (elType.includes('EndEvent')) {
        const badge = createCountBadge(count, 'completed')
        const position = getBadgePosition('completed')
        safeAddOverlay(actId, position, badge)
      }
    }

    // Ensure arrow marker exists for flows
    setTimeout(() => {
      try {
        if (!bpmnRef.current) return
        const container = bpmnRef.current.get('canvas')._container
        const svg = container?.querySelector('svg')
        if (svg) {
          const existingMarker = svg.querySelector('#sequenceflow-end-blue')
          if (existingMarker) {
            existingMarker.remove()
          }
          let defs = svg.querySelector('defs')
          if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
            svg.insertBefore(defs, svg.firstChild)
          }
          const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker')
          marker.setAttribute('id', 'sequenceflow-end-blue')
          marker.setAttribute('viewBox', '0 0 20 20')
          marker.setAttribute('refX', '11')
          marker.setAttribute('refY', '10')
          marker.setAttribute('markerWidth', '10')
          marker.setAttribute('markerHeight', '10')
          marker.setAttribute('orient', 'auto')
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          path.setAttribute('d', 'M 1 5 L 11 10 L 1 15 Z')
          path.setAttribute('fill', 'var(--cds-link-01)')
          marker.appendChild(path)
          defs.appendChild(marker)
        }
      } catch {}

      // Highlight completed flows
      try {
        if (!bpmnRef.current) return
        const elementRegistry = bpmnRef.current.get('elementRegistry')
        const canvas = bpmnRef.current.get('canvas')
        if (!elementRegistry || !canvas) return

        const completedSet = new Set<string>()
        const activeSet = new Set<string>()
        for (const a of actQ.data || []) {
          const id = a.activityId
          if (!id) continue
          if (a.endTime) completedSet.add(id)
          else activeSet.add(id)
        }

        for (const id of [...completedSet, ...activeSet]) {
          const el: any = elementRegistry.get(id)
          if (!el || !el.outgoing) continue
          for (const flow of el.outgoing) {
            const tgtId = flow?.target?.id
            if (!tgtId) continue
            if (completedSet.has(tgtId) || activeSet.has(tgtId)) {
              try {
                canvas.addMarker(flow.id, 'highlight-completed-flow')
              } catch {}
            }
          }
        }
      } catch {}
    }, 50)
  }, [actQ.data, incidentsQ.data, isSuspended, showTokenPassCounts])

  // Inject styles for highlight markers
  // Only target direct shape children (rect, circle, polygon) - exclude path to avoid icons
  useEffect(() => {
    const css = `
      .highlight-completed .djs-visual > rect,
      .highlight-completed .djs-visual > circle,
      .highlight-completed .djs-visual > polygon { stroke: var(--cds-link-01) !important; }
      g.djs-element.djs-connection.highlight-completed-flow .djs-visual > path,
      g.djs-element.djs-connection.highlight-completed-flow .djs-visual > polyline,
      .djs-connection.highlight-completed-flow .djs-visual > path,
      .djs-connection.highlight-completed-flow .djs-visual > polyline { stroke: var(--cds-link-01) !important; stroke-opacity: 0.75 !important; fill: none !important; marker-end: url(#sequenceflow-end-blue) !important; }
      .highlight-active .djs-visual > rect,
      .highlight-active .djs-visual > circle,
      .highlight-active .djs-visual > polygon { stroke: var(--cds-link-01) !important; }
      .highlight-hover .djs-visual > rect,
      .highlight-hover .djs-visual > circle,
      .highlight-hover .djs-visual > polygon { stroke: var(--cds-link-01) !important; fill: var(--cds-layer-hover-01) !important; }
      .highlight-selected .djs-visual > rect,
      .highlight-selected .djs-visual > circle,
      .highlight-selected .djs-visual > polygon { stroke: var(--cds-link-01) !important; fill: var(--cds-highlight) !important; }
    `
    let style = document.getElementById('wm-bpmn-highlight') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'wm-bpmn-highlight'
      document.head.appendChild(style)
    }
    style!.textContent = css
    return () => {
      const s = document.getElementById('wm-bpmn-highlight')
      if (s) s.remove()
    }
  }, [])

  return {
    viewerApi,
    setViewerApi,
    bpmnRef,
    applyOverlays,
  }
}
