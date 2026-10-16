/** One application-issued, session-bound token transported in a cookie and a header. */
export const XSRF_COOKIE_NAME = 'XSRF-TOKEN';
export const XSRF_HEADER_NAME = 'X-XSRF-TOKEN';

/** Explicit scope for deployments whose frontend and API share a parent domain. */
export function normalizeXsrfCookieDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const domain = value.toLowerCase().replace(/^\./, '');
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) {
    throw new Error('EG_XSRF_COOKIE_DOMAIN must be a DNS domain without a scheme, port, or path.');
  }
  return domain;
}
