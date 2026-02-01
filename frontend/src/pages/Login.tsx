import { useState, FormEvent, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { TextInput, Button, TextArea, Loading } from '@carbon/react';
import { Login as LoginIcon } from '@carbon/icons-react';
import FormModal from '../components/FormModal';
import { useModal } from '../shared/hooks/useModal';
import { useAuth } from '../shared/hooks/useAuth';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import { useToast } from '../shared/notifications/ToastProvider';
import logoPng from '../assets/logo.png';
import { toSafeInternalPath } from '../utils/safeNavigation';
import { isMultiTenantEnabled } from '../enterprise/extensionRegistry';

// SSO Provider type from backend
interface SsoProviderButton {
  id: string;
  name: string;
  type: 'microsoft' | 'google' | 'saml' | 'oidc';
  buttonLabel?: string;
  buttonColor?: string;
  iconUrl?: string;
}

interface PublicBranding {
  logoUrl: string | null;
  loginLogoUrl: string | null;
  loginTitleVerticalOffset: number;
  loginTitleColor: string | null;
  logoTitle: string | null;
  logoScale: number;
  titleFontWeight: string;
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
    titleFontWeight: typeof r.titleFontWeight === 'string' ? r.titleFontWeight : '600',
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

function writeCachedBranding(branding: PublicBranding): void {
  try {
    window.localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(branding));
  } catch {
  }
}

function parseSafeLogoDataUrl(raw: unknown): { mime: string; bytes: ArrayBuffer } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('//')) return null;
  if (!trimmed.startsWith('data:')) return null;

  const match = trimmed.match(/^data:(image\/(?:png|jpe?g|webp|gif|svg\+xml))(?:;charset=[a-z0-9-]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, '');

  let decoded: string;
  try {
    decoded = atob(base64);
  } catch {
    return null;
  }

  const maxBytes = 600 * 1024;
  if (decoded.length > maxBytes) return null;

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
  const blob = new Blob([parsed.bytes], { type: parsed.mime });
  return URL.createObjectURL(blob);
}

