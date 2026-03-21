import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Button,
  InlineLoading,
  TextInput,
  PasswordInput,
  InlineNotification,
} from '@carbon/react';
import { Checkmark } from '@carbon/icons-react';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';
import { useAuth } from '../shared/hooks/useAuth';
import type { User } from '../shared/types/auth';
import logoPng from '../assets/logo.png';

interface PublicBranding {
  logoUrl: string | null;
  loginLogoUrl: string | null;
  loginTitleVerticalOffset: number;
  loginTitleColor: string | null;
  logoTitle: string | null;
  logoScale: number;
  titleFontUrl: string | null;
  titleFontWeight: string;
  titleFontSize: number;
  faviconUrl: string | null;
}

const BRANDING_CACHE_KEY = 'eg.platformBranding.v1';

function normalizeBranding(raw: any): PublicBranding {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    logoUrl: typeof r.logoUrl === 'string' ? r.logoUrl : null,
    loginLogoUrl: typeof r.loginLogoUrl === 'string' ? r.loginLogoUrl : null,
    loginTitleVerticalOffset: typeof r.loginTitleVerticalOffset === 'number' ? r.loginTitleVerticalOffset : 0,
    loginTitleColor: typeof r.loginTitleColor === 'string' ? r.loginTitleColor : null,
    logoTitle: typeof r.logoTitle === 'string' ? r.logoTitle : null,
    logoScale: typeof r.logoScale === 'number' ? r.logoScale : 100,
    titleFontUrl: typeof r.titleFontUrl === 'string' ? r.titleFontUrl : null,
    titleFontWeight: typeof r.titleFontWeight === 'string' ? r.titleFontWeight : '600',
    titleFontSize: typeof r.titleFontSize === 'number' ? r.titleFontSize : 14,
    faviconUrl: typeof r.faviconUrl === 'string' ? r.faviconUrl : null,
  };
}

function readCachedBranding(): PublicBranding | null {
  try {
    const raw = window.localStorage.getItem(BRANDING_CACHE_KEY);
    if (!raw) return null;
    return normalizeBranding(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseSafeLogoDataUrl(raw: unknown): { mime: string; bytes: ArrayBuffer } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('//') || !trimmed.startsWith('data:')) return null;
  const match = trimmed.match(/^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml))(?:;charset=[a-z0-9-]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, '');

  let decoded = '';
  try {
    decoded = atob(base64);
  } catch {
    return null;
  }

  if (decoded.length > 600 * 1024) return null;

  if (mime === 'image/svg+xml') {
    const snippet = decoded.slice(0, 8000).toLowerCase();
    if (
      snippet.includes('<script') ||
      snippet.includes('javascript:') ||
      snippet.includes('<foreignobject') ||
      snippet.includes('<iframe') ||
      snippet.includes('<object') ||
      snippet.includes('<embed') ||
      /\son\w+\s*=/.test(snippet)
    ) {
      return null;
    }
  }

  const buffer = new ArrayBuffer(decoded.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < decoded.length; i++) {
    view[i] = decoded.charCodeAt(i);
  }
  return { mime, bytes: buffer };
}

function makeLogoObjectUrl(raw: unknown): string | null {
  const parsed = parseSafeLogoDataUrl(raw);
  if (!parsed) return null;
  return URL.createObjectURL(new Blob([parsed.bytes], { type: parsed.mime }));
}

interface InviteInfo {
  email: string;
  tenantSlug: string;
  resourceType: 'platform_user' | 'tenant' | 'project' | 'engine';
  resourceName: string | null;
  resourceRole: string | null;
  resourceRoles: string[];
  deliveryMethod: 'email' | 'manual';
  expiresAt: number;
  status: 'pending' | 'expired' | 'onboarding';
}

interface CompleteOnboardingResponse {
  user: User;
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();
  const { setAuthenticatedUser } = useAuth();
  const onboardingStageKey = token ? `invite-onboarding-stage:${token}` : null;
  const initialBranding = readCachedBranding();

  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [completed, setCompleted] = useState(false);
  const [stage, setStage] = useState<'redeem' | 'verify' | 'set-password'>('verify');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [branding, setBranding] = useState<PublicBranding | null>(initialBranding);
  const [brandingFetchDone, setBrandingFetchDone] = useState(false);
  const [logoObjectUrl, setLogoObjectUrl] = useState<string | null>(() => {
    const raw = initialBranding?.loginLogoUrl || initialBranding?.logoUrl;
    return makeLogoObjectUrl(raw);
  });

