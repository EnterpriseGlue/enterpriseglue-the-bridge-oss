import React from 'react'
import { Navigate, RouteObject, useLocation } from 'react-router-dom'

// Extension registry for EE plugin integration
import { extensions, isMultiTenantEnabled } from '../enterprise/extensionRegistry'

// Shared components
import LayoutWithProSidebar from '../features/shared/components/LayoutWithProSidebar'

// Starbase pages
import ProjectOverview from '../features/starbase/pages/ProjectOverview'
import ProjectDetail from '../features/starbase/pages/ProjectDetail'
import Editor from '../features/starbase/pages/Editor'

// Mission Control pages
import MissionControlBridge from '../features/mission-control/pages/MissionControlBridge'
import EnginesPage from '../features/mission-control/engines/EnginesPage'

// Mission Control components
import ProcessesOverviewPage from '../features/mission-control/processes-overview/ProcessesOverviewPage'
import ProcessInstanceDetailPage from '../features/mission-control/process-instance-detail/ProcessInstanceDetailPage'
import Decisions from '../features/mission-control/decisions-overview/components/Decisions'
import DecisionHistoryDetail from '../features/mission-control/decision-instance-detail/components/DecisionHistoryDetail'
import BatchesPage from '../features/mission-control/batches/BatchesPage'
import NewDeleteBatch from '../features/mission-control/batches/components/NewDeleteBatch'
import NewSuspendBatch from '../features/mission-control/batches/components/NewSuspendBatch'
import NewActivateBatch from '../features/mission-control/batches/components/NewActivateBatch'
import NewRetriesBatch from '../features/mission-control/batches/components/NewRetriesBatch'
import MigrationWizardPage from '../features/mission-control/migration-wizard/MigrationWizardPage'

// Platform Admin pages
import PlatformSettingsPage from '../features/platform-admin/pages/PlatformSettingsPage'
import SsoMappings from '../features/platform-admin/pages/SsoMappings'
import AuthzPolicies from '../features/platform-admin/pages/AuthzPolicies'
import AuthzAuditLog from '../features/platform-admin/pages/AuthzAuditLog'

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
import AuditLogViewer from '../pages/AuditLogViewer'
import UserManagement from '../pages/admin/UserManagement'
import EmailConfigurations from '../pages/admin/EmailConfigurations'
import EmailTemplates from '../pages/admin/EmailTemplates'
import Branding from '../pages/admin/Branding'

// Dashboard
import Dashboard from '../pages/Dashboard'

// Git OAuth
import OAuthCallback from '../features/git/pages/OAuthCallback'

// Settings
import GitConnections from '../pages/settings/GitConnections'

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
  const tenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
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
          <PlatformSettingsPage />
        </ProtectedRoute>
      )
    }] : []),
    { 
      path: `${pathPrefix}admin/sso-mappings`, 
      element: (
        <ProtectedRoute requireAdmin>
          <SsoMappings />
        </ProtectedRoute>
      )
    },
    { 
      path: `${pathPrefix}admin/policies`, 
      element: (
        <ProtectedRoute requireAdmin>
          <AuthzPolicies />
        </ProtectedRoute>
      )
    },
    { 
      path: `${pathPrefix}admin/authz-audit`, 
      element: (
        <ProtectedRoute requireAdmin>
          <AuthzAuditLog />
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
          <AuditLogViewer />
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
    ...(!isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/email`, 
      element: (
        <ProtectedRoute requireAdmin>
          <EmailConfigurations />
        </ProtectedRoute>
      )
    }] : []),
    ...(isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/email-settings`,
      element: (
        <ProtectedRoute requireAdmin>
          <ExtensionPage name="platform-email-settings-page" />
        </ProtectedRoute>
      )
    }] : []),
    { 
      path: `${pathPrefix}admin/email-templates`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          {(isRootLevel || !isMultiTenantEnabled())
            ? (isMultiTenantEnabled() ? <ExtensionPage name="platform-email-templates-page" /> : <EmailTemplates />)
            : <ExtensionPage name="tenant-email-templates-page" />}
        </ProtectedRoute>
      )
    },
    ...(!isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/branding`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          <Branding />
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
          <UserManagement />
        </ProtectedRoute>
      )
    }] : []),
    ...(isMultiTenantEnabled() ? [{
      path: `${pathPrefix}admin/users`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel}>
          {isRootLevel ? <UserManagement /> : <ExtensionPage name="tenant-users-page" />}
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
          <ProjectOverview />
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/*`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <ProjectOverview />
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/project/:projectId`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <ProjectDetail />
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/editor/:fileId`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <Editor />
        </FeatureFlagGuard>
      )
    },

    // Mission Control routes
    { 
      path: `${pathPrefix}mission-control`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <MissionControlBridge />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/processes`, 
      element: (
        <FeatureFlagGuard flag="missionControl.processes" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <ProcessesOverviewPage />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/processes/instances/:instanceId`, 
      element: (
        <FeatureFlagGuard flag="missionControl.processes" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <ProcessInstanceDetailPage />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <BatchesPage />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/:batchId`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <BatchesPage />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/delete`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <NewDeleteBatch />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/suspend`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <NewSuspendBatch />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/activate`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <NewActivateBatch />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/batches/new/retries`, 
      element: (
        <FeatureFlagGuard flag="missionControl.batches" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <NewRetriesBatch />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/migration/new`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <MigrationWizardPage />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/decisions`, 
      element: (
        <FeatureFlagGuard flag="missionControl.decisions" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <Decisions />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/decisions/instances/:id`, 
      element: (
        <FeatureFlagGuard flag="missionControl.decisions" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <DecisionHistoryDetail />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/*`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard>
            <MissionControlBridge />
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },

    // Engines
    { 
      path: `${pathPrefix}engines`, 
      element: (
        <FeatureFlagGuard flag="engines" fallback={<Navigate to={fallbackPath} replace />}>
          <EnginesPage />
        </FeatureFlagGuard>
      )
    },

    // Settings
    { path: `${pathPrefix}profile`, element: <Navigate to={fallbackPath} replace /> },
    { path: `${pathPrefix}settings/git-connections`, element: <GitConnections /> },

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
          <OAuthCallback />
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
