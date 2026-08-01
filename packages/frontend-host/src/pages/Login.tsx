import { useState, FormEvent, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ActionableNotification, TextInput, PasswordInput, Button, ClickableTile, InlineLoading, Loading, InlineNotification } from '@carbon/react';
import { Login as LoginIcon } from '@carbon/icons-react';
import { useAuth } from '../shared/hooks/useAuth';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import logoPng from '../assets/logo.png';
import { toSafeInternalPath } from '../utils/safeNavigation';
import { redirectTo } from '../utils/redirect';
import { isMultiTenantEnabled } from '../enterprise/extensionRegistry';
import type { PublicPlatformBranding } from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';
import type {
  PublicLoginMethodsResponse,
  PublicLoginProvider,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import type { LoginResponse } from '../shared/types/auth';
import {
  MAX_LOGIN_LABEL_LENGTH,
  providerLoginLabel,
} from '../features/platform-admin/identityAccessCopy';

const DEFAULT_TENANT_SLUG = 'default';

const BRANDING_CACHE_KEY = 'eg.platformBranding.v1';
const SSO_AUTO_REDIRECT_BLOCK_UNTIL_KEY = 'eg.sso.autoRedirect.blockUntil';
const SSO_REDIRECT_TRANSITION_MS = 600;

interface LoginLocationState {
  from?: { pathname?: unknown };
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function providerLoginPath(provider: PublicLoginProvider, slug: string | null): string {
  return slug
    ? `/api/t/${encodeURIComponent(slug)}/auth/providers/${encodeURIComponent(provider.id)}/start`
    : `/api/auth/providers/${encodeURIComponent(provider.id)}/start`;
}

function loginMethodsPath(slug: string | null): string {
  return slug
    ? `/api/t/${encodeURIComponent(slug)}/auth/login-methods`
    : '/api/auth/login-methods';
}

function providerPasswordLoginPath(provider: PublicLoginProvider, slug: string | null): string {
  return slug
    ? `/api/t/${encodeURIComponent(slug)}/auth/providers/${encodeURIComponent(provider.id)}/login`
    : `/api/auth/providers/${encodeURIComponent(provider.id)}/login`;
}

function normalizeBranding(raw: unknown): PublicPlatformBranding {
  const r: Record<string, unknown> = raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : {};
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
    titleVerticalOffset: typeof r.titleVerticalOffset === 'number' ? r.titleVerticalOffset : 0,
    menuAccentColor: typeof r.menuAccentColor === 'string' ? r.menuAccentColor : null,
    faviconUrl: typeof r.faviconUrl === 'string' ? r.faviconUrl : null,
  };
}

function readCachedBranding(): PublicPlatformBranding | null {
  try {
    const raw = window.localStorage.getItem(BRANDING_CACHE_KEY);
    if (!raw) return null;
    return normalizeBranding(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedBranding(branding: PublicPlatformBranding): void {
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
  const { login, setAuthenticatedUser, refreshPermissions, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const tenantSlugMatch = location.pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const rawTenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantSlug = rawTenantSlug && /^[a-zA-Z0-9_-]+$/.test(rawTenantSlug) ? rawTenantSlug : null;
  const isAdministratorRecovery = /(?:^|\/)admin-recovery\/?$/.test(location.pathname);
  const forgotPasswordPath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/forgot-password` : '/forgot-password';

  const initialBranding = readCachedBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginMethods, setLoginMethods] = useState<PublicLoginMethodsResponse | null>(null);
  const [directLdapProvider, setDirectLdapProvider] = useState<PublicLoginProvider | null>(null);
  const [loginStep, setLoginStep] = useState<'discover' | 'methods' | 'local'>('methods');
  const [discoveredProviderIds, setDiscoveredProviderIds] = useState<string[] | null>(null);
  const [ssoLoading, setSsoLoading] = useState(true);
  const [loginMethodsUnavailable, setLoginMethodsUnavailable] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [redirectingProvider, setRedirectingProvider] = useState<PublicLoginProvider | null>(null);
  const [branding, setBranding] = useState<PublicPlatformBranding | null>(initialBranding);
  const [brandingFetchDone, setBrandingFetchDone] = useState(false);
  const [logoObjectUrl, setLogoObjectUrl] = useState<string | null>(() => {
    const raw = initialBranding?.loginLogoUrl || initialBranding?.logoUrl;
    return makeLogoObjectUrl(raw);
  });
  const logoObjectUrlRef = useRef<string | null>(logoObjectUrl);
  const hasTriggeredAutoSsoRedirect = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const transitionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const chooserHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const hasAppliedFirstFocusableState = useRef(false);
  
  // The public contract contains only policy-resolved, sanitized login methods.
  const loadLoginMethods = useCallback(() => {
    if (isAdministratorRecovery) {
      setSsoLoading(false);
      setLoginMethodsUnavailable(false);
      setLoginMethods(null);
      setLoginStep('local');
      return;
    }
    setSsoLoading(true);
    setLoginMethodsUnavailable(false);
    apiClient.get<PublicLoginMethodsResponse>(loginMethodsPath(tenantSlug))
      .then((methods) => {
        setLoginMethods(methods);
        setLoginStep(methods.providerSelection === 'progressive' && methods.providers.length > 0 ? 'discover' : 'methods');
      })
      .catch(() => {
        setLoginMethods(null);
        setLoginMethodsUnavailable(true);
      })
      .finally(() => setSsoLoading(false));
  }, [isAdministratorRecovery, tenantSlug]);

  useEffect(() => {
    loadLoginMethods();
  }, [loadLoginMethods]);

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

  useEffect(() => {
    const styleId = 'public-branding-font';
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
  }, [branding?.titleFontUrl]);

  // Fetch platform branding for the login page (public endpoint)
  useEffect(() => {
    let cancelled = false;

    apiClient.get<unknown>('/api/auth/branding', undefined, { credentials: 'include' })
      .then((data: unknown) => {
        if (cancelled) return;
        if (!data || typeof data !== 'object') return;
        const normalized = normalizeBranding(data);
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

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;

    const params = new URLSearchParams(location.search);
    if (params.get('error')) return;

    const fallback = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : `/t/${DEFAULT_TENANT_SLUG}/`;
    const fromRaw = (location.state as LoginLocationState | null)?.from?.pathname;
    navigate(toSafeInternalPath(fromRaw, fallback), { replace: true });
  }, [isAuthLoading, isAuthenticated, location.search, location.state, navigate, tenantSlug]);

  // Handle OAuth error messages (success now redirects directly to root)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    const errorMessage = params.get('message');

    if (error) {
      try {
        window.sessionStorage.setItem(SSO_AUTO_REDIRECT_BLOCK_UNTIL_KEY, String(Date.now() + 60_000));
      } catch {
        // ignore
      }

      setLoginError(errorMessage || error);
      // Clean up URL
      navigate(toSafeInternalPath(location.pathname, '/login'), { replace: true });
    }
  }, [location, navigate]);

  const beginProviderRedirect = useCallback((provider: PublicLoginProvider) => {
    if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current);
    setLoginError(null);
    setRedirectingProvider(provider);
    redirectTimerRef.current = window.setTimeout(() => {
      redirectTimerRef.current = null;
      redirectTo(providerLoginPath(provider, tenantSlug));
    }, SSO_REDIRECT_TRANSITION_MS);
  }, [tenantSlug]);

  const cancelProviderRedirect = useCallback(() => {
    if (redirectTimerRef.current !== null) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
    try {
      window.sessionStorage.setItem(SSO_AUTO_REDIRECT_BLOCK_UNTIL_KEY, String(Date.now() + 60_000));
    } catch {
      // ignore
    }
    setRedirectingProvider(null);
    setDiscoveredProviderIds(null);
    setLoginStep('methods');
  }, []);

  useEffect(() => () => {
    if (redirectTimerRef.current !== null) window.clearTimeout(redirectTimerRef.current);
  }, []);

  useEffect(() => {
    if (hasTriggeredAutoSsoRedirect.current) return;
    if (ssoLoading || !loginMethods?.autoRedirectProviderId) return;
    const provider = loginMethods.providers.find((item) => item.id === loginMethods.autoRedirectProviderId);
    if (!provider || provider.loginMethod !== 'redirect') return;

    const params = new URLSearchParams(location.search);
    if (params.get('no_sso_redirect') === '1') return;

    try {
      const raw = window.sessionStorage.getItem(SSO_AUTO_REDIRECT_BLOCK_UNTIL_KEY);
      if (raw) {
        const blockUntil = Number(raw);
        if (Number.isFinite(blockUntil) && Date.now() < blockUntil) {
          return;
        }
        window.sessionStorage.removeItem(SSO_AUTO_REDIRECT_BLOCK_UNTIL_KEY);
      }
    } catch {
      // ignore
    }

    hasTriggeredAutoSsoRedirect.current = true;
    beginProviderRedirect(provider);
  }, [
    beginProviderRedirect,
    ssoLoading,
    loginMethods,
    location.search,
  ]);

  const submitLogin = async () => {
    if (isLoading) return;
    setLoginError(null);
    setIsLoading(true);

    try {
      const response = isAdministratorRecovery
        ? await apiClient.post<LoginResponse>('/api/auth/recovery/login', { email, password })
        : await login({ email, password });

      if (isAdministratorRecovery) {
        setAuthenticatedUser(response.user);
        await refreshPermissions();
      }

      if (response?.emailVerificationRequired || response?.user?.isEmailVerified === false) {
        const resendPath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/resend-verification` : '/resend-verification';
        navigate(resendPath, { replace: true, state: { email } });
        return;
      }

      // Redirect to the page they tried to visit or home
      const fallback = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : `/t/${DEFAULT_TENANT_SLUG}/`;
      const fromRaw = (location.state as LoginLocationState | null)?.from?.pathname;
      navigate(toSafeInternalPath(fromRaw, fallback), { replace: true });
    } catch (err) {
      const parsed = parseApiError(err, 'Login failed');
      setLoginError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitLogin();
  };

  const handleSsoLogin = (provider: PublicLoginProvider) => {
    setLoginError(null);
    if (provider.loginMethod === 'password') {
      setDirectLdapProvider(provider);
      return;
    }
    beginProviderRedirect(provider);
  };

  const continueLoginDiscovery = () => {
    const domain = email.trim().toLowerCase().split('@')[1] || '';
    const matchingProviders = (loginMethods?.providers || []).filter((provider) => provider.loginDomains.some((candidate) => (
      domain === candidate || domain.endsWith(`.${candidate}`)
    )));
    if (matchingProviders.length === 1) {
      handleSsoLogin(matchingProviders[0]);
      return;
    }
    if (matchingProviders.length > 1) {
      setDiscoveredProviderIds(matchingProviders.map((provider) => provider.id));
      setLoginStep('methods');
      return;
    }
    if (loginMethods?.localPassword.enabled) {
      setLoginStep('local');
      return;
    }
    setDiscoveredProviderIds(null);
    setLoginStep('methods');
  };

  const submitDirectLdapLogin = async () => {
    if (!directLdapProvider || isLoading || !email || !password) return;
    setLoginError(null);
    setIsLoading(true);
    try {
      await apiClient.post(providerPasswordLoginPath(directLdapProvider, tenantSlug), { username: email, password });
      redirectTo(tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : `/t/${DEFAULT_TENANT_SLUG}/`);
    } catch (err) {
      const parsed = parseApiError(err, 'Directory sign-in failed');
      setLoginError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  };

  const hideDefaultBranding = !branding && !brandingFetchDone;
  const safeBrandLogoSrc = logoObjectUrl;
  const loginLogoHeightPx = Math.round(28 * ((branding?.logoScale ?? 100) / 100));
  const brandTitle = typeof branding?.logoTitle === 'string' && branding.logoTitle.trim() ? branding.logoTitle.trim() : 'EnterpriseGlue';
  const customBrandFontFamily = branding?.titleFontUrl ? 'PublicBrandingFont' : undefined;
  const brandTitleWeight = typeof branding?.titleFontWeight === 'string' && branding.titleFontWeight.trim()
    ? branding.titleFontWeight.trim()
    : 'var(--font-weight-semibold)';
  const loginTitleFontSizePx = Math.round(Math.max(branding?.titleFontSize ?? 14, 10) * 2);

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

  useEffect(() => {
    document.title = brandTitle;
  }, [brandTitle]);

  const availableProviders = loginMethods?.providers || [];
  const visibleProviders = discoveredProviderIds
    ? availableProviders.filter((provider) => discoveredProviderIds.includes(provider.id))
    : availableProviders;
  const localPasswordEnabled = isAdministratorRecovery || Boolean(loginMethods?.localPassword.enabled);
  const showLocalForm = !directLdapProvider && localPasswordEnabled
    && (isAdministratorRecovery || loginStep === 'local' || loginMethods?.providerSelection !== 'progressive');
  const showProviderChooser = !isAdministratorRecovery && !directLdapProvider && !ssoLoading
    && visibleProviders.length > 0 && loginStep === 'methods';
  const showProgressiveDiscovery = !isAdministratorRecovery && !directLdapProvider && !ssoLoading
    && loginMethods?.providerSelection === 'progressive' && loginStep === 'discover';

  useEffect(() => {
    if (ssoLoading) return;
    const isFirstFocusableState = !hasAppliedFirstFocusableState.current;
    hasAppliedFirstFocusableState.current = true;
    window.requestAnimationFrame(() => {
      if (loginError && errorRef.current) {
        errorRef.current.focus({ preventScroll: true });
        return;
      }
      if (redirectingProvider && transitionHeadingRef.current) {
        transitionHeadingRef.current.focus({ preventScroll: true });
        return;
      }
      const inputId = directLdapProvider
        ? 'ldap-username'
        : showProgressiveDiscovery
          ? 'login-discovery-email'
          : showLocalForm
            ? 'email'
            : null;
      if (inputId) {
        document.getElementById(inputId)?.focus({ preventScroll: true });
        return;
      }
      if (showProviderChooser && !isFirstFocusableState) chooserHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [
    directLdapProvider,
    loginError,
    loginStep,
    redirectingProvider,
    showLocalForm,
    showProgressiveDiscovery,
    showProviderChooser,
    ssoLoading,
  ]);

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
        maxWidth: '440px'
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
            fontSize: `${loginTitleFontSizePx}px`,
            fontWeight: brandTitleWeight,
            fontFamily: customBrandFontFamily || 'var(--font-primary)',
            color: loginTitleColor || 'var(--color-text-primary)',
            display: 'inline-block',
            transform: loginTitleOffsetPx ? `translateY(${loginTitleOffsetPx}px)` : undefined,
            visibility: hideDefaultBranding ? 'hidden' : 'visible',
          }}>
            {brandTitle}
          </span>
        </div>

        {isAdministratorRecovery && <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Administrator recovery"
          subtitle="Only the designated platform administrator can use this emergency sign-in with a local password. Use it only if your organization’s sign-in provider is unavailable."
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}

        {loginMethods?.configurationStatus === 'no_login_method' && !isAdministratorRecovery && <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="No sign-in method is available"
          subtitle="Ask a platform administrator to enable work-account sign-in or local password sign-in."
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}

        {loginMethodsUnavailable && !isAdministratorRecovery && <ActionableNotification
          kind="error"
          lowContrast
          hideCloseButton
          inline
          actionButtonLabel="Retry"
          onActionButtonClick={loadLoginMethods}
          title="Sign-in methods could not be loaded"
          subtitle="Try again or contact a platform administrator. Sign-in remains unavailable until EnterpriseGlue can verify your organization’s sign-in settings."
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}

        {loginError && <div ref={errorRef} tabIndex={-1}>
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={isAdministratorRecovery ? 'Recovery sign-in failed' : 'Sign-in failed'}
            subtitle={`${sentence(loginError)} Check the entered details or choose another sign-in method.`}
            style={{ marginBottom: 'var(--spacing-5)' }}
          />
        </div>}

        {/* Login form */}
        {redirectingProvider ? (
          <div role="status" aria-live="polite" className="eg-login-redirect-status">
            <h2 ref={transitionHeadingRef} tabIndex={-1} style={{ fontSize: 'var(--text-18)', margin: '0 0 var(--spacing-3)' }}>
              Opening {providerLoginLabel(redirectingProvider)}
            </h2>
            {redirectingProvider.organization && <p style={{ margin: '0 0 var(--spacing-4)', color: 'var(--cds-text-secondary)', overflowWrap: 'anywhere' }}>{redirectingProvider.organization}</p>}
            <InlineLoading description="Connecting to your organization’s sign-in…" />
            <Button type="button" kind="ghost" onClick={cancelProviderRedirect} style={{ width: '100%', marginTop: 'var(--spacing-4)' }}>
              Choose another sign-in method
            </Button>
          </div>
        ) : directLdapProvider ? (
          <form onSubmit={(event) => { event.preventDefault(); submitDirectLdapLogin(); }}>
            <h2 ref={chooserHeadingRef} tabIndex={-1} style={{ fontSize: 'var(--text-18)', margin: '0 0 var(--spacing-5)', overflowWrap: 'anywhere' }}>Sign in with {providerLoginLabel(directLdapProvider)}</h2>
            <div style={{ marginBottom: 'var(--spacing-5)' }}>
              <TextInput id="ldap-username" labelText="Username" placeholder="Enter your directory username" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isLoading} />
            </div>
            <div style={{ marginBottom: 'var(--spacing-6)' }}>
              <PasswordInput id="ldap-password" labelText="Password" placeholder="Enter your directory password" autoComplete="current-password" showPasswordLabel="Show password" hidePasswordLabel="Hide password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={isLoading} />
            </div>
            <Button type="submit" kind="primary" disabled={isLoading || !email || !password} style={{ width: '100%' }}>{isLoading ? 'Signing in...' : 'Sign in'}</Button>
            <Button type="button" kind="ghost" disabled={isLoading} onClick={() => { setDirectLdapProvider(null); setPassword(''); setLoginStep('methods'); }} style={{ width: '100%', marginTop: 'var(--spacing-3)' }}>Choose another sign-in method</Button>
          </form>
        ) : showProgressiveDiscovery ? (
          <form onSubmit={(event) => { event.preventDefault(); if (email) continueLoginDiscovery(); }}>
            <h2 ref={chooserHeadingRef} tabIndex={-1} style={{ fontSize: 'var(--text-18)', margin: '0 0 var(--spacing-3)' }}>Sign in to your organization</h2>
            <p style={{ margin: '0 0 var(--spacing-5)', color: 'var(--cds-text-secondary)' }}>Enter your work email and we’ll direct you to the right sign-in method.</p>
            <div style={{ marginBottom: 'var(--spacing-6)' }}>
              <TextInput id="login-discovery-email" labelText="Work email" placeholder="name@example.com" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isLoading} />
            </div>
            <Button type="submit" kind="primary" disabled={isLoading || !email} style={{ width: '100%' }}>Continue</Button>
            <Button type="button" kind="ghost" onClick={() => { setDiscoveredProviderIds(null); setLoginStep('methods'); }} style={{ width: '100%', marginTop: 'var(--spacing-3)' }}>Choose a sign-in method instead</Button>
          </form>
        ) : showLocalForm ? (
          <form
            onSubmit={handleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isLoading && email && password) {
                e.preventDefault();
                submitLogin();
              }
            }}
          >
            <h2 ref={chooserHeadingRef} tabIndex={-1} style={{ fontSize: 'var(--text-18)', margin: '0 0 var(--spacing-5)' }}>{isAdministratorRecovery ? 'Recover platform access' : 'Sign in with email and password'}</h2>
            <div style={{ marginBottom: 'var(--spacing-5)' }}>
              <TextInput
                id="email"
                labelText="Email"
                placeholder="Enter your email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <div style={{ marginBottom: 'var(--spacing-6)' }}>
              <PasswordInput
                id="password"
                labelText="Password"
                placeholder="Enter your password"
                autoComplete="current-password"
                showPasswordLabel="Show password"
                hidePasswordLabel="Hide password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              kind="primary"
              disabled={isLoading || ssoLoading || !email || !password}
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
              {isLoading ? 'Signing in...' : isAdministratorRecovery ? 'Sign in for recovery' : 'Sign in'}
            </Button>
            {!isAdministratorRecovery && <div style={{ textAlign: 'right', marginTop: 'var(--spacing-3)' }}>
              <Link to={forgotPasswordPath} style={{ color: 'var(--cds-link-01)', fontSize: 'var(--text-14)' }}>
                Forgot your password?
              </Link>
            </div>}
          </form>
        ) : null}

        {/* SSO Providers */}
        {ssoLoading ? (
          <div role="status" aria-live="polite" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-4)' }}>
            <Loading small withOverlay={false} description="Loading sign-in options..." />
          </div>
        ) : showProviderChooser && !redirectingProvider && (
          <>
            {showLocalForm && <div style={{
              display: 'flex',
              alignItems: 'center',
              margin: 'var(--spacing-6) 0',
              textAlign: 'center'
            }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border-primary)' }} />
              <span style={{ padding: '0 var(--spacing-4)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-14)' }}>
                or
              </span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border-primary)' }} />
            </div>}

            {!showLocalForm && <div style={{ marginBottom: 'var(--spacing-5)' }}>
              <h2 ref={chooserHeadingRef} tabIndex={-1} style={{ fontSize: 'var(--text-18)', margin: 0 }}>Choose how to sign in</h2>
              <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Use your work account.</p>
            </div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
              {visibleProviders.map((provider) => {
                const primary = visibleProviders.length === 1 && !showLocalForm;
                const accessibleLabel = `Continue with ${provider.displayName}${provider.organization ? ` ${provider.organization}` : ''}`;
                return (
                  <ClickableTile
                    key={provider.id}
                    role="button"
                    aria-label={accessibleLabel}
                    aria-disabled={isLoading}
                    className={`eg-login-provider-tile${primary ? ' eg-login-provider-tile--primary' : ''}`}
                    renderIcon={LoginIcon}
                    onClick={() => handleSsoLogin(provider)}
                    disabled={isLoading}
                  >
                    <span className="eg-login-provider-tile__content">
                      <span
                        className="eg-login-provider-tile__action"
                        title={provider.displayName.length > MAX_LOGIN_LABEL_LENGTH ? provider.displayName : undefined}
                      >
                        Continue with {providerLoginLabel(provider)}
                      </span>
                      {provider.organization && (
                        <span className="eg-login-provider-tile__supporting" title={provider.organization}>
                          {provider.organization}
                        </span>
                      )}
                    </span>
                  </ClickableTile>
                );
              })}
            </div>
            {loginMethods?.providerSelection === 'progressive' && <Button type="button" kind="ghost" onClick={() => { setDiscoveredProviderIds(null); setLoginStep('discover'); }} style={{ width: '100%', marginTop: 'var(--spacing-3)' }}>Use a different email</Button>}
            {loginMethods?.localPassword.enabled && !showLocalForm && <Button type="button" kind="ghost" onClick={() => setLoginStep('local')} style={{ width: '100%', marginTop: 'var(--spacing-3)' }}>Sign in with a local password</Button>}
          </>
        )}

        {/* Footer */}
        {isMultiTenantEnabled() && (
          <div style={{
            marginTop: 'var(--spacing-6)',
            paddingTop: 'var(--spacing-5)',
            borderTop: '1px solid var(--color-border-primary)',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: 'var(--text-14)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-3)' }}>
              Don't have an account?{' '}
              <Link to="/signup" style={{ color: 'var(--cds-link-01)' }}>
                Sign up
              </Link>
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
