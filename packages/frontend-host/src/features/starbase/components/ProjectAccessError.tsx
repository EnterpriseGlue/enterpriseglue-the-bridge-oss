import React from 'react'
import { Warning, Locked } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useTenantNavigate } from '../../../shared/hooks/useTenantNavigate'

interface ProjectAccessErrorProps {
  status: 403 | 404 | number
  message?: string
}

export function ProjectAccessError({ status, message }: ProjectAccessErrorProps) {
  const { tenantNavigate } = useTenantNavigate()

  const is404 = status === 404
  const title = is404 ? 'Project Not Found' : 'Access Denied'
  const description = is404
    ? 'This project does not exist or has been deleted.'
    : message || 'You do not have permission to access this project.'

  const Icon = is404 ? Warning : Locked

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        padding: 'var(--spacing-6)',
        textAlign: 'center',
        color: 'var(--color-text-secondary)',
      }}
    >
      <Icon size={48} style={{ color: is404 ? 'var(--color-warning)' : 'var(--color-error)', marginBottom: 'var(--spacing-4)' }} />
      <h2 style={{ fontSize: 'var(--text-20)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-2)' }}>
        {title}
      </h2>
      <p style={{ fontSize: 'var(--text-14)', maxWidth: '400px', marginBottom: 'var(--spacing-5)' }}>
        {description}
      </p>
      <Button kind="tertiary" size="sm" onClick={() => tenantNavigate('/starbase')}>
        Back to Starbase
      </Button>
    </div>
  )
}

export function isProjectAccessError(error: unknown): { status: 403 | 404; message?: string } | null {
  if (!error) return null
  const status = (error as any)?.status ?? extractStatusFromMessage(error)
  if (status === 403 || status === 404) {
    const message = (error as any)?.message || String(error)
    return { status, message }
  }
  return null
}

function extractStatusFromMessage(error: unknown): number | null {
  const msg = String(error)
  const match = msg.match(/^(\d{3})\s/)
  if (match) return parseInt(match[1], 10)
  return null
}
