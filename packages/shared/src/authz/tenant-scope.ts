export const OSS_DEFAULT_TENANT_ID = 'tenant-default';
export const OSS_LEGACY_DEFAULT_TENANT_ID = 'default-tenant-id';
export const OSS_DEFAULT_TENANT_SLUG = 'default';

const OSS_DEFAULT_TENANT_IDS = new Set([
  OSS_DEFAULT_TENANT_ID,
  OSS_LEGACY_DEFAULT_TENANT_ID,
]);

export function isOssDefaultTenantId(tenantId?: string | null): boolean {
  const normalizedTenantId = tenantId?.trim() || null;
  return Boolean(normalizedTenantId && OSS_DEFAULT_TENANT_IDS.has(normalizedTenantId));
}

export function normalizeTenantIdForPersistence(tenantId?: string | null): string | null {
  const normalizedTenantId = tenantId?.trim();
  if (!normalizedTenantId) return null;
  return isOssDefaultTenantId(normalizedTenantId) ? OSS_DEFAULT_TENANT_ID : normalizedTenantId;
}

export function normalizeTenantIdForAuthz(tenantId?: string | null): string | null {
  const normalizedTenantId = tenantId?.trim();
  return normalizeTenantIdForPersistence(normalizedTenantId);
}

export function tenantIdsForAuthz(tenantId?: string | null): string[] {
  const normalizedTenantId = normalizeTenantIdForAuthz(tenantId);
  if (!normalizedTenantId) return [];
  return isOssDefaultTenantId(normalizedTenantId)
    ? [OSS_DEFAULT_TENANT_ID, OSS_LEGACY_DEFAULT_TENANT_ID]
    : [normalizedTenantId];
}

export function isTenantVisibleForAuthz(rowTenantId: string | null | undefined, tenantId?: string | null): boolean {
  const visibleTenantIds = tenantIdsForAuthz(tenantId);
  return visibleTenantIds.length === 0 || !rowTenantId || visibleTenantIds.includes(rowTenantId);
}
