import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { InlineLoading, SkeletonText } from '@carbon/react';
import { useOptionalOrganizationSession } from '../../features/organizations/OrganizationSession';
import { ORGANIZATION_SELECTION_PATH } from '../../features/organizations/organizationPaths';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../../shared/api/client';
import { isMultiTenantEnabled } from '../../enterprise/extensionRegistry';
import {
  hasAdminRouteAccess,
  hasPlatformPermission,
  PlatformPermission,
} from '../auth/permissions';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requiredPlatformPermissions?: string[];
  skipSetupCheck?: boolean;
}

/**
 * Component to protect routes that require authentication
 * Optionally can require admin role
 * Redirects admin users to setup wizard if platform not configured
 */
export function ProtectedRoute({ children, requireAdmin = false, requiredPlatformPermissions, skipSetupCheck = false }: ProtectedRouteProps) {
  const { user, permissions, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const organization = useOptionalOrganizationSession();
  const [setupChecked, setSetupChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const platformSettingsAllowed = hasPlatformPermission(permissions, PlatformPermission.SETTINGS_MANAGE);
  const canAccessAdminRoute = hasAdminRouteAccess(permissions, user, requiredPlatformPermissions);

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const effectivePathname = tenantSlug ? (location.pathname.replace(/^\/t\/[^/]+/, '') || '/') : location.pathname;
  const loginPath = !organization && tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/login` : '/login';
  const homePath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : '/';

  // Setup-exempt paths (accessible even when setup needed)
  const multiTenantEnabled = isMultiTenantEnabled();
  const setupExemptPaths = ['/admin/tenants', '/admin/email', '/logout', '/profile'];
  const isExemptPath = setupExemptPaths.some(p => effectivePathname.includes(p));
  const sessionTenant = user?.session?.tenant;
  const verifiedTenantSlug = sessionTenant?.id ? sessionTenant.slug : undefined;
  const organizationMatch = verifiedTenantSlug ? verifiedTenantSlug === tenantSlug : organization?.memberships.data?.some((membership) =>
    membership.tenantSlug === tenantSlug && membership.tenantId === sessionTenant?.id
      && membership.tenantStatus === 'active',
  );
  // A current host has already checked the exact tenant and active membership
  // when establishing this session. The full list can load in the background.
  const checkingOrganization = Boolean(tenantSlug && organization && isAuthenticated
    && (organization.transitioning || (!verifiedTenantSlug && sessionTenant?.id && organization.memberships.isPending)));
  const isSetupPath = !multiTenantEnabled && effectivePathname === '/admin/settings';

  useEffect(() => {
    if (isLoading || !isAuthenticated || !platformSettingsAllowed || skipSetupCheck || isExemptPath || isSetupPath) {
      setSetupChecked(true);
      setNeedsSetup(false);
      return;
    }

    setSetupChecked(false);
    const checkSetup = async () => {
      try {
        const data = await apiClient.get<{ isConfigured?: boolean }>('/api/admin/setup-status');
        setNeedsSetup(!data?.isConfigured);
      } catch {
        // Ignore errors, assume configured
      } finally {
        setSetupChecked(true);
      }
    };

    checkSetup();
  }, [isLoading, isAuthenticated, platformSettingsAllowed, skipSetupCheck, isExemptPath, isSetupPath]);

  if (organization && (isLoading || checkingOrganization)) {
    return <main id="main-content" className="eg-workspace-loading" aria-label="Loading your workspace">
      <SkeletonText paragraph lineCount={4} />
    </main>;
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <InlineLoading description="Loading..." />
      </div>
    );
  }

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }

  if (organization && tenantSlug && !organizationMatch) {
    const destination = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={ORGANIZATION_SELECTION_PATH} state={{ destination }} replace />;
  }

  // Requires admin but user is not admin - redirect to home
  if (requireAdmin && !canAccessAdminRoute) {
    return <Navigate to={homePath} replace />;
  }

  // Still checking setup status for admins
  if (platformSettingsAllowed && !setupChecked && !skipSetupCheck && !isExemptPath) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <InlineLoading description="Loading..." />
      </div>
    );
  }

  // Admin needs to complete setup - redirect to tenant management
  if (needsSetup && !isExemptPath && !isSetupPath) {
    const setupPath = multiTenantEnabled ? '/admin/tenants' : `${tenantPrefix}/admin/settings`;
    return <Navigate to={setupPath} replace state={{ setupRequired: true }} />;
  }

  // Authenticated and authorized
  return <>{children}</>;
}
