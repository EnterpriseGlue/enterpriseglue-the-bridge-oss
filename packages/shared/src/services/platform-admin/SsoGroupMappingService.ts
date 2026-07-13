import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuditLog } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuditLog.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { SsoGroupMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoGroupMapping.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { logger } from '@enterpriseglue/shared/utils/logger.js';
import { IsNull, type DataSource, type EntityManager } from 'typeorm';
import {
  ssoClaimMatches,
  type ClaimType,
  type SsoClaimOperator,
  type SsoClaims,
  ssoClaimOperatorIsRegex,
  ssoClaimOperatorRequiresValue,
} from './SsoClaimsMappingService.js';
import { identityEntitlementMappingService, type IdentityEntitlementMatchOperator, type ManagedIdentityEntitlementMapping } from './IdentityEntitlementMappingService.js';

export type SsoGroupMappingSyncMode = 'authoritative' | 'additive';

type SsoGroupMappingStore = DataSource | EntityManager;

export interface SsoGroupMappingInput {
  tenantId?: string | null;
  providerId?: string | null;
  claimType: ClaimType;
  claimKey: string;
  claimValue: string;
  claimOperator?: SsoClaimOperator | null;
  targetGroupId: string;
  syncMode?: SsoGroupMappingSyncMode;
  priority?: number;
  isActive?: boolean;
  riskAcknowledged?: boolean;
}

export interface SsoGroupMappingView {
  id: string;
  tenantId: string | null;
  providerId: string | null;
  claimType: ClaimType;
  claimKey: string;
  claimValue: string;
  claimOperator: SsoClaimOperator | null;
  targetGroupId: string;
  targetGroupKey: string | null;
  targetGroupName: string | null;
  syncMode: SsoGroupMappingSyncMode;
  priority: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderNeutralSsoGroupMigrationResult {
  legacyMappingId: string;
  providerKey: string;
  identityMapping: ManagedIdentityEntitlementMapping;
  created: boolean;
}

function normalizeTenantId(tenantId?: string | null): string | null {
  const normalized = tenantId?.trim();
  return normalized || null;
}

function addTenantScopeFilter(qb: { andWhere: (...args: any[]) => any }, alias: string, tenantId?: string | null): void {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId) return;
  qb.andWhere(`(${alias}.tenantId = :tenantId OR ${alias}.tenantId IS NULL)`, { tenantId: normalizedTenantId });
}

function toView(mapping: SsoGroupMapping, group?: AuthzGroup | null): SsoGroupMappingView {
  return {
    id: mapping.id,
    tenantId: mapping.tenantId,
    providerId: mapping.providerId,
    claimType: mapping.claimType as ClaimType,
    claimKey: mapping.claimKey,
    claimValue: mapping.claimValue,
    claimOperator: mapping.claimOperator as SsoClaimOperator | null,
    targetGroupId: mapping.targetGroupId,
    targetGroupKey: group?.key || null,
    targetGroupName: group?.name || null,
    syncMode: mapping.syncMode as SsoGroupMappingSyncMode,
    priority: Number(mapping.priority),
    isActive: Boolean(mapping.isActive),
    createdAt: Number(mapping.createdAt),
    updatedAt: Number(mapping.updatedAt),
  };
}

async function recordSsoGroupMembershipAudit(
  dataSource: SsoGroupMappingStore,
  entry: {
    tenantId?: string | null;
    action: string;
    membershipId: string;
    userId: string;
    groupId: string;
    mappingId: string;
  }
): Promise<void> {
  try {
    await dataSource.getRepository(AuditLog).insert({
      id: generateId(),
      tenantId: normalizeTenantId(entry.tenantId),
      userId: entry.userId,
      action: entry.action,
      resourceType: 'authz_group_membership',
      resourceId: entry.membershipId,
      ipAddress: null,
      userAgent: null,
      details: JSON.stringify({
        membershipId: entry.membershipId,
        tenantId: normalizeTenantId(entry.tenantId),
        userId: entry.userId,
        groupId: entry.groupId,
        source: 'sso',
        sourceRef: entry.mappingId,
      }),
      createdAt: Date.now(),
    });
  } catch (error) {
    logger.error('Failed to write SSO group membership audit log:', error);
  }
}

function mappingUpdateAffectsMemberships(existing: SsoGroupMapping, merged: SsoGroupMappingInput): boolean {
  return (
    existing.tenantId !== normalizeTenantId(merged.tenantId) ||
    existing.providerId !== (merged.providerId || null) ||
    existing.claimType !== merged.claimType ||
    existing.claimKey !== merged.claimKey ||
    existing.claimValue !== merged.claimValue ||
    existing.claimOperator !== (merged.claimOperator || null) ||
    existing.targetGroupId !== merged.targetGroupId ||
    Boolean(existing.isActive) !== Boolean(merged.isActive ?? true)
  );
}

function providerNeutralEntitlementType(mapping: SsoGroupMapping): 'group' | 'role' {
  if (mapping.claimType === 'group') return 'group';
  if (mapping.claimType === 'role') return 'role';
  throw Errors.validation('Only legacy group and role claim mappings can be migrated automatically. Recreate custom and email-domain mappings as an explicit provider-neutral design.');
}

function providerNeutralMatchOperator(mapping: SsoGroupMapping): IdentityEntitlementMatchOperator {
  switch (mapping.claimOperator) {
    case null:
    case 'equals':
      return 'exact';
    case 'contains':
      return 'contains';
    case 'exists':
      return 'exists';
    default:
      throw Errors.validation('Only equals, contains, and exists legacy claim operators can be migrated automatically. Recreate wildcard, negated, and regex mappings explicitly.');
  }
}

class SsoGroupMappingServiceClass {
  async getAllMappings(tenantId?: string | null): Promise<SsoGroupMappingView[]> {
    const dataSource = await getDataSource();
    const normalizedTenantId = normalizeTenantId(tenantId);
    const mappings = await dataSource.getRepository(SsoGroupMapping).find({
      where: normalizedTenantId ? [{ tenantId: normalizedTenantId }, { tenantId: IsNull() }] : undefined,
      order: { priority: 'DESC', updatedAt: 'DESC' },
    });
    return this.toViews(dataSource, mappings);
  }

  async createMapping(input: SsoGroupMappingInput): Promise<{ id: string }> {
    const dataSource = await getDataSource();
    await this.validateMappingInput(dataSource, input);
    await this.validateRegexMappingRisk(dataSource, input);

    const id = generateId();
    const now = Date.now();
    await dataSource.getRepository(SsoGroupMapping).insert({
      id,
      tenantId: normalizeTenantId(input.tenantId),
      providerId: input.providerId || null,
      claimType: input.claimType,
      claimKey: input.claimKey,
      claimValue: input.claimValue || '',
      claimOperator: input.claimOperator || null,
      targetGroupId: input.targetGroupId,
      syncMode: input.syncMode || 'authoritative',
      priority: input.priority ?? 0,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });

    return { id };
  }

  /**
   * Creates an equivalent provider-neutral mapping while preserving the legacy
   * mapping. Administrators can validate the replacement before disabling the
   * old evaluator, so an incomplete migration never removes access.
   */
  async migrateToProviderNeutral(id: string, providerKey: string, tenantId?: string | null): Promise<ProviderNeutralSsoGroupMigrationResult> {
    const normalizedProviderKey = providerKey.trim();
    if (!normalizedProviderKey) throw Errors.validation('providerKey is required');
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const legacyMapping = await manager.getRepository(SsoGroupMapping).findOneBy({ id });
      if (!legacyMapping) throw Errors.notFound('SSO group mapping');
      const normalizedTenantId = normalizeTenantId(tenantId);
      if ((legacyMapping.tenantId || null) !== normalizedTenantId) {
        throw Errors.forbidden('The legacy SSO group mapping is not available in this tenant');
      }
      if (!legacyMapping.isActive) throw Errors.validation('Only active legacy SSO group mappings can be migrated');

      const entitlementType = providerNeutralEntitlementType(legacyMapping);
      const matchOperator = providerNeutralMatchOperator(legacyMapping);
      const externalId = matchOperator === 'exists' ? null : legacyMapping.claimValue.trim();
      if (matchOperator !== 'exists' && !externalId) throw Errors.validation('The legacy SSO group mapping has no claim value');

      const [provider, group] = await Promise.all([
        manager.getRepository(IdentityProvider).findOne({ where: normalizedTenantId ? { tenantId: normalizedTenantId, key: normalizedProviderKey } : { tenantId: IsNull(), key: normalizedProviderKey } }),
        manager.getRepository(AuthzGroup).findOneBy({ id: legacyMapping.targetGroupId }),
      ]);
      if (!provider) throw Errors.notFound('Identity provider not found');
      if (!group || group.isArchived) throw Errors.notFound('Target group');
      if ((group.tenantId || null) !== normalizedTenantId) throw Errors.validation('The legacy mapping target group and replacement identity provider must use the same tenant scope');

      const existing = await manager.getRepository(IdentityEntitlementMapping).findOne({
        where: {
          tenantId: normalizedTenantId || IsNull(), providerId: provider.id, targetGroupId: group.id,
          entitlementType, externalId, matchOperator, syncMode: legacyMapping.syncMode, isActive: true,
        } as any,
      });
      if (existing) {
        return {
          legacyMappingId: legacyMapping.id,
          providerKey: provider.key,
          created: false,
          identityMapping: {
            id: existing.id, providerId: provider.id, providerKey: provider.key, targetGroupId: group.id, targetGroupKey: group.key,
            entitlementType, externalId, matchOperator, syncMode: existing.syncMode as 'additive' | 'authoritative',
            isActive: Boolean(existing.isActive), configKey: existing.configKey, sourceRef: existing.sourceRef,
          },
        };
      }

      const identityMapping = await identityEntitlementMappingService.create({
        providerKey: provider.key,
        targetGroupKey: group.key,
        entitlementType,
        externalId,
        matchOperator,
        syncMode: legacyMapping.syncMode as 'additive' | 'authoritative',
      }, normalizedTenantId, manager);
      return { legacyMappingId: legacyMapping.id, providerKey: provider.key, identityMapping, created: true };
    });
  }

  async updateMapping(id: string, updates: Partial<SsoGroupMappingInput>): Promise<void> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(SsoGroupMapping);
    const existing = await repo.findOneBy({ id });
    if (!existing) {
      throw Errors.notFound('SSO group mapping');
    }

    const merged: SsoGroupMappingInput = {
      tenantId: updates.tenantId !== undefined ? updates.tenantId : existing.tenantId,
      providerId: updates.providerId !== undefined ? updates.providerId : existing.providerId,
      claimType: (updates.claimType || existing.claimType) as ClaimType,
      claimKey: updates.claimKey || existing.claimKey,
      claimValue: updates.claimValue !== undefined ? updates.claimValue : existing.claimValue,
      claimOperator: updates.claimOperator !== undefined
        ? updates.claimOperator
        : existing.claimOperator as SsoClaimOperator | null,
      targetGroupId: updates.targetGroupId || existing.targetGroupId,
      syncMode: (updates.syncMode || existing.syncMode) as SsoGroupMappingSyncMode,
      priority: updates.priority !== undefined ? updates.priority : existing.priority,
      isActive: updates.isActive !== undefined ? updates.isActive : existing.isActive,
    };

    await this.validateMappingInput(dataSource, merged);
    await this.validateRegexMappingRisk(dataSource, merged);
    const shouldRemoveExistingMemberships = mappingUpdateAffectsMemberships(existing, merged);

    await repo.update({ id }, {
      tenantId: normalizeTenantId(merged.tenantId),
      providerId: merged.providerId || null,
      claimType: merged.claimType,
      claimKey: merged.claimKey,
      claimValue: merged.claimValue || '',
      claimOperator: merged.claimOperator || null,
      targetGroupId: merged.targetGroupId,
      syncMode: merged.syncMode,
      priority: merged.priority ?? 0,
      isActive: merged.isActive ?? true,
      updatedAt: Date.now(),
    });

    if (shouldRemoveExistingMemberships) {
      await this.deleteMembershipsForMapping(dataSource, id);
    }
  }

  async deleteMapping(id: string): Promise<void> {
    const dataSource = await getDataSource();
    await this.deleteMembershipsForMapping(dataSource, id);
    await dataSource.getRepository(SsoGroupMapping).delete({ id });
  }

  async testClaims(claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<{
    matchedMappings: SsoGroupMappingView[];
    memberships: Array<{ groupId: string; mappingId: string }>;
  }> {
    const dataSource = await getDataSource();
    const mappings = await this.getMatchingMappings(dataSource, claims, providerId, tenantId);
    const matchedMappings = await this.toViews(dataSource, mappings);
    return {
      matchedMappings,
      memberships: mappings.map((mapping) => ({
        groupId: mapping.targetGroupId,
        mappingId: mapping.id,
      })),
    };
  }

  async syncMembershipsForUser(userId: string, claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> {
    const dataSource = await getDataSource();
    return this.syncMembershipsForUserInStore(dataSource, userId, claims, providerId, tenantId);
  }

  async syncMembershipsForUserWithManager(manager: EntityManager, userId: string, claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> {
    return this.syncMembershipsForUserInStore(manager, userId, claims, providerId, tenantId);
  }

  private async syncMembershipsForUserInStore(
    store: SsoGroupMappingStore,
    userId: string,
    claims: SsoClaims,
    providerId?: string,
    tenantId?: string | null
  ): Promise<{
    created: number;
    updated: number;
    removed: number;
  }> {
    const mappings = await this.getCandidateMappings(store, providerId, tenantId);
    const membershipRepo = store.getRepository(AuthzGroupMembership);
    let created = 0;
    let updated = 0;
    let removed = 0;
    const now = Date.now();

    for (const mapping of mappings) {
      const platformSettingsAllowMapping = await this.platformSettingsAllowRegexMapping(store, mapping);
      const matches = platformSettingsAllowMapping && ssoClaimMatches(claims, mapping);
      const desiredMembershipIds = new Set<string>();

      if (matches) {
        await this.validateTargetGroup(store, mapping.targetGroupId, tenantId ?? mapping.tenantId);
        const existingQb = membershipRepo.createQueryBuilder('membership')
          .where('membership.userId = :userId', { userId })
          .andWhere('membership.groupId = :groupId', { groupId: mapping.targetGroupId })
          .andWhere('membership.source = :source', { source: 'sso' })
          .andWhere('membership.sourceRef = :sourceRef', { sourceRef: mapping.id });
        addTenantScopeFilter(existingQb, 'membership', tenantId ?? mapping.tenantId);

        const existing = await existingQb.getOne();
        if (existing) {
          await membershipRepo.update({ id: existing.id }, { expiresAt: null, updatedAt: now });
          desiredMembershipIds.add(existing.id);
          updated += 1;
        } else {
          const id = generateId();
          await membershipRepo.insert({
            id,
            tenantId: normalizeTenantId(tenantId ?? mapping.tenantId),
            groupId: mapping.targetGroupId,
            userId,
            source: 'sso',
            sourceRef: mapping.id,
            expiresAt: null,
            createdById: null,
            createdAt: now,
            updatedAt: now,
          });
          await recordSsoGroupMembershipAudit(store, {
            tenantId: tenantId ?? mapping.tenantId,
            action: 'authz.sso_group_membership.create',
            membershipId: id,
            userId,
            groupId: mapping.targetGroupId,
            mappingId: mapping.id,
          });
          desiredMembershipIds.add(id);
          created += 1;
        }
      }

      if (mapping.syncMode === 'authoritative' || !platformSettingsAllowMapping) {
        const normalizedMembershipTenantId = normalizeTenantId(tenantId ?? mapping.tenantId);
        const staleMemberships = await membershipRepo.find({
          where: normalizedMembershipTenantId
            ? [
              { tenantId: normalizedMembershipTenantId, userId, source: 'sso', sourceRef: mapping.id },
              { tenantId: IsNull(), userId, source: 'sso', sourceRef: mapping.id },
            ]
            : { userId, source: 'sso', sourceRef: mapping.id },
        });
        const staleIds = staleMemberships
          .map((membership) => membership.id)
          .filter((id) => !desiredMembershipIds.has(id));
        for (const staleMembership of staleMemberships.filter((membership) => staleIds.includes(membership.id))) {
          await membershipRepo.delete({ id: staleMembership.id });
          await recordSsoGroupMembershipAudit(store, {
            tenantId: staleMembership.tenantId,
            action: 'authz.sso_group_membership.delete',
            membershipId: staleMembership.id,
            userId: staleMembership.userId,
            groupId: staleMembership.groupId,
            mappingId: mapping.id,
          });
          removed += 1;
        }
      }
    }

    return { created, updated, removed };
  }

  private async toViews(dataSource: SsoGroupMappingStore, mappings: SsoGroupMapping[]): Promise<SsoGroupMappingView[]> {
    const groupIds = Array.from(new Set(mappings.map((mapping) => mapping.targetGroupId)));
    const groups = groupIds.length
      ? await dataSource.getRepository(AuthzGroup).createQueryBuilder('group')
        .where('group.id IN (:...groupIds)', { groupIds })
        .getMany()
      : [];
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    return mappings.map((mapping) => toView(mapping, groupsById.get(mapping.targetGroupId)));
  }

  private async getMatchingMappings(dataSource: SsoGroupMappingStore, claims: SsoClaims, providerId?: string, tenantId?: string | null): Promise<SsoGroupMapping[]> {
    const mappings = await this.getCandidateMappings(dataSource, providerId, tenantId);
    const matchingMappings: SsoGroupMapping[] = [];
    for (const mapping of mappings) {
      if (ssoClaimMatches(claims, mapping) && await this.platformSettingsAllowRegexMapping(dataSource, mapping)) {
        matchingMappings.push(mapping);
      }
    }
    return matchingMappings;
  }

  private async getCandidateMappings(dataSource: SsoGroupMappingStore, providerId?: string, tenantId?: string | null): Promise<SsoGroupMapping[]> {
    const qb = dataSource.getRepository(SsoGroupMapping).createQueryBuilder('m')
      .where('m.isActive = :isActive', { isActive: true })
      .andWhere(providerId
        ? '(m.providerId IS NULL OR m.providerId = :providerId)'
        : 'm.providerId IS NULL',
        providerId ? { providerId } : {}
      )
      .orderBy('m.priority', 'DESC');
    addTenantScopeFilter(qb, 'm', tenantId);

    return qb.getMany();
  }

  private async validateMappingInput(dataSource: SsoGroupMappingStore, input: SsoGroupMappingInput): Promise<void> {
    if (!input.claimKey?.trim()) {
      throw Errors.validation('claimKey is required');
    }
    if (ssoClaimOperatorRequiresValue(input.claimOperator) && !input.claimValue?.trim()) {
      throw Errors.validation('claimValue is required');
    }
    if (!input.targetGroupId?.trim()) {
      throw Errors.validation('targetGroupId is required');
    }
    if (input.isActive === false) {
      return;
    }
    await this.validateTargetGroup(dataSource, input.targetGroupId, input.tenantId);
  }

  private async validateRegexMappingRisk(
    dataSource: SsoGroupMappingStore,
    input: Pick<SsoGroupMappingInput, 'claimOperator' | 'riskAcknowledged' | 'isActive'>
  ): Promise<void> {
    if (input.isActive === false || !ssoClaimOperatorIsRegex(input.claimOperator)) {
      return;
    }
    if (input.riskAcknowledged !== true) {
      throw Errors.validation('High-risk SSO regex claim mapping requires acknowledgement');
    }
    if (!(await this.platformSettingsAllowRegexMapping(dataSource, input))) {
      throw Errors.validation('High-risk SSO regex claim mappings are disabled by platform settings');
    }
  }

  private async platformSettingsAllowRegexMapping(
    dataSource: SsoGroupMappingStore,
    mapping: { claimOperator?: SsoClaimOperator | string | null }
  ): Promise<boolean> {
    if (!ssoClaimOperatorIsRegex(mapping.claimOperator)) {
      return true;
    }
    const settings = await dataSource.getRepository(PlatformSettings).findOneBy({ id: 'default' });
    return (settings as any)?.ssoRegexClaimMappingsEnabled ?? false;
  }

  private async validateTargetGroup(dataSource: SsoGroupMappingStore, groupId: string, tenantId?: string | null): Promise<AuthzGroup> {
    const group = await dataSource.getRepository(AuthzGroup).findOneBy({ id: groupId });
    if (!group || group.isArchived) {
      throw Errors.notFound('Target group');
    }

    const normalizedTenantId = normalizeTenantId(tenantId);
    if (normalizedTenantId && group.tenantId && group.tenantId !== normalizedTenantId) {
      throw Errors.forbidden('Target group is not available in this tenant');
    }
    if (!normalizedTenantId && group.tenantId) {
      throw Errors.validation('Global SSO group mappings cannot target tenant-scoped groups');
    }

    return group;
  }

  private async deleteMembershipsForMapping(dataSource: SsoGroupMappingStore, mappingId: string): Promise<void> {
    const membershipRepo = dataSource.getRepository(AuthzGroupMembership);
    const memberships = await membershipRepo.find({
      where: {
        source: 'sso',
        sourceRef: mappingId,
      },
    });
    await membershipRepo.delete({
      source: 'sso',
      sourceRef: mappingId,
    });
    for (const membership of memberships) {
      await recordSsoGroupMembershipAudit(dataSource, {
        tenantId: membership.tenantId,
        action: 'authz.sso_group_membership.delete',
        membershipId: membership.id,
        userId: membership.userId,
        groupId: membership.groupId,
        mappingId,
      });
    }
  }
}

export const ssoGroupMappingService = new SsoGroupMappingServiceClass();
