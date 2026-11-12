import { applyApiBaseUrl, assertApiRequestUrl } from './apiFetch';
import { toSafeInternalPath } from './safeNavigation';

export function redirectTo(url: string): void {
  window.location.assign(toSafeInternalPath(url, '/'));
}

export function redirectToApi(url: string): void {
  const path = toSafeInternalPath(url, '');
  if (!path.startsWith('/api/')) throw new Error('Expected a local API path.');
  const destination = applyApiBaseUrl(path);
  assertApiRequestUrl(destination);
  window.location.assign(destination);
}

export function replaceAndReloadToInternalPath(url: string, fallback = '/'): void {
  const safePath = toSafeInternalPath(url, fallback);
  window.history.replaceState(window.history.state, '', safePath);
  window.location.reload();
}
