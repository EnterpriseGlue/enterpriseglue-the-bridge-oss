/**
 * External registrations inherit their authorization boundary from the linked
 * engine because registration records themselves are not tenant-scoped.
 */
export function isExternalEngineTenantVisible(
  engineTenantId: string | null | undefined,
  requestTenantId: string | null | undefined,
): boolean {
  const tenantId = requestTenantId?.trim() || null;
  return !tenantId || !engineTenantId || engineTenantId === tenantId;
}
