import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { sanitizePathParam } from '../utils/sanitize';
import { useAuth } from '../hooks/useAuth';

interface RequireEmailVerificationProps {
  children: ReactNode;
}

/**
 * Redirects unverified users to the resend verification flow.
 */
export function RequireEmailVerification({ children }: RequireEmailVerificationProps) {
  const { user } = useAuth();
  const location = useLocation();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const tenantSlug = tenantSlugMatch?.[1] ? sanitizePathParam(decodeURIComponent(tenantSlugMatch[1])) : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const resendPath = tenantSlug ? `${tenantPrefix}/resend-verification` : '/resend-verification';

  if (user?.mustResetPassword) {
    return <>{children}</>;
  }

  if (user && user.isEmailVerified === false) {
    return <Navigate to={resendPath} replace />;
  }

  return <>{children}</>;
}
