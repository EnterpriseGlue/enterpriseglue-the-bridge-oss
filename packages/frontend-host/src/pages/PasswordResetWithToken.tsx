import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, PasswordInput, InlineLoading, InlineNotification } from '@carbon/react';
import { authService } from '../services/auth';
import { parseApiError } from '../shared/api/apiErrorUtils';
import PublicAuthShell from '../shared/components/PublicAuthShell';

const PASSWORD_REQUIREMENTS = 'Use at least 8 characters with an uppercase letter, lowercase letter, number, and symbol (!@#$%^&*_+=).';

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[a-z]/.test(password)) return 'Add at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Add at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Add at least one number.';
  if (!/[!@#$%^&*_+=]/.test(password)) return 'Add at least one symbol (!@#$%^&*_+=).';
  return null;
}

export default function PasswordResetWithToken() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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
  const [submitError, setSubmitError] = useState('');
  const [resetComplete, setResetComplete] = useState(false);
  const [newPasswordTouched, setNewPasswordTouched] = useState(false);
  const [confirmPasswordTouched, setConfirmPasswordTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

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

  const newPasswordError = newPasswordTouched || submitAttempted ? validatePassword(newPassword) : null;
  const confirmPasswordError = confirmPasswordTouched || submitAttempted
    ? !confirmPassword
      ? 'Confirm your new password.'
      : newPassword !== confirmPassword
        ? 'Passwords do not match.'
        : null
    : null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitAttempted(true);

    if (newPassword !== confirmPassword) {
      return;
    }

    if (validatePassword(newPassword)) return;

    setIsSubmitting(true);

    try {
      await authService.resetPasswordWithToken({ token, newPassword });
      setResetComplete(true);
      setTimeout(() => navigate(loginPath, { replace: true }), 1500);
    } catch (err) {
      const parsed = parseApiError(err, 'Password reset failed');
      setSubmitError(parsed.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PublicAuthShell
      title="Set a new password"
      description="Create a new password to regain access to your account."
      homePath={tenantSlug ? `${tenantPrefix}/` : '/'}
    >

        {isValidating ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--spacing-6)' }}>
            <InlineLoading description="Validating reset link..." />
          </div>
        ) : !isValidToken ? (
          <div>
            <InlineNotification kind="error" lowContrast hideCloseButton title="Reset link unavailable" subtitle={validationMessage} />
            <Button kind="secondary" onClick={() => navigate(forgotPath)}>
              Request a new reset link
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {resetComplete && <InlineNotification kind="success" lowContrast hideCloseButton title="Password reset" subtitle="Your password was updated. Redirecting to login…" style={{ marginBottom: 'var(--spacing-5)' }} />}
            {submitError && <InlineNotification kind="error" lowContrast hideCloseButton title="Password not updated" subtitle={submitError} style={{ marginBottom: 'var(--spacing-5)' }} />}
            <div style={{ marginBottom: 'var(--spacing-5)' }}>
              <PasswordInput
                id="new-password"
                labelText="New password"
                placeholder="Enter your new password"
                autoComplete="new-password"
                showPasswordLabel="Show password"
                hidePasswordLabel="Hide password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onBlur={() => setNewPasswordTouched(true)}
                helperText={PASSWORD_REQUIREMENTS}
                invalid={Boolean(newPasswordError)}
                invalidText={newPasswordError || undefined}
                required
                disabled={isSubmitting || resetComplete}
              />
            </div>

            <div style={{ marginBottom: 'var(--spacing-6)' }}>
              <PasswordInput
                id="confirm-password"
                labelText="Confirm password"
                placeholder="Confirm your new password"
                autoComplete="new-password"
                showPasswordLabel="Show password"
                hidePasswordLabel="Hide password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => setConfirmPasswordTouched(true)}
                helperText="Enter the same password again."
                invalid={Boolean(confirmPasswordError)}
                invalidText={confirmPasswordError || undefined}
                required
                disabled={isSubmitting || resetComplete}
              />
            </div>

            <Button
              type="submit"
              kind="primary"
              disabled={isSubmitting || resetComplete || !newPassword || !confirmPassword}
              style={{ width: '100%' }}
            >
              {isSubmitting ? 'Updating...' : 'Update password'}
            </Button>
          </form>
        )}
    </PublicAuthShell>
  );
}
