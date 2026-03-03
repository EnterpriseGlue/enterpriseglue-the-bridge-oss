import { PADDING_FACTOR, STATE_COLORS, BADGE_STYLES, BADGE_POSITIONS_RECTANGLE, InstanceState } from './viewerConstants'

/**
 * Notify viewport change callback if provided
 */
export function notifyViewportChange(
  canvas: any,
  onViewportChange?: (viewport: { x: number; y: number; scale: number }) => void
) {
  if (onViewportChange) {
    try {
      const vb = canvas.viewbox()
      onViewportChange({ x: vb.x, y: vb.y, scale: vb.scale })
    } catch {}
  }
}

/**
 * Apply zoom with padding factor to center diagram with breathing room
 */
export function applyZoomWithPadding(canvas: any, paddingFactor: number = PADDING_FACTOR) {
  try {
    canvas.zoom('fit-viewport', 'auto')
    const vb = canvas.viewbox()
    const center = {
      x: vb.x + vb.width / 2,
      y: vb.y + vb.height / 2,
    }
    canvas.zoom(vb.scale * paddingFactor, center)
  } catch {}
}

/**
 * Inject highlight styles into container
 */
export function injectHighlightStyles(container: HTMLElement, styles: string) {
  try {
    const style = document.createElement('style')
    style.textContent = styles
    container.appendChild(style)
  } catch {}
}

/**
 * Create a badge element with count
 * @param count - The count to display
 * @param state - Optional instance state for color (defaults to 'active')
 * @param options - Optional styling overrides
 */
