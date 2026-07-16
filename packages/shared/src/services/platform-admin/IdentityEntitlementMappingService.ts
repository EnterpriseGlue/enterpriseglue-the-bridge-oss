import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroup } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroup.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { PlatformSettings } from '@enterpriseglue/shared/infrastructure/persistence/entities/PlatformSettings.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { ExternalEntitlement, NormalizedExternalIdentity } from './IdentityProviderAdapter.js';

export type IdentityEntitlementMatchOperator = 'exact' | 'contains' | 'exists';

/**
 * OAuth scopes describe API delegation. They are normalized with other external
 * entitlements, but must not grant access to an interactive human identity.
 */
export const humanIdentityEntitlementTypes = ['group', 'role', 'attribute', 'authenticated'] as const;
export type HumanIdentityEntitlementType = typeof humanIdentityEntitlementTypes[number];

export function isHumanIdentityEntitlementType(value: string): value is HumanIdentityEntitlementType {
  return (humanIdentityEntitlementTypes as readonly string[]).includes(value);
}

export interface IdentityEntitlementMappingMatch {
  entitlementType: ExternalEntitlement['type'];
  externalId?: string | null;
  matchOperator: IdentityEntitlementMatchOperator;
}

export interface IdentityEntitlementMappingInput extends IdentityEntitlementMappingMatch {
  providerKey: string;
  targetGroupKey: string;
  syncMode?: 'additive' | 'authoritative';
  configKey?: string | null;
  configKeyIdentity?: string | null;
  sourceRef?: string | null;
  sourceHash?: string | null;
  lastAppliedAt?: number | null;
  driftStatus?: string | null;
}

export interface ManagedIdentityEntitlementMapping {
  id: string;
  providerId: string;
  providerKey: string;
  targetGroupId: string;
  targetGroupKey: string;
  entitlementType: ExternalEntitlement['type'];
  externalId: string | null;
  matchOperator: IdentityEntitlementMatchOperator;
  syncMode: 'additive' | 'authoritative';
  isActive: boolean;
  configKey: string | null;
  sourceRef: string | null;
}

export interface ConfiguredIdentityEntitlementMappingUpdate {
  providerId: string;
  previousProviderId?: string;
  configKey: string;
  configKeyIdentity: string;
  sourceRef: string;
  sourceHash: string;
  lastAppliedAt: number;
  driftStatus: string;
  entitlementType: ExternalEntitlement['type'];
  externalId: string | null;
  matchOperator: IdentityEntitlementMatchOperator;
  targetGroupId: string;
  syncMode: 'additive' | 'authoritative';
  isActive: boolean;
}

/**
 * Provider-managed memberships must retain both parts of their derivation.
 * The legacy mapping-only form remains readable during the staged migration.
 */
export function identityProviderMembershipSourceRef(providerId: string, mappingId: string): string {
  return `identity_provider:${providerId}:mapping:${mappingId}`;
}

export function identityProviderMembershipSourceRefs(providerId: string, mappingId: string): string[] {
  return [identityProviderMembershipSourceRef(providerId, mappingId), `identity_mapping:${mappingId}`];
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
  return tenantId ? { tenantId } : { tenantId: IsNull() };
}

function normalized(value: string, field: string): string {
  const result = value.trim();
  if (!result) throw Errors.validation(`${field} is required`);
  return result;
}

function validateInput(input: IdentityEntitlementMappingInput): void {
  normalized(input.providerKey, 'providerKey');
  normalized(input.targetGroupKey, 'targetGroupKey');
  if (!isHumanIdentityEntitlementType(input.entitlementType)) throw Errors.validation('OAuth scopes cannot be used for human identity mappings');
  if (!['exact', 'contains', 'exists'].includes(input.matchOperator)) throw Errors.validation('Unsupported entitlement match operator');
  if (input.matchOperator === 'exists' && input.externalId) throw Errors.validation('externalId is not allowed for exists mappings');
  if (input.matchOperator !== 'exists' && !input.externalId?.trim()) throw Errors.validation('externalId is required for exact and contains mappings');
  if (input.syncMode && !['additive', 'authoritative'].includes(input.syncMode)) throw Errors.validation('Unsupported identity mapping sync mode');
}

