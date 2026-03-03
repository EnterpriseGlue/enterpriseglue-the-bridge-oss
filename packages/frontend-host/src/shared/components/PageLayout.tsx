import React from 'react'

interface PageHeaderProps {
  /** The Carbon icon component to display */
  icon: React.ComponentType<{ size: number; style?: React.CSSProperties }>
  /** Page title */
  title: string
  /** Optional subtitle/description */
  subtitle?: string
  /** Gradient colors [start, end] - defaults to blue */
  gradient?: [string, string]
  /** Optional action buttons to display on the right */
  actions?: React.ReactNode
}

interface PageLayoutProps {
  /** Page content */
  children: React.ReactNode
  /** Optional custom padding - defaults to var(--spacing-6) */
  padding?: string
  /** Optional additional styles */
  style?: React.CSSProperties
}

/**
 * Shared page header with gradient icon, title, and optional subtitle
 */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  gradient = ['#0f62fe', '#0043ce'],
  actions,
}: PageHeaderProps) {
  const [startColor, endColor] = gradient
  // Calculate shadow color from start color with 30% opacity
  const shadowColor = startColor + '4D' // 4D = 30% opacity in hex

  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'flex-start', 
      justifyContent: 'space-between', 
      gap: 'var(--spacing-4)',
      marginBottom: 'var(--spacing-5)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
        <div style={{ 
          background: `linear-gradient(135deg, ${startColor} 0%, ${endColor} 100%)`, 
          borderRadius: '8px', 
          padding: '12px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          boxShadow: `0 2px 8px ${shadowColor}`
        }}>
          <Icon size={24} style={{ color: 'white' }} />
        </div>
        <div>
          <h1 style={{ 
            margin: 0, 
            fontSize: '28px', 
            fontWeight: 600, 
            color: 'var(--color-text-primary)' 
          }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ 
              margin: '4px 0 0 0', 
              fontSize: '14px', 
              color: 'var(--color-text-secondary)' 
            }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'center' }}>
          {actions}
        </div>
      )}
    </div>
  )
}

/**
 * Shared page layout wrapper with consistent padding
 */
export function PageLayout({ 
  children, 
  padding = 'var(--spacing-6)',
  style 
}: PageLayoutProps) {
  return (
    <div style={{ 
      padding,
      ...style
    }}>
      {children}
    </div>
  )
}

// Common gradient presets for easy reuse
export const PAGE_GRADIENTS = {
  blue: ['#0f62fe', '#0043ce'] as [string, string],
  purple: ['#8a3ffc', '#6929c4'] as [string, string],
  green: ['#24a148', '#198038'] as [string, string],
  red: ['#da1e28', '#a2191f'] as [string, string],
  teal: ['#0072c3', '#0053a0'] as [string, string],
}
