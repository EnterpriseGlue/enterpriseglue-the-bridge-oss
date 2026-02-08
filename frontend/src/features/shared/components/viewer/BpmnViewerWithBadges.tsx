import React, { useRef, useEffect, useCallback } from 'react'
import { createCountBadge, getBadgePosition } from './viewerUtils'
import { BADGE_STYLES } from './viewerConstants'
import type { InstanceState } from './viewerConstants'

const Viewer = React.lazy(() => import('../Viewer'))

export interface BadgeConfig {
  activityId: string
  count: number | string
  state?: InstanceState
  color?: string
  position?: 'active' | 'incidents' | 'suspended' | 'canceled' | 'completed'
  customPosition?: Record<string, number>
  customStyle?: {
    backgroundColor?: string
    color?: string
  }
}

export interface BpmnViewerWithBadgesProps {
  xml: string
  badges?: BadgeConfig[]
  highlights?: Array<{ activityId: string; className: string }>
  onReady?: (api: any) => void
  onDiagramReset?: () => void
  onElementClick?: (activityId: string) => void
}

export function BpmnViewerWithBadges({
  xml,
  badges = [],
  highlights = [],
  onReady,
  onDiagramReset,
  onElementClick,
}: BpmnViewerWithBadgesProps) {
  const viewerApiRef = useRef<any>(null)
  const bpmnRef = useRef<any>(null)
  const overlayKeysRef = useRef<string[]>([])

  const applyBadges = useCallback(() => {
    if (!bpmnRef.current) return
    const overlays = bpmnRef.current.get('overlays')
    const elementRegistry = bpmnRef.current.get('elementRegistry')
    const canvas = bpmnRef.current.get('canvas')
    if (!overlays || !elementRegistry || !canvas) return

    // Clear existing overlays
    for (const key of overlayKeysRef.current) {
      try { overlays.remove(key) } catch {}
    }
    overlayKeysRef.current = []

    // Clear existing highlights
    for (const h of highlights) {
      try { canvas.removeMarker(h.activityId, h.className) } catch {}
    }

    // Apply badges
    for (const badge of badges) {
      const el = elementRegistry.get(badge.activityId)
      if (!el) continue

      const position = badge.customPosition || getBadgePosition(badge.position || 'active')
      let badgeEl: HTMLElement

      if (badge.customStyle) {
        badgeEl = createCountBadge(badge.count, {
          backgroundColor: badge.customStyle.backgroundColor,
          color: badge.customStyle.color || '#ffffff',
          fontSize: BADGE_STYLES.fontSize,
          fontWeight: BADGE_STYLES.fontWeight,
          ...BADGE_STYLES.default,
        })
      } else {
        badgeEl = createCountBadge(badge.count, badge.state || 'active')
      }

      try {
        const key = overlays.add(badge.activityId, { position, html: badgeEl })
        overlayKeysRef.current.push(key)
      } catch {}
    }

    // Apply highlights
    for (const h of highlights) {
      try { canvas.addMarker(h.activityId, h.className) } catch {}
    }
  }, [badges, highlights])

  const handleReady = useCallback((api: any) => {
    viewerApiRef.current = api
    const internals = api.getInternals()
    bpmnRef.current = internals.viewer

    // Set up element click handler
    if (onElementClick) {
      const eventBus = bpmnRef.current.get('eventBus')
      if (eventBus) {
        eventBus.on('element.click', (e: any) => {
          const el = e?.element
          if (!el || el.waypoints) return
          const id = el.businessObject?.id || el.id
          if (id) onElementClick(id)
        })
      }
    }

    onReady?.(api)
  }, [onReady, onElementClick])

  const handleDiagramReset = useCallback(() => {
    applyBadges()
    onDiagramReset?.()
  }, [applyBadges, onDiagramReset])

  // Re-apply badges when they change
  useEffect(() => {
    applyBadges()
  }, [applyBadges])

  return (
    <React.Suspense
      fallback={
        <div style={{ padding: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-tertiary)' }}>
          Loading diagram...
        </div>
      }
    >
      <Viewer xml={xml} onReady={handleReady} onDiagramReset={handleDiagramReset} />
    </React.Suspense>
  )
}
