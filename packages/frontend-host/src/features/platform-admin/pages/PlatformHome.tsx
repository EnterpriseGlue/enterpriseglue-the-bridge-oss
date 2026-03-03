import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { UserAvatar, Document, Security, UserMultiple, Settings, Policy, RecentlyViewed, Enterprise } from '@carbon/icons-react'
import { PageLayout, PageHeader, PAGE_GRADIENTS } from '../../../shared/components/PageLayout'

export default function PlatformHome() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  const cards = [
    {
      title: 'Platform Settings',
      description: 'Configure platform-wide settings, environments, and default behaviors.',
      icon: Settings,
      path: '/admin/settings',
      color: '#0f62fe'
    },
    {
      title: 'SSO Role Mappings',
      description: 'Map SSO claims (groups, roles, email domains) to platform roles for automatic provisioning.',
      icon: UserMultiple,
      path: '/admin/sso-mappings',
      color: '#8a3ffc'
    },
    {
      title: 'Authorization Policies',
      description: 'Define ABAC policies with conditions for fine-grained access control beyond roles.',
      icon: Policy,
      path: '/admin/policies',
      color: '#009d9a'
    },
    {
      title: 'Authorization Audit',
      description: 'View authorization decision history for compliance, debugging, and security review.',
      icon: RecentlyViewed,
      path: '/admin/authz-audit',
      color: '#da1e28'
    },
    {
      title: 'Tenant Management',
      description: 'Create and manage tenants, assign tenant admins, and configure tenant-specific settings.',
      icon: Enterprise,
      path: '/admin/tenants',
      color: '#198038'
    },
    {
      title: 'User Management',
      description: 'Manage users, create accounts, assign roles, and control access across the platform.',
      icon: UserAvatar,
      path: '/admin/users',
      color: '#0072c3'
    },
    {
      title: 'System Audit Logs',
      description: 'Track and review all system activities, user actions, and security events.',
      icon: Document,
      path: '/admin/audit-logs',
      color: '#6929c4'
    }
  ]

  return (
    <PageLayout style={{ 
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--spacing-5)',
      background: 'var(--color-bg-primary)',
      minHeight: '100vh'
    }}>
      <PageHeader
        icon={Security}
        title="Admin"
        subtitle="Identity and Access Management - Control who can see and do what across the platform"
        gradient={PAGE_GRADIENTS.red}
      />

      {/* Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 'var(--spacing-4)'
      }}>
        {cards.map((card) => {
          const Icon = card.icon
          
          return (
            <div
              key={card.path}
              onClick={() => navigate(toTenantPath(card.path))}
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-primary)',
                borderRadius: '8px',
                padding: 'var(--spacing-6)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
                e.currentTarget.style.borderColor = card.color
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)'
                e.currentTarget.style.borderColor = 'var(--color-border-primary)'
              }}
            >
              {/* Icon */}
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '4px',
                backgroundColor: `${card.color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 'var(--spacing-5)'
              }}>
                <Icon size={24} style={{ color: card.color }} />
              </div>

              {/* Title */}
              <h3 style={{
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: 'var(--spacing-3)',
                color: 'var(--color-text-primary)'
              }}>
                {card.title}
              </h3>

              {/* Description */}
              <p style={{
                fontSize: '14px',
                lineHeight: '1.5',
                color: 'var(--color-text-secondary)',
                marginBottom: 0
              }}>
                {card.description}
              </p>

            </div>
          )
        })}
      </div>
    </PageLayout>
  )
}
