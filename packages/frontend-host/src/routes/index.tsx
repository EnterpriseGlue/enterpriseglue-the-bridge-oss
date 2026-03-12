import React from 'react'
import { Navigate, RouteObject, useLocation } from 'react-router-dom'

// Extension registry for EE plugin integration
import { extensions, isMultiTenantEnabled } from '../enterprise/extensionRegistry'

// Shared components
import LayoutWithProSidebar from '../features/shared/components/LayoutWithProSidebar'
import { PageLoadingState } from '../features/shared/components/LoadingState'

// Starbase pages
const ProjectOverview = React.lazy(() => import('../features/starbase/pages/ProjectOverview'))
const ProjectDetail = React.lazy(() => import('../features/starbase/pages/ProjectDetail'))
const Editor = React.lazy(() => import('../features/starbase/pages/Editor'))

// Mission Control pages
const MissionControlBridge = React.lazy(() => import('../features/mission-control/pages/MissionControlBridge'))
const EnginesPage = React.lazy(() => import('../features/mission-control/engines/EnginesPage'))

// Mission Control components
const ProcessesOverviewPage = React.lazy(() => import('../features/mission-control/processes-overview/ProcessesOverviewPage'))
const ProcessInstanceDetailPage = React.lazy(() => import('../features/mission-control/process-instance-detail/ProcessInstanceDetailPage'))
const Decisions = React.lazy(() => import('../features/mission-control/decisions-overview/components/Decisions'))
const DecisionHistoryDetail = React.lazy(() => import('../features/mission-control/decision-instance-detail/components/DecisionHistoryDetail'))
const BatchesPage = React.lazy(() => import('../features/mission-control/batches/BatchesPage'))
const NewDeleteBatch = React.lazy(() => import('../features/mission-control/batches/components/NewDeleteBatch'))
const NewSuspendBatch = React.lazy(() => import('../features/mission-control/batches/components/NewSuspendBatch'))
const NewActivateBatch = React.lazy(() => import('../features/mission-control/batches/components/NewActivateBatch'))
const NewRetriesBatch = React.lazy(() => import('../features/mission-control/batches/components/NewRetriesBatch'))
const MigrationWizardPage = React.lazy(() => import('../features/mission-control/migration-wizard/MigrationWizardPage'))

// Platform Admin pages
const PlatformSettingsPage = React.lazy(() => import('../features/platform-admin/pages/PlatformSettingsPage'))
const SsoMappings = React.lazy(() => import('../features/platform-admin/pages/SsoMappings'))
const AuthzPolicies = React.lazy(() => import('../features/platform-admin/pages/AuthzPolicies'))
const AuthzAuditLog = React.lazy(() => import('../features/platform-admin/pages/AuthzAuditLog'))

// EE-only pages (rendered via ExtensionPage)
import { ExtensionPage } from '../enterprise/ExtensionSlot'

// Guards
import { FeatureFlagGuard } from '../shared/components/FeatureFlagGuard'
import { ProtectedRoute } from '../shared/components/ProtectedRoute'
import { RequireEmailVerification } from '../shared/components/RequireEmailVerification'
import { RequirePasswordReset } from '../shared/components/RequirePasswordReset'

// Auth pages
import Login from '../pages/Login'
import ForgotPassword from '../pages/ForgotPassword'
import PasswordResetWithToken from '../pages/PasswordResetWithToken'
import ResetPassword from '../pages/ResetPassword'
import ResendVerification from '../pages/ResendVerification'
import VerifyEmail from '../pages/VerifyEmail'
import Signup from '../pages/Signup'
import AcceptInvite from '../pages/AcceptInvite'

// Admin pages
const AuditLogViewer = React.lazy(() => import('../pages/AuditLogViewer'))
const UserManagement = React.lazy(() => import('../pages/admin/UserManagement'))

// Dashboard
import Dashboard from '../pages/Dashboard'

// Git OAuth
const OAuthCallback = React.lazy(() => import('../features/git/pages/OAuthCallback'))

// Settings (GitConnections page removed — Git connections now live at project level)

import { useAuth } from '../shared/hooks/useAuth'
import { useFeatureFlag } from '../shared/hooks/useFeatureFlag'
import { EngineAccessError } from '../features/mission-control/shared'

function MissionControlRoleGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()

  const isMissionControlEnabled = useFeatureFlag('missionControl')
  const canViewMissionControl = Boolean(user?.capabilities?.canViewMissionControl)
  const canManagePlatformSettings = Boolean(user?.capabilities?.canManagePlatformSettings)
  const isMultiTenant = isMultiTenantEnabled()
  const hideVoyagerForPlatformAdmin = isMultiTenant && canManagePlatformSettings

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  if (hideVoyagerForPlatformAdmin) {
    return <Navigate to="/admin/tenants" replace />
  }

  if (isMissionControlEnabled && !canViewMissionControl) {
    const message = 'You need an engine role of owner, delegate, or operator on at least one engine to access Mission Control. Create an engine or ask an engine owner to grant you access.'
    return <EngineAccessError status={403} message={message} actionPath={toTenantPath('/engines')} actionLabel="Go to Engines" />
  }

  return <>{children}</>
}

function LazyRoute({ children, message = 'Loading page...' }: { children: React.ReactNode; message?: string }) {
  return (
    <React.Suspense fallback={<PageLoadingState message={message} />}>
      {children}
    </React.Suspense>
  )
}

/**
 * Creates protected child routes that are shared between root (/) and tenant (/t/:tenantSlug) layouts
 * @param isRootLevel - true for root routes (uses "/" prefix), false for tenant routes (no prefix)
 */
