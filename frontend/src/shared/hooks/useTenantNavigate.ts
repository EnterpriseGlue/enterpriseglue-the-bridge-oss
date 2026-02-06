/**
 * Shared hook for tenant-aware navigation.
 * Extracts the tenant slug from the current URL and provides:
 *  - toTenantPath(path)  — prepend /t/{slug} to an absolute path
 *  - tenantNavigate(path, opts?) — navigate with tenant prefix
 *  - tenantSlug          — the current tenant slug (or null)
 *  - effectivePathname   — the pathname with the tenant prefix stripped
 */

import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, type NavigateOptions } from 'react-router-dom';

export function useTenantNavigate() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const tenantSlug = tenantSlugMatch?.[1] ? decodeURIComponent(tenantSlugMatch[1]) : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const effectivePathname = tenantSlug ? (pathname.replace(/^\/t\/[^/]+/, '') || '/') : pathname;

  const toTenantPath = useCallback(
    (p: string) => (tenantSlug ? `${tenantPrefix}${p}` : p),
    [tenantSlug, tenantPrefix],
  );

  const tenantNavigate = useCallback(
    (path: string, options?: NavigateOptions) => {
      navigate(toTenantPath(path), options);
    },
    [navigate, toTenantPath],
  );

  return useMemo(
    () => ({ toTenantPath, tenantNavigate, tenantSlug, effectivePathname, navigate }),
    [toTenantPath, tenantNavigate, tenantSlug, effectivePathname, navigate],
  );
}
