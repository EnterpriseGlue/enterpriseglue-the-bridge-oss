import { useEffect, useRef, useCallback } from 'react'
import { createCountBadge } from '../../../../shared/components/viewer/viewerUtils'
import { BADGE_STYLES } from '../../../../shared/components/viewer/viewerConstants'
import type { ModificationOperation } from '../types'

// Modification badge colors
const MOD_ADD_COLOR = '#0f62fe'    // Blue - planned additions
const MOD_CANCEL_COLOR = '#da1e28' // Red - planned cancellations

// Badge positions for modification overlays (avoid colliding with existing state badges)
// Adds: top-left corner; Cancels: top-right corner
const MOD_ADD_POSITION = { top: -22, left: -14 }
const MOD_CANCEL_POSITION = { top: -22, right: 14 }

interface UseModificationOverlaysProps {
  bpmnRef: React.MutableRefObject<any>
  modPlan: ModificationOperation[]
  isModMode: boolean
  moveSourceActivityId: string | null
}

export function useModificationOverlays({
  bpmnRef,
  modPlan,
  isModMode,
  moveSourceActivityId,
}: UseModificationOverlaysProps) {
  const overlayKeysRef = useRef<string[]>([])
  const markerIdsRef = useRef<string[]>([])

  const clearModOverlays = useCallback(() => {
    if (!bpmnRef.current) return
    try {
      const overlays = bpmnRef.current.get('overlays')
      for (const key of overlayKeysRef.current) {
        try { overlays.remove(key) } catch {}
      }
    } catch {}
    overlayKeysRef.current = []

    // Remove modification markers
    try {
      const canvas = bpmnRef.current.get('canvas')
      for (const id of markerIdsRef.current) {
        try { canvas.removeMarker(id, 'highlight-mod-add') } catch {}
        try { canvas.removeMarker(id, 'highlight-mod-cancel') } catch {}
        try { canvas.removeMarker(id, 'highlight-mod-move-source') } catch {}
      }
    } catch {}
    markerIdsRef.current = []
  }, [bpmnRef])

  const applyModOverlays = useCallback(() => {
    if (!bpmnRef.current || !isModMode) return
    clearModOverlays()

    const overlays = bpmnRef.current.get('overlays')
    const elementRegistry = bpmnRef.current.get('elementRegistry')
    const canvas = bpmnRef.current.get('canvas')
    if (!overlays || !elementRegistry || !canvas) return

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
      } catch {}
    }

    // Compute add/cancel counts per activity
    const addCounts = new Map<string, number>()
    const cancelCounts = new Map<string, number>()

    for (const op of modPlan) {
      if ((op.kind === 'add' || op.kind === 'addAfter') && op.activityId) {
        addCounts.set(op.activityId, (addCounts.get(op.activityId) || 0) + 1)
      } else if (op.kind === 'cancel' && op.activityId) {
        cancelCounts.set(op.activityId, (cancelCounts.get(op.activityId) || 0) + 1)
      } else if (op.kind === 'move') {
        if (op.fromActivityId) {
          cancelCounts.set(op.fromActivityId, (cancelCounts.get(op.fromActivityId) || 0) + 1)
        }
        if (op.toActivityId) {
          addCounts.set(op.toActivityId, (addCounts.get(op.toActivityId) || 0) + 1)
        }
      }
    }

    // Add badges for planned additions (blue +N)
    for (const [actId, count] of addCounts) {
      const el = elementRegistry.get(actId)
      if (!el) continue
      const badge = createCountBadge(`+${count}`, {
        backgroundColor: MOD_ADD_COLOR,
        color: '#ffffff',
        fontSize: BADGE_STYLES.fontSize,
        fontWeight: BADGE_STYLES.fontWeight,
        ...BADGE_STYLES.default,
        noIcon: true,
      })
      safeAddOverlay(actId, MOD_ADD_POSITION, badge)
      try {
        canvas.addMarker(actId, 'highlight-mod-add')
        markerIdsRef.current.push(actId)
      } catch {}
    }

    // Add badges for planned cancellations (red -N)
    for (const [actId, count] of cancelCounts) {
      const el = elementRegistry.get(actId)
      if (!el) continue
      const badge = createCountBadge(`-${count}`, {
        backgroundColor: MOD_CANCEL_COLOR,
        color: '#ffffff',
        fontSize: BADGE_STYLES.fontSize,
        fontWeight: BADGE_STYLES.fontWeight,
        ...BADGE_STYLES.default,
        noIcon: true,
      })
      safeAddOverlay(actId, MOD_CANCEL_POSITION, badge)
      if (!markerIdsRef.current.includes(actId)) {
        try {
          canvas.addMarker(actId, 'highlight-mod-cancel')
          markerIdsRef.current.push(actId)
        } catch {}
      }
    }

    // Highlight move source node in orange
    if (moveSourceActivityId) {
      const el = elementRegistry.get(moveSourceActivityId)
      if (el) {
        try {
          canvas.addMarker(moveSourceActivityId, 'highlight-mod-move-source')
          if (!markerIdsRef.current.includes(moveSourceActivityId)) {
            markerIdsRef.current.push(moveSourceActivityId)
          }
        } catch {}
      }
    }
  }, [bpmnRef, modPlan, isModMode, moveSourceActivityId, clearModOverlays])

  // Apply overlays when mod plan or mode changes
  useEffect(() => {
    if (isModMode) {
      applyModOverlays()
    } else {
      clearModOverlays()
    }
  }, [isModMode, modPlan, moveSourceActivityId, applyModOverlays, clearModOverlays])

  // Inject modification highlight CSS
  useEffect(() => {
    const css = `
      .highlight-mod-add .djs-visual > rect,
      .highlight-mod-add .djs-visual > circle,
      .highlight-mod-add .djs-visual > polygon {
        stroke: ${MOD_ADD_COLOR} !important;
        stroke-width: 2px !important;
        stroke-dasharray: 6 3 !important;
      }
      .highlight-mod-cancel .djs-visual > rect,
      .highlight-mod-cancel .djs-visual > circle,
      .highlight-mod-cancel .djs-visual > polygon {
        stroke: ${MOD_CANCEL_COLOR} !important;
        stroke-width: 2px !important;
        stroke-dasharray: 6 3 !important;
      }
      .highlight-mod-move-source .djs-visual > rect,
      .highlight-mod-move-source .djs-visual > circle,
      .highlight-mod-move-source .djs-visual > polygon {
        stroke: #ff832b !important;
        stroke-width: 3px !important;
        stroke-dasharray: 8 4 !important;
        fill: rgba(255, 131, 43, 0.08) !important;
      }
    `
    let style = document.getElementById('wm-bpmn-mod-highlight') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'wm-bpmn-mod-highlight'
      document.head.appendChild(style)
    }
    style.textContent = css
    return () => {
      const s = document.getElementById('wm-bpmn-mod-highlight')
      if (s) s.remove()
    }
  }, [])

  return { applyModOverlays, clearModOverlays }
}
