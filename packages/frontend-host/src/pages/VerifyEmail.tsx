import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Button, SkeletonIcon, SkeletonText } from '@carbon/react';
import { apiClient } from '../shared/api/client';
import { CheckmarkFilled, WarningFilled } from '@carbon/icons-react';

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
          const timer = setInterval(() => {
            setCountdown((prev) => {
              if (prev <= 1) {
                clearInterval(timer);
                navigate(loginPath);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
          
          return () => clearInterval(timer);
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
  }, [searchParams, navigate, loginPath]);

  if (status === 'verifying') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 'var(--spacing-6)',
        textAlign: 'center',
      }}>
        <div style={{ marginBottom: 'var(--spacing-6)' }}>
          <SkeletonIcon />
        </div>
        <div style={{ width: 'min(520px, 100%)' }}>
          <SkeletonText heading width="60%" />
          <div style={{ marginTop: 'var(--spacing-3)' }}>
            <SkeletonText paragraph lineCount={2} />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 'var(--spacing-6)',
        textAlign: 'center',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: '50%',
          padding: 'var(--spacing-6)',
          marginBottom: 'var(--spacing-6)',
        }}>
          <CheckmarkFilled size={64} style={{ color: 'white' }} />
        </div>
        
        <h1 style={{ fontSize: 'var(--text-32)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-4)' }}>
          Email Verified Successfully!
        </h1>
        
        <p style={{ fontSize: 'var(--text-18)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)', maxWidth: '500px' }}>
          Your email address has been verified. You can now log in to your account.
        </p>
        
        <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--spacing-5)' }}>
          Redirecting to login in {countdown} second{countdown !== 1 ? 's' : ''}...
        </p>
        
        <Button onClick={() => navigate(loginPath)}>
          Go to Login Now
        </Button>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: 'var(--spacing-6)',
        textAlign: 'center',
      }}>
        <div style={{
          background: 'var(--color-warning)',
          borderRadius: '50%',
          padding: 'var(--spacing-6)',
          marginBottom: 'var(--spacing-6)',
        }}>
          <WarningFilled size={64} style={{ color: 'white' }} />
        </div>
        
        <h1 style={{ fontSize: 'var(--text-32)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-4)' }}>
          Verification Link Expired
        </h1>
        
        <p style={{ fontSize: 'var(--text-18)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)', maxWidth: '500px' }}>
          This verification link has expired. Verification links are valid for 24 hours.
        </p>
        
        <div style={{ display: 'flex', gap: 'var(--spacing-4)' }}>
          <Button kind="secondary" onClick={() => navigate(loginPath)}>
            Go to Login
          </Button>
          <Button onClick={() => navigate(resendPath)}>
            Request New Link
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: 'var(--spacing-6)',
      textAlign: 'center',
    }}>
      <div style={{
        background: 'var(--color-error)',
        borderRadius: '50%',
        padding: 'var(--spacing-6)',
        marginBottom: 'var(--spacing-6)',
      }}>
        <WarningFilled size={64} style={{ color: 'white' }} />
      </div>
      
      <h1 style={{ fontSize: 'var(--text-32)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-4)' }}>
        Verification Failed
      </h1>
      
      <p style={{ fontSize: 'var(--text-18)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)', maxWidth: '500px' }}>
        {error}
      </p>
      
      <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--spacing-6)' }}>
        The verification link may be invalid or has already been used.
      </p>
      
      <div style={{ display: 'flex', gap: 'var(--spacing-4)' }}>
        <Button kind="secondary" onClick={() => navigate(loginPath)}>
          Go to Login
        </Button>
        <Button onClick={() => navigate(resendPath)}>
          Request New Link
        </Button>
      </div>
    </div>
  );
}
