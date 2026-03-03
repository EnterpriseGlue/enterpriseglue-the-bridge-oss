// Zoom configuration
export const ZOOM_STEP = 1.05  // Multiplier for zoom (1.15 = 15% per step)
export const ZOOM_ANIMATION_DURATION = 250  // ms for zoom animation
export const MAX_ZOOM = 4
export const MIN_ZOOM = 0.2
export const PADDING_FACTOR = 0.95

// Badge center should coincide with the geometric corner point (as if corner-radius was 0)
const BADGE_HEIGHT = 18
const BADGE_MIN_WIDTH = 28

export const BADGE_POSITIONS_RECTANGLE = {
  active: { bottom: BADGE_HEIGHT / 2, left: -BADGE_MIN_WIDTH / 2 },       // Bottom Left
  incidents: { bottom: BADGE_HEIGHT / 2, right: BADGE_MIN_WIDTH / 2 },    // Bottom Right
  suspended: { top: -BADGE_HEIGHT / 2, right: BADGE_MIN_WIDTH / 2 },      // Top Right
  canceled: { top: -BADGE_HEIGHT / 2, left: -BADGE_MIN_WIDTH / 2 },       // Top Left
  completed: { top: -BADGE_HEIGHT / 2, right: BADGE_MIN_WIDTH / 2 },      // Top Right (for circles/end events)
} as const

// Badge default styles (centralized)
export const BADGE_STYLES = {
  fontFamily: "'IBM Plex Sans', system-ui",
  fontSize: '13px',
  fontWeight: 'bold',
  default: {
    borderRadius: '9999px',
    padding: '0 8px',
    lineHeight: '18px',
    height: '18px',
    minWidth: '28px',
  },
  // Pill variant (alias for default, kept for compatibility)
  pill: {
    borderRadius: '9999px',
    padding: '0 8px',
    lineHeight: '20px',
    height: '20px',
    minWidth: '28px',
  },
}

// Instance state colors (centralized for badges, filters, overlays)
export const STATE_COLORS = {
  active: { bg: '#24a148', fg: '#ffffff' },      // Green - var(--color-success)
  completed: { bg: '#697077', fg: '#ffffff' },   // Gray (same as canceled)
  incidents: { bg: '#da1e28', fg: '#ffffff' },   // Red - var(--color-error)
  canceled: { bg: '#697077', fg: '#ffffff' },    // Cool gray
  suspended: { bg: '#ff832b', fg: '#ffffff' },   // Orange
} as const

export type InstanceState = keyof typeof STATE_COLORS

// Highlight CSS classes
export const HIGHLIGHT_SRC_CLASS = 'vt-highlight-src'
export const HIGHLIGHT_TGT_CLASS = 'vt-highlight-tgt'
export const HIGHLIGHT_SELECTED_CLASS = 'highlight-selected'

// Highlight styles
export const HIGHLIGHT_STYLES = `
  /* Emphasize outline so highlight is always visible */
  .djs-element.vt-highlight-src .djs-outline { stroke: var(--cds-link-01) !important; stroke-width: 4px !important; opacity: 1 !important; filter: drop-shadow(0 0 2px var(--cds-link-01)); }
  .djs-element.vt-highlight-tgt .djs-outline { stroke: var(--cds-link-01) !important; stroke-width: 4px !important; opacity: 1 !important; filter: drop-shadow(0 0 2px var(--cds-link-01)); }
`
