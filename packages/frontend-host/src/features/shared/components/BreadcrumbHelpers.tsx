import React from 'react'
import { Link } from 'react-router-dom'

// Shared styles
export const breadcrumbStyles = {
  link: {
    fontWeight: 'var(--font-weight-medium)' as const,
    color: 'rgba(255, 255, 255, 0.7)',
    textDecoration: 'none' as const,
    fontFeatureSettings: '"liga"'
  },
  linkActive: {
    fontWeight: 'var(--font-weight-medium)' as const,
    color: 'white',
    textDecoration: 'none' as const,
    fontFeatureSettings: '"liga"'
  },
  text: {
    fontWeight: 'var(--font-weight-medium)' as const,
    color: 'white',
    fontFeatureSettings: '"liga"'
  },
  separator: {
    color: 'rgba(255, 255, 255, 0.5)'
  }
}

interface BreadcrumbLinkProps {
  to: string
  children: React.ReactNode
  isActive?: boolean
}

export function BreadcrumbLink({ to, children, isActive = false }: BreadcrumbLinkProps) {
  return (
    <Link to={to} style={isActive ? breadcrumbStyles.linkActive : breadcrumbStyles.link}>
      {children}
    </Link>
  )
}

interface BreadcrumbTextProps {
  children: React.ReactNode
}

export function BreadcrumbText({ children }: BreadcrumbTextProps) {
  return <span style={breadcrumbStyles.text}>{children}</span>
}

export function BreadcrumbSeparator() {
  return <span style={breadcrumbStyles.separator}>›</span>
}
