/**
 * Design Tokens - TypeScript Constants
 * Use these when you need to reference design tokens in JavaScript/TypeScript
 * For inline styles that must be dynamic based on props or state
 * 
 * Prefer CSS variables (in theme.css) for static styles
 */

export const colors = {
  // EnterpriseGlue Brand Colors
  eg: {
    white: '#ffffff',
    oldLace: '#fffce3',
    gainsboro: '#e2dedb',
    gray: '#78797e',
    gray1: '#808080',
    burntOrange: '#dc4e2f',
    blue: '#0000ee',
    darkGray: '#1c1b1d',
    black: '#000000',
  },

  // Primary Colors
  primary: '#0f62fe',
  primaryHover: '#0043ce',

  // Text Colors
  text: {
    primary: '#161616',
    secondary: '#525252',
    tertiary: '#8d8d8d',
    disabled: '#c6c6c6',
    inverse: '#ffffff',
  },

  // Background Colors
  bg: {
    primary: '#ffffff',
    secondary: '#f4f4f4',
    tertiary: '#e8e8e8',
    hover: '#f0f0f0',
    active: '#8d8d8d31',
  },

  // Border Colors
  border: {
    primary: '#e0e0e0',
    secondary: '#c6c6c6',
    active: '#0f62fe',
  },

  // UI Element Colors
  ui: {
    headerBg: '#f4f4f4',
    sidebarBg: '#f4f4f4',
    divider: '#c6c6c6',
  },

  // Status Colors
  status: {
    success: '#24a148',
    warning: '#f1c21b',
    error: '#da1e28',
    info: '#0f62fe',
  },

  // Icon Colors
  icon: {
    primary: '#161616',
    secondary: '#525252',
    tertiary: '#545454',
  },
} as const;

export const fonts = {
  // Font Families
  budujSans: "'Buduj Sans', sans-serif",
  inter: 'Inter, sans-serif',
  ibmPlexSans: "'IBM Plex Sans', system-ui, 'Segoe UI', Arial, sans-serif",
  ibmPlexMono: "'IBM Plex Mono', 'Courier New', monospace",

  // Primary Fonts
  primary: "'IBM Plex Sans', system-ui, 'Segoe UI', Arial, sans-serif",
  monospace: "'IBM Plex Mono', 'Courier New', monospace",
} as const;

export const typography = {
  // Font Sizes (in px)
  size: {
    12: '0.75rem',
    14: '0.875rem',
    16: '1rem',
    18: '1.125rem',
    20: '1.25rem',
    24: '1.5rem',
    28: '1.75rem',
    30: '1.875rem',
    32: '2rem',
    44: '2.75rem',
    70: '4.375rem',
  },

  // Font Weights
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  // Line Heights
  lineHeight: {
    none: 1,
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
    loose: 2,
  },

  // Letter Spacing
  letterSpacing: {
    tight: '-0.003em',
    normal: '0',
    wide: '0.16px',
  },
} as const;

export const spacing = {
  0: '0',
  1: '0.25rem',   // 4px
  2: '0.5rem',    // 8px
  3: '0.75rem',   // 12px
  4: '1rem',      // 16px
  5: '1.5rem',    // 24px
  6: '2rem',      // 32px
  7: '2.5rem',    // 40px
  8: '3rem',      // 48px
  10: '4rem',     // 64px
} as const;

export const borderRadius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
  md: '0 2px 6px rgba(0, 0, 0, 0.1)',
  lg: '0 4px 12px rgba(0, 0, 0, 0.15)',
  xl: '0 8px 24px rgba(0, 0, 0, 0.2)',
} as const;

export const zIndex = {
  dropdown: 100,
  sticky: 200,
  fixed: 300,
  modalBackdrop: 900,
  modal: 1000,
  overlayToggle: 1002,
  popover: 1100,
  tooltip: 1200,
  toast: 3000,
  dragOverlay: 9999,
} as const;

export const transitions = {
  fast: '150ms ease-in-out',
  base: '250ms ease-in-out',
  slow: '350ms ease-in-out',
} as const;

export const components = {
  header: {
    height: '48px',
  },
  sidebar: {
    width: '256px',
    itemHeight: '48px',
  },
  table: {
    rowHeight: '50px',
  },
  button: {
    height: '48px',
  },
} as const;

/**
 * Helper function to build inline styles using design tokens
 * Prefer using CSS classes when possible
 */
export function buildStyle(styleProps: Record<string, any>) {
  return styleProps;
}

/**
 * Type-safe helper to reference CSS variables in inline styles
 * Usage: cssVar('color-primary') => 'var(--color-primary)'
 */
export function cssVar(name: string): string {
  return `var(--${name})`;
}
