import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Button, InlineLoading, InlineNotification } from '@carbon/react';
import { apiClient } from '../shared/api/client';
import PublicAuthShell from '../shared/components/PublicAuthShell';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'expired'>('verifying');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(5);

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const loginPath = tenantSlug ? `${tenantPrefix}/login` : '/login';
  const resendPath = tenantSlug ? `${tenantPrefix}/resend-verification` : '/resend-verification';

  useEffect(() => {
    const token = searchParams.get('token');
    let redirectTimer: ReturnType<typeof setInterval> | undefined;

    if (!token) {
      setStatus('error');
      setError('No verification token provided');
      return;
    }

    // Verify the email
    apiClient.get<{ code?: string; error?: string }>(
      '/api/auth/verify-email',
      { token }
    )
      .then((data) => {
        if (!data || typeof data !== 'object') {
          setStatus('error');
          setError('Verification failed');
          return;
        }
        if (!data.code && !data.error) {
          setStatus('success');
          // Start countdown to redirect
          redirectTimer = setInterval(() => {
            setCountdown((prev) => {
              if (prev <= 1) {
                if (redirectTimer) clearInterval(redirectTimer);
                navigate(loginPath);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
          
        }
        if (data.code === 'TOKEN_EXPIRED') {
          setStatus('expired');
        } else {
          setStatus('error');
        }
        setError(data.error || 'Verification failed');
      })
      .catch((err) => {
        console.error('Verification error:', err);
        setStatus('error');
        setError('Failed to verify email. Please try again.');
      });
    return () => {
      if (redirectTimer) clearInterval(redirectTimer);
    };
  }, [searchParams, navigate, loginPath]);

  const title = status === 'verifying'
    ? 'Verifying your email'
    : status === 'success'
      ? 'Email verified'
      : status === 'expired'
        ? 'Verification link expired'
        : 'Verification failed';

  return (
    <PublicAuthShell title={title} homePath={tenantSlug ? `${tenantPrefix}/` : '/'}>
      {status === 'verifying' ? (
        <InlineLoading description="Verifying your email…" />
      ) : status === 'success' ? <>
        <InlineNotification kind="success" lowContrast hideCloseButton title="Email address verified" subtitle="You can now log in to your account." />
        <p style={{ color: 'var(--cds-text-secondary)' }}>Redirecting to login in {countdown} second{countdown !== 1 ? 's' : ''}…</p>
        <div className="eg-public-auth-actions"><Button onClick={() => navigate(loginPath)}>Go to login now</Button></div>
      </> : status === 'expired' ? <>
        <InlineNotification kind="warning" lowContrast hideCloseButton title="This link has expired" subtitle="Verification links are valid for 24 hours. Request a new link to continue." />
        <div className="eg-public-auth-actions">
          <Button onClick={() => navigate(resendPath)}>Request new link</Button>
          <Button kind="secondary" onClick={() => navigate(loginPath)}>Go to login</Button>
        </div>
      </> : <>
        <InlineNotification kind="error" lowContrast hideCloseButton title="Email was not verified" subtitle={error || 'The verification link may be invalid or may already have been used.'} />
        <div className="eg-public-auth-actions">
          <Button onClick={() => navigate(resendPath)}>Request new link</Button>
          <Button kind="secondary" onClick={() => navigate(loginPath)}>Go to login</Button>
        </div>
      </>}
    </PublicAuthShell>
  );
}
