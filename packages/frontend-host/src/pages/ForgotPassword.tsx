import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, TextInput } from '@carbon/react';
import { authService } from '../services/auth';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';

export default function ForgotPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const { notify } = useToast();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const loginPath = tenantSlug ? `${tenantPrefix}/login` : '/login';

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await authService.forgotPassword({ email });
      setSubmitted(true);
      notify({
        kind: 'success',
        title: 'Reset email sent',
        subtitle: 'If an account exists, a reset link has been sent.',
      });
    } catch (err) {
      const parsed = parseApiError(err, 'Unable to request password reset');
      notify({ kind: 'error', title: 'Request failed', subtitle: parsed.message });
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
            Forgot your password?
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
            Enter your email to receive a password reset link.
          </p>
        </div>

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

        <div style={{
          marginTop: 'var(--spacing-6)',
          paddingTop: 'var(--spacing-4)',
          borderTop: '1px solid var(--color-border-primary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--spacing-3)',
          fontSize: 'var(--text-14)',
        }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Remembered your password?</span>
          <Button kind="ghost" size="sm" onClick={() => navigate(loginPath)}>
            Back to login
          </Button>
        </div>
      </div>
    </div>
  );
}
