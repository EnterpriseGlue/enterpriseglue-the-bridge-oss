import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, TextInput, InlineLoading } from '@carbon/react';
import { authService } from '../services/auth';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';

export default function PasswordResetWithToken() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify } = useToast();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const loginPath = tenantSlug ? `${tenantPrefix}/login` : '/login';
  const forgotPath = tenantSlug ? `${tenantPrefix}/forgot-password` : '/forgot-password';

  const token = searchParams.get('token') || '';
  const [isValidating, setIsValidating] = useState(true);
  const [isValidToken, setIsValidToken] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validationMessage = useMemo(() => {
    if (!validationError) return '';
    if (validationError.toLowerCase().includes('expired')) {
      return 'This reset link has expired. Please request a new one.';
    }
    return validationError;
  }, [validationError]);

  useEffect(() => {
    if (!token) {
      setIsValidating(false);
      setIsValidToken(false);
      setValidationError('Missing reset token');
      return;
    }

    let cancelled = false;
    setIsValidating(true);

    authService
      .verifyResetToken(token)
      .then((response) => {
        if (cancelled) return;
        if (response?.valid) {
          setIsValidToken(true);
          setValidationError('');
        } else {
          setIsValidToken(false);
          setValidationError(response?.error || 'Invalid or expired token');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const parsed = parseApiError(err, 'Failed to verify reset token');
        setIsValidToken(false);
        setValidationError(parsed.message);
      })
      .finally(() => {
        if (!cancelled) setIsValidating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
    if (!/[!@#$%^&*_+=]/.test(password)) return 'Password must contain at least one symbol (!@#$%^&*_+=)';
    return null;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      notify({ kind: 'error', title: 'Passwords do not match' });
      return;
    }

    const validationError = validatePassword(newPassword);
    if (validationError) {
      notify({ kind: 'error', title: 'Password requirements', subtitle: validationError });
      return;
    }

    setIsSubmitting(true);

    try {
      await authService.resetPasswordWithToken({ token, newPassword });
      notify({
        kind: 'success',
        title: 'Password reset',
        subtitle: 'Your password was updated. Redirecting to login...',
      });
      setTimeout(() => navigate(loginPath, { replace: true }), 1500);
    } catch (err) {
      const parsed = parseApiError(err, 'Password reset failed');
      notify({ kind: 'error', title: 'Reset failed', subtitle: parsed.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--color-bg-secondary)',
      padding: 'var(--spacing-6)',
    }}>
      <div style={{
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-8)',
        borderRadius: 'var(--border-radius-md)',
        boxShadow: 'var(--shadow-md)',
        width: '100%',
        maxWidth: '500px',
      }}>
        <div style={{ marginBottom: 'var(--spacing-6)' }}>
          <h1 style={{
            fontSize: 'var(--text-28)',
            fontWeight: 'var(--font-weight-semibold)',
            marginBottom: 'var(--spacing-2)',
            color: 'var(--color-text-primary)',
          }}>
            Set a new password
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
            Create a new password to regain access to your account.
          </p>
        </div>

        {isValidating ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--spacing-6)' }}>
            <InlineLoading description="Validating reset link..." />
          </div>
        ) : !isValidToken ? (
          <div style={{
            padding: 'var(--spacing-5)',
            borderRadius: 'var(--border-radius-sm)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-secondary)',
          }}>
            <p style={{ marginBottom: 'var(--spacing-4)' }}>{validationMessage}</p>
            <Button kind="secondary" onClick={() => navigate(forgotPath)}>
              Request a new reset link
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 'var(--spacing-5)' }}>
              <TextInput
                id="new-password"
                labelText="New Password"
                placeholder="Enter your new password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                disabled={isSubmitting}
              />
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
                disabled={isSubmitting}
              />
            </div>

            <Button
              type="submit"
              kind="primary"
              disabled={isSubmitting || !newPassword || !confirmPassword}
              style={{ width: '100%' }}
            >
              {isSubmitting ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