/**
 * Login page
 * Handles user authentication
 */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const { notify } = useToast();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const tenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const forgotPasswordPath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/forgot-password` : '/forgot-password';

  const initialBranding = readCachedBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<SsoProviderButton[]>([]);
  const [ssoLoading, setSsoLoading] = useState(true);
  const [branding, setBranding] = useState<PublicBranding | null>(initialBranding);
  const [brandingFetchDone, setBrandingFetchDone] = useState(false);
  const [logoObjectUrl, setLogoObjectUrl] = useState<string | null>(() => {
    const raw = initialBranding?.loginLogoUrl || initialBranding?.logoUrl;
    return makeLogoObjectUrl(raw);
  });
  const logoObjectUrlRef = useRef<string | null>(logoObjectUrl);
  
  // Fetch enabled SSO providers
  useEffect(() => {
    setSsoLoading(true);
    apiClient.get<SsoProviderButton[]>('/api/sso/providers/enabled')
      .then(data => setSsoProviders(Array.isArray(data) ? data : []))
      .catch(() => setSsoProviders([]))
      .finally(() => setSsoLoading(false));
  }, []);

  useEffect(() => {
    const raw = branding?.loginLogoUrl || branding?.logoUrl;
    const nextUrl = makeLogoObjectUrl(raw);

    if (logoObjectUrlRef.current) {
      URL.revokeObjectURL(logoObjectUrlRef.current);
      logoObjectUrlRef.current = null;
    }

    logoObjectUrlRef.current = nextUrl;
    setLogoObjectUrl(nextUrl);

    return () => {
      if (logoObjectUrlRef.current) {
        URL.revokeObjectURL(logoObjectUrlRef.current);
        logoObjectUrlRef.current = null;
      }
    };
  }, [branding?.loginLogoUrl, branding?.logoUrl]);

  // Apply favicon override from branding
  useEffect(() => {
    const faviconUrl = branding?.faviconUrl;
    const links = Array.from(document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')) as HTMLLinkElement[];
    if (links.length === 0) return;

    // Store default href on first run
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

  // Fetch platform branding for the login page (public endpoint)
  useEffect(() => {
    let cancelled = false;

    apiClient.get<unknown>('/api/auth/branding', undefined, { credentials: 'include' })
      .then((data: unknown) => {
        if (cancelled) return;
        if (!data || typeof data !== 'object') return;
        const normalized = normalizeBranding(data as any);
        writeCachedBranding(normalized);
        setBranding(normalized);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (cancelled) return;
        setBrandingFetchDone(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Handle OAuth error messages (success now redirects directly to root)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    const errorMessage = params.get('message');

    if (error) {
      notify({
        kind: 'error',
        title: 'Login failed',
        subtitle: decodeURIComponent(errorMessage || error),
      });
      // Clean up URL
      navigate(toSafeInternalPath(location.pathname, '/login'), { replace: true });
    }
  }, [location, navigate, notify]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await login({ email, password });

      if (response?.emailVerificationRequired || response?.user?.isEmailVerified === false) {
        const resendPath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/resend-verification` : '/resend-verification';
        navigate(resendPath, { replace: true });
        return;
      }

      // Redirect to the page they tried to visit or home
      const fallback = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : '/';
      const fromRaw = (location.state as any)?.from?.pathname;
      navigate(toSafeInternalPath(fromRaw, fallback), { replace: true });
    } catch (err) {
      const parsed = parseApiError(err, 'Login failed');
      notify({ kind: 'error', title: 'Login failed', subtitle: parsed.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSsoLogin = (provider: SsoProviderButton) => {
    // Redirect to backend OAuth endpoint for the provider
    const tenantQuery = tenantSlug ? `?tenantSlug=${encodeURIComponent(tenantSlug)}` : '';
    window.location.href = `/api/auth/${provider.type}${tenantQuery}`;
  };

  // Get provider icon SVG
  const getProviderIcon = (type: string) => {
    switch (type) {
      case 'microsoft':
        return (
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
        );
      case 'google':
        return (
          <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        );
      case 'saml':
      case 'oidc':
      default:
        return <LoginIcon size={20} />;
    }
  };

  const hideDefaultBranding = !branding && !brandingFetchDone;
  const safeBrandLogoSrc = logoObjectUrl;
  const loginLogoHeightPx = Math.round(28 * ((branding?.logoScale ?? 100) / 100));
  const brandTitle = typeof branding?.logoTitle === 'string' && branding.logoTitle.trim() ? branding.logoTitle.trim() : 'EnterpriseGlue';
  const brandTitleWeight = typeof branding?.titleFontWeight === 'string' && branding.titleFontWeight.trim()
    ? branding.titleFontWeight.trim()
    : 'var(--font-weight-semibold)';

  const loginTitleOffsetPx = (() => {
    const raw = branding?.loginTitleVerticalOffset;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
    return Math.max(-50, Math.min(50, raw));
  })();

  const loginTitleColor = (() => {
    const raw = branding?.loginTitleColor;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return undefined;
    return trimmed;
  })();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--color-bg-secondary)',
      padding: 'var(--spacing-6)'
    }}>
      <div style={{
        background: 'var(--color-bg-primary)',
        padding: 'var(--spacing-8)',
        borderRadius: 'var(--border-radius-md)',
        boxShadow: 'var(--shadow-md)',
        width: '100%',
        maxWidth: '400px'
      }}>
        {/* Logo + Name (matching header style, scaled up) */}
        <div style={{ 
          marginBottom: 'var(--spacing-6)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: 'var(--spacing-3)',
          width: '100%'
        }}>
          <img 
            src={safeBrandLogoSrc || logoPng} 
            alt="Logo" 
            style={{ height: `${loginLogoHeightPx}px`, width: 'auto', visibility: hideDefaultBranding ? 'hidden' : 'visible' }}
          />
          <span style={{ 
            fontSize: '1.75rem',
            fontWeight: brandTitleWeight,
            fontFamily: 'var(--font-primary)',
            color: loginTitleColor || 'var(--color-text-primary)',
            display: 'inline-block',
            transform: loginTitleOffsetPx ? `translateY(${loginTitleOffsetPx}px)` : undefined,
            visibility: hideDefaultBranding ? 'hidden' : 'visible',
          }}>
            {brandTitle}
          </span>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--spacing-5)' }}>
            <TextInput
              id="email"
              labelText="Email"
              placeholder="Enter your email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <div style={{ marginBottom: 'var(--spacing-6)' }}>
            <TextInput
              id="password"
              labelText="Password"
              placeholder="Enter your password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
            <div style={{ textAlign: 'right', marginTop: 'var(--spacing-3)' }}>
              <Link to={forgotPasswordPath} style={{ color: 'var(--cds-link-01)', fontSize: 'var(--text-14)' }}>
                Forgot your password?
              </Link>
            </div>
          </div>

          <Button
            type="submit"
            kind="primary"
            disabled={isLoading || !email || !password}
            style={{ 
              width: '100%',
              backgroundColor: 'var(--eg-color-dark-gray)',
              borderColor: 'var(--eg-color-dark-gray)',
              fontWeight: 'var(--font-weight-semibold)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              paddingInline: '1rem'
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>

        {/* SSO Providers */}
        {ssoLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-4)' }}>
            <Loading small withOverlay={false} description="Loading SSO options..." />
          </div>
        ) : ssoProviders.length > 0 && (
          <>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              margin: 'var(--spacing-6) 0',
              textAlign: 'center'
            }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border-primary)' }} />
              <span style={{ padding: '0 var(--spacing-4)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
                OR
              </span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border-primary)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
              {ssoProviders.map(provider => (
                <Button
                  key={provider.id}
                  kind="tertiary"
                  size="lg"
                  onClick={() => handleSsoLogin(provider)}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 'var(--spacing-3)',
                  }}
                >
                  {getProviderIcon(provider.type)}
                  <span>{provider.buttonLabel || `Sign in with ${provider.name}`}</span>
                </Button>
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 'var(--spacing-6)',
          paddingTop: 'var(--spacing-5)',
          borderTop: '1px solid var(--color-border-primary)',
          textAlign: 'center'
        }}>
          {isMultiTenantEnabled() && (
            <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
              Don't have an account?{' '}
              <Link to="/signup" style={{ color: 'var(--cds-link-01)' }}>
                Sign up
              </Link>
            </p>
          )}
        </div>
      </div>

    </div>
  );
}
