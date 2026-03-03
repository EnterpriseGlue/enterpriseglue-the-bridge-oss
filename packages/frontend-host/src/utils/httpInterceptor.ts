/**
 * HTTP Interceptor
 * Intercepts fetch requests to handle authentication and token refresh
 * 
 * Unified Tenant Routing (Option A):
 * - All tenant-scoped API calls are automatically prefixed with /t/:tenantSlug
 * - OSS uses /t/default/* paths
 * - EE uses /t/:actualTenantSlug/* paths
 */

import { USER_KEY } from '../constants/storageKeys';
import { getErrorMessageFromResponse } from '../shared/api/apiErrorUtils';
import { config } from '../config';

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
  if (!m?.[1]) return DEFAULT_TENANT_SLUG;
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
  if (PLATFORM_API_PREFIXES.some(prefix => url.startsWith(prefix))) return false;
  
  // Check if it's a tenant-scoped API
  return TENANT_SCOPED_API_PREFIXES.some(prefix => url.startsWith(prefix));
}

/**
 * Add tenant slug prefix to tenant-scoped URLs
 */
function addTenantPrefix(url: string): string {
  if (!isTenantScopedUrl(url)) return url;
  
  const tenantSlug = getTenantSlugFromPathname(window.location.pathname);
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

function getCookieValue(name: string): string | null {
  const needle = `${name}=`;
  const parts = String(document.cookie || '').split(';');
  for (const part of parts) {
    const p = part.trim();
    if (!p.startsWith(needle)) continue;
    const v = p.slice(needle.length);
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

// Track if a token refresh is in progress to avoid multiple simultaneous refreshes
let isRefreshing = false;
let refreshSubscribers: Array<(success: boolean) => void> = [];

// Store CSRF token from response headers (avoids non-httpOnly cookie)
let csrfToken: string | null = null;

/**
 * Update stored CSRF token from response headers
 */
function updateCsrfToken(response: Response): void {
  const token = response.headers.get('X-CSRF-Token');
  if (token) {
    csrfToken = token;
  }
}

/**
 * Subscribe to token refresh completion
 */
function subscribeTokenRefresh(callback: (success: boolean) => void): void {
  refreshSubscribers.push(callback);
}

/**
 * Notify all subscribers when token refresh completes
 */
function onTokenRefreshed(success: boolean): void {
  refreshSubscribers.forEach((callback) => callback(success));
  refreshSubscribers = [];
}

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
    const response = await fetch(applyApiBaseUrl(`${API_BASE_URL}/auth/refresh`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const message = await getErrorMessageFromResponse(response);
      console.warn('Token refresh failed:', message);
      handleAuthFailure();
      return false;
    }

    return true;
  } catch (error) {
    console.error('Token refresh failed:', error);
    handleAuthFailure();
    return false;
  }
}

/**
 * Check if we're on a public route that doesn't require authentication
 */
function isPublicRoute(): boolean {
  const pathname = window.location.pathname;
  const publicRoutes = [
    '/login',
    '/verify-email',
    '/reset-password',
    '/forgot-password',
    '/password-reset',
    '/resend-verification',
  ];
  if (publicRoutes.some(route => pathname.startsWith(route))) return true;
  return /^\/t\/[^/]+\/(login|verify-email|reset-password|forgot-password|password-reset|resend-verification)(?:\/|$)/.test(pathname);
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
  const isAuthEndpoint = prefixedUrl.includes('/auth/login') || 
                         prefixedUrl.includes('/auth/refresh') || 
                         prefixedUrl.includes('/auth/logout');

  // Don't intercept on public routes - let them handle 401s naturally
  const onPublicRoute = isPublicRoute();

  // Ensure credentials are included so cookies are sent
  const fetchOptions: RequestInit = { ...options, credentials: 'include' };

  // Make the original request with prefixed URL
  let response = await fetch(requestUrl, fetchOptions);

  // Extract CSRF token from response headers
  updateCsrfToken(response);

  // If we get a 401 and it's not an auth endpoint and not on a public route, try to refresh the token
  if (response.status === 401 && !isAuthEndpoint && !onPublicRoute) {
    if (!isRefreshing) {
      // Start refresh process
      isRefreshing = true;
      
      const success = await refreshAccessToken();
      isRefreshing = false;
      
      // Notify all waiting requests
      onTokenRefreshed(success);
      
      if (success) {
        // After refresh the accessToken cookie changed; get a fresh CSRF token
        // by making a lightweight GET that goes through CSRF middleware.
        try {
          const csrfResp = await fetch(applyApiBaseUrl('/api/auth/me'), { credentials: 'include' });
          updateCsrfToken(csrfResp);
        } catch { /* best effort */ }

        // Rebuild headers with the fresh CSRF token for the retry
        const retryHeaders = new Headers(getAuthHeaders());
        if (fetchOptions.headers) {
          const orig = new Headers(fetchOptions.headers);
          orig.forEach((v, k) => { if (k.toLowerCase() !== 'x-csrf-token') retryHeaders.set(k, v); });
        }
        response = await fetch(requestUrl, { ...fetchOptions, headers: retryHeaders });
        updateCsrfToken(response);
      } else {
        // Refresh failed, user will be redirected to login
        return response;
      }
    } else {
      // Wait for the ongoing refresh to complete
      const success = await new Promise<boolean>((resolve) => {
        subscribeTokenRefresh((ok) => {
          resolve(ok);
        });
      });
      
      if (success) {
        // Rebuild headers with fresh CSRF token after refresh
        const retryHeaders = new Headers(getAuthHeaders());
        if (fetchOptions.headers) {
          const orig = new Headers(fetchOptions.headers);
          orig.forEach((v, k) => { if (k.toLowerCase() !== 'x-csrf-token') retryHeaders.set(k, v); });
        }
        response = await fetch(requestUrl, { ...fetchOptions, headers: retryHeaders });
        updateCsrfToken(response);
      }
    }
  }

  return response;
}

/**
 * Helper to create auth headers with current token
 */
export function getAuthHeaders(): Record<string, string> {
  const tenantSlug = getTenantSlugFromPathname(window.location.pathname);
  return {
    'Content-Type': 'application/json',
    ...(tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  };
}
