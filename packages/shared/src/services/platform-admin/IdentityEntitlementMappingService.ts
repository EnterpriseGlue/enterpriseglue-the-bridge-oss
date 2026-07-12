import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { ExternalEntitlement, NormalizedExternalIdentity } from './IdentityProviderAdapter.js';

export type IdentityEntitlementMatchOperator = 'exact' | 'contains' | 'exists';

export interface IdentityEntitlementMappingMatch {
  entitlementType: ExternalEntitlement['type'];
  externalId?: string | null;
  matchOperator: IdentityEntitlementMatchOperator;
}

export function matchesIdentityEntitlement(mapping: IdentityEntitlementMappingMatch, identity: NormalizedExternalIdentity): boolean {
  const candidates = identity.entitlements.filter((entitlement) => entitlement.type === mapping.entitlementType);
  if (mapping.matchOperator === 'exists') return candidates.length > 0;
  const expected = mapping.externalId?.trim();
  if (!expected) return false;
  return candidates.some((candidate) => mapping.matchOperator === 'exact'
    ? candidate.externalId === expected
    : candidate.externalId.includes(expected));
}

type MappingStore = DataSource | EntityManager;

function tenantWhere(tenantId?: string | null): object | object[] {
  return tenantId ? [{ tenantId }, { tenantId: IsNull() }] : {};
}

class IdentityEntitlementMappingService {
  async syncMemberships(userId: string, tenantId: string | null | undefined, identity: NormalizedExternalIdentity): Promise<{ created: number; removed: number }> {
    return this.syncMembershipsInStore(await getDataSource(), userId, tenantId, identity);
  }

  async syncMembershipsInStore(store: MappingStore, userId: string, tenantId: string | null | undefined, identity: NormalizedExternalIdentity): Promise<{ created: number; removed: number }> {
    const mappingRepo = store.getRepository(IdentityEntitlementMapping);
    const membershipRepo = store.getRepository(AuthzGroupMembership);
    const mappings = (await mappingRepo.find({ where: tenantWhere(tenantId) as any }))
      .filter((mapping) => mapping.providerId === identity.providerKey && mapping.isActive);
    let created = 0;
    let removed = 0;
    const now = Date.now();

    for (const mapping of mappings) {
      const sourceRef = `identity_mapping:${mapping.id}`;
      const matches = matchesIdentityEntitlement({
        entitlementType: mapping.entitlementType as ExternalEntitlement['type'],
        externalId: mapping.externalId,
        matchOperator: mapping.matchOperator as IdentityEntitlementMatchOperator,
      }, identity);
      const existing = await membershipRepo.findOne({ where: { userId, groupId: mapping.targetGroupId, source: 'identity_provider', sourceRef } });
      if (matches && !existing) {
        await membershipRepo.insert({ id: generateId(), tenantId: tenantId || null, userId, groupId: mapping.targetGroupId, source: 'identity_provider', sourceRef, expiresAt: null, createdById: null, createdAt: now, updatedAt: now });
        created += 1;
      }
      if (!matches && mapping.syncMode === 'authoritative' && existing) {
        await membershipRepo.delete({ id: existing.id });
        removed += 1;
      }
    }
    return { created, removed };
  }
}

export const identityEntitlementMappingService = new IdentityEntitlementMappingService();
