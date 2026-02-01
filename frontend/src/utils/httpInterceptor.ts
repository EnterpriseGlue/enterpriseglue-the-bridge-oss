/**
 * HTTP Interceptor
 * Intercepts fetch requests to handle authentication and token refresh
 * 
 * Unified Tenant Routing (Option A):
 * - All tenant-scoped API calls are automatically prefixed with /t/:tenantSlug
 * - OSS uses /t/default/* paths
 * - EE uses /t/:actualTenantSlug/* paths
 */

import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, USER_KEY } from '../constants/storageKeys';
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
let refreshSubscribers: Array<(token: string | null) => void> = [];

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
function subscribeTokenRefresh(callback: (token: string | null) => void): void {
  refreshSubscribers.push(callback);
}

/**
 * Notify all subscribers when token refresh completes
 */
function onTokenRefreshed(token: string | null): void {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

/**
 * Clear authentication and redirect to login
 */
function handleAuthFailure(): void {
  // Clear all auth data
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
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
async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  
  if (!refreshToken) {
    handleAuthFailure();
    return null;
  }

  try {
    const response = await fetch(applyApiBaseUrl(`${API_BASE_URL}/auth/refresh`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      const message = await getErrorMessageFromResponse(response);
      console.warn('Token refresh failed:', message);
      // Refresh token is invalid or expired
      handleAuthFailure();
      return null;
    }

    const data = await response.json();
    const newAccessToken = data.accessToken;
    
    // Store new access token
    localStorage.setItem(ACCESS_TOKEN_KEY, newAccessToken);
    
    return newAccessToken;
  } catch (error) {
    console.error('Token refresh failed:', error);
    handleAuthFailure();
    return null;
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

  // Make the original request with prefixed URL
  let response = await fetch(requestUrl, options);

  // Extract CSRF token from response headers
  updateCsrfToken(response);

  // If we get a 401 and it's not an auth endpoint and not on a public route, try to refresh the token
  if (response.status === 401 && !isAuthEndpoint && !onPublicRoute) {
    if (!isRefreshing) {
      // Start refresh process
      isRefreshing = true;
      
      const newToken = await refreshAccessToken();
      isRefreshing = false;
      
      // Notify all waiting requests
      onTokenRefreshed(newToken);
      
      if (newToken) {
        // Retry the original request with the new token
        const newHeaders = new Headers(options.headers);
        newHeaders.set('Authorization', `Bearer ${newToken}`);
        
        const newOptions: RequestInit = {
          ...options,
          headers: newHeaders,
        };
        
        response = await fetch(requestUrl, newOptions);
        updateCsrfToken(response);
      } else {
        // Refresh failed, user will be redirected to login
        return response;
      }
    } else {
      // Wait for the ongoing refresh to complete
      const newToken = await new Promise<string | null>((resolve) => {
        subscribeTokenRefresh((token) => {
          resolve(token);
        });
      });
      
      if (newToken) {
        // Retry with new token
        const newHeaders = new Headers(options.headers);
        newHeaders.set('Authorization', `Bearer ${newToken}`);
        
        const newOptions: RequestInit = {
          ...options,
          headers: newHeaders,
        };
        
        response = await fetch(requestUrl, newOptions);
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
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  const tenantSlug = getTenantSlugFromPathname(window.location.pathname);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantSlug ? { 'X-Tenant-Slug': tenantSlug } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  };
}
