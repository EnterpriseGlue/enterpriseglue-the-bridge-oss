import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import type { EntityManager } from 'typeorm';

export const LEGACY_MAPPING_CONVERSION_AUDIT_ACTION = 'authz.legacy_mapping_conversion.create';

export type LegacyMappingConversionFamily = 'platform_role' | 'group' | 'engine_assignment';

export async function recordLegacyMappingConversion(
  manager: EntityManager,
  input: {
    tenantId?: string | null;
    actorId?: string | null;
    family: LegacyMappingConversionFamily;
    legacyMappingId: string;
    identityMappingId: string;
    providerId: string;
    providerKey: string;
    created: boolean;
  },
): Promise<void> {
  await manager.getRepository(AuditLog).insert({
    id: generateId(),
    tenantId: input.tenantId?.trim() || null,
    userId: input.actorId?.trim() || null,
    action: LEGACY_MAPPING_CONVERSION_AUDIT_ACTION,
    resourceType: 'sso_mapping',
    resourceId: input.legacyMappingId,
    ipAddress: null,
    userAgent: null,
    details: JSON.stringify({
      family: input.family,
      legacyMappingId: input.legacyMappingId,
      identityMappingId: input.identityMappingId,
      providerId: input.providerId,
      providerKey: input.providerKey,
      created: input.created,
    }),
    createdAt: Date.now(),
  });
}
