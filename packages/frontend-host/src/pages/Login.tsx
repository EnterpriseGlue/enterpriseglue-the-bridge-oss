import { useState, FormEvent, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import { ActionableNotification, TextInput, PasswordInput, Button, Link as CarbonLink, InlineLoading, Loading, InlineNotification, Tile } from '@carbon/react';
import { Login as LoginIcon } from '@carbon/icons-react';
import { useAuth } from '../shared/hooks/useAuth';
import { apiClient } from '../shared/api/client';
import { parseApiError } from '../shared/api/apiErrorUtils';
import PublicAuthShell from '../shared/components/PublicAuthShell';
import { toSafeInternalPath } from '../utils/safeNavigation';
import { redirectTo } from '../utils/redirect';
import { isMultiTenantEnabled } from '../enterprise/extensionRegistry';
import { getTenancyCapabilities } from '../services/tenancy';
import type {
  PublicLoginMethodsResponse,
  PublicLoginProvider,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import type { LoginResponse } from '../shared/types/auth';

const DEFAULT_TENANT_SLUG = 'default';

const SSO_AUTO_REDIRECT_BLOCK_UNTIL_KEY = 'eg.sso.autoRedirect.blockUntil';
const TENANT_DISCOVERY_EMAIL_KEY = 'eg.tenancy.discoveryEmail';
const SSO_REDIRECT_TRANSITION_MS = 600;

interface LoginLocationState {
  from?: { pathname?: unknown };
}

type LoginField = 'email' | 'password' | 'discoveryEmail' | 'workspace' | 'ldapUsername' | 'ldapPassword';
type LoginErrorFocusTarget = 'notification' | 'email' | 'ldap-username';

interface TenantDiscoveryMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: 'active' | 'suspended' | 'deleting';
  role: 'admin' | 'member';
}

type TenantDiscoveryResult =
  | { status: 'resolved'; tenantSlug: string; loginPath: string }
  | { status: 'verification_sent'; message: string };

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function requiredFieldError(value: string, label: string): string | null {
  return value.trim() ? null : `${label} is required`;
}

function emailFieldError(value: string, label: string): string | null {
  const requiredError = requiredFieldError(value, label);
  if (requiredError) return requiredError;
  return /^[^\s@]+@[^\s@]+$/.test(value.trim()) ? null : 'Enter a valid email address';
}

function workspaceSlug(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized) ? normalized : null;
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
  const tenancyCapabilities = getTenancyCapabilities();
  const isOrganizationFinder = tenancyCapabilities.mode === 'pooled'
    && tenancyCapabilities.organizationDiscoveryEnabled
    && !tenantSlug
    && !isAdministratorRecovery;
  const forgotPasswordPath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/forgot-password` : '/forgot-password';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [organizationStep, setOrganizationStep] = useState<'email' | 'workspace' | 'tenants'>('email');
  const [organizationChoices, setOrganizationChoices] = useState<TenantDiscoveryMembership[]>([]);
  const [organizationNotice, setOrganizationNotice] = useState<string | null>(null);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [organizationLoading, setOrganizationLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loginMethods, setLoginMethods] = useState<PublicLoginMethodsResponse | null>(null);
  const [directLdapProvider, setDirectLdapProvider] = useState<PublicLoginProvider | null>(null);
  const [loginStep, setLoginStep] = useState<'discover' | 'methods' | 'local'>('methods');
  const [discoveredProviderIds, setDiscoveredProviderIds] = useState<string[] | null>(null);
  const [ssoLoading, setSsoLoading] = useState(true);
  const [loginMethodsUnavailable, setLoginMethodsUnavailable] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginErrorFocusTarget, setLoginErrorFocusTarget] = useState<LoginErrorFocusTarget>('notification');
  const [touchedFields, setTouchedFields] = useState<Partial<Record<LoginField, boolean>>>({});
  const [redirectingProvider, setRedirectingProvider] = useState<PublicLoginProvider | null>(null);
  const hasTriggeredAutoSsoRedirect = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);
  const transitionHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const chooserHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const hasAppliedFirstFocusableState = useRef(false);
  const hasExchangedDiscoveryToken = useRef(false);

  const touchFields = useCallback((...fields: LoginField[]) => {
    setTouchedFields((current) => {
      const next = { ...current };
      fields.forEach((field) => { next[field] = true; });
      return next;
    });
  }, []);

  const updateEmail = (value: string) => {
    setEmail(value);
    setLoginError(null);
  };

  const updatePassword = (value: string) => {
    setPassword(value);
    setLoginError(null);
  };

  const emailError = touchedFields.email ? emailFieldError(email, 'Email') : null;
  const passwordError = touchedFields.password ? requiredFieldError(password, 'Password') : null;
  const discoveryEmailError = touchedFields.discoveryEmail ? emailFieldError(email, 'Work email') : null;
  const workspaceError = touchedFields.workspace && !workspaceSlug(workspace)
    ? 'Use 1–63 lowercase letters, numbers, or hyphens'
    : null;
  const ldapUsernameError = touchedFields.ldapUsername ? requiredFieldError(email, 'Username') : null;
  const ldapPasswordError = touchedFields.ldapPassword ? requiredFieldError(password, 'Password') : null;
  
  // The public contract contains only policy-resolved, sanitized login methods.
  const loadLoginMethods = useCallback(() => {
    if (isOrganizationFinder) {
      setSsoLoading(false);
      setLoginMethodsUnavailable(false);
      setLoginMethods(null);
      return;
    }
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
  }, [isAdministratorRecovery, isOrganizationFinder, tenantSlug]);

  useEffect(() => {
    loadLoginMethods();
  }, [loadLoginMethods]);

  useEffect(() => {
    if (!tenantSlug) return;
    try {
      const discoveredEmail = window.sessionStorage.getItem(TENANT_DISCOVERY_EMAIL_KEY);
      if (!email && discoveredEmail) setEmail(discoveredEmail);
      window.sessionStorage.removeItem(TENANT_DISCOVERY_EMAIL_KEY);
    } catch {
      // Browser storage is an optional convenience and never tenant authority.
    }
  }, [email, tenantSlug]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated || isOrganizationFinder) return;

    const params = new URLSearchParams(location.search);
    if (params.get('error')) return;

    const fallback = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : `/t/${DEFAULT_TENANT_SLUG}/`;
    const fromRaw = (location.state as LoginLocationState | null)?.from?.pathname;
    navigate(toSafeInternalPath(fromRaw, fallback), { replace: true });
  }, [isAuthLoading, isAuthenticated, isOrganizationFinder, location.search, location.state, navigate, tenantSlug]);

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

      setLoginErrorFocusTarget('notification');
      setLoginError(errorMessage || error);
      // Clean up URL
      navigate(toSafeInternalPath(location.pathname, '/login'), { replace: true });
    }
  }, [location, navigate]);

  const openTenantLogin = useCallback((slugValue: string, prefillEmail?: string) => {
    const slug = workspaceSlug(slugValue);
    if (!slug) {
      setOrganizationError('Enter a valid organization name using letters, numbers, or hyphens.');
      return;
    }
    if (prefillEmail) {
      try { window.sessionStorage.setItem(TENANT_DISCOVERY_EMAIL_KEY, prefillEmail.trim().toLowerCase()); }
      catch { /* optional convenience only */ }
    }
    navigate(`/t/${encodeURIComponent(slug)}/login`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!isOrganizationFinder || hasExchangedDiscoveryToken.current) return;
    const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('discovery_token');
    if (!token) return;
    hasExchangedDiscoveryToken.current = true;
    navigate('/login', { replace: true });
    setOrganizationLoading(true);
    setOrganizationError(null);
    apiClient.post<{ tenants: TenantDiscoveryMembership[] }>('/api/auth/tenant-discovery/exchange', { token })
      .then(({ tenants }) => {
        const active = tenants.filter((tenant) => tenant.tenantStatus === 'active');
        if (active.length === 1) {
          openTenantLogin(active[0].tenantSlug);
          return;
        }
        if (active.length > 1) {
          setOrganizationChoices(active);
          setOrganizationStep('tenants');
          return;
        }
        setOrganizationError('No active organization is available for this link. Try your work email or organization name.');
      })
      .catch(() => setOrganizationError('This organization link is invalid or has expired. Request a new link.'))
      .finally(() => setOrganizationLoading(false));
  }, [isOrganizationFinder, location.hash, navigate, openTenantLogin]);

  const handleOrganizationEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    touchFields('discoveryEmail');
    if (emailFieldError(email, 'Work email')) {
      window.requestAnimationFrame(() => document.getElementById('organization-discovery-email')?.focus({ preventScroll: true }));
      return;
    }
    setOrganizationLoading(true);
    setOrganizationError(null);
    setOrganizationNotice(null);
    try {
      const result = await apiClient.post<TenantDiscoveryResult>('/api/auth/tenant-discovery', { email: email.trim().toLowerCase() });
      if (result.status === 'resolved') {
        openTenantLogin(result.tenantSlug, email);
        return;
      }
      setOrganizationNotice(result.message);
    } catch (error) {
      setOrganizationError(parseApiError(error, 'Organization discovery is unavailable').message);
    } finally {
      setOrganizationLoading(false);
    }
  };

  const handleWorkspaceSubmit = (event: FormEvent) => {
    event.preventDefault();
    touchFields('workspace');
    if (!workspaceSlug(workspace)) {
      setOrganizationError('Enter a valid organization name using letters, numbers, or hyphens.');
      window.requestAnimationFrame(() => document.getElementById('organization-slug')?.focus({ preventScroll: true }));
      return;
    }
    setOrganizationError(null);
    openTenantLogin(workspace);
  };

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
      setPassword('');
      setTouchedFields((current) => ({ ...current, password: false }));
      setLoginErrorFocusTarget('email');
      setLoginError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    touchFields('email', 'password');
    const invalidEmail = emailFieldError(email, 'Email');
    const invalidPassword = requiredFieldError(password, 'Password');
    if (invalidEmail || invalidPassword) {
      window.requestAnimationFrame(() => {
        document.getElementById(invalidEmail ? 'email' : 'password')?.focus({ preventScroll: true });
      });
      return;
    }
    submitLogin();
  };

  const handleSsoLogin = (provider: PublicLoginProvider) => {
    setLoginError(null);
    if (provider.loginMethod === 'password') {
      setPassword('');
      setTouchedFields((current) => ({ ...current, ldapUsername: false, ldapPassword: false }));
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

  const handleDiscoverySubmit = (event: FormEvent) => {
    event.preventDefault();
    touchFields('discoveryEmail');
    if (emailFieldError(email, 'Work email')) {
      window.requestAnimationFrame(() => {
        document.getElementById('login-discovery-email')?.focus({ preventScroll: true });
      });
      return;
    }
    continueLoginDiscovery();
  };

  const submitDirectLdapLogin = async () => {
    if (!directLdapProvider || isLoading) return;
    setLoginError(null);
    setIsLoading(true);
    try {
      await apiClient.post(providerPasswordLoginPath(directLdapProvider, tenantSlug), { username: email, password });
      redirectTo(tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : `/t/${DEFAULT_TENANT_SLUG}/`);
    } catch (err) {
      const parsed = parseApiError(err, 'Directory login failed');
      setPassword('');
      setTouchedFields((current) => ({ ...current, ldapPassword: false }));
      setLoginErrorFocusTarget('ldap-username');
      setLoginError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDirectLdapSubmit = (event: FormEvent) => {
    event.preventDefault();
    touchFields('ldapUsername', 'ldapPassword');
    const invalidUsername = requiredFieldError(email, 'Username');
    const invalidPassword = requiredFieldError(password, 'Password');
    if (invalidUsername || invalidPassword) {
      window.requestAnimationFrame(() => {
        document.getElementById(invalidUsername ? 'ldap-username' : 'ldap-password')?.focus({ preventScroll: true });
      });
      return;
    }
    submitDirectLdapLogin();
  };

  const headerHomePath = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/` : '/';

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
  const primaryProviderId = !showLocalForm
    ? visibleProviders.find((provider) => provider.preferred)?.id
      || (visibleProviders.length === 1 ? visibleProviders[0].id : null)
    : null;

  useEffect(() => {
    if (ssoLoading) return;
    const isFirstFocusableState = !hasAppliedFirstFocusableState.current;
    hasAppliedFirstFocusableState.current = true;
    window.requestAnimationFrame(() => {
      if (loginError) {
        if (loginErrorFocusTarget === 'notification' && errorRef.current) {
          errorRef.current.focus({ preventScroll: true });
        } else {
          document.getElementById(loginErrorFocusTarget)?.focus({ preventScroll: true });
        }
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
    loginErrorFocusTarget,
    loginStep,
    redirectingProvider,
    showLocalForm,
    showProgressiveDiscovery,
    showProviderChooser,
    ssoLoading,
  ]);

  useEffect(() => {
    if (!isOrganizationFinder || organizationLoading) return;
    const id = organizationStep === 'email'
      ? 'organization-discovery-email'
      : organizationStep === 'workspace'
        ? 'organization-slug'
        : 'organization-picker-heading';
    window.requestAnimationFrame(() => document.getElementById(id)?.focus({ preventScroll: true }));
  }, [isOrganizationFinder, organizationLoading, organizationStep]);

  if (isOrganizationFinder) {
    return (
      <PublicAuthShell title="Find your organization" homePath="/">
        {organizationError && <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="Organization unavailable"
          subtitle={organizationError}
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}
        {organizationNotice && <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title="Check your email"
          subtitle={organizationNotice}
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}
        {organizationLoading && <div role="status" aria-live="polite" style={{ padding: 'var(--spacing-4) 0' }}>
          <InlineLoading description="Finding your organization…" />
        </div>}

        {!organizationLoading && organizationStep === 'email' && <form onSubmit={handleOrganizationEmailSubmit} noValidate>
          <h2 className="eg-login-section-heading eg-login-section-heading--with-copy">Use your work email</h2>
          <p className="eg-login-intro-copy">We’ll use your verified work-email domain to open the right organization. Your email does not grant access.</p>
          <div style={{ marginBottom: 'var(--spacing-6)' }}>
            <TextInput
              id="organization-discovery-email"
              labelText="Work email"
              placeholder="name@example.com"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => { updateEmail(event.target.value); setOrganizationNotice(null); setOrganizationError(null); }}
              onBlur={() => touchFields('discoveryEmail')}
              invalid={Boolean(discoveryEmailError)}
              invalidText={discoveryEmailError || undefined}
              required
            />
          </div>
          <Button type="submit" kind="primary" size="md" className="eg-login-primary-action">Continue</Button>
          <Button type="button" kind="ghost" size="md" className="eg-login-secondary-action" onClick={() => { setOrganizationError(null); setOrganizationNotice(null); setOrganizationStep('workspace'); }}>
            Use an organization name instead
          </Button>
        </form>}

        {!organizationLoading && organizationStep === 'workspace' && <form onSubmit={handleWorkspaceSubmit} noValidate>
          <h2 className="eg-login-section-heading eg-login-section-heading--with-copy">Enter your organization name</h2>
          <p className="eg-login-intro-copy">Use the name from your EnterpriseGlue URL, for example <strong>acme</strong> from <strong>/t/acme</strong>.</p>
          <div style={{ marginBottom: 'var(--spacing-6)' }}>
            <TextInput
              id="organization-slug"
              labelText="Organization name"
              placeholder="acme"
              autoComplete="organization"
              value={workspace}
              onChange={(event) => { setWorkspace(event.target.value.toLowerCase()); setOrganizationError(null); }}
              onBlur={() => touchFields('workspace')}
              invalid={Boolean(workspaceError)}
              invalidText={workspaceError || undefined}
              required
            />
          </div>
          <Button type="submit" kind="primary" size="md" className="eg-login-primary-action">Continue</Button>
          <Button type="button" kind="ghost" size="md" className="eg-login-secondary-action" onClick={() => { setOrganizationError(null); setOrganizationStep('email'); }}>
            Use work email instead
          </Button>
        </form>}

        {!organizationLoading && organizationStep === 'tenants' && <div>
          <h2 id="organization-picker-heading" tabIndex={-1} className="eg-login-section-heading eg-login-section-heading--with-copy">Choose an organization</h2>
          <p className="eg-login-intro-copy">You’ll complete that organization’s own login and SSO requirements next.</p>
          <div style={{ display: 'grid', gap: 'var(--spacing-3)', marginTop: 'var(--spacing-5)' }}>
            {organizationChoices.map((tenant) => <Tile key={tenant.tenantId}>
              <Button kind="ghost" size="lg" onClick={() => openTenantLogin(tenant.tenantSlug)} style={{ width: '100%', justifyContent: 'flex-start' }}>
                {tenant.tenantName}
              </Button>
            </Tile>)}
          </div>
          <Button type="button" kind="ghost" size="md" className="eg-login-secondary-action" onClick={() => { setOrganizationChoices([]); setOrganizationStep('email'); }}>
            Use a different email
          </Button>
        </div>}
      </PublicAuthShell>
    );
  }

  return (
    <PublicAuthShell
      title={isAdministratorRecovery ? 'Log in for administrator recovery' : 'Log in'}
      homePath={headerHomePath}
    >

        {isAdministratorRecovery && <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Administrator recovery"
          subtitle="Only the designated platform administrator can use this emergency login with a local password. Use it only if your organization’s login provider is unavailable."
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}

        {loginMethods?.configurationStatus === 'no_login_method' && !isAdministratorRecovery && <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="No login method is available"
          subtitle="Ask a platform administrator to enable work-account login or local password login."
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}

        {loginMethodsUnavailable && !isAdministratorRecovery && <ActionableNotification
          kind="error"
          lowContrast
          hideCloseButton
          inline
          actionButtonLabel="Retry"
          onActionButtonClick={loadLoginMethods}
          title="Login methods could not be loaded"
          subtitle="Try again or contact a platform administrator. Login remains unavailable until EnterpriseGlue can verify your organization’s login settings."
          style={{ marginBottom: 'var(--spacing-5)' }}
        />}

        {loginError && <div ref={errorRef} tabIndex={-1}>
          <InlineNotification
            kind="error"
            lowContrast
            hideCloseButton
            title={isAdministratorRecovery ? 'Recovery login failed' : 'Log in failed'}
            subtitle={`${sentence(loginError)} Check the entered details or choose another login method.`}
            style={{ marginBottom: 'var(--spacing-5)' }}
          />
        </div>}

        {/* Login form */}
        {redirectingProvider ? (
          <div role="status" aria-live="polite" className="eg-login-redirect-status">
            <h2 ref={transitionHeadingRef} tabIndex={-1} style={{ fontSize: 'var(--text-18)', margin: '0 0 var(--spacing-3)' }}>
              Opening {redirectingProvider.displayName}
            </h2>
            {redirectingProvider.organization && <p className="eg-login-supporting-copy">{redirectingProvider.organization}</p>}
            <InlineLoading description="Connecting to your organization’s login…" />
            <Button type="button" kind="ghost" size="md" onClick={cancelProviderRedirect} className="eg-login-secondary-action">
              Choose another login method
            </Button>
          </div>
        ) : directLdapProvider ? (
          <form onSubmit={handleDirectLdapSubmit} noValidate>
            <h2 ref={chooserHeadingRef} tabIndex={-1} className="eg-login-section-heading">Log in with {directLdapProvider.displayName}</h2>
            <div style={{ marginBottom: 'var(--spacing-5)' }}>
              <TextInput
                id="ldap-username"
                labelText="Username"
                placeholder="Enter your directory username"
                autoComplete="username"
                value={email}
                onChange={(event) => updateEmail(event.target.value)}
                onBlur={() => touchFields('ldapUsername')}
                invalid={Boolean(ldapUsernameError)}
                invalidText={ldapUsernameError || undefined}
                required
                disabled={isLoading}
              />
            </div>
            <div style={{ marginBottom: 'var(--spacing-6)' }}>
              <PasswordInput
                id="ldap-password"
                labelText="Password"
                placeholder="Enter your directory password"
                autoComplete="current-password"
                showPasswordLabel="Show password"
                hidePasswordLabel="Hide password"
                value={password}
                onChange={(event) => updatePassword(event.target.value)}
                onBlur={() => touchFields('ldapPassword')}
                invalid={Boolean(ldapPasswordError)}
                invalidText={ldapPasswordError || undefined}
                required
                disabled={isLoading}
              />
            </div>
            <Button type="submit" kind="primary" size="md" disabled={isLoading} className="eg-login-primary-action">{isLoading ? 'Logging in…' : 'Log in'}</Button>
            <Button type="button" kind="ghost" size="md" disabled={isLoading} onClick={() => { setDirectLdapProvider(null); setPassword(''); setLoginError(null); setLoginStep('methods'); }} className="eg-login-secondary-action">Choose another login method</Button>
          </form>
        ) : showProgressiveDiscovery ? (
          <form onSubmit={handleDiscoverySubmit} noValidate>
            <h2 ref={chooserHeadingRef} tabIndex={-1} className="eg-login-section-heading eg-login-section-heading--with-copy">Use your work email</h2>
            <p className="eg-login-intro-copy">Enter your work email and we’ll direct you to the right login method.</p>
            <div style={{ marginBottom: 'var(--spacing-6)' }}>
              <TextInput
                id="login-discovery-email"
                labelText="Work email"
                placeholder="name@example.com"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => updateEmail(event.target.value)}
                onBlur={() => touchFields('discoveryEmail')}
                invalid={Boolean(discoveryEmailError)}
                invalidText={discoveryEmailError || undefined}
                required
                disabled={isLoading}
              />
            </div>
            <Button type="submit" kind="primary" size="md" disabled={isLoading} className="eg-login-primary-action">Continue</Button>
            <Button type="button" kind="ghost" size="md" onClick={() => { setDiscoveredProviderIds(null); setLoginError(null); setLoginStep('methods'); }} className="eg-login-secondary-action">Choose a login method instead</Button>
          </form>
        ) : showLocalForm ? (
          <form onSubmit={handleSubmit} noValidate>
            <h2 ref={chooserHeadingRef} tabIndex={-1} className="eg-login-section-heading">{isAdministratorRecovery ? 'Recovery credentials' : 'Email and password'}</h2>
            <div style={{ marginBottom: 'var(--spacing-5)' }}>
              <TextInput
                id="email"
                labelText="Email"
                placeholder="Enter your email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => updateEmail(event.target.value)}
                onBlur={() => touchFields('email')}
                invalid={Boolean(emailError)}
                invalidText={emailError || undefined}
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
                onChange={(event) => updatePassword(event.target.value)}
                onBlur={() => touchFields('password')}
                invalid={Boolean(passwordError)}
                invalidText={passwordError || undefined}
                required
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              kind="primary"
              size="md"
              disabled={isLoading || ssoLoading}
              className="eg-login-primary-action"
            >
              {isLoading ? 'Logging in…' : isAdministratorRecovery ? 'Log in for recovery' : 'Log in'}
            </Button>
            {!isAdministratorRecovery && <div className="eg-login-forgot-password">
              <CarbonLink as={RouterLink} to={forgotPasswordPath} size="sm">
                Forgot password?
              </CarbonLink>
            </div>}
          </form>
        ) : null}

        {/* SSO Providers */}
        {ssoLoading ? (
          <div role="status" aria-live="polite" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-4)' }}>
            <Loading small withOverlay={false} description="Loading login options…" />
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
              <h2 ref={chooserHeadingRef} tabIndex={-1} className="eg-login-section-heading eg-login-section-heading--with-copy">Choose how to log in</h2>
              <p style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--cds-text-secondary)' }}>Use your work account.</p>
            </div>}
            <div className="eg-login-provider-list">
              {visibleProviders.map((provider) => {
                const primary = provider.id === primaryProviderId;
                const accessibleLabel = `Continue with ${provider.displayName}${provider.organization ? ` ${provider.organization}` : ''}`;
                return (
                  <Button
                    key={provider.id}
                    type="button"
                    kind={primary ? 'primary' : 'tertiary'}
                    size="lg"
                    aria-label={accessibleLabel}
                    className="eg-login-provider-button"
                    renderIcon={LoginIcon}
                    onClick={() => handleSsoLogin(provider)}
                    disabled={isLoading}
                  >
                    <span className="eg-login-provider-button__content">
                      <span className="eg-login-provider-button__action">
                        Continue with {provider.displayName}
                      </span>
                      {provider.organization && (
                        <span className="eg-login-provider-button__supporting">
                          {provider.organization}
                        </span>
                      )}
                    </span>
                  </Button>
                );
              })}
            </div>
            {loginMethods?.providerSelection === 'progressive' && <Button type="button" kind="ghost" size="md" onClick={() => { setDiscoveredProviderIds(null); setLoginError(null); setLoginStep('discover'); }} className="eg-login-secondary-action">Use a different email</Button>}
            {loginMethods?.localPassword.enabled && !showLocalForm && <Button type="button" kind="ghost" size="md" onClick={() => { setLoginError(null); setLoginStep('local'); }} className="eg-login-secondary-action">Use a local password</Button>}
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
              Need an account?{' '}
              <CarbonLink as={RouterLink} to="/signup" inline>
                Create account
              </CarbonLink>
            </p>
          </div>
        )}
    </PublicAuthShell>
  );
}
