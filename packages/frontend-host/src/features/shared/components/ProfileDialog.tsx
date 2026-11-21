import { useEffect, useState } from 'react'
import { Button, InlineLoading, InlineNotification, Modal, Tag, TextInput, Theme } from '@carbon/react'
import { Link as LinkIcon } from '@carbon/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import type { AuthenticatedIdentityProviderLinks } from '@enterpriseglue/shared/schemas/auth/session.js'
import { useAuth } from '../../../shared/hooks/useAuth'
import { getTenancyCapabilities } from '../../../services/tenancy'
import { apiClient } from '../../../shared/api/client'
import { parseApiError } from '../../../shared/api/apiErrorUtils'
import { ADMIN_NAV_PLATFORM_PERMISSIONS, hasAnyPlatformPermission } from '../../../shared/auth/permissions'
import { configuredDocumentationOrigin, documentationAccountLink } from '../../../utils/documentationAccess'
import { redirectToApi } from '../../../utils/redirect'

export function ProfileDialog({ open, onClose, isMultiTenant, tenantSlug }: {
  open: boolean
  onClose: () => void
  isMultiTenant: boolean
  tenantSlug: string | null
}) {
  const { user, permissions, refreshUser } = useAuth()
  const { pathname } = useLocation()
  const platformAdminMenuVisible = hasAnyPlatformPermission(permissions, ADMIN_NAV_PLATFORM_PERMISSIONS)
  const showPlatformAccess = platformAdminMenuVisible || getTenancyCapabilities().mode !== 'pooled'
  const [profileFirstName, setProfileFirstName] = useState('')
  const [profileLastName, setProfileLastName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState('')

  const identityProviderLinksQ = useQuery({
    queryKey: ['auth', 'me', 'identity-providers', user?.id, tenantSlug],
    queryFn: () => apiClient.get<AuthenticatedIdentityProviderLinks>('/api/auth/me/identity-providers'),
    enabled: open && Boolean(user) && (!isMultiTenant || Boolean(tenantSlug)),
    staleTime: 15_000,
  })
  const documentationLinkQ = useQuery({
    queryKey: ['auth', 'documentation', 'configuration'],
    queryFn: async () => {
      const { documentationOrigin } = await apiClient.get<{ documentationOrigin: string }>('/api/auth/documentation/configuration')
      return documentationAccountLink(configuredDocumentationOrigin(documentationOrigin))
    },
    enabled: open && isMultiTenant && user?.isEmailVerified === true && !user.mustResetPassword,
    retry: false,
  })

  const connectIdentityProvider = (providerId: string) => {
    if (profileHasChanges || profileSaving) return
    const returnTo = pathname
    try {
      redirectToApi(`/api/auth/me/identity-providers/${encodeURIComponent(providerId)}/link?returnTo=${encodeURIComponent(returnTo)}`)
    } catch {
      setProfileError('Could not connect this sign-in method. Try again.')
    }
  }

  useEffect(() => {
    if (!open) return
    setProfileFirstName(user?.firstName || '')
    setProfileLastName(user?.lastName || '')
    setProfileError('')
    setProfileSaving(false)
  }, [open, user])

  const profileHasChanges =
    profileFirstName !== (user?.firstName || '') ||
    profileLastName !== (user?.lastName || '')

  const handleCloseProfile = () => {
    onClose()
    setProfileError('')
  }

  const handleSaveProfile = async () => {
    try {
      setProfileSaving(true)
      setProfileError('')

      await apiClient.patch('/api/auth/me', {
        firstName: profileFirstName,
        lastName: profileLastName,
      })

      if (refreshUser) {
        await refreshUser()
      }

      onClose()
    } catch (e: unknown) {
      const parsed = parseApiError(e, 'Failed to update profile')
      setProfileError(parsed.message)
    } finally {
      setProfileSaving(false)
    }
  }

  return (
    <Theme theme="g10">
    <Modal
      className="eg-profile-dialog"
      open={open}
      modalHeading="My profile"
      primaryButtonText={profileSaving ? 'Saving…' : 'Save changes'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={profileSaving || !profileHasChanges}
      onRequestClose={handleCloseProfile}
      onRequestSubmit={handleSaveProfile}
    >
      {profileError && (
        <InlineNotification
          kind="error"
          title="Error"
          subtitle={profileError}
          onCloseButtonClick={() => setProfileError('')}
          style={{ marginBottom: 'var(--spacing-5)' }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-2)' }}>Email</div>
          <div style={{ fontSize: '14px' }}>{user?.email || ''}</div>
        </div>

        {showPlatformAccess && <div>
          <div style={{ fontSize: '12px', color: 'var(--cds-text-secondary)', marginBottom: 'var(--spacing-2)' }}>Platform access</div>
          <Tag type={platformAdminMenuVisible ? 'purple' : 'gray'} size="sm">
            {platformAdminMenuVisible ? 'Administrative features' : 'Standard features'}
          </Tag>
        </div>}

        {documentationLinkQ.data && user?.isEmailVerified === true && !user.mustResetPassword && (
          <Button as="a" href={documentationLinkQ.data} kind="ghost" size="sm">Open documentation</Button>
        )}

        <TextInput
          id="profile-first-name"
          labelText="First name"
          value={profileFirstName}
          onChange={(e) => setProfileFirstName(e.target.value)}
        />

        <TextInput
          id="profile-last-name"
          labelText="Last name"
          value={profileLastName}
          onChange={(e) => setProfileLastName(e.target.value)}
        />

        <section aria-labelledby="profile-sign-in-methods-heading">
          <h3 id="profile-sign-in-methods-heading" className="cds--type-heading-compact-01" style={{ marginBottom: 'var(--spacing-3)' }}>
            Sign-in methods
          </h3>
          {profileHasChanges && <p id="profile-sign-in-draft-help" className="cds--type-body-compact-01" style={{ marginBottom: 'var(--spacing-3)' }}>
            Save your name changes before connecting another sign-in method.
          </p>}
          {identityProviderLinksQ.isLoading ? (
            <InlineLoading description="Loading sign-in methods" />
          ) : identityProviderLinksQ.isError ? (
            <>
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title="Sign-in methods unavailable"
              subtitle="Try loading your sign-in methods again."
            />
            <Button kind="tertiary" size="sm" disabled={identityProviderLinksQ.isFetching} onClick={() => { void identityProviderLinksQ.refetch() }}>Retry sign-in methods</Button>
            </>
          ) : identityProviderLinksQ.data?.providers.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
              {identityProviderLinksQ.data.providers.map((provider) => (
                <div key={provider.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--spacing-4)' }}>
                  <div>
                    <div className="cds--type-body-compact-01">{provider.displayName}</div>
                    {provider.organization && <div className="cds--type-label-01" style={{ color: 'var(--cds-text-secondary)' }}>{provider.organization}</div>}
                  </div>
                  {provider.linked ? (
                    <Tag type="green" size="sm">Connected</Tag>
                  ) : (
                    <Button kind="tertiary" size="sm" renderIcon={LinkIcon}
                      disabled={profileHasChanges || profileSaving}
                      aria-describedby={profileHasChanges ? 'profile-sign-in-draft-help' : undefined}
                      onClick={() => connectIdentityProvider(provider.id)}>
                      Connect
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="cds--type-body-compact-01" style={{ color: 'var(--cds-text-secondary)' }}>
              {isMultiTenant && !tenantSlug
                ? 'Open an organization to manage its sign-in methods.'
                : 'No additional sign-in methods are configured for this organization.'}
            </p>
          )}
        </section>
      </div>
    </Modal>
    </Theme>
  )
}
