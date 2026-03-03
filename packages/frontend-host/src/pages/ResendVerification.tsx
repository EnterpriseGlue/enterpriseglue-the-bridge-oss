import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, TextInput } from '@carbon/react';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';

export default function ResendVerification() {
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useToast();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const loginPath = tenantSlug ? `${tenantPrefix}/login` : '/login';
  const verifyPath = tenantSlug ? `${tenantPrefix}/verify-email` : '/verify-email';

  const locationState = location.state as { email?: string } | null;
  const queryEmail = new URLSearchParams(location.search).get('email') || '';
  const initialEmail = (locationState?.email || queryEmail).trim();

  const [email, setEmail] = useState(initialEmail);
  const [showEmailInput, setShowEmailInput] = useState(!initialEmail);
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'verified'>('idle');
  const [showResendForm, setShowResendForm] = useState(false);

  const canResend = Boolean(email);

  const handleVerifyToken = (e: FormEvent) => {
    e.preventDefault();
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      notify({
        kind: 'error',
        title: 'Verification token required',
        subtitle: 'Paste the verification token from your email to continue.',
      });
      return;
    }
    setIsVerifying(true);
    navigate(`${verifyPath}?token=${encodeURIComponent(trimmedToken)}`, { replace: true });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email) {
      notify({
        kind: 'error',
        title: 'Email required',
        subtitle: 'Enter the email address for the verification link.',
      });
      return;
    }
    setIsLoading(true);

    try {
      const response = await apiClient.post<{ alreadyVerified?: boolean }>('/api/auth/resend-verification', { email });
      if (response?.alreadyVerified) {
        setStatus('verified');
        notify({
          kind: 'info',
          title: 'Email already verified',
          subtitle: 'You can log in to your account.',
        });
      } else {
        setStatus('sent');
        notify({
          kind: 'success',
          title: 'Verification email sent',
          subtitle: 'If your email exists, a verification link has been sent.',
        });
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to send verification email');
      notify({ kind: 'error', title: 'Unable to resend verification email', subtitle: parsed.message });
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
      padding: 'var(--spacing-6)',
    }}>
      <div style={{
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-8)',
        borderRadius: 'var(--border-radius-md)',
        boxShadow: 'var(--shadow-md)',
        width: '100%',
        maxWidth: '480px',
      }}>
        <div style={{ marginBottom: 'var(--spacing-6)' }}>
          <h1 style={{
            fontSize: 'var(--text-28)',
            fontWeight: 'var(--font-weight-semibold)',
            marginBottom: 'var(--spacing-2)',
            color: 'var(--color-text-primary)',
          }}>
            Verify your email
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
            Paste the verification token from the email to complete verification.
          </p>
        </div>

        <form onSubmit={handleVerifyToken}>
          <div style={{ marginBottom: 'var(--spacing-5)' }}>
            <TextInput
              id="verification-token"
              labelText="Verification token"
              placeholder="Paste token from your email"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={isVerifying}
              required
            />
          </div>

          <Button
            type="submit"
            kind="primary"
            disabled={isVerifying || !token.trim()}
            style={{ width: '100%' }}
          >
            {isVerifying ? 'Verifying...' : 'Verify token'}
          </Button>
        </form>

        <div style={{
          marginTop: 'var(--spacing-6)',
          paddingTop: 'var(--spacing-4)',
          borderTop: '1px solid var(--color-border-primary)',
        }}>
          {!showResendForm ? (
            <Button
              kind="ghost"
              size="sm"
              onClick={() => setShowResendForm(true)}
              style={{ width: '100%' }}
            >
              Need a new link? Resend verification email
            </Button>
          ) : (
            <>
              <p style={{
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--text-14)',
                marginBottom: 'var(--spacing-4)',
              }}>
                We can resend the verification email.
              </p>

              <form onSubmit={handleSubmit}>
                {showEmailInput && (
                  <div style={{ marginBottom: 'var(--spacing-5)' }}>
                    <TextInput
                      id="email"
                      labelText="Email"
                      placeholder="name@company.com"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                )}

                <div style={{ display: 'flex', gap: 'var(--spacing-3)', flexWrap: 'wrap' }}>
                  {!showEmailInput && (
                    <Button
                      type="button"
                      kind="ghost"
                      size="sm"
                      onClick={() => setShowEmailInput(true)}
                      disabled={isLoading}
                    >
                      Use a different email
                    </Button>
                  )}
                  <Button
                    type="submit"
                    kind="secondary"
                    disabled={isLoading || !canResend}
                    style={{ flex: showEmailInput ? undefined : 1 }}
                  >
                    {isLoading ? 'Sending...' : 'Resend verification email'}
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>

        <div style={{
          marginTop: 'var(--spacing-6)',
          paddingTop: 'var(--spacing-4)',
          borderTop: '1px solid var(--color-border-primary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--spacing-3)',
          flexWrap: 'wrap',
          fontSize: 'var(--text-14)',
        }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {status === 'verified' ? 'Email already verified.' : 'Already verified your email?'}
          </span>
          <Button kind="ghost" size="sm" onClick={() => navigate(loginPath)}>
            Go to login
          </Button>
        </div>
      </div>
    </div>
  );
}