export function createProtectedChildRoutes(isRootLevel: boolean): RouteObject[] {
  const fallbackPath = isRootLevel ? '/' : '..'
  const pathPrefix = isRootLevel ? '/' : ''

  return [
    { index: true, element: <Dashboard /> },
    
    // Admin routes
    ...(!isMultiTenantEnabled() ? [{ 
      path: `${pathPrefix}admin/settings`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          <LazyRoute message="Loading settings...">
            <PlatformSettingsPage />
          </LazyRoute>
        </ProtectedRoute>
      )
    }] : []),
    { 
      path: `${pathPrefix}admin/sso-mappings`, 
      element: (
        <ProtectedRoute requireAdmin>
          <LazyRoute message="Loading SSO mappings...">
            <SsoMappings />
          </LazyRoute>
        </ProtectedRoute>
      )
    },
    { 
      path: `${pathPrefix}admin/policies`, 
      element: (
        <ProtectedRoute requireAdmin>
          <LazyRoute message="Loading policies...">
            <AuthzPolicies />
          </LazyRoute>
        </ProtectedRoute>
      )
    },
    { 
      path: `${pathPrefix}admin/authz-audit`, 
      element: (
        <ProtectedRoute requireAdmin>
          <LazyRoute message="Loading audit log...">
            <AuthzAuditLog />
          </LazyRoute>
        </ProtectedRoute>
      )
    },
    // TenantManagement is EE-only (multi-tenant mode)
    // Uses ExtensionPage - shows fallback in OSS, actual page in EE
    ...(isMultiTenantEnabled() ? [{ 
      path: `${pathPrefix}admin/tenants`, 
      element: (
        <ProtectedRoute requireAdmin>
          <ExtensionPage name="tenant-management-page" />
        </ProtectedRoute>
      )
    }] : []),
    ...((!isMultiTenantEnabled() || !isRootLevel) ? [{
      path: `${pathPrefix}admin/audit-logs`,
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          <LazyRoute message="Loading audit logs...">
            <AuditLogViewer />
          </LazyRoute>
        </ProtectedRoute>
      )
    }] : []),
    // EE-only tenant-scoped admin pages (domains, sso, invite-policies)
    ...(isMultiTenantEnabled() && !isRootLevel ? [
      { 
        path: `${pathPrefix}admin/domains`, 
        element: (
          <ProtectedRoute requireAdmin={false}>
            <ExtensionPage name="tenant-domains-page" />
          </ProtectedRoute>
        )
      },
      { 
        path: `${pathPrefix}admin/sso`, 
        element: (
          <ProtectedRoute requireAdmin={false}>
            <ExtensionPage name="tenant-sso-page" />
          </ProtectedRoute>
        )
      },
      { 
        path: `${pathPrefix}admin/invite-policies`, 
        element: (
          <ProtectedRoute requireAdmin={false}>
            <ExtensionPage name="tenant-invite-policies-page" />
          </ProtectedRoute>
        )
      },
    ] : []),
    // OSS: redirect old standalone pages to Platform Settings tabs
    ...(!isMultiTenantEnabled() ? [
      { path: `${pathPrefix}admin/email`, element: <Navigate to={isRootLevel ? '/admin/settings' : '../admin/settings'} replace /> },
      { path: `${pathPrefix}admin/email-templates`, element: <Navigate to={isRootLevel ? '/admin/settings' : '../admin/settings'} replace /> },
      { path: `${pathPrefix}admin/branding`, element: <Navigate to={isRootLevel ? '/admin/settings' : '../admin/settings'} replace /> },
    ] : []),
    // EE multi-tenant: keep extension page routes
    ...(isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/email-settings`,
      element: (
        <ProtectedRoute requireAdmin>
          <ExtensionPage name="platform-email-settings-page" />
        </ProtectedRoute>
      )
    }] : []),
    ...(isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/email-templates`,
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          {isRootLevel
            ? <ExtensionPage name="platform-email-templates-page" />
            : <ExtensionPage name="tenant-email-templates-page" />}
        </ProtectedRoute>
      )
    }] : []),
    ...(isMultiTenantEnabled() && !isRootLevel ? [{
      path: `${pathPrefix}admin/branding`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          <ExtensionPage name="tenant-branding-page" />
        </ProtectedRoute>
      )
    }] : []),
    // User Management - OSS uses root-level UserManagement, EE multi-tenant uses tenant-scoped page
    ...(!isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/users`, 
      element: (
        <ProtectedRoute requireAdmin>
          <LazyRoute message="Loading users...">
            <UserManagement />
          </LazyRoute>
        </ProtectedRoute>
      )
    }] : []),
    ...(isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/users`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          {isRootLevel ? <LazyRoute message="Loading users..."><UserManagement /></LazyRoute> : <ExtensionPage name="tenant-users-page" />}
        </ProtectedRoute>
      )
    }] : []),

    // TenantSetupWizard is EE-only (multi-tenant mode)
    ...(isMultiTenantEnabled() ? [{ 
      path: `${pathPrefix}setup`, 
      element: (
        <ProtectedRoute>
          <ExtensionPage name="tenant-setup-wizard-page" />
        </ProtectedRoute>
      )
    }] : []),

    // Starbase routes
    { 
      path: `${pathPrefix}starbase`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <LazyRoute message="Loading projects...">
            <ProjectOverview />
          </LazyRoute>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/*`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <LazyRoute message="Loading projects...">
            <ProjectOverview />
          </LazyRoute>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/project/:projectId`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <LazyRoute message="Loading project...">
            <ProjectDetail />
          </LazyRoute>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/editor/:fileId`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <LazyRoute message="Loading editor...">
            <Editor />
          </LazyRoute>
        </FeatureFlagGuard>
      )
    },

    // Mission Control routes
    { 
      path: `${pathPrefix}mission-control`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading Mission Control...">
              <MissionControlBridge />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/processes`, 
      element: (
        <FeatureFlagGuard flag="missionControl.processes" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading processes...">
              <ProcessesOverviewPage />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/processes/instances/:instanceId`, 
      element: (
        <FeatureFlagGuard flag="missionControl.processes" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading process instance...">
              <ProcessInstanceDetailPage />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading batches...">
              <BatchesPage />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/:batchId`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading batches...">
              <BatchesPage />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/delete`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading batch form...">
              <NewDeleteBatch />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/suspend`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading batch form...">
              <NewSuspendBatch />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/activate`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading batch form...">
              <NewActivateBatch />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/retries`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading batch form...">
              <NewRetriesBatch />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/migration/new`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading migration wizard...">
              <MigrationWizardPage />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/decisions`, 
      element: (
        <FeatureFlagGuard flag="missionControl.decisions" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading decisions...">
              <Decisions />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/decisions/instances/:id`, 
      element: (
        <FeatureFlagGuard flag="missionControl.decisions" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading decision history...">
              <DecisionHistoryDetail />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/*`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <LazyRoute message="Loading Mission Control...">
              <MissionControlBridge />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },

    // Engines
    { 
      path: `${pathPrefix}engines`, 
      element: (
        <FeatureFlagGuard flag="engines" fallback={<Navigate to={fallbackPath} replace />}>
          <ExtensionPage name="engines-page" fallback={<LazyRoute message="Loading engines..."><EnginesPage /></LazyRoute>} />
        </FeatureFlagGuard>
      )
    },

    // Settings
    { path: `${pathPrefix}profile`, element: <Navigate to={fallbackPath} replace /> },
    { path: `${pathPrefix}settings/git-connections`, element: <Navigate to={isRootLevel ? '/starbase' : '../starbase'} replace /> },

    // Legacy redirects
    { path: `${pathPrefix}tower/*`, element: <Navigate to={isRootLevel ? '/mission-control/processes' : '../mission-control/processes'} replace /> },
    { path: `${pathPrefix}tower`, element: <Navigate to={isRootLevel ? '/mission-control/processes' : '../mission-control/processes'} replace /> },
  ]
}

/**
 * Public routes that don't require authentication
 */
export function getPublicRoutes(): RouteObject[] {
  return [
    { path: '/login', element: <Login /> },
    { path: '/t/:tenantSlug/login', element: <Login /> },
    { path: '/forgot-password', element: <ForgotPassword /> },
    { path: '/t/:tenantSlug/forgot-password', element: <ForgotPassword /> },
    { path: '/password-reset', element: <PasswordResetWithToken /> },
    { path: '/t/:tenantSlug/password-reset', element: <PasswordResetWithToken /> },
    { path: '/verify-email', element: <VerifyEmail /> },
    { path: '/t/:tenantSlug/verify-email', element: <VerifyEmail /> },
    { path: '/resend-verification', element: <ResendVerification /> },
    { path: '/t/:tenantSlug/resend-verification', element: <ResendVerification /> },
    { path: '/signup', element: <Signup /> },
    { 
      path: '/git/oauth/callback', 
      element: (
        <ProtectedRoute>
          <LazyRoute message="Loading callback...">
            <OAuthCallback />
          </LazyRoute>
        </ProtectedRoute>
      )
    },
    { 
      path: '/reset-password', 
      element: (
        <ProtectedRoute>
          <ResetPassword />
        </ProtectedRoute>
      )
    },
    { 
      path: '/t/:tenantSlug/reset-password', 
      element: (
        <ProtectedRoute>
          <ResetPassword />
        </ProtectedRoute>
      )
    },
  ]
}

/**
 * Default tenant slug for OSS single-tenant mode
 * In OSS, all users are redirected to /t/default/* paths for unified routing (Option A)
 */
const DEFAULT_TENANT_SLUG = 'default';

/**
 * Creates the root redirect route (OSS: redirects to /t/default/)
 * For unified tenant routing, we redirect root to the default tenant path
 */
export function createRootLayoutRoute(enterpriseChildren: RouteObject[] = []): RouteObject {
  return {
    path: '/',
    element: (
      <ProtectedRoute>
        <RequireEmailVerification>
          <RequirePasswordReset>
            <LayoutWithProSidebar />
          </RequirePasswordReset>
        </RequireEmailVerification>
      </ProtectedRoute>
    ),
    children: [
      // Redirect root to default tenant for unified routing
      { index: true, element: <Navigate to={`/t/${DEFAULT_TENANT_SLUG}`} replace /> },
      ...createProtectedChildRoutes(true),
      ...enterpriseChildren,
    ],
  }
}

/**
 * Creates the tenant protected layout route
 */
export function createTenantLayoutRoute(enterpriseChildren: RouteObject[] = []): RouteObject {
  return {
    path: '/t/:tenantSlug',
    element: (
      <ProtectedRoute>
        <RequireEmailVerification>
          <RequirePasswordReset>
            <LayoutWithProSidebar />
          </RequirePasswordReset>
        </RequireEmailVerification>
      </ProtectedRoute>
    ),
    children: [
      ...createProtectedChildRoutes(false),
      { path: 'invite/:token', element: <AcceptInvite /> },
      ...enterpriseChildren,
    ],
  }
}

/**
 * Creates all application routes
 * 
 * Routes are merged from:
 * 1. OSS base routes (defined in this file)
 * 2. Enterprise plugin routes (passed as parameters)
 * 3. Extension registry routes (from extensionRegistry.ts)
 */
export function createAppRoutes(
  enterpriseRootChildren: RouteObject[] = [],
  enterpriseTenantChildren: RouteObject[] = []
): RouteObject[] {
  // Merge all root routes: plugin interface + extension registry
  const allRootChildren = [
    ...enterpriseRootChildren,
    ...(extensions?.rootRoutes || []),
  ];
  
  // Merge all tenant routes: plugin interface + extension registry
  const allTenantChildren = [
    ...enterpriseTenantChildren,
    ...(extensions?.tenantRoutes || []),
  ];
  
  return [
    ...getPublicRoutes(),
    createRootLayoutRoute(allRootChildren),
    createTenantLayoutRoute(allTenantChildren),
  ]
}
