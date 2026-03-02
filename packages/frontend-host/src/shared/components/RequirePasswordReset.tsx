import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface RequirePasswordResetProps {
  children: ReactNode;
}

/**
 * Component that redirects to password reset if user must reset password
 * Wrap protected routes with this to enforce password reset
 */
export function RequirePasswordReset({ children }: RequirePasswordResetProps) {
  const { user } = useAuth();

  // If user must reset password, redirect to reset page
  if (user?.mustResetPassword) {
    return <Navigate to="/reset-password" replace />;
  }

  return <>{children}</>;
}
