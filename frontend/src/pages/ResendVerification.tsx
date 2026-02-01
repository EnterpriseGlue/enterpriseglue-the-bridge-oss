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
  const tenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const loginPath = tenantSlug ? `${tenantPrefix}/login` : '/login';

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'verified'>('idle');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
            Resend verification email
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
            Enter the email address associated with your account. We will send a new verification link.
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
              disabled={isLoading}
            />
          </div>

          <Button
            type="submit"
            kind="primary"
            disabled={isLoading || !email}
            style={{ width: '100%' }}
          >
            {isLoading ? 'Sending...' : 'Send verification email'}
          </Button>
        </form>

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
