import React from 'react'
import { Navigate, RouteObject, useLocation } from 'react-router-dom'

// Extension registry for EE plugin integration
import { extensions, isMultiTenantEnabled, type EnterpriseExtensionRoute } from '../enterprise/extensionRegistry'
import { prepareExtensionRoutes } from '../enterprise/extensionRouteAuthz'

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
const MigrationWizardPage = React.lazy(() => import('../features/mission-control/migration-wizard/MigrationWizardPage'))

// Platform Admin pages
const PlatformSettingsPage = React.lazy(() => import('../features/platform-admin/pages/PlatformSettingsPage'))
const AccessControl = React.lazy(() => import('../features/platform-admin/pages/AccessControl'))
const AuthzPolicies = React.lazy(() => import('../features/platform-admin/pages/AuthzPolicies'))
const AuthzAuditLog = React.lazy(() => import('../features/platform-admin/pages/AuthzAuditLog'))
const PluginManagement = React.lazy(() => import('../features/platform-admin/pages/PluginManagement'))

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
const UserDetail = React.lazy(() => import('../pages/admin/UserDetail'))

// Dashboard
import Dashboard from '../pages/Dashboard'

// Git OAuth
const OAuthCallback = React.lazy(() => import('../features/git/pages/OAuthCallback'))

// Settings (GitConnections page removed — Git connections now live at project level)

import { useAuth } from '../shared/hooks/useAuth'
import { useFeatureFlag } from '../shared/hooks/useFeatureFlag'
import { EngineAccessError } from '../features/mission-control/shared'
import {
  ACCESS_CONTROL_PLATFORM_PERMISSIONS,
  hasEnginesUiAccess,
  hasMissionControlSectionAccess,
  hasMissionControlUiAccess,
  hasPlatformPermission,
  hasStarbaseUiAccess,
  MISSION_CONTROL_BATCHES_ENGINE_PERMISSIONS,
  MISSION_CONTROL_DECISIONS_ENGINE_PERMISSIONS,
  MISSION_CONTROL_MIGRATION_ENGINE_PERMISSIONS,
  MISSION_CONTROL_NAV_ENGINE_PERMISSIONS,
  MISSION_CONTROL_PROCESSES_ENGINE_PERMISSIONS,
  PlatformPermission,
  PLATFORM_SETTINGS_HUB_PLATFORM_PERMISSIONS,
  USER_MANAGEMENT_PLATFORM_PERMISSIONS,
} from '../shared/auth/permissions'
import { evaluateActionSnapshot } from '../shared/auth/guards'

/**
 * Default tenant slug for OSS single-tenant mode and EE default tenant.
 * Root protected routes redirect here so the browser URL remains the source
 * of tenant context for routing, API prefixing, and tenant-aware navigation.
 */
const DEFAULT_TENANT_SLUG = 'default'

function DefaultTenantRedirect() {
  const location = useLocation()
  const targetPath = location.pathname === '/' ? '' : location.pathname
  return (
    <Navigate
      to={`/t/${DEFAULT_TENANT_SLUG}${targetPath}${location.search}${location.hash}`}
      replace
    />
  )
}

function MissionControlRoleGuard({
  children,
  requiredEnginePermissions,
  message,
}: {
  children: React.ReactNode
  requiredEnginePermissions?: string[]
  message?: string
}) {
  const { user, permissions } = useAuth()
  const location = useLocation()

  const isMissionControlEnabled = useFeatureFlag('missionControl')
  const missionControlAllowed = requiredEnginePermissions?.length
    ? hasMissionControlSectionAccess(permissions, user, requiredEnginePermissions)
    : hasMissionControlUiAccess(permissions, user)
  const platformSettingsAllowed = hasPlatformPermission(permissions, PlatformPermission.SETTINGS_MANAGE)
  const isMultiTenant = isMultiTenantEnabled()
  const hideVoyagerForPlatformAdmin = isMultiTenant && platformSettingsAllowed

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  if (hideVoyagerForPlatformAdmin) {
    return <Navigate to="/admin/tenants" replace />
  }

  if (isMissionControlEnabled && !missionControlAllowed) {
    const defaultMessage = 'You need Mission Control permission on at least one engine to open this section. Create an engine or ask an engine owner to grant you access.'
    return <EngineAccessError status={403} message={message || defaultMessage} actionPath={toTenantPath('/engines')} actionLabel="Go to Engines" />
  }

  return <>{children}</>
}

function EnginesRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, permissions } = useAuth()
  const location = useLocation()
  const canAccessEngines = hasEnginesUiAccess(permissions, user)

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  if (!canAccessEngines) {
    return (
      <EngineAccessError
        status={403}
        message="You need permission to create engines or access at least one engine to open Engines."
        actionPath={toTenantPath('/')}
        actionLabel="Go home"
      />
    )
  }

  return <>{children}</>
}

function StarbaseRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, permissions } = useAuth()
  const location = useLocation()
  const projectsReadDecision = evaluateActionSnapshot(permissions, 'project.projects.read', { type: 'project', id: null })
  const canAccessStarbase = projectsReadDecision.allowed || hasStarbaseUiAccess(permissions, user)

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/)
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : ''
  const toTenantPath = (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p)

  if (!canAccessStarbase) {
    return (
      <EngineAccessError
        status={403}
        message="You need project access or permission to create projects to open Starbase."
        actionPath={toTenantPath('/')}
        actionLabel="Go home"
      />
    )
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
  const multiTenantEnabled = isMultiTenantEnabled()
  const fallbackPath = isRootLevel ? '/' : '..'
  const pathPrefix = isRootLevel ? '/' : ''

  if (isRootLevel && multiTenantEnabled) {
    return [
      { path: '*', element: <DefaultTenantRedirect /> },
    ]
  }

  return [
    { index: true, element: <Dashboard /> },
    
    // Admin routes
    ...((!multiTenantEnabled || !isRootLevel) ? [{
      path: `${pathPrefix}admin/settings`, 
      element: multiTenantEnabled && !isRootLevel ? (
        <ProtectedRoute requireAdmin={false}>
          <ExtensionPage name="tenant-settings-page" />
        </ProtectedRoute>
      ) : (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={PLATFORM_SETTINGS_HUB_PLATFORM_PERMISSIONS}>
          <LazyRoute message="Loading settings...">
            <PlatformSettingsPage />
          </LazyRoute>
        </ProtectedRoute>
      )
    }] : []),
    ...(!multiTenantEnabled ? [
      {
        path: `${pathPrefix}admin/settings/:settingsSection`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={PLATFORM_SETTINGS_HUB_PLATFORM_PERMISSIONS}>
            <LazyRoute message="Loading settings...">
              <PlatformSettingsPage />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/plugins`,
        element: (
          <ProtectedRoute requireAdmin>
            <LazyRoute message="Loading plugin management...">
              <PluginManagement />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/settings/git`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.GIT_PROVIDER_MANAGE, PlatformPermission.SETTINGS_MANAGE]}>
            <LazyRoute message="Loading Git settings...">
              <PlatformSettingsPage section="git" />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/settings/projects`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.SETTINGS_MANAGE]}>
            <LazyRoute message="Loading project settings...">
              <PlatformSettingsPage section="projects" />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/settings/engines`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.ENGINE_REGISTRATION_MANAGE, PlatformPermission.SETTINGS_MANAGE]}>
            <LazyRoute message="Loading engine settings...">
              <PlatformSettingsPage section="engines" />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/settings/access-control`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={ACCESS_CONTROL_PLATFORM_PERMISSIONS}>
            <LazyRoute message="Loading access control...">
              <PlatformSettingsPage section="access-control" />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/settings/policies`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.AUTHZ_ROLES_MANAGE]}>
            <LazyRoute message="Loading policies...">
              <PlatformSettingsPage section="authz-policies" />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/settings/authz-audit`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.AUDIT_VIEW]}>
            <LazyRoute message="Loading authorization audit...">
              <PlatformSettingsPage section="authz-audit" />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
      {
        path: `${pathPrefix}admin/settings/audit-logs`,
        element: (
          <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.AUDIT_VIEW]}>
            <LazyRoute message="Loading audit logs...">
              <PlatformSettingsPage section="audit-logs" />
            </LazyRoute>
          </ProtectedRoute>
        )
      },
    ] : []),
    ...(multiTenantEnabled && !isRootLevel ? [
      { path: `${pathPrefix}admin/settings/git`, element: <Navigate to="../admin/settings" replace /> },
      { path: `${pathPrefix}admin/settings/projects`, element: <Navigate to="../admin/settings" replace /> },
      { path: `${pathPrefix}admin/settings/engines`, element: <Navigate to="../admin/settings" replace /> },
      { path: `${pathPrefix}admin/settings/sso`, element: <Navigate to="../admin/settings" replace /> },
      { path: `${pathPrefix}admin/settings/access-control`, element: <Navigate to="../admin/settings" replace /> },
      { path: `${pathPrefix}admin/settings/policies`, element: <Navigate to="../admin/settings" replace /> },
      { path: `${pathPrefix}admin/settings/authz-audit`, element: <Navigate to="../admin/settings" replace /> },
      { path: `${pathPrefix}admin/settings/audit-logs`, element: <Navigate to="../admin/settings" replace /> },
    ] : []),
    {
      path: `${pathPrefix}admin/access-control`,
      element: (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={ACCESS_CONTROL_PLATFORM_PERMISSIONS}>
          <LazyRoute message="Loading access control...">
            <AccessControl />
          </LazyRoute>
        </ProtectedRoute>
      )
    },
    { 
      path: `${pathPrefix}admin/policies`, 
      element: (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.AUTHZ_ROLES_MANAGE]}>
          <LazyRoute message="Loading policies...">
            <AuthzPolicies />
          </LazyRoute>
        </ProtectedRoute>
      )
    },
    { 
      path: `${pathPrefix}admin/authz-audit`, 
      element: (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.AUDIT_VIEW]}>
          <LazyRoute message="Loading audit log...">
            <AuthzAuditLog />
          </LazyRoute>
        </ProtectedRoute>
      )
    },
    // TenantManagement is EE-only (multi-tenant mode)
    // Uses ExtensionPage - shows fallback in OSS, actual page in EE
    ...(multiTenantEnabled ? [{
      path: `${pathPrefix}admin/tenants`, 
      element: (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.SETTINGS_MANAGE]}>
          <ExtensionPage name="tenant-management-page" />
        </ProtectedRoute>
      )
    }] : []),
    ...((!multiTenantEnabled || !isRootLevel) ? [{
      path: `${pathPrefix}admin/audit-logs`,
      element: (
        <ProtectedRoute requireAdmin={isRootLevel} requiredPlatformPermissions={[PlatformPermission.AUDIT_VIEW]}>
          <LazyRoute message="Loading audit logs...">
            <AuditLogViewer />
          </LazyRoute>
        </ProtectedRoute>
      )
    }] : []),
    // EE-only tenant-scoped admin pages (domains, sso, invite-policies)
    ...(multiTenantEnabled && !isRootLevel ? [
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
    ...(!multiTenantEnabled ? [
      { path: `${pathPrefix}admin/email`, element: <Navigate to={isRootLevel ? '/admin/settings' : '../admin/settings'} replace /> },
      { path: `${pathPrefix}admin/email-templates`, element: <Navigate to={isRootLevel ? '/admin/settings' : '../admin/settings'} replace /> },
      { path: `${pathPrefix}admin/branding`, element: <Navigate to={isRootLevel ? '/admin/settings' : '../admin/settings'} replace /> },
    ] : []),
    // EE multi-tenant: keep extension page routes
    ...(multiTenantEnabled ? [{
      path: `${pathPrefix}admin/email-settings`,
      element: (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={[PlatformPermission.SETTINGS_MANAGE]}>
          <ExtensionPage name="platform-email-settings-page" />
        </ProtectedRoute>
      )
    }] : []),
    ...(multiTenantEnabled ? [{
      path: `${pathPrefix}admin/email-templates`,
      element: (
        <ProtectedRoute requireAdmin={isRootLevel} requiredPlatformPermissions={[PlatformPermission.SETTINGS_MANAGE]}>
          {isRootLevel
            ? <ExtensionPage name="platform-email-templates-page" />
            : <ExtensionPage name="tenant-email-templates-page" />}
        </ProtectedRoute>
      )
    }] : []),
    ...(multiTenantEnabled && !isRootLevel ? [{
      path: `${pathPrefix}admin/branding`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel} requiredPlatformPermissions={[PlatformPermission.SETTINGS_MANAGE]}>
          <ExtensionPage name="tenant-branding-page" />
        </ProtectedRoute>
      )
    }] : []),
    // User Management - OSS uses root-level UserManagement, EE multi-tenant uses tenant-scoped page
    ...(!multiTenantEnabled ? [{
      path: `${pathPrefix}admin/users`, 
      element: (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={USER_MANAGEMENT_PLATFORM_PERMISSIONS}>
          <LazyRoute message="Loading users...">
            <UserManagement />
          </LazyRoute>
        </ProtectedRoute>
      )
    }, {
      path: `${pathPrefix}admin/users/:userId`,
      element: (
        <ProtectedRoute requireAdmin requiredPlatformPermissions={USER_MANAGEMENT_PLATFORM_PERMISSIONS}>
          <LazyRoute message="Loading user details...">
            <UserDetail />
          </LazyRoute>
        </ProtectedRoute>
      )
    }] : []),
    ...(multiTenantEnabled ? [{
      path: `${pathPrefix}admin/users`, 
      element: (
        <ProtectedRoute requireAdmin={isRootLevel} requiredPlatformPermissions={USER_MANAGEMENT_PLATFORM_PERMISSIONS}>
          {isRootLevel ? <LazyRoute message="Loading users..."><UserManagement /></LazyRoute> : <ExtensionPage name="tenant-users-page" />}
        </ProtectedRoute>
      )
    }] : []),

    // TenantSetupWizard is EE-only (multi-tenant mode)
    ...(multiTenantEnabled ? [{
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
          <StarbaseRouteGuard>
            <LazyRoute message="Loading projects...">
              <ProjectOverview />
            </LazyRoute>
          </StarbaseRouteGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/*`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <StarbaseRouteGuard>
            <LazyRoute message="Loading projects...">
              <ProjectOverview />
            </LazyRoute>
          </StarbaseRouteGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/project/:projectId`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <StarbaseRouteGuard>
            <LazyRoute message="Loading project...">
              <ProjectDetail />
            </LazyRoute>
          </StarbaseRouteGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}starbase/editor/:fileId`, 
      element: (
        <FeatureFlagGuard flag="starbase" fallback={<Navigate to={fallbackPath} replace />}>
          <StarbaseRouteGuard>
            <LazyRoute message="Loading editor...">
              <Editor />
            </LazyRoute>
          </StarbaseRouteGuard>
        </FeatureFlagGuard>
      )
    },

    // Mission Control routes
    { 
      path: `${pathPrefix}mission-control`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_NAV_ENGINE_PERMISSIONS}>
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
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_PROCESSES_ENGINE_PERMISSIONS}>
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
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_PROCESSES_ENGINE_PERMISSIONS}>
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
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_BATCHES_ENGINE_PERMISSIONS}>
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
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_BATCHES_ENGINE_PERMISSIONS}>
            <LazyRoute message="Loading batches...">
              <BatchesPage />
            </LazyRoute>
          </MissionControlRoleGuard>
        </FeatureFlagGuard>
      )
    },
    { 
      path: `${pathPrefix}mission-control/migration/new`, 
      element: (
        <FeatureFlagGuard flag="missionControl" fallback={<Navigate to={fallbackPath} replace />}>
          <MissionControlRoleGuard
            requiredEnginePermissions={MISSION_CONTROL_MIGRATION_ENGINE_PERMISSIONS}
            message="You need process modify permission on at least one engine to run process migrations."
          >
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
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_DECISIONS_ENGINE_PERMISSIONS}>
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
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_DECISIONS_ENGINE_PERMISSIONS}>
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
          <MissionControlRoleGuard requiredEnginePermissions={MISSION_CONTROL_NAV_ENGINE_PERMISSIONS}>
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
          <EnginesRouteGuard>
            <ExtensionPage name="engines-page" fallback={<LazyRoute message="Loading engines..."><EnginesPage /></LazyRoute>} />
          </EnginesRouteGuard>
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
    { path: '/admin-recovery', element: <Login /> },
    { path: '/t/:tenantSlug/admin-recovery', element: <Login /> },
    { path: '/t/:tenantSlug/invite/:token', element: <AcceptInvite /> },
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
  enterpriseRootChildren: EnterpriseExtensionRoute[] = [],
  enterpriseTenantChildren: EnterpriseExtensionRoute[] = []
): RouteObject[] {
  // Merge all root routes: plugin interface + extension registry
  const allRootChildren = prepareExtensionRoutes([
    ...enterpriseRootChildren,
    ...(extensions?.rootRoutes || []),
  ], { scope: 'root' });

  // Merge all tenant routes: plugin interface + extension registry
  const allTenantChildren = prepareExtensionRoutes([
    ...enterpriseTenantChildren,
    ...(extensions?.tenantRoutes || []),
  ], { scope: 'tenant' });

  return [
    ...getPublicRoutes(),
    createRootLayoutRoute(allRootChildren),
    createTenantLayoutRoute(allTenantChildren),
  ]
}
