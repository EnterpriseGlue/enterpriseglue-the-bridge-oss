import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, InlineNotification, TextInput } from '@carbon/react';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import PublicAuthShell from '../shared/components/PublicAuthShell';

export default function ResendVerification() {
  const location = useLocation();
  const navigate = useNavigate();

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
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'info' | 'success'; title: string; subtitle: string } | null>(null);

  const canResend = Boolean(email);

  const handleVerifyToken = (e: FormEvent) => {
    e.preventDefault();
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setFeedback({
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
      setFeedback({
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
        setFeedback({
          kind: 'info',
          title: 'Email already verified',
          subtitle: 'You can log in to your account.',
        });
      } else {
        setStatus('sent');
        setFeedback({
          kind: 'success',
          title: 'Verification email sent',
          subtitle: 'If your email exists, a verification link has been sent.',
        });
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to send verification email');
      setFeedback({ kind: 'error', title: 'Unable to resend verification email', subtitle: parsed.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PublicAuthShell
      title="Verify your email"
      description="Paste the verification token from the email to complete verification."
      homePath={tenantSlug ? `${tenantPrefix}/` : '/'}
    >

        {feedback ? (
          <InlineNotification
            kind={feedback.kind}
            lowContrast
            hideCloseButton
            title={feedback.title}
            subtitle={feedback.subtitle}
            style={{ marginBottom: 'var(--spacing-5)' }}
          />
        ) : null}

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
              Resend verification email
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

        <div className="eg-public-auth-actions">
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {status === 'verified' ? 'Email already verified.' : 'Already verified your email?'}
          </span>
          <Button kind="ghost" size="sm" onClick={() => navigate(loginPath)}>
            Go to login
          </Button>
        </div>
    </PublicAuthShell>
  );
}
