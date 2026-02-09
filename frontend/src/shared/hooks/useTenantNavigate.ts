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
import { safeRelativePath, sanitizePathParam } from '../utils/sanitize';

export function useTenantNavigate() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const tenantSlugMatch = pathname.match(/^\/t\/([^/]+)(?:\/|$)/);
  const tenantSlug = tenantSlugMatch?.[1] ? sanitizePathParam(decodeURIComponent(tenantSlugMatch[1])) : null;
  const tenantPrefix = tenantSlug ? `/t/${encodeURIComponent(tenantSlug)}` : '';
  const effectivePathname = tenantSlug ? (pathname.replace(/^\/t\/[^/]+/, '') || '/') : pathname;

  const toTenantPath = useCallback(
    (p: string) => {
      const safe = safeRelativePath(p);
      return tenantSlug ? `${tenantPrefix}${safe}` : safe;
    },
    [tenantSlug, tenantPrefix],
  );

  const tenantNavigate = useCallback(
    (path: string, options?: NavigateOptions) => {
      navigate(toTenantPath(safeRelativePath(path)), options);
    },
    [navigate, toTenantPath],
  );

  return useMemo(
    () => ({ toTenantPath, tenantNavigate, tenantSlug, effectivePathname, navigate }),
    [toTenantPath, tenantNavigate, tenantSlug, effectivePathname, navigate],
  );
}