  useEffect(() => {
    if (token) {
      loadInviteInfo();
    }
  }, [token]);

  useEffect(() => {
    if (!onboardingStageKey) {
      return;
    }

    const savedStage = window.sessionStorage.getItem(onboardingStageKey);
    if (savedStage === 'set-password') {
      setStage('set-password');
    }
  }, [onboardingStageKey]);

  useEffect(() => {
    const raw = branding?.loginLogoUrl || branding?.logoUrl;
    const next = makeLogoObjectUrl(raw);
    setLogoObjectUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return next;
    });

    return () => {
      if (next) {
        URL.revokeObjectURL(next);
      }
    };
  }, [branding?.loginLogoUrl, branding?.logoUrl]);

  useEffect(() => {
    let cancelled = false;

    apiClient.get<unknown>('/api/auth/branding', undefined, { credentials: 'include' })
      .then((data) => {
        if (cancelled || !data || typeof data !== 'object') return;
        const normalized = normalizeBranding(data as any);
        try {
          window.localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(normalized));
        } catch {
        }
        setBranding(normalized);
      })
      .catch(() => {
      })
      .finally(() => {
        if (!cancelled) {
          setBrandingFetchDone(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const faviconUrl = branding?.faviconUrl;
    const links = Array.from(document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) as HTMLLinkElement[];
    if (links.length === 0) return;

    for (const link of links) {
      if (!link.dataset.defaultHref) {
        link.dataset.defaultHref = link.href;
      }
    }

    if (faviconUrl) {
      for (const link of links) {
        link.href = faviconUrl;
      }
    } else {
      for (const link of links) {
        if (link.dataset.defaultHref) link.href = link.dataset.defaultHref;
      }
    }
  }, [branding?.faviconUrl]);

  const loadInviteInfo = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<InviteInfo>(`/api/invitations/${token}`);
      setInviteInfo(data);
      if (data.status === 'onboarding') {
        setStage('set-password');
      } else if (data.deliveryMethod === 'email') {
        setStage('redeem');
      } else {
        setStage('verify');
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to load invitation');
      notify({ kind: 'error', title: 'Failed to load invitation', subtitle: parsed.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemEmailInvite = async () => {
    if (!token) return;

    try {
      setRedeeming(true);
      await apiClient.post(`/api/invitations/${token}/redeem`, {});
      setStage('set-password');
      if (onboardingStageKey) {
        window.sessionStorage.setItem(onboardingStageKey, 'set-password');
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to redeem invitation');
      notify({ kind: 'error', title: 'Failed to redeem invitation', subtitle: parsed.message });
    } finally {
      setRedeeming(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!token) return;

    try {
      setVerifying(true);

      await apiClient.post(`/api/invitations/${token}/verify-otp`, { oneTimePassword });
      setStage('set-password');
      if (onboardingStageKey) {
        window.sessionStorage.setItem(onboardingStageKey, 'set-password');
      }
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to verify one-time password');
      notify({ kind: 'error', title: 'Failed to verify one-time password', subtitle: parsed.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleComplete = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      notify({ kind: 'error', title: 'Name is required', subtitle: 'Enter your first name and last name to finish account setup.' });
      return;
    }

    if (password !== confirmPassword) {
      notify({ kind: 'error', title: 'Passwords do not match' });
      return;
    }

    try {
      setCompleting(true);
      const response = await apiClient.post<CompleteOnboardingResponse>('/api/auth/complete-onboarding', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        newPassword: password,
      });
      setAuthenticatedUser(response.user);
      setCompleted(true);
      if (onboardingStageKey) {
        window.sessionStorage.removeItem(onboardingStageKey);
      }
      setTimeout(() => {
        navigate(`/t/${encodeURIComponent(inviteInfo?.tenantSlug || 'default')}/`, { replace: true });
      }, 1200);
    } catch (err) {
      const parsed = parseApiError(err, 'Failed to complete onboarding');
      notify({ kind: 'error', title: 'Failed to complete onboarding', subtitle: parsed.message });
    } finally {
      setCompleting(false);
    }
  };

  const resourceLabel = inviteInfo?.resourceType === 'tenant'
    ? 'workspace'
    : inviteInfo?.resourceType === 'platform_user'
      ? 'platform'
      : inviteInfo?.resourceType;
  const hideDefaultBranding = !branding && !brandingFetchDone;
  const safeBrandLogoSrc = logoObjectUrl;
  const loginLogoHeightPx = Math.round(28 * ((branding?.logoScale ?? 100) / 100));
  const brandTitle = typeof branding?.logoTitle === 'string' && branding.logoTitle.trim() ? branding.logoTitle.trim() : 'EnterpriseGlue';
  const customBrandFontFamily = branding?.titleFontUrl ? 'PublicBrandingFont' : undefined;
  const brandTitleWeight = typeof branding?.titleFontWeight === 'string' && branding.titleFontWeight.trim()
    ? branding.titleFontWeight.trim()
    : 'var(--font-weight-semibold)';
  const loginTitleFontSizePx = Math.round(Math.max(branding?.titleFontSize ?? 14, 10) * 2);
  const loginTitleOffsetPx = typeof branding?.loginTitleVerticalOffset === 'number'
    ? Math.max(-50, Math.min(50, branding.loginTitleVerticalOffset))
    : 0;
  const loginTitleColor = typeof branding?.loginTitleColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(branding.loginTitleColor.trim())
    ? branding.loginTitleColor.trim()
    : undefined;
  const inviteStatusNotice = inviteInfo?.status === 'expired'
    ? {
        kind: 'warning' as const,
        title: 'Invitation expired',
        subtitle: `This invite expired on ${new Date(inviteInfo.expiresAt).toLocaleString('en-GB')}. Ask a project owner or delegate to send a new invitation.`,
      }
    : inviteInfo?.status === 'onboarding'
      ? {
          kind: 'info' as const,
          title: 'Continue account setup',
          subtitle: inviteInfo.deliveryMethod === 'email'
            ? 'Your email invite was already redeemed. Finish your profile and password setup below.'
            : 'Your one-time password was already verified. Finish your profile and password setup below.',
        }
      : inviteInfo?.deliveryMethod === 'email' && stage === 'redeem'
        ? {
            kind: 'info' as const,
            title: 'Email invitation ready',
            subtitle: 'Click continue to redeem this one-time invite link and start account setup.',
          }
      : null;

  useEffect(() => {
    const styleId = 'public-branding-font-accept-invite';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!branding?.titleFontUrl) {
      if (styleEl) styleEl.remove();
      return;
    }

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
      @font-face {
        font-family: 'PublicBrandingFont';
        src: url('${branding.titleFontUrl}') format('woff2'), url('${branding.titleFontUrl}') format('woff'), url('${branding.titleFontUrl}') format('truetype');
        font-weight: normal;
        font-style: normal;
        font-display: swap;
      }
    `;

    return () => {
      const next = document.getElementById(styleId);
      if (next) next.remove();
    };
  }, [branding?.titleFontUrl]);

  useEffect(() => {
    document.title = brandTitle;
  }, [brandTitle]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <InlineLoading description="Loading invitation..." />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-bg-secondary)',
        padding: 'var(--spacing-6)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--spacing-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--spacing-2)', width: '100%' }}>
          <img
            src={safeBrandLogoSrc || logoPng}
            alt="Logo"
            style={{ height: `${loginLogoHeightPx}px`, width: 'auto', visibility: hideDefaultBranding ? 'hidden' : 'visible' }}
          />
          <span
            style={{
              fontSize: `${loginTitleFontSizePx}px`,
              fontWeight: brandTitleWeight,
              fontFamily: customBrandFontFamily || 'var(--font-primary)',
              color: loginTitleColor || 'var(--color-text-primary)',
              display: 'inline-block',
              transform: loginTitleOffsetPx ? `translateY(${loginTitleOffsetPx}px)` : undefined,
              visibility: hideDefaultBranding ? 'hidden' : 'visible',
            }}
          >
            {brandTitle}
          </span>
        </div>

        <div style={{ background: 'var(--color-bg-primary)', padding: 'var(--spacing-6)', borderRadius: 'var(--border-radius-md)', boxShadow: 'var(--shadow-md)', width: '100%' }}>
          {completed ? (
            <div style={{ textAlign: 'center' }}>
              <Checkmark size={48} style={{ color: 'var(--cds-support-success)', marginBottom: 'var(--spacing-4)' }} />
              <h1 style={{ fontSize: '1.375rem', lineHeight: 1.25, fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--spacing-2)' }}>
                Account ready
              </h1>
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
                {`Redirecting you into ${brandTitle}...`}
              </p>
              <InlineLoading description="Redirecting..." />
            </div>
          ) : inviteInfo ? (
            <div style={{ display: 'grid', gap: 'var(--spacing-5)', width: '100%' }}>
              <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                <h1 style={{ fontSize: '1.375rem', lineHeight: 1.25, fontWeight: 'var(--font-weight-semibold)', margin: 0 }}>
                  Set up your account
                </h1>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)', lineHeight: 1.5, margin: 0 }}>
                  You have been invited to join <strong>{inviteInfo.resourceName || inviteInfo.tenantSlug}</strong> {resourceLabel ? `(${resourceLabel})` : ''} on {brandTitle}.
                </p>
              </div>

              {inviteStatusNotice ? (
                <InlineNotification
                  lowContrast
                  kind={inviteStatusNotice.kind}
                  title={inviteStatusNotice.title}
                  subtitle={inviteStatusNotice.subtitle}
                  hideCloseButton
                />
              ) : null}

              <div style={{ backgroundColor: 'var(--color-bg-tertiary)', padding: 'var(--spacing-3)', borderRadius: 4, display: 'grid', gap: '0.375rem', textAlign: 'left', justifyItems: 'start' }}>
                <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>Invitation for</div>
                <div style={{ fontWeight: 600 }}>{inviteInfo.email}</div>
              </div>

              {inviteInfo.status === 'expired' ? null : stage === 'redeem' ? (
                <div style={{ display: 'grid', gap: 'var(--spacing-4)', width: '100%' }}>
                  <Button
                    renderIcon={Checkmark}
                    onClick={handleRedeemEmailInvite}
                    disabled={redeeming}
                    style={{ width: '100%', backgroundColor: 'var(--eg-color-dark-gray)', borderColor: 'var(--eg-color-dark-gray)', fontWeight: 'var(--font-weight-semibold)' }}
                  >
                    {redeeming ? 'Continuing...' : 'Continue to account setup'}
                  </Button>
                </div>
              ) : stage === 'verify' ? (
                <div style={{ display: 'grid', gap: 'var(--spacing-4)', width: '100%' }}>
                  <TextInput
                    id="invite-one-time-password"
                    labelText="One-Time Password"
                    placeholder="Enter the one-time password"
                    value={oneTimePassword}
                    onChange={(e) => setOneTimePassword(e.target.value)}
                    disabled={verifying}
                  />
                  <Button
                    renderIcon={Checkmark}
                    onClick={handleVerifyOtp}
                    disabled={verifying || !oneTimePassword.trim()}
                    style={{ width: '100%', backgroundColor: 'var(--eg-color-dark-gray)', borderColor: 'var(--eg-color-dark-gray)', fontWeight: 'var(--font-weight-semibold)' }}
                  >
                    {verifying ? 'Verifying...' : 'Verify One-Time Password'}
                  </Button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 'var(--spacing-4)', width: '100%' }}>
                  <TextInput
                    id="invite-first-name"
                    labelText="First Name"
                    placeholder="Enter your first name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={completing}
                    required
                  />
                  <TextInput
                    id="invite-last-name"
                    labelText="Last Name"
                    placeholder="Enter your last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={completing}
                    required
                  />
                  <PasswordInput
                    id="invite-password"
                    labelText="New Password"
                    placeholder="Choose a strong password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={completing}
                  />
                  <PasswordInput
                    id="invite-confirm-password"
                    labelText="Confirm Password"
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={completing}
                  />
                  <Button
                    renderIcon={Checkmark}
                    onClick={handleComplete}
                    disabled={completing || !firstName.trim() || !lastName.trim() || !password || !confirmPassword}
                    style={{ width: '100%', backgroundColor: 'var(--eg-color-dark-gray)', borderColor: 'var(--eg-color-dark-gray)', fontWeight: 'var(--font-weight-semibold)' }}
                  >
                    {completing ? 'Finishing setup...' : 'Finish Account Setup'}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <InlineNotification
              lowContrast
              kind="warning"
              title="Invitation unavailable"
              subtitle="This invitation is invalid or is no longer available. Ask your administrator to send a new one."
              hideCloseButton
            />
          )}

          <p style={{ textAlign: 'center', marginTop: 'var(--spacing-4)', color: 'var(--color-text-secondary)' }}>
            <Link to="/" style={{ color: 'var(--cds-link-01)' }}>
              Go to home page
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