async function requireBroadEntitlementMappingsEnabled(store: MappingStore, matchOperator: IdentityEntitlementMatchOperator): Promise<void> {
  if (matchOperator === 'exact') return;
  const settings = await store.getRepository(PlatformSettings).findOneBy({ id: 'default' });
  if (!(settings as any)?.ssoBroadEntitlementMappingsEnabled) {
    throw Errors.forbidden('Broad identity entitlement mappings are disabled in Platform Settings');
  }
}

class IdentityEntitlementMappingService {
  async previewStoredSnapshots(input: Omit<IdentityEntitlementMappingInput, 'targetGroupKey'> & { limit?: number }, tenantId?: string | null): Promise<{ scanned: number; matches: number; nonMatches: number; failed: number; truncated: boolean; latestSnapshotAt: number | null; warnings: Array<'stored_snapshots_only' | 'no_active_snapshots' | 'truncated'> }> {
    validateInput({ ...input, targetGroupKey: 'preview-only' });
    const dataSource = await getDataSource();
    const provider = await dataSource.getRepository(IdentityProvider).findOne({ where: { ...tenantWhere(tenantId), key: normalized(input.providerKey, 'providerKey') } as any });
    if (!provider) throw Errors.notFound('Identity provider not found');
    const limit = Math.min(Math.max(input.limit ?? 500, 1), 5000);
    const snapshots = await dataSource.getRepository(SsoNormalizedIdentity).find({ where: { ...(tenantId ? { tenantId } : { tenantId: IsNull() }), providerId: provider.id, providerStatus: 'active' } as any, order: { lastSeenAt: 'DESC' }, take: limit + 1 });
    const selected = snapshots.slice(0, limit);
    const result = { scanned: selected.length, matches: 0, nonMatches: 0, failed: 0, truncated: snapshots.length > limit, latestSnapshotAt: selected.reduce<number | null>((latest, item) => latest === null || item.lastSeenAt > latest ? item.lastSeenAt : latest, null), warnings: ['stored_snapshots_only'] as Array<'stored_snapshots_only' | 'no_active_snapshots' | 'truncated'> };
    if (selected.length === 0) result.warnings.push('no_active_snapshots');
    if (result.truncated) result.warnings.push('truncated');
    const adapter = (await import('./IdentityProviderAdapter.js')).getIdentityProviderAdapter(provider.protocol);
    for (const snapshot of selected) {
      try {
        const claims = JSON.parse(snapshot.claimsJson) as Record<string, unknown>;
        const identity = adapter.normalizeIdentity({ providerKey: provider.id, subjectId: snapshot.providerSubject, claims, username: snapshot.email, email: snapshot.email, directoryTenantId: snapshot.providerTenantId, observedAt: snapshot.lastSeenAt });
        if (matchesIdentityEntitlement(input, identity)) result.matches += 1;
        else result.nonMatches += 1;
      } catch { result.failed += 1; }
    }
    return result;
  }

