import { useEffect, useState } from 'react'
import { Button, InlineLoading, InlineNotification, Modal, Tag, TextInput } from '@carbon/react'
import { Link as LinkIcon } from '@carbon/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import type { AuthenticatedIdentityProviderLinks } from '@enterpriseglue/shared/schemas/auth/session.js'
import { useAuth } from '../../../shared/hooks/useAuth'
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
    <Modal
      open={open}
      modalHeading="My Profile"
      primaryButtonText={profileSaving ? 'Saving...' : 'Save Changes'}
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
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>Email</div>
          <div style={{ fontSize: '14px' }}>{user?.email || ''}</div>
        </div>

        <div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-2)' }}>Role</div>
          <Tag type={platformAdminMenuVisible ? 'purple' : 'gray'} size="sm">
            {platformAdminMenuVisible ? 'Platform Admin' : 'User'}
          </Tag>
        </div>

        {documentationLinkQ.data && user?.isEmailVerified === true && !user.mustResetPassword && (
          <Button as="a" href={documentationLinkQ.data} kind="ghost" size="sm">Open documentation</Button>
        )}

        <TextInput
          id="profile-first-name"
          labelText="First Name"
          value={profileFirstName}
          onChange={(e) => setProfileFirstName(e.target.value)}
        />

        <TextInput
          id="profile-last-name"
          labelText="Last Name"
          value={profileLastName}
          onChange={(e) => setProfileLastName(e.target.value)}
        />

        <section aria-labelledby="profile-sign-in-methods-heading">
          <h3 id="profile-sign-in-methods-heading" className="cds--type-heading-compact-01" style={{ marginBottom: 'var(--spacing-3)' }}>
            Sign-in methods
          </h3>
          {identityProviderLinksQ.isLoading ? (
            <InlineLoading description="Loading sign-in methods" />
          ) : identityProviderLinksQ.isError ? (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title="Sign-in methods unavailable"
              subtitle="Refresh the page and try again."
            />
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
                    <Button kind="tertiary" size="sm" renderIcon={LinkIcon} onClick={() => connectIdentityProvider(provider.id)}>
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
  )
}
