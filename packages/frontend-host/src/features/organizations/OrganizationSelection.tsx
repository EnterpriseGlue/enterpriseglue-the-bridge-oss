import { useEffect, useRef, useState } from 'react'
import { Button, InlineNotification, Link, SkeletonText, Stack } from '@carbon/react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../shared/hooks/useAuth'
import PublicAuthShell from '../../shared/components/PublicAuthShell'
import { OrganizationList } from './OrganizationList'
import { useOrganizationSession, type OrganizationMembership } from './OrganizationSession'
import { safeOrganizationDestination, tenantSlugForPath } from './organizationPaths'

type SelectionState = { destination?: string; switchOrganization?: boolean }

export function OrganizationSelection({ onboardingPath }: { onboardingPath?: string }) {
  const { user, logout, hasPlatformPermission, organizationChangedInAnotherTab } = useAuth()
  const { memberships, lastOrganization, openOrganization, transitioning } = useOrganizationSession()
  const navigate = useNavigate()
  const state = useLocation().state as SelectionState | null
  const destination = safeOrganizationDestination(state?.destination)
  const destinationSlug = destination ? tenantSlugForPath(destination) : undefined
  const membership = memberships.data?.find((item) => item.tenantSlug === destinationSlug)
  const noAccess = Boolean(destinationSlug && memberships.data && !membership)
  const [error, setError] = useState('')
  const attempted = useRef(false)
  const canCreate = Boolean(onboardingPath && hasPlatformPermission('platform:tenants:self-create'))
  const emptyDestination = canCreate ? onboardingPath
    : !noAccess && hasPlatformPermission('platform:tenants:view') ? '/admin/tenants' : undefined
  const active = memberships.data?.filter((item) => item.tenantStatus === 'active') ?? []
  const knownOrganization = !organizationChangedInAnotherTab && !state?.switchOrganization && !noAccess
    ? membership ?? (!destinationSlug ? (active.find((item) => item.tenantId === user?.session?.tenant.id)
      ?? active.find((item) => item.verifiedDomain)
      ?? (memberships.data?.length === 1 ? active[0] : undefined)) : undefined)
    : undefined
  const choosingKnown = knownOrganization?.tenantStatus === 'active'
  const lastActive = active.find((item) => item.tenantId === lastOrganization)
  const preloadSlug = !choosingKnown ? lastActive?.tenantSlug : undefined

  useEffect(() => {
    if (!preloadSlug) return
    // The workspace HTML and placement route are safe to warm before
    // selection. Private workspace data still requires a tenant session.
    const preload = document.createElement('link')
    preload.rel = 'prefetch'
    preload.href = `/t/${encodeURIComponent(preloadSlug)}/`
    document.head.append(preload)
    return () => { preload.remove() }
  }, [preloadSlug])

  useEffect(() => {
    if (!memberships.data || attempted.current) return
    if (!memberships.data.length && emptyDestination) {
      attempted.current = true
      navigate(emptyDestination, { replace: true, state: { organizationAccessDenied: noAccess } })
      return
    }
    if (!choosingKnown || !knownOrganization) return
    attempted.current = true
    void openOrganization(knownOrganization, destination).catch(() =>
      setError('Could not open this organization. Try again or choose another organization.'),
    )
  }, [choosingKnown, destination, emptyDestination, knownOrganization, memberships.data, navigate, noAccess, openOrganization])

  function choose(organization: OrganizationMembership) {
    setError('')
    void openOrganization(organization).catch(() =>
      setError('Could not open this organization. Try again or choose another organization.'),
    )
  }

  const loading = memberships.isPending || (!error && !noAccess && (choosingKnown || Boolean(emptyDestination && memberships.data?.length === 0)))

  return (
    <PublicAuthShell title="Choose an organization" layout="grid">
      {loading ? <div role="status" aria-label="Finding your organization"><SkeletonText paragraph lineCount={4} /></div>
        : <Stack gap={5} className="eg-organization-picker">
          {user && <p className="cds--type-body-01">{user.email}</p>}
          {organizationChangedInAnotherTab && <InlineNotification kind="info" lowContrast hideCloseButton title="Your organization changed in another tab. Choose an organization to continue." />}
          {noAccess && <InlineNotification kind="error" lowContrast hideCloseButton title="You don’t have access to that organization" />}
          {membership && membership.tenantStatus !== 'active' && <InlineNotification kind="warning" lowContrast hideCloseButton title="This organization is currently unavailable" />}
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title={error} />}
          {memberships.isError && <>
            <InlineNotification kind="error" lowContrast hideCloseButton title="Could not load your organizations" />
            <Button kind="secondary" onClick={() => { void memberships.refetch() }}>Retry</Button>
          </>}
          {!memberships.isError && <OrganizationList
            memberships={memberships.data ?? []} lastOrganization={lastOrganization} onChoose={choose} busy={transitioning}
          />}
          <div className="eg-organization-picker-actions">
            {canCreate && onboardingPath && <Link as={RouterLink} to={onboardingPath}>Create a new organization</Link>}
            <Button kind="ghost" size="sm" type="button" onClick={() => {
              void logout().then(() => navigate('/login', { replace: true })).catch(() => setError('Could not sign out. Try again.'))
            }}>Sign out</Button>
          </div>
        </Stack>}
    </PublicAuthShell>
  )
}
