import React from 'react'
import { Button, TextInput, Toggle, Tile } from '@carbon/react'
import { Close } from '@carbon/icons-react'
import { PlatformGrid, PlatformRow, PlatformCol } from './PlatformGrid'

interface InviteDomainsSettingsSectionProps {
  inviteAllowAll: boolean
  normalizedInviteDomains: string[]
  inviteDomainInput: string
  setInviteDomainInput: (value: string) => void
  addInviteDomain: () => void
  removeInviteDomain: (domain: string) => void
  onToggleInviteAllowAll: (checked: boolean) => void
}

export function InviteDomainsSettingsSection({
  inviteAllowAll,
  normalizedInviteDomains,
  inviteDomainInput,
  setInviteDomainInput,
  addInviteDomain,
  removeInviteDomain,
  onToggleInviteAllowAll,
}: InviteDomainsSettingsSectionProps) {
  return (
    <PlatformGrid style={{ paddingInline: 0 }}>
      <PlatformRow>
        <PlatformCol sm={4} md={8} lg={16} style={{ marginInlineStart: 0, marginInlineEnd: 0 }}>
          <Tile>
            <h3 style={{ margin: '0 0 var(--spacing-2) 0', fontSize: '16px', fontWeight: 600 }}>Invite Domains</h3>
            <p style={{ margin: '0 0 var(--spacing-4) 0', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
              Control which email domains can be invited from Project Members.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
              <Toggle
                id="invite-allow-all"
                labelText="Allow all domains"
                labelA="No"
                labelB="Yes"
                toggled={!!inviteAllowAll}
                onToggle={onToggleInviteAllowAll}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--spacing-3)', alignItems: 'end', maxWidth: 520 }}>
                <TextInput
                  id="invite-domain-input"
                  labelText="Allowed domains"
                  placeholder="e.g. enterpriseglue.ai"
                  value={inviteDomainInput}
                  disabled={!!inviteAllowAll}
                  onChange={(e) => setInviteDomainInput((e.target as HTMLInputElement).value)}
                  helperText={inviteAllowAll ? 'All domains are allowed' : 'Add domains like enterpriseglue.ai or gmail.com'}
                />
                <Button kind="tertiary" size="md" disabled={!!inviteAllowAll || !inviteDomainInput.trim()} onClick={addInviteDomain}>
                  Add
                </Button>
              </div>

              {!inviteAllowAll && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
                  {normalizedInviteDomains.length === 0 ? (
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>No allowed domains configured.</span>
                  ) : (
                    normalizedInviteDomains.map((d) => (
                      <span
                        key={d}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '2px 6px',
                          border: '1px solid var(--cds-border-subtle-01, #e0e0e0)',
                          borderRadius: 999,
                        }}
                      >
                        <span style={{ fontSize: '14px' }}>{d}</span>
                        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Remove domain" onClick={() => removeInviteDomain(d)} />
                      </span>
                    ))
                  )}
                </div>
              )}
            </div>
          </Tile>
        </PlatformCol>
      </PlatformRow>
    </PlatformGrid>
  )
}
