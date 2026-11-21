import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Button, Column, Grid, InlineLoading, InlineNotification } from '@carbon/react';
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
    let active = true;
    setStatus('verifying');
    setError('');
    setCountdown(5);

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
        if (!active) return;
        if (!data || typeof data !== 'object') {
          setStatus('error');
          setError('Verification failed');
          return;
        }
        if (!data.code && !data.error) {
          setStatus('success');
          return;
        }
        if (data.code === 'TOKEN_EXPIRED') {
          setStatus('expired');
        } else {
          setStatus('error');
        }
        setError(data.error || 'Verification failed');
      })
      .catch((err) => {
        if (!active) return;
        console.error('Verification error:', err);
        setStatus('error');
        setError('Failed to verify email. Please try again.');
      });
    return () => {
      active = false;
    };
  }, [searchParams]);

  useEffect(() => {
    if (status !== 'success') return;
    const timer = setInterval(() => setCountdown((remaining) => Math.max(0, remaining - 1)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status === 'success' && countdown === 0) navigate(loginPath);
  }, [countdown, loginPath, navigate, status]);

  const title = status === 'verifying'
    ? 'Verifying your email'
    : status === 'success'
      ? 'Email verified'
      : status === 'expired'
        ? 'Verification link expired'
        : 'Verification failed';

  return (
    <PublicAuthShell title={title} homePath={tenantSlug ? `${tenantPrefix}/` : '/'}>
      <Grid fullWidth className="eg-verification-grid">
      {status === 'verifying' ? (
        <Column sm={4} md={8} lg={16}>
          <InlineLoading description="Verifying your email…" />
        </Column>
      ) : status === 'success' ? <>
        <Column sm={4} md={8} lg={16}>
          <InlineNotification kind="success" lowContrast hideCloseButton title="Email address verified" subtitle="You can now log in to your account." />
        </Column>
        <Column sm={4} md={8} lg={16}>
          <p className="eg-verification-countdown">Redirecting to login in {countdown} second{countdown !== 1 ? 's' : ''}…</p>
        </Column>
        <Column sm={4} md={8} lg={16}>
          <div className="eg-public-auth-actions"><Button onClick={() => navigate(loginPath)}>Go to login now</Button></div>
        </Column>
      </> : status === 'expired' ? <>
        <Column sm={4} md={8} lg={16}>
          <InlineNotification kind="warning" lowContrast hideCloseButton title="This link has expired" subtitle="Verification links are valid for 24 hours. Request a new link to continue." />
        </Column>
        <Column sm={4} md={8} lg={16}>
          <div className="eg-public-auth-actions">
            <Button onClick={() => navigate(resendPath)}>Request new link</Button>
            <Button kind="secondary" onClick={() => navigate(loginPath)}>Go to login</Button>
          </div>
        </Column>
      </> : <>
        <Column sm={4} md={8} lg={16}>
          <InlineNotification kind="error" lowContrast hideCloseButton title="Email was not verified" subtitle={error || 'The verification link may be invalid or may already have been used.'} />
        </Column>
        <Column sm={4} md={8} lg={16}>
          <div className="eg-public-auth-actions">
            <Button onClick={() => navigate(resendPath)}>Request new link</Button>
            <Button kind="secondary" onClick={() => navigate(loginPath)}>Go to login</Button>
          </div>
        </Column>
      </>}
      </Grid>
    </PublicAuthShell>
  );
}