  async list(tenantId?: string | null): Promise<ManagedIdentityEntitlementMapping[]> {
    const dataSource = await getDataSource();
    const [mappings, providers, groups] = await Promise.all([
      dataSource.getRepository(IdentityEntitlementMapping).find({ where: tenantWhere(tenantId) as any, order: { createdAt: 'ASC' } }),
      dataSource.getRepository(IdentityProvider).find({ where: tenantWhere(tenantId) as any }),
      dataSource.getRepository(AuthzGroup).find({ where: tenantWhere(tenantId) as any }),
    ]);
    const providerById = new Map(providers.map((provider) => [provider.id, provider]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    return mappings.flatMap((mapping) => {
      const provider = providerById.get(mapping.providerId);
      const group = groupById.get(mapping.targetGroupId);
      if (!provider || !group) return [];
      return [{
        id: mapping.id, providerId: mapping.providerId, providerKey: provider.key, targetGroupId: mapping.targetGroupId,
        targetGroupKey: group.key, entitlementType: mapping.entitlementType as ExternalEntitlement['type'], externalId: mapping.externalId,
        matchOperator: mapping.matchOperator as IdentityEntitlementMatchOperator, syncMode: mapping.syncMode as 'additive' | 'authoritative',
        isActive: mapping.isActive, configKey: mapping.configKey, sourceRef: mapping.sourceRef,
      }];
    });
  }

  async create(input: IdentityEntitlementMappingInput, tenantId?: string | null, store?: MappingStore): Promise<ManagedIdentityEntitlementMapping> {
    validateInput(input);
    const dataSource = store || await getDataSource();
    await requireBroadEntitlementMappingsEnabled(dataSource, input.matchOperator);
    const [provider, group] = await Promise.all([
      dataSource.getRepository(IdentityProvider).findOne({ where: { ...tenantWhere(tenantId), key: normalized(input.providerKey, 'providerKey') } as any }),
      dataSource.getRepository(AuthzGroup).findOne({ where: { ...tenantWhere(tenantId), key: normalized(input.targetGroupKey, 'targetGroupKey'), isArchived: false } as any }),
    ]);
    if (!provider) throw Errors.notFound('Identity provider not found');
    if (!group) throw Errors.notFound('Authorization group not found');
    const repo = dataSource.getRepository(IdentityEntitlementMapping);
    const now = Date.now();
    const id = generateId();
    await repo.insert({
      id,
      tenantId: tenantId || null,
      providerId: provider.id,
      configKey: input.configKey ?? null,
      configKeyIdentity: input.configKeyIdentity ?? null,
      sourceRef: input.sourceRef ?? null,
      sourceHash: input.sourceHash ?? null,
      lastAppliedAt: input.lastAppliedAt ?? null,
      driftStatus: input.driftStatus ?? null,
      entitlementType: input.entitlementType,
      externalId: input.externalId?.trim() || null,
      matchOperator: input.matchOperator,
      targetGroupId: group.id,
      syncMode: input.syncMode || 'authoritative',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { id, providerId: provider.id, providerKey: provider.key, targetGroupId: group.id, targetGroupKey: group.key, entitlementType: input.entitlementType, externalId: input.externalId?.trim() || null, matchOperator: input.matchOperator, syncMode: input.syncMode || 'authoritative', isActive: true, configKey: input.configKey ?? null, sourceRef: input.sourceRef ?? null };
  }

  /** Applies an already-validated configuration mapping and clears only its prior derived memberships. */
  async reconcileConfiguredMapping(id: string, input: ConfiguredIdentityEntitlementMappingUpdate, tenantId?: string | null, store?: MappingStore): Promise<void> {
    const dataSource = store || await getDataSource();
    await dataSource.getRepository(AuthzGroupMembership).delete({
      ...tenantWhere(tenantId), source: 'identity_provider',
      sourceRef: In(identityProviderMembershipSourceRefs(input.previousProviderId || input.providerId, id)),
    } as any);
    await dataSource.getRepository(IdentityEntitlementMapping).update({ id }, {
      providerId: input.providerId,
      configKey: input.configKey,
      configKeyIdentity: input.configKeyIdentity,
      sourceRef: input.sourceRef,
      sourceHash: input.sourceHash,
      lastAppliedAt: input.lastAppliedAt,
      driftStatus: input.driftStatus,
      entitlementType: input.entitlementType,
      externalId: input.externalId,
      matchOperator: input.matchOperator,
      targetGroupId: input.targetGroupId,
      syncMode: input.syncMode,
      isActive: input.isActive,
      updatedAt: Date.now(),
    });
  }

  async disableConfiguredMapping(id: string, providerId: string, tenantId?: string | null, store?: MappingStore): Promise<void> {
    const dataSource = store || await getDataSource();
    await dataSource.getRepository(AuthzGroupMembership).delete({
      ...tenantWhere(tenantId), source: 'identity_provider', sourceRef: In(identityProviderMembershipSourceRefs(providerId, id)),
    } as any);
    await dataSource.getRepository(IdentityEntitlementMapping).update({ id }, { isActive: false, updatedAt: Date.now() });
  }

  async update(id: string, input: Partial<IdentityEntitlementMappingInput> & { isActive?: boolean }, tenantId?: string | null): Promise<ManagedIdentityEntitlementMapping> {
    const dataSource = await getDataSource();
    const repo = dataSource.getRepository(IdentityEntitlementMapping);
    const existing = await repo.findOne({ where: { ...tenantWhere(tenantId), id } as any });
    if (!existing) throw Errors.notFound('Identity mapping not found');
    if (existing.sourceRef) throw Errors.forbidden('This identity mapping is managed by configuration');
    const current = (await this.list(tenantId)).find((mapping) => mapping.id === id);
    if (!current) throw Errors.notFound('Identity mapping references a missing provider or group');
    if (current.entitlementType === 'scope' && input.entitlementType === undefined) {
      const attemptedChange = input.providerKey !== undefined || input.targetGroupKey !== undefined || input.externalId !== undefined
        || input.matchOperator !== undefined || input.syncMode !== undefined;
      if (attemptedChange || input.isActive !== false) throw Errors.validation('Legacy OAuth scope mappings cannot grant human access; replace or deactivate the mapping');
      await dataSource.transaction(async (manager) => {
        await manager.getRepository(AuthzGroupMembership).delete({
          ...tenantWhere(tenantId), source: 'identity_provider', sourceRef: In(identityProviderMembershipSourceRefs(existing.providerId, existing.id)),
        } as any);
        await manager.getRepository(IdentityEntitlementMapping).update({ id }, { isActive: false, updatedAt: Date.now() });
      });
      return { ...current, isActive: false };
    }
    const merged: IdentityEntitlementMappingInput = {
      providerKey: input.providerKey ?? current.providerKey, targetGroupKey: input.targetGroupKey ?? current.targetGroupKey,
      entitlementType: input.entitlementType ?? current.entitlementType, externalId: input.externalId === undefined ? current.externalId : input.externalId,
      matchOperator: input.matchOperator ?? current.matchOperator, syncMode: input.syncMode ?? current.syncMode,
    };
    validateInput(merged);
    const [provider, group] = await Promise.all([
      dataSource.getRepository(IdentityProvider).findOne({ where: { ...tenantWhere(tenantId), key: merged.providerKey } as any }),
      dataSource.getRepository(AuthzGroup).findOne({ where: { ...tenantWhere(tenantId), key: merged.targetGroupKey, isArchived: false } as any }),
    ]);
    if (!provider) throw Errors.notFound('Identity provider not found');
    if (!group) throw Errors.notFound('Authorization group not found');
    const isActive = input.isActive ?? existing.isActive;
    if (isActive && (current.matchOperator === 'exact' || !existing.isActive) && merged.matchOperator !== 'exact') {
      await requireBroadEntitlementMappingsEnabled(dataSource, merged.matchOperator);
    }
    const values = { providerId: provider.id, targetGroupId: group.id, entitlementType: merged.entitlementType, externalId: merged.externalId?.trim() || null, matchOperator: merged.matchOperator, syncMode: merged.syncMode || 'authoritative', isActive, updatedAt: Date.now() };
    const membershipDefinitionChanged = existing.providerId !== values.providerId
      || existing.targetGroupId !== values.targetGroupId
      || existing.entitlementType !== values.entitlementType
      || existing.externalId !== values.externalId
      || existing.matchOperator !== values.matchOperator
      || existing.syncMode !== values.syncMode
      || existing.isActive !== values.isActive;
    await dataSource.transaction(async (manager) => {
      if (membershipDefinitionChanged) {
        await manager.getRepository(AuthzGroupMembership).delete({
          ...tenantWhere(tenantId),
          source: 'identity_provider',
          sourceRef: In(identityProviderMembershipSourceRefs(existing.providerId, existing.id)),
        } as any);
      }
      await manager.getRepository(IdentityEntitlementMapping).update({ id }, values);
    });
    return { id, providerId: provider.id, providerKey: provider.key, targetGroupId: group.id, targetGroupKey: group.key, entitlementType: merged.entitlementType, externalId: merged.externalId?.trim() || null, matchOperator: merged.matchOperator, syncMode: merged.syncMode || 'authoritative', isActive, configKey: null, sourceRef: null };
  }

  async remove(id: string, tenantId?: string | null): Promise<void> {
    const dataSource = await getDataSource();
    await dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(IdentityEntitlementMapping);
      const mapping = await repo.findOne({ where: { ...tenantWhere(tenantId), id } as any });
      if (!mapping) throw Errors.notFound('Identity mapping not found');
      if (mapping.sourceRef) throw Errors.forbidden('This identity mapping is managed by configuration');
      await manager.getRepository(AuthzGroupMembership).delete({
        ...tenantWhere(tenantId), source: 'identity_provider', sourceRef: In(identityProviderMembershipSourceRefs(mapping.providerId, mapping.id)),
      } as any);
      await repo.delete({ id: mapping.id });
    });
  }

  async test(input: Omit<IdentityEntitlementMappingInput, 'targetGroupKey'> & { claims: Record<string, unknown> }, tenantId?: string | null): Promise<{ matches: boolean; entitlements: ExternalEntitlement[] }> {
    const dataSource = await getDataSource();
    const provider = await dataSource.getRepository(IdentityProvider).findOne({ where: { ...tenantWhere(tenantId), key: normalized(input.providerKey, 'providerKey') } as any });
    if (!provider) throw Errors.notFound('Identity provider not found');
    const subjectId = typeof input.claims.sub === 'string' ? input.claims.sub : 'mapping-preview';
    const identity = (await import('./IdentityProviderAdapter.js')).getIdentityProviderAdapter(provider.protocol as 'oidc' | 'saml' | 'ldap').normalizeIdentity({ providerKey: provider.id, subjectId, claims: input.claims });
    return { matches: matchesIdentityEntitlement(input, identity), entitlements: identity.entitlements };
  }

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
      const sourceRef = identityProviderMembershipSourceRef(mapping.providerId, mapping.id);
      const existing = await membershipRepo.findOne({ where: { userId, groupId: mapping.targetGroupId, source: 'identity_provider', sourceRef } })
        || await membershipRepo.findOne({ where: { userId, groupId: mapping.targetGroupId, source: 'identity_provider', sourceRef: `identity_mapping:${mapping.id}` } });
      if (!isHumanIdentityEntitlementType(mapping.entitlementType)) {
        if (existing) {
          await membershipRepo.delete({ id: existing.id });
          removed += 1;
        }
        continue;
      }
      const matches = matchesIdentityEntitlement({
        entitlementType: mapping.entitlementType,
        externalId: mapping.externalId,
        matchOperator: mapping.matchOperator as IdentityEntitlementMatchOperator,
      }, identity);
      if (matches && !existing) {
        await membershipRepo.insert({ id: generateId(), tenantId: tenantId || null, userId, groupId: mapping.targetGroupId, source: 'identity_provider', sourceRef, expiresAt: null, createdById: null, createdAt: now, updatedAt: now });
        created += 1;
      }
      if (matches && existing && existing.sourceRef !== sourceRef) {
        await membershipRepo.update({ id: existing.id }, { sourceRef, updatedAt: now });
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
