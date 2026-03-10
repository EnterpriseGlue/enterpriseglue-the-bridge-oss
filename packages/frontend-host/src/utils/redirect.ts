import { toSafeInternalPath } from './safeNavigation';

export function redirectTo(url: string): void {
  window.location.assign(toSafeInternalPath(url, '/'));
}

export function replaceAndReloadToInternalPath(url: string, fallback = '/'): void {
  const safePath = toSafeInternalPath(url, fallback);
  window.history.replaceState(window.history.state, '', safePath);
  window.location.reload();
}
