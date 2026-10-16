import { config } from '../config';
import { XSRF_COOKIE_NAME, XSRF_HEADER_NAME } from '@enterpriseglue/shared/utils/xsrf.js';

export function assertApiRequestUrl(url: string): void {
  const resolved = new URL(url, window.location.href);
  const allowedOrigin = config.apiBaseUrl ? new URL(config.apiBaseUrl).origin : window.location.origin;
  if (!['http:', 'https:'].includes(resolved.protocol) || resolved.origin !== allowedOrigin || resolved.username || resolved.password) {
    throw new Error('Blocked request outside the configured API origin.');
  }
}

function readXsrfToken(): string | null {
  const matches = document.cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${XSRF_COOKIE_NAME}=`));
  if (matches.length > 1) throw new Error('Multiple XSRF cookies match; check cookie domain and path configuration.');
  if (!matches.length) return null;
  let token: string;
  try { token = decodeURIComponent(matches[0].slice(XSRF_COOKIE_NAME.length + 1)); } catch {
    throw new Error('XSRF cookie has invalid encoding.');
  }
  if (!token) return null;
  if (token.length > 8192 || !/^[\x21-\x7e]+$/.test(token)) throw new Error('XSRF cookie has an invalid token value.');
  return token;
}

/** Echo the current application cookie at dispatch, including refreshes and retries. */
export function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  assertApiRequestUrl(url);
  const headers = new Headers(options.headers);
  // Never retain a caller's stale token after rotation or cookie deletion.
  headers.delete(XSRF_HEADER_NAME);
  const token = readXsrfToken();
  if (token) headers.set(XSRF_HEADER_NAME, token);
  // Custom token headers can survive redirects; don't send them to an unapproved destination.
  return fetch(url, { ...options, headers, credentials: 'include', redirect: 'error' });
}
