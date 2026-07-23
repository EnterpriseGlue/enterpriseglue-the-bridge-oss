import type { FindOptionsWhere } from 'typeorm';
import { IsNull, Not } from 'typeorm';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';

export type EngineTenancyVisibility = Pick<Engine, 'tenantId' | 'tenancyMode'>;

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

/**
 * Tenant views contain their explicitly owned dedicated engines plus shared
 * engines. Platform views may span explicitly owned engines across tenants plus
 * shared engines. Neither view includes a null-owned dedicated migration row.
 */
export function engineTenancyVisibilityWhere(
  where: FindOptionsWhere<Engine> = {},
  tenantId?: string | null
): FindOptionsWhere<Engine>[] {
  const normalizedTenantId = normalizeTenantId(tenantId);
  return normalizedTenantId
    ? [
      { ...where, tenantId: normalizedTenantId },
      { ...where, tenantId: IsNull(), tenancyMode: 'shared' },
    ]
    : [
      { ...where, tenantId: Not(IsNull()) },
      { ...where, tenantId: IsNull(), tenancyMode: 'shared' },
    ];
}

export function isEngineVisibleInTenancyContext(
  engine: EngineTenancyVisibility,
  tenantId?: string | null
): boolean {
  if (engine.tenancyMode === 'shared') {
    return !engine.tenantId;
  }
  if (engine.tenancyMode !== 'dedicated' || !engine.tenantId) {
    return false;
  }
  const normalizedTenantId = normalizeTenantId(tenantId);
  return !normalizedTenantId || engine.tenantId === normalizedTenantId;
}
