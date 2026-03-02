import { useState, useEffect, FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, TextInput, Tile, Loading } from '@carbon/react';
import { useAuth } from '../shared/hooks/useAuth';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';

/**
 * Password Reset page
 * Forces users to reset their password on first login
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, resetPassword } = useAuth();
  const { notify } = useToast();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const homePath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : '/';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Redirect if no user or already reset
  useEffect(() => {
    if (!user || !user.mustResetPassword) {
      navigate(homePath, { replace: true });
    }
  }, [user, navigate, homePath]);

  // Don't render form if user shouldn't be here
  if (!user || !user.mustResetPassword) {
    return null;
  }

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (!/[a-z]/.test(password)) {
      return 'Password must contain at least one lowercase letter';
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must contain at least one uppercase letter';
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must contain at least one number';
    }
    if (!/[!@#$%^&*_+=]/.test(password)) {
      return 'Password must contain at least one symbol (!@#$%^&*_+=)';
    }
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    // Validate passwords match
    if (newPassword !== confirmPassword) {
      notify({ kind: 'error', title: 'Passwords do not match' });
      return;
    }

    // Validate password complexity
    const validationError = validatePassword(newPassword);
    if (validationError) {
      notify({ kind: 'error', title: 'Password requirements', subtitle: validationError });
      return;
    }

    setIsLoading(true);

    try {
      await resetPassword({ currentPassword, newPassword });
      notify({
        kind: 'success',
        title: 'Password reset',
        subtitle: 'Password reset successfully! Redirecting...',
      });

      // Redirect to home after 2 seconds
      setTimeout(() => {
        navigate(homePath, { replace: true });
      }, 2000);
    } catch (err) {
      const parsed = parseApiError(err, 'Password reset failed');
      notify({ kind: 'error', title: 'Password reset failed', subtitle: parsed.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--color-bg-secondary)',
      padding: 'var(--spacing-6)'
    }}>
      <div style={{
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-8)',
        borderRadius: 'var(--border-radius-md)',
        boxShadow: 'var(--shadow-md)',
        width: '100%',
        maxWidth: '500px'
      }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--spacing-6)' }}>
          <h1 style={{
            fontSize: 'var(--text-28)',
            fontWeight: 'var(--font-weight-semibold)',
            marginBottom: 'var(--spacing-2)',
            color: 'var(--color-text-primary)'
          }}>
            Reset Your Password
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
            You must reset your password before continuing
          </p>
        </div>

        {/* Reset form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--spacing-5)' }}>
            <TextInput
              id="current-password"
              labelText="Current Password"
              placeholder="Enter your temporary password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <div style={{ marginBottom: 'var(--spacing-5)' }}>
            <TextInput
              id="new-password"
              labelText="New Password"
              placeholder="Enter your new password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={isLoading}
            />
            <div style={{ marginTop: 'var(--spacing-2)', fontSize: 'var(--text-12)', color: 'var(--color-text-secondary)' }}>
              Password must contain:
              <ul style={{ marginLeft: 'var(--spacing-5)', marginTop: 'var(--spacing-1)' }}>
                <li>At least 8 characters</li>
                <li>One uppercase letter (A-Z)</li>
                <li>One lowercase letter (a-z)</li>
                <li>One number (0-9)</li>
                <li>One symbol (!@#$%^&*_+=)</li>
              </ul>
            </div>
          </div>

          <div style={{ marginBottom: 'var(--spacing-6)' }}>
            <TextInput
              id="confirm-password"
              labelText="Confirm Password"
              placeholder="Confirm your new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <Button
            type="submit"
            kind="primary"
            disabled={isLoading || !currentPassword || !newPassword || !confirmPassword}
            style={{ width: '100%' }}
          >
            {isLoading ? 'Resetting...' : 'Reset Password'}
          </Button>
        </form>
      </div>
    </div>
  );
}