export function createCountBadge(
  count: number | string,
  stateOrOptions?: InstanceState | {
    backgroundColor?: string
    color?: string
    fontFamily?: string
    fontSize?: string
    fontWeight?: string
    borderRadius?: string
    padding?: string
    lineHeight?: string
    height?: string
    minWidth?: string
    noIcon?: boolean
  },
  options?: {
    backgroundColor?: string
    color?: string
    fontFamily?: string
    fontSize?: string
    fontWeight?: string
    borderRadius?: string
    padding?: string
    lineHeight?: string
    height?: string
    minWidth?: string
    noIcon?: boolean
  }
): HTMLElement {
  // Determine state and options based on arguments
  let state: InstanceState = 'active'
  let styleOptions = options
  
  if (typeof stateOrOptions === 'string') {
    state = stateOrOptions
  } else if (stateOrOptions) {
    styleOptions = stateOrOptions
  }
  
  const stateColor = STATE_COLORS[state]
  const defaults = {
    backgroundColor: stateColor.bg,
    color: stateColor.fg,
    fontFamily: BADGE_STYLES.fontFamily,
    fontSize: BADGE_STYLES.fontSize,
    fontWeight: BADGE_STYLES.fontWeight,
    ...BADGE_STYLES.default,
  }
  const opts = { ...defaults, ...styleOptions }
  
  const div = document.createElement('div')

  const numeric = typeof count === 'number' ? count : Number.isFinite(Number(count)) ? Number(count) : null
  const displayCount = numeric !== null && numeric >= 1000 ? '999+' : String(count)

  const getIconSize = (s: InstanceState) => {
    return s === 'active' || s === 'completed' ? 14 : 12
  }

  const makeIcon = (s: InstanceState): SVGElement | null => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const size = getIconSize(s)
    svg.setAttribute('width', String(size))
    svg.setAttribute('height', String(size))
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('fill', '#ffffff')
    svg.setAttribute('aria-hidden', 'true')

    // Simple, theme-friendly glyphs (not exact Carbon paths, but consistent semantics)
    switch (s) {
      case 'active':
        {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        // play
        path.setAttribute('d', 'M6 4.5v7l6-3.5-6-3.5z')
        svg.appendChild(path)
        return svg
        }
      case 'incidents':
        {
        // warning (circle + exclamation)
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circle.setAttribute('cx', '8')
        circle.setAttribute('cy', '8')
        circle.setAttribute('r', '6.25')
        circle.setAttribute('fill', 'none')
        circle.setAttribute('stroke', '#ffffff')
        circle.setAttribute('stroke-width', '1.5')
        svg.appendChild(circle)

        const bang = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        bang.setAttribute('d', 'M8 4.9v4.6')
        bang.setAttribute('fill', 'none')
        bang.setAttribute('stroke', '#ffffff')
        bang.setAttribute('stroke-width', '1.5')
        bang.setAttribute('stroke-linecap', 'round')
        svg.appendChild(bang)

        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        dot.setAttribute('cx', '8')
        dot.setAttribute('cy', '11.5')
        dot.setAttribute('r', '0.85')
        dot.setAttribute('fill', '#ffffff')
        svg.appendChild(dot)
        return svg
        }
      case 'suspended':
        {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        // pause
        path.setAttribute('d', 'M5 3h2v10H5V3zm4 0h2v10H9V3z')
        svg.appendChild(path)
        return svg
        }
      case 'completed':
        {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        // check
        path.setAttribute('d', 'M6.3 11.1 3.6 8.4l1-1 1.7 1.7 5-5 1 1-6 6z')
        svg.appendChild(path)
        return svg
        }
      case 'canceled':
        {
        // error outline (circle + slash)
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        circle.setAttribute('cx', '8')
        circle.setAttribute('cy', '8')
        circle.setAttribute('r', '6.25')
        circle.setAttribute('fill', 'none')
        circle.setAttribute('stroke', '#ffffff')
        circle.setAttribute('stroke-width', '1.5')
        svg.appendChild(circle)

        const slash = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        slash.setAttribute('d', 'M5.25 5.25 10.75 10.75')
        slash.setAttribute('fill', 'none')
        slash.setAttribute('stroke', '#ffffff')
        slash.setAttribute('stroke-width', '1.5')
        slash.setAttribute('stroke-linecap', 'round')
        svg.appendChild(slash)
        return svg
        }
      default:
        return null
    }
  }

  const skipIcon = (typeof stateOrOptions !== 'string' && stateOrOptions?.noIcon) || styleOptions?.noIcon
  const icon = skipIcon ? null : makeIcon(state)
  if (icon) {
    const chip = document.createElement('span')
    const size = getIconSize(state)
    const box = size + 2
    chip.style.cssText =
      `width:${box}px;height:${box}px;border-radius:9999px;display:inline-flex;` +
      `align-items:center;justify-content:center;flex-shrink:0;` +
      `background:transparent;`
    chip.appendChild(icon)
    div.appendChild(chip)
  }

  const text = document.createElement('span')
  text.textContent = displayCount
  div.appendChild(text)

  div.style.cssText = `background:${opts.backgroundColor};color:${opts.color};` +
    `font-family:${opts.fontFamily};font-size:${opts.fontSize};font-weight:${opts.fontWeight};` +
    `border-radius:${opts.borderRadius};padding:${opts.padding};` +
    `line-height:${opts.lineHeight};height:${opts.height};` +
    `display:inline-flex;align-items:center;justify-content:center;gap:4px;` +
    `min-width:${opts.minWidth};`
  return div
}

/**
 * Calculate badge position based on state for rectangle/square shapes
 * Badge center aligns with corner arc center
 * - active: Bottom Left
 * - incidents: Bottom Right
 * - suspended: Top Right
 * - canceled: Top Left
 * - completed: Top Right (for circles/end events)
 */
export function getBadgePosition(state: 'active' | 'incidents' | 'suspended' | 'canceled' | 'completed' = 'active'): Record<string, number> {
  return { ...BADGE_POSITIONS_RECTANGLE[state] }
}

/**
 * Calculate position for completion dot on bottom-left rounded corner
 * Positions dot centered on the bottom-left corner arc
 */
export function getCompletionDotPosition(): { bottom: number; left: number } {
  const dotSize = 10 // width/height of dot
  const dotRadius = dotSize / 2 // 5px
  
  // Position dot so its center sits on the bottom-left corner
  // Align bottom edge with element bottom, extend to the left
  return { bottom: -2, left: dotRadius }
}
