import { describe, it, expect } from 'vitest'
import { getInvitationDeliveryOptions, getPreferredInvitationDeliveryMethod } from '../../../../../packages/frontend-host/src/shared/utils/invitationFlow'

describe('invitationFlow', () => {
  it('prefers email delivery when both email and manual delivery are available', () => {
    expect(getPreferredInvitationDeliveryMethod({
      ssoRequired: false,
      emailConfigured: true,
    })).toBe('email')
  })

  it('prefers manual delivery when email is unavailable but local onboarding is allowed', () => {
    expect(getPreferredInvitationDeliveryMethod({
      ssoRequired: false,
      emailConfigured: false,
    })).toBe('manual')
  })

  it('only exposes email delivery while SSO is enforced', () => {
    expect(getInvitationDeliveryOptions({
      ssoRequired: true,
      emailConfigured: true,
    })).toEqual([
      { value: 'email', text: 'Email invite link and one-time password' },
    ])
  })

  it('returns no delivery options when SSO is enforced and email is unavailable', () => {
    expect(getInvitationDeliveryOptions({
      ssoRequired: true,
      emailConfigured: false,
    })).toEqual([])
  })
})
