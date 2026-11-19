import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Button, Header, HeaderGlobalAction, HeaderGlobalBar, HeaderName, HeaderPanel,
  InlineNotification, SkeletonText, SkipToContent, Stack, Theme,
} from '@carbon/react'
import { UserAvatar } from '@carbon/icons-react'
import { useAuth } from '../../shared/hooks/useAuth'
import { PublicAuthHeaderBrand, usePublicAuthBranding } from '../../shared/components/PublicAuthShell'
import { ProfileDialog } from '../shared/components/ProfileDialog'
import { OrganizationList } from './OrganizationList'
import { OrganizationSessionProvider, useOrganizationMemberships, useOrganizationSession, type OrganizationMembership } from './OrganizationSession'
import { ORGANIZATION_SELECTION_PATH, tenantSlugForPath } from './organizationPaths'
import { WorkspaceHeaderContext } from './workspaceHeaderContext'

function WorkspaceHeader() {
  const branding = usePublicAuthBranding()
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { memberships, lastOrganization, openOrganization, transitioning } = useOrganizationSession()
  const [navigation, setNavigation] = useState<HTMLDivElement | null>(null)
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [switching, setSwitching] = useState(false)
  const switchOptions = useOrganizationMemberships(true, switching)
  const [error, setError] = useState('')
  const tenantPath = tenantSlugForPath(location.pathname)
  const active = tenantPath && memberships.data?.find((item) =>
    item.tenantId === user?.session?.tenant.id && item.tenantSlug === tenantPath,
  )
  const hasTenantHome = tenantPath && (active || (user?.session?.tenant.id && user.session.tenant.slug === tenantPath))
  const options = memberships.data ?? []
  const publicPage = /\/(?:login|signup|forgot-password|password-reset|verify-email|admin-recovery)(?:\/|$)/.test(location.pathname)
  const noAccess = location.pathname === '/cloud/onboarding'
    && (location.state as { organizationAccessDenied?: boolean } | null)?.organizationAccessDenied

  function closePanel(restoreFocus = false) {
    setExpanded(false)
    setSwitching(false)
    setError('')
    if (restoreFocus) trigger.current?.focus()
  }

  useEffect(() => {
    closePanel()
    setProfileOpen(false)
  }, [location.key])
  useEffect(() => {
    if (!expanded) return
    const handlePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) closePanel()
    }
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel(true)
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKeyboard)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKeyboard)
    }
  }, [expanded])

  function choose(organization: OrganizationMembership) {
    setError('')
    void openOrganization(organization).catch(() => setError('Could not open this organization. Try again.'))
  }

  return (
    <WorkspaceHeaderContext.Provider value={{ branding, navigation, actions }}>
      <Theme theme="g10" className="eg-workspace-shell">
        <Theme theme="g100">
          <Header className="eg-workspace-header" aria-label={`${branding.brandTitle} application header`}>
            <SkipToContent href={publicPage ? '#public-auth-main' : '#main-content'}>Skip to main content</SkipToContent>
            <HeaderName as={RouterLink} to={hasTenantHome ? `/t/${tenantPath}/` : '/'} prefix="">
              <PublicAuthHeaderBrand branding={branding} />
            </HeaderName>
            <div className="eg-workspace-header-slot" ref={setNavigation} />
            <HeaderGlobalBar>
              <div className="eg-workspace-header-slot" ref={setActions} />
              {user && <HeaderGlobalAction
                ref={trigger} aria-label="Account menu" tooltipAlignment="end"
                isActive={expanded} aria-expanded={expanded} aria-controls="eg-account-panel"
                onClick={() => expanded ? closePanel() : setExpanded(true)}
              ><UserAvatar size={20} /></HeaderGlobalAction>}
            </HeaderGlobalBar>
            {user && <HeaderPanel ref={panel} expanded={expanded} addFocusListeners={false}>
              {expanded && <section id="eg-account-panel" aria-label="Account settings" className="eg-account-panel">
                <Stack gap={4}>
                  <div>
                    <p className="cds--type-heading-compact-01">{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</p>
                    <p>{user.email}</p>
                  </div>
                  {active && <div>
                    <p className="cds--type-heading-compact-01">{active.tenantName}</p>
                    <p className="eg-organization-slug">{active.tenantSlug}</p>
                  </div>}
                  {options.length >= 2 && <Button kind="ghost" size="sm" onClick={() => {
                    if (options.length > 7) {
                      closePanel()
                      navigate(ORGANIZATION_SELECTION_PATH, { state: { switchOrganization: true } })
                    } else {
                      setSwitching((current) => !current)
                    }
                  }}>Switch organization</Button>}
                  {switching && switchOptions.isPending && <SkeletonText paragraph lineCount={3} />}
                  {switching && switchOptions.isError && <>
                    <InlineNotification kind="error" lowContrast hideCloseButton title="Could not load your organizations" />
                    <Button kind="secondary" size="sm" onClick={() => { void switchOptions.refetch() }}>Retry</Button>
                  </>}
                  {switching && switchOptions.data && <OrganizationList
                    memberships={switchOptions.data} lastOrganization={lastOrganization} onChoose={choose} busy={transitioning}
                  />}
                  {error && <InlineNotification kind="error" lowContrast hideCloseButton title={error} />}
                  <Button kind="ghost" size="sm" onClick={() => {
                    closePanel(true)
                    setProfileOpen(true)
                  }}>Profile and sign-in methods</Button>
                  <Button kind="ghost" size="sm" onClick={() => {
                    void logout().then(() => navigate('/login', { replace: true })).catch(() => setError('Could not sign out. Try again.'))
                  }}>Sign out</Button>
                </Stack>
              </section>}
            </HeaderPanel>}
          </Header>
          <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)}
            isMultiTenant tenantSlug={tenantPath ?? null} />
        </Theme>
        {noAccess && <div className="eg-organization-access-notice">
          <InlineNotification kind="error" lowContrast hideCloseButton title="You don’t have access to that organization" />
        </div>}
        <Outlet />
      </Theme>
    </WorkspaceHeaderContext.Provider>
  )
}

export function WorkspaceShell() {
  return <OrganizationSessionProvider><WorkspaceHeader /></OrganizationSessionProvider>
}
