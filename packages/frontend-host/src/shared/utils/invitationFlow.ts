export type InvitationDeliveryMethod = 'email' | 'manual'

export interface InvitationCapabilities {
  ssoRequired: boolean
  emailConfigured: boolean
}

export interface InvitationDeliveryOption {
  value: InvitationDeliveryMethod
  text: string
}

export interface InvitationRevealData {
  email: string
  inviteUrl: string
  oneTimePassword: string
}

export function getInvitationDeliveryOptions(capabilities: InvitationCapabilities): InvitationDeliveryOption[] {
  const localLoginDisabled = Boolean(capabilities.ssoRequired)
  const emailConfigured = Boolean(capabilities.emailConfigured)

  return [
    ...(emailConfigured ? [{ value: 'email' as const, text: 'Email invite link and one-time password' }] : []),
    ...(!localLoginDisabled ? [{ value: 'manual' as const, text: 'Reveal invite link and one-time password here' }] : []),
  ]
}

export function getPreferredInvitationDeliveryMethod(capabilities: InvitationCapabilities): InvitationDeliveryMethod {
  const localLoginDisabled = Boolean(capabilities.ssoRequired)
  const emailConfigured = Boolean(capabilities.emailConfigured)

  if (localLoginDisabled && emailConfigured) {
    return 'email'
  }

  if (!localLoginDisabled) {
    return emailConfigured ? 'email' : 'manual'
  }

  return 'manual'
}
