import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, InlineNotification, TextInput } from '@carbon/react';
import { authService } from '../services/auth';
import { parseApiError } from '../shared/api/apiErrorUtils';
import PublicAuthShell from '../shared/components/PublicAuthShell';

export default function ForgotPassword() {
  const location = useLocation();
  const navigate = useNavigate();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const loginPath = tenantSlug ? `${tenantPrefix}/login` : '/login';

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [requestError, setRequestError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setRequestError('');

    try {
      await authService.forgotPassword({ email });
      setSubmitted(true);
    } catch (err) {
      const parsed = parseApiError(err, 'Unable to request password reset');
      setRequestError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PublicAuthShell
      title="Forgot your password?"
      description="Enter your email to receive a password reset link."
      homePath={tenantSlug ? `${tenantPrefix}/` : '/'}
    >
        {submitted && <InlineNotification
          kind="success"
          lowContrast
          hideCloseButton
          title="Reset email sent"
          subtitle="If an account exists, a reset link has been sent."
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}
        {requestError && <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="Request failed"
          subtitle={requestError}
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--spacing-5)' }}>
            <TextInput
              id="email"
              labelText="Email"
              placeholder="name@company.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading || submitted}
            />
          </div>

          <Button
            type="submit"
            kind="primary"
            disabled={isLoading || !email || submitted}
            style={{ width: '100%' }}
          >
            {isLoading ? 'Sending...' : submitted ? 'Email sent' : 'Send reset link'}
          </Button>
        </form>

        <div className="eg-public-auth-actions">
          <span style={{ color: 'var(--color-text-secondary)' }}>Remembered your password?</span>
          <Button kind="ghost" size="sm" onClick={() => navigate(loginPath)}>
            Back to login
          </Button>
        </div>
    </PublicAuthShell>
  );
}
