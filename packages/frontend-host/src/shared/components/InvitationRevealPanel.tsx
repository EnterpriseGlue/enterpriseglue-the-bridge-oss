import React from 'react'
import { Button, InlineNotification, TextInput } from '@carbon/react'
import type { InvitationRevealData } from '../utils/invitationFlow'

interface InvitationRevealPanelProps {
  data: InvitationRevealData
  subtitle?: string
}

export default function InvitationRevealPanel({ data, subtitle }: InvitationRevealPanelProps) {
  const [copiedField, setCopiedField] = React.useState<'invite-link' | 'invite-password' | null>(null)

  const copyRevealValue = React.useCallback(async (field: 'invite-link' | 'invite-password', value: string) => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(field)
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current))
      }, 1500)
    } catch {
      setCopiedField(null)
    }
  }, [])

  return (
    <>
      <InlineNotification
        lowContrast
        kind="success"
        title="Invitation ready"
        subtitle={subtitle || `Copy and share the invite link and one-time password for ${data.email}.`}
        hideCloseButton
      />

      <TextInput
        id="invitation-generated-link"
        labelText="Invite link"
        value={data.inviteUrl}
        readOnly
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          kind="ghost"
          size="sm"
          type="button"
          onClick={() => copyRevealValue('invite-link', data.inviteUrl)}
        >
          {copiedField === 'invite-link' ? 'Copied' : 'Copy link'}
        </Button>
      </div>

      <TextInput
        id="invitation-generated-password"
        labelText="One-time password"
        value={data.oneTimePassword}
        readOnly
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          kind="ghost"
          size="sm"
          type="button"
          onClick={() => copyRevealValue('invite-password', data.oneTimePassword)}
        >
          {copiedField === 'invite-password' ? 'Copied' : 'Copy password'}
        </Button>
      </div>
    </>
  )
}
