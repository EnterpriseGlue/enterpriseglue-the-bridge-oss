import React from 'react'
import { Warning, Locked } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useNavigate } from 'react-router-dom'

interface EngineAccessErrorProps {
  status: 403 | 503 | number
  message?: string
  actionPath?: string
  actionLabel?: string
}

export function EngineAccessError({ status, message, actionPath = '/mission-control', actionLabel = 'Back to Mission Control' }: EngineAccessErrorProps) {
  const navigate = useNavigate()

  const is503 = status === 503
  const title = is503 ? 'No Active Engine' : 'Access Denied'
  const description = is503
    ? 'There is no active engine configured. Please contact your administrator to set up an engine.'
    : message || 'You do not have permission to access Mission Control for the active engine.'

  const Icon = is503 ? Warning : Locked

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
      <Icon size={48} style={{ color: is503 ? 'var(--color-warning)' : 'var(--color-error)', marginBottom: 'var(--spacing-4)' }} />
      <h2 style={{ fontSize: 'var(--text-20)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)', marginBottom: 'var(--spacing-2)' }}>
        {title}
      </h2>
      <p style={{ fontSize: 'var(--text-14)', maxWidth: '400px', marginBottom: 'var(--spacing-5)' }}>
        {description}
      </p>
      <Button kind="tertiary" size="sm" onClick={() => navigate(actionPath)}>
        {actionLabel}
      </Button>
    </div>
  )
}

export function isEngineAccessError(error: unknown): { status: 403 | 503; message?: string } | null {
  if (!error) return null
  const status = (error as any)?.status ?? extractStatusFromMessage(error)
  if (status === 403 || status === 503) {
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
