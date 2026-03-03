import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { InlineLoading } from '@carbon/react';
import { useAuth } from '../hooks/useAuth';
import { apiClient } from '../../shared/api/client';

interface ProtectedRouteProps {
  children: ReactNode;
  requireAdmin?: boolean;
  skipSetupCheck?: boolean;
}

/**
 * Component to protect routes that require authentication
 * Optionally can require admin role
 * Redirects admin users to setup wizard if platform not configured
 */
export function ProtectedRoute({ children, requireAdmin = false, skipSetupCheck = false }: ProtectedRouteProps) {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const [setupChecked, setSetupChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const canAccessAdminRoutes = Boolean(user?.capabilities?.canAccessAdminRoutes);
  const canManagePlatformSettings = Boolean(user?.capabilities?.canManagePlatformSettings);

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const effectivePathname = tenantSlug ? (location.pathname.replace(/^\/t\/[^/]+/, '') || '/') : location.pathname;
  const loginPath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/login` : '/login';
  const homePath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : '/';

  // Setup-exempt paths (accessible even when setup needed)
  const setupExemptPaths = ['/admin/tenants', '/admin/email', '/logout', '/profile'];
  const isExemptPath = setupExemptPaths.some(p => effectivePathname.includes(p));

  useEffect(() => {
    if (!isAuthenticated || !canManagePlatformSettings || skipSetupCheck || isExemptPath) {
      setSetupChecked(true);
      return;
    }

    const checkSetup = async () => {
      try {
        const data = await apiClient.get<{ isConfigured?: boolean }>('/api/admin/setup-status');
        if (!data?.isConfigured) {
          setNeedsSetup(true);
        }
      } catch {
        // Ignore errors, assume configured
      } finally {
        setSetupChecked(true);
      }
    };

    checkSetup();
  }, [isAuthenticated, canManagePlatformSettings, skipSetupCheck, isExemptPath]);

  // Not authenticated - redirect to login
  if (!isAuthenticated) {
    return <Navigate to={loginPath} replace state={{ from: location }} />;
  }

  // Requires admin but user is not admin - redirect to home
  if (requireAdmin && !canAccessAdminRoutes) {
    return <Navigate to={homePath} replace />;
  }

  // Still checking setup status for admins
  if (canManagePlatformSettings && !setupChecked && !skipSetupCheck && !isExemptPath) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <InlineLoading description="Loading..." />
      </div>
    );
  }

  // Admin needs to complete setup - redirect to tenant management
  if (needsSetup && !isExemptPath) {
    const setupPath = tenantSlug ? `${tenantPrefix}/admin/tenants` : '/admin/tenants';
    return <Navigate to={setupPath} replace state={{ setupRequired: true }} />;
  }

  // Authenticated and authorized
  return <>{children}</>;
}
