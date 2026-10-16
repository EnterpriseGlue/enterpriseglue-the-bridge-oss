/**
 * HTTP Interceptor
 * Intercepts fetch requests to handle authentication and token refresh
 *
 * Unified Tenant Routing (Option A):
 * - Legacy tenant-scoped APIs are automatically prefixed with /t/:tenantSlug
 * - Native tenant APIs use the canonical /api/t/:tenantSlug shape
 * - OSS single mode resolves the canonical default tenant
 */

import { USER_KEY } from '../constants/storageKeys.js';
import { getErrorMessageFromResponse } from '../shared/api/apiErrorUtils.js';
import { config } from '../config.js';
import { apiFetch } from './apiFetch';
import { getTenancyCapabilities } from '../services/tenancy.js';
import { getPublicAuthRoutePolicy } from './publicAuthRoute.js';

const API_BASE_URL = '/api';
const DEFAULT_TENANT_SLUG = 'default';

// API prefixes that are tenant-scoped (need /t/:tenantSlug prefix)
const TENANT_SCOPED_API_PREFIXES = [
  '/starbase-api/',
  '/mission-control-api/',
  '/engines-api/',
  '/git-api/',
  '/vcs-api/',
  '/api/users',
  '/api/audit',
  '/api/notifications',
  '/api/dashboard',
  '/api/identity/providers',
  '/api/identity/provider-secrets',
];

// API prefixes that are platform-level (no tenant prefix needed)
const PLATFORM_API_PREFIXES = [
  '/api/auth/',
  '/api/admin/',
  '/api/platform-admin/',
  '/api/contact-admin',
  '/api/sso-providers',
  '/api/authz/',
];

function getTenantSlugFromPathname(pathname: string): string {
  const m = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  // On unprefixed pooled pages, routing belongs to the verified hostname.
  // Inventing `default` conflicts with that host at the edge and also redirects
  // failed refreshes to the wrong tenant. A neutral hostname still fails closed.
  if (!m?.[1]) return getTenancyCapabilities().mode === 'pooled' ? '' : DEFAULT_TENANT_SLUG;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Check if a URL is a tenant-scoped API endpoint
 */
function isTenantScopedUrl(url: string): boolean {
  // Already has tenant prefix
  if (url.startsWith('/t/')) return false;

  // Check if it's a platform-level API (no prefix needed)
  if (PLATFORM_API_PREFIXES.some((prefix) => url.startsWith(prefix))) return false;

  // On a verified tenant hostname, pooled APIs deliberately stay root-shaped;
  // the backend derives the tenant from that hostname. The platform hostname
  // cannot resolve a tenant and therefore fails closed.
  if (getTenancyCapabilities().mode === 'pooled' && !window.location.pathname.match(/^\/t\/[^/]+(?:\/|$)/)) {
    return false;
  }

  // Provider administration is platform-scoped on the root settings page in
  // single mode and tenant-scoped only from a canonical tenant route.
  if (isIdentityProviderAdminUrl(url) && !window.location.pathname.match(/^\/t\/[^/]+(?:\/|$)/)) {
    return false;
  }

  // Check if it's a tenant-scoped API
  return TENANT_SCOPED_API_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isIdentityProviderAdminUrl(url: string): boolean {
  return url.startsWith('/api/identity/providers') || url.startsWith('/api/identity/provider-secrets');
}

/**
 * Add tenant slug prefix to tenant-scoped URLs
 */
function addTenantPrefix(url: string): string {
  if (!isTenantScopedUrl(url)) return url;

  const tenantSlug = getTenantSlugFromPathname(window.location.pathname);
  // Native tenant identity-provider administration uses the canonical API
  // shape. Keep the older /t/:slug prefix only for legacy tenant APIs.
  if (isIdentityProviderAdminUrl(url)) {
    return `/api/t/${encodeURIComponent(tenantSlug)}${url.slice('/api'.length)}`;
  }
  return `/t/${encodeURIComponent(tenantSlug)}${url}`;
}

function applyApiBaseUrl(url: string): string {
  if (!config.apiBaseUrl) return url;
  if (/^https?:\/\//.test(url)) return url;
  const base = config.apiBaseUrl.replace(/\/$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function getTenantLoginPath(pathname: string): string {
  const tenantSlug = getTenantSlugFromPathname(pathname);
  return tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}/login` : '/login';
}

// Share one refresh across concurrent 401 responses. Retries reread the rotated cookie.
let refreshPromise: Promise<boolean> | null = null;

/**
 * Clear authentication and redirect to login
 */
function handleAuthFailure(): void {
  // Clear local user data (tokens are in httpOnly cookies, cleared server-side on logout)
  localStorage.removeItem(USER_KEY);

  // Only redirect if not already on login page
  const loginPath = getTenantLoginPath(window.location.pathname);
  if (window.location.pathname !== loginPath) {
    window.location.href = loginPath;
  }
}

/**
 * Attempt to refresh the access token
 */
async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await apiFetch(applyApiBaseUrl(`${API_BASE_URL}/auth/refresh`), {
      method: 'POST',
      credentials: 'include',
      // The SaaS edge uses this as a bounded shard-routing hint. It is not
      // tenant authority: the backend still validates the tenant-bound refresh
      // token and active membership before issuing a new access token.
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      const message = await getErrorMessageFromResponse(response);
      console.warn('Token refresh failed:', message);
      if (response.status === 401 || response.status === 403) {
        handleAuthFailure();
      }
      return false;
    }

    return true;
  } catch (error) {
    console.error('Token refresh failed:', error);
    return false;
  }
}

/**
 * Intercepted fetch function with automatic token refresh on 401
 * Also handles automatic tenant URL prefixing for unified routing (Option A)
 */
export async function interceptedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Add tenant prefix to tenant-scoped URLs
  const prefixedUrl = addTenantPrefix(url);
  const requestUrl = applyApiBaseUrl(prefixedUrl);

  // Don't intercept auth endpoints (login, refresh, logout)
  const isAuthEndpoint = ['/auth/login', '/auth/refresh', '/auth/logout'].some((path) =>
    prefixedUrl.includes(path),
  );

  // Don't intercept on public routes - let them handle 401s naturally
  const onPublicRoute = getPublicAuthRoutePolicy(window.location.pathname) !== null;

  // Ensure credentials are included so cookies are sent
  const fetchOptions: RequestInit = { ...options, credentials: 'include' };

  // Make the original request with prefixed URL
  let response = await apiFetch(requestUrl, fetchOptions);

  // If we get a 401 and it's not an auth endpoint and not on a public route, try to refresh the token
  if (response.status === 401 && !isAuthEndpoint && !onPublicRoute) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null; });
    }
    if (await refreshPromise) {
      const headers = new Headers(getAuthHeaders());
      new Headers(fetchOptions.headers).forEach((value, name) => headers.set(name, value));
      response = await apiFetch(requestUrl, { ...fetchOptions, headers });
    }
  }

  return response;
}

/**
 * Helper to create content and tenant headers; apiFetch adds the current XSRF token.
 */
export function getAuthHeaders(): Record<string, string> {
  const tenantSlug = getTenantSlugFromPathname(window.location.pathname);
  return {
    'Content-Type': 'application/json',
    ...(tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {}),
  };
}
