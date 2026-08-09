import { DataSource, EntityManager, In, IsNull, MoreThan } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityReconciliationCheckpoint } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityReconciliationCheckpoint.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { externalIdentityService } from './ExternalIdentityService.js';
import { getIdentityProviderAdapter, type IdentityProviderType } from './IdentityProviderAdapter.js';
import { identityEntitlementMappingService, isHumanIdentityEntitlementType, matchesIdentityEntitlement, type IdentityEntitlementMatchOperator } from './IdentityEntitlementMappingService.js';
import { identityProviderMembershipSourceRefs } from './IdentityEntitlementMappingService.js';
import type { IdentityClaims } from './IdentityClaims.js';

export interface UpsertSsoNormalizedIdentityInput {
  tenantId?: string | null;
  providerId: string;
  providerType: string;
  providerSubject: string;
  subjectClaim?: string | null;
  providerTenantId?: string | null;
  userId: string;
  email?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  claims: IdentityClaims;
  authorizationAttributeKeys?: string[];
  now?: number;
}

export interface ReplayNormalizedIdentityMembershipsInput {
  tenantId?: string | null;
  providerIds: string[];
  limit?: number;
  cursor?: string | null;
}

export interface ReplayNormalizedIdentityMembershipsResult {
  scanned: number;
  created: number;
  removed: number;
  failed: number;
  truncated: boolean;
  nextCursor: string | null;
}

export interface PreviewNormalizedIdentityMembershipsInput {
  tenantId?: string | null;
  providerId: string;
  limit?: number;
  cursor?: string | null;
}

export interface PreviewNormalizedIdentityMembershipsResult {
  scanned: number;
  additions: number;
  removals: number;
  unchanged: number;
  failed: number;
  truncated: boolean;
  nextCursor: string | null;
  latestSnapshotAt: number | null;
  warnings: Array<'stored_snapshots_only' | 'no_active_snapshots' | 'truncated'>;
  mappings: Array<{
    mappingId: string;
    targetGroupId: string;
    additions: number;
    removals: number;
    unchanged: number;
  }>;
}

export interface DeactivateMissingProviderIdentitiesResult {
  identitiesDeactivated: number;
  providerManagedMembershipsRemoved: number;
  providerRefreshSessionsRevoked: number;
  providerUserSessionsInvalidated: number;
}

function normalizeNullableText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeStringArray(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Array.from(new Set(
    source
      .map((item) => typeof item === 'string' ? item.trim() : String(item ?? '').trim())
      .filter(Boolean)
  ));
}

function normalizeAuthorizationAttributeValues(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Array.from(new Set(
    source
      .map((item) => typeof item === 'string' ? item.trim() : String(item ?? '').trim())
      .filter(Boolean)
  ));
}

function stringifyJson(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function parseStoredClaims(value: string): IdentityClaims {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as IdentityClaims : {};
  } catch {
    return {};
  }
}

function decodeReplayCursor(value?: string | null): { lastSeenAt: number; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Number.isInteger(parsed?.lastSeenAt) || typeof parsed?.id !== 'string' || !parsed.id) throw new Error('Invalid cursor');
    return { lastSeenAt: parsed.lastSeenAt, id: parsed.id };
  } catch { throw new Error('Invalid replay cursor'); }
}

function encodeReplayCursor(identity: SsoNormalizedIdentity): string {
  return Buffer.from(JSON.stringify({ lastSeenAt: identity.lastSeenAt, id: identity.id })).toString('base64url');
}

/**
 * Snapshots are used only for entitlement reconciliation. Never persist the
 * raw protocol payload: it can contain JWT assertions, SAML attributes, LDAP
 * directory data, or unrelated PII.
 */
export function allowlistedIdentityClaims(claims: Record<string, unknown>, authorizationAttributeKeys: string[] = []): IdentityClaims {
  const source = claims;
  const groups = normalizeStringArray(source.groups ?? source.group ?? source.memberOf).sort();
  const roles = normalizeStringArray(source.roles ?? source.role ?? source.appRoles).sort();
  const scopes = normalizeStringArray(source.scp ?? source.scope)
    .flatMap((scope) => scope.split(/\s+/))
    .filter(Boolean)
    .sort();
  const attributeKeys = Array.from(new Set(authorizationAttributeKeys.map((key) => key.trim()).filter(Boolean))).sort();
  const attributes = Object.fromEntries(attributeKeys.flatMap((key) => {
    const values = normalizeAuthorizationAttributeValues(source[key]);
    return values.length > 0 ? [[key, values] as const] : [];
  }));
  return {
    ...(groups.length > 0 ? { groups } : {}),
    ...(roles.length > 0 ? { roles } : {}),
    ...(scopes.length > 0 ? { scp: Array.from(new Set(scopes)) } : {}),
    ...(Object.keys(attributes).length > 0 ? { __enterpriseglue_authz_attributes: attributes } : {}),
  } as IdentityClaims;
}

function adapterType(providerType: string): IdentityProviderType {
  if (providerType === 'saml') return 'saml';
  if (providerType === 'ldap') return 'ldap';
  return 'oidc';
}

class SsoNormalizedIdentityServiceClass {
  async upsertIdentity(input: UpsertSsoNormalizedIdentityInput): Promise<{ id: string; created: boolean; groupMembershipsCreated: number; groupMembershipsRemoved: number }> {
    const dataSource = await getDataSource();
    return dataSource.transaction((manager) => this.upsertIdentityInStore(manager, input));
  }

  async upsertIdentityWithManager(
    manager: EntityManager,
    input: UpsertSsoNormalizedIdentityInput
  ): Promise<{ id: string; created: boolean; groupMembershipsCreated: number; groupMembershipsRemoved: number }> {
    return this.upsertIdentityInStore(manager, input);
  }

  /**
   * Applies the absence half of one complete authoritative directory snapshot.
   * Callers must never invoke this after a truncated or failed enumeration.
   * Only memberships owned by mappings for this provider are removed; manual
   * and other-provider access remain intact. Session-version invalidation makes
   * the removal immediate for already-issued access tokens.
   */
  async deactivateMissingProviderIdentities(input: {
    tenantId?: string | null;
    providerId: string;
    seenProviderSubjects: string[];
    leaseId: string;
    providerUpdatedAt: number;
    providerProtocol: IdentityProvider['protocol'];
    providerAuthenticationMode: IdentityProvider['authenticationMode'];
    providerDirectoryTenantId: string | null;
    providerConfigurationJson: string;
    cursor: string | null;
    now?: number;
  }): Promise<DeactivateMissingProviderIdentitiesResult> {
    const tenantId = normalizeNullableText(input.tenantId);
    const providerId = normalizeRequiredText(input.providerId, 'providerId');
    const leaseId = normalizeRequiredText(input.leaseId, 'leaseId');
    if (!Number.isSafeInteger(input.providerUpdatedAt) || input.providerUpdatedAt < 0) throw new Error('providerUpdatedAt must be a non-negative safe integer');
    const seen = new Set(input.seenProviderSubjects.map((subject) => subject.trim()).filter(Boolean));
    const now = input.now ?? Date.now();
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      // Fence the entire destructive absence phase in the same transaction.
      // The no-op conditional writes acquire row locks before any membership
      // mutation; provider edits or a successor lease make this transaction
      // fail with zero absence writes.
      const providerClaim = await manager.getRepository(IdentityProvider).update({
        id: providerId,
        isEnabled: true,
        updatedAt: input.providerUpdatedAt,
        protocol: input.providerProtocol,
        authenticationMode: input.providerAuthenticationMode,
        directoryTenantId: input.providerDirectoryTenantId || IsNull(),
        configurationJson: input.providerConfigurationJson,
      }, { updatedAt: input.providerUpdatedAt });
      if (providerClaim.affected !== 1) throw new Error('LDAP provider changed before authoritative absence removal');
      const checkpointClaim = await manager.getRepository(IdentityReconciliationCheckpoint).update({
        providerId,
        leaseId,
        leaseExpiresAt: MoreThan(now),
      }, { updatedAt: now });
      if (checkpointClaim.affected !== 1) throw new Error('LDAP reconciliation lease was lost before authoritative absence removal');
      const completeCheckpoint = async (): Promise<void> => {
        const completed = await manager.getRepository(IdentityReconciliationCheckpoint).update({ providerId, leaseId }, {
          cursor: input.cursor,
          lastSuccessAt: now,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: now,
        });
        if (completed.affected !== 1) throw new Error('LDAP reconciliation lease was lost before checkpoint completion');
      };
      const tenantScope = tenantId ? { tenantId } : { tenantId: IsNull() };
      const normalizedRepo = manager.getRepository(SsoNormalizedIdentity);
      const active = await normalizedRepo.find({ where: { ...tenantScope, providerId, providerStatus: 'active' } as any });
      const missing = active.filter((identity) => !seen.has(identity.providerSubject));
      if (missing.length === 0) {
        await completeCheckpoint();
        return { identitiesDeactivated: 0, providerManagedMembershipsRemoved: 0, providerRefreshSessionsRevoked: 0, providerUserSessionsInvalidated: 0 };
      }

      const userIds = Array.from(new Set(missing.map((identity) => identity.userId)));
      const subjectIds = Array.from(new Set(missing.map((identity) => identity.providerSubject)));
      const mappings = await manager.getRepository(IdentityEntitlementMapping).find({ where: { ...tenantScope, providerId } as any });
      const sourceRefs = Array.from(new Set(mappings.flatMap((mapping) => identityProviderMembershipSourceRefs(providerId, mapping.id))));
      const chunks = <T>(values: T[]): T[][] => Array.from({ length: Math.ceil(values.length / 500) }, (_entry, index) => values.slice(index * 500, (index + 1) * 500));

      let membershipsRemoved = 0;
      for (const userChunk of chunks(userIds)) {
        for (const sourceChunk of chunks(sourceRefs)) {
          const result = await manager.getRepository(AuthzGroupMembership).delete({ ...tenantScope, userId: In(userChunk), source: 'identity_provider', sourceRef: In(sourceChunk) } as any);
          membershipsRemoved += result.affected || 0;
        }
      }
      let identitiesDeactivated = 0;
      for (const identityChunk of chunks(missing.map((identity) => identity.id))) {
        const result = await normalizedRepo.update({ id: In(identityChunk) }, { providerStatus: 'directory_inactive', lastProviderCheckAt: now, updatedAt: now });
        identitiesDeactivated += result.affected || 0;
      }
      for (const subjectChunk of chunks(subjectIds)) {
        await manager.getRepository(ExternalIdentity).update({ ...tenantScope, providerId, subjectId: In(subjectChunk) } as any, { status: 'directory_inactive', updatedAt: now });
      }
      let refreshSessionsRevoked = 0;
      for (const userChunk of chunks(userIds)) {
        const result = await manager.getRepository(RefreshToken).update({ userId: In(userChunk), identityProviderId: providerId, revokedAt: IsNull() }, { revokedAt: now });
        refreshSessionsRevoked += result.affected || 0;
      }
      let userSessionsInvalidated = 0;
      const userRepo = manager.getRepository(User);
      for (const userChunk of chunks(userIds)) {
        const users = await userRepo.find({ where: { id: In(userChunk) }, select: ['id', 'authSessionVersion'] });
        for (const user of users) {
          await userRepo.update({ id: user.id }, { authSessionVersion: (user.authSessionVersion || 0) + 1 });
          userSessionsInvalidated += 1;
        }
      }
      await completeCheckpoint();
      return {
        identitiesDeactivated,
        providerManagedMembershipsRemoved: membershipsRemoved,
        providerRefreshSessionsRevoked: refreshSessionsRevoked,
        providerUserSessionsInvalidated: userSessionsInvalidated,
      };
    });
  }

  /**
   * Replays sanitized snapshots only. It intentionally does not call an
   * external provider, so configuration changes can repair known memberships
   * without coupling an apply request to a directory scan.
   */
  async replayMemberships(input: ReplayNormalizedIdentityMembershipsInput): Promise<ReplayNormalizedIdentityMembershipsResult> {
    const providerIds = Array.from(new Set(input.providerIds.map((id) => id.trim()).filter(Boolean)));
    if (providerIds.length === 0) return { scanned: 0, created: 0, removed: 0, failed: 0, truncated: false, nextCursor: null };

    const limit = Math.min(Math.max(input.limit ?? 500, 1), 5000);
    const dataSource = await getDataSource();
    const cursor = decodeReplayCursor(input.cursor);
    const qb = dataSource.getRepository(SsoNormalizedIdentity).createQueryBuilder('identity')
      .where('identity.providerStatus = :providerStatus', { providerStatus: 'active' })
      .andWhere('identity.providerId IN (:...providerIds)', { providerIds });
    if (input.tenantId) qb.andWhere('identity.tenantId = :tenantId', { tenantId: input.tenantId });
    else qb.andWhere('identity.tenantId IS NULL');
    if (cursor) qb.andWhere('(identity.lastSeenAt > :cursorSeen OR (identity.lastSeenAt = :cursorSeen AND identity.id > :cursorId))', { cursorSeen: cursor.lastSeenAt, cursorId: cursor.id });
    const identities = await qb.orderBy('identity.lastSeenAt', 'ASC').addOrderBy('identity.id', 'ASC').take(limit + 1).getMany();
    const selected = identities.slice(0, limit);
    const result: ReplayNormalizedIdentityMembershipsResult = {
      scanned: selected.length,
      created: 0,
      removed: 0,
      failed: 0,
      truncated: identities.length > limit,
      nextCursor: identities.length > limit && selected.length > 0 ? encodeReplayCursor(selected[selected.length - 1]) : null,
    };

    for (const identity of selected) {
      try {
        const normalized = getIdentityProviderAdapter(adapterType(identity.providerType)).normalizeIdentity({
          providerKey: identity.providerId,
          subjectId: identity.providerSubject,
          claims: parseStoredClaims(identity.claimsJson) as Record<string, unknown>,
          username: identity.email,
          email: identity.email,
          directoryTenantId: identity.providerTenantId,
          observedAt: identity.lastSeenAt,
        });
        const change = await dataSource.transaction((manager) => identityEntitlementMappingService.syncMembershipsInStore(manager, identity.userId, identity.tenantId, normalized));
        result.created += change.created;
        result.removed += change.removed;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  /**
   * Plans membership changes from persisted, allowlisted identity snapshots.
   * It deliberately does not contact a provider or write memberships.
   */
  async previewMemberships(input: PreviewNormalizedIdentityMembershipsInput): Promise<PreviewNormalizedIdentityMembershipsResult> {
    const providerId = input.providerId.trim();
    if (!providerId) throw new Error('providerId is required');

    const limit = Math.min(Math.max(input.limit ?? 500, 1), 5000);
    const dataSource = await getDataSource();
    const cursor = decodeReplayCursor(input.cursor);
    const qb = dataSource.getRepository(SsoNormalizedIdentity).createQueryBuilder('identity')
      .where('identity.providerStatus = :providerStatus', { providerStatus: 'active' })
      .andWhere('identity.providerId = :providerId', { providerId });
    if (input.tenantId) qb.andWhere('identity.tenantId = :tenantId', { tenantId: input.tenantId });
    else qb.andWhere('identity.tenantId IS NULL');
    if (cursor) qb.andWhere('(identity.lastSeenAt > :cursorSeen OR (identity.lastSeenAt = :cursorSeen AND identity.id > :cursorId))', { cursorSeen: cursor.lastSeenAt, cursorId: cursor.id });
    const identities = await qb.orderBy('identity.lastSeenAt', 'ASC').addOrderBy('identity.id', 'ASC').take(limit + 1).getMany();
    const selected = identities.slice(0, limit);
    const tenantId = input.tenantId || null;
    const mappings = await dataSource.getRepository(IdentityEntitlementMapping).find();
    const activeMappings = mappings.filter((mapping) => mapping.providerId === providerId && mapping.isActive && (mapping.tenantId || null) === tenantId);
    const memberships = selected.length === 0 || activeMappings.length === 0
      ? []
      : await dataSource.getRepository(AuthzGroupMembership).find({
        where: {
          tenantId: tenantId || IsNull(),
          source: 'identity_provider',
          sourceRef: In(activeMappings.map((mapping) => `identity_mapping:${mapping.id}`)),
          userId: In(selected.map((identity) => identity.userId)),
        },
      });
    const membershipKeys = new Set(memberships
      .filter((membership) => (membership.tenantId || null) === tenantId && membership.source === 'identity_provider')
      .map((membership) => `${membership.userId}:${membership.groupId}:${membership.sourceRef || ''}`));
    const summaryByMappingId = new Map(activeMappings.map((mapping) => [mapping.id, {
      mappingId: mapping.id,
      targetGroupId: mapping.targetGroupId,
      additions: 0,
      removals: 0,
      unchanged: 0,
    }]));
    const result: PreviewNormalizedIdentityMembershipsResult = {
      scanned: selected.length,
      additions: 0,
      removals: 0,
      unchanged: 0,
      failed: 0,
      truncated: identities.length > limit,
      nextCursor: identities.length > limit && selected.length > 0 ? encodeReplayCursor(selected[selected.length - 1]) : null,
      latestSnapshotAt: selected.reduce<number | null>((latest, identity) => latest === null || identity.lastSeenAt > latest ? identity.lastSeenAt : latest, null),
      warnings: ['stored_snapshots_only'],
      mappings: [],
    };
    if (selected.length === 0) result.warnings.push('no_active_snapshots');
    if (result.truncated) result.warnings.push('truncated');

    for (const identity of selected) {
      try {
        const normalized = getIdentityProviderAdapter(adapterType(identity.providerType)).normalizeIdentity({
          providerKey: identity.providerId,
          subjectId: identity.providerSubject,
          claims: parseStoredClaims(identity.claimsJson) as Record<string, unknown>,
          username: identity.email,
          email: identity.email,
          directoryTenantId: identity.providerTenantId,
          observedAt: identity.lastSeenAt,
        });
        for (const mapping of activeMappings) {
          const summary = summaryByMappingId.get(mapping.id)!;
          const sourceRef = `identity_mapping:${mapping.id}`;
          const membershipKey = `${identity.userId}:${mapping.targetGroupId}:${sourceRef}`;
          const existing = membershipKeys.has(membershipKey);
          const matches = isHumanIdentityEntitlementType(mapping.entitlementType) && matchesIdentityEntitlement({
            entitlementType: mapping.entitlementType,
            externalId: mapping.externalId,
            matchOperator: mapping.matchOperator as IdentityEntitlementMatchOperator,
          }, normalized);
          if (matches && !existing) {
            result.additions += 1;
            summary.additions += 1;
          } else if (!matches && (mapping.syncMode === 'authoritative' || !isHumanIdentityEntitlementType(mapping.entitlementType)) && existing) {
            result.removals += 1;
            summary.removals += 1;
          } else if (existing) {
            result.unchanged += 1;
            summary.unchanged += 1;
          }
        }
      } catch {
        result.failed += 1;
      }
    }
    result.mappings = Array.from(summaryByMappingId.values()).sort((left, right) => left.mappingId.localeCompare(right.mappingId));
    return result;
  }

  private async upsertIdentityInStore(
    store: EntityManager,
    input: UpsertSsoNormalizedIdentityInput
  ): Promise<{ id: string; created: boolean; groupMembershipsCreated: number; groupMembershipsRemoved: number }> {
    const tenantId = normalizeNullableText(input.tenantId);
    const providerId = normalizeRequiredText(input.providerId, 'providerId');
    const providerSubject = normalizeRequiredText(input.providerSubject, 'providerSubject');
    const now = input.now ?? Date.now();
    const repo = store.getRepository(SsoNormalizedIdentity);
    const qb = repo.createQueryBuilder('identity')
      .where('identity.providerId = :providerId', { providerId })
      .andWhere('identity.providerSubject = :providerSubject', { providerSubject });

    if (tenantId) {
      qb.andWhere('identity.tenantId = :tenantId', { tenantId });
    } else {
      qb.andWhere('identity.tenantId IS NULL');
    }

    const persistedClaims = allowlistedIdentityClaims(input.claims, input.authorizationAttributeKeys);
    const groups = normalizeStringArray(persistedClaims.groups);
    const roles = normalizeStringArray(persistedClaims.roles);
    const update = {
      tenantId,
      providerId,
      providerType: normalizeRequiredText(input.providerType, 'providerType'),
      providerSubject,
      subjectClaim: normalizeNullableText(input.subjectClaim),
      providerTenantId: normalizeNullableText(input.providerTenantId),
      userId: normalizeRequiredText(input.userId, 'userId'),
      email: normalizeNullableText(input.email)?.toLowerCase() ?? null,
      displayName: normalizeNullableText(input.displayName),
      firstName: normalizeNullableText(input.firstName),
      lastName: normalizeNullableText(input.lastName),
      groupsJson: stringifyJson(groups, '[]'),
      rolesJson: stringifyJson(roles, '[]'),
      claimsJson: stringifyJson(persistedClaims, '{}'),
      providerStatus: 'active',
      lastSeenAt: now,
      updatedAt: now,
    };

    const existing = await qb.getOne();
    const normalized = getIdentityProviderAdapter(adapterType(update.providerType)).normalizeIdentity({
      providerKey: providerId,
      subjectId: providerSubject,
      claims: { ...input.claims, ...persistedClaims } as Record<string, unknown>,
      username: update.email,
      email: update.email,
      directoryTenantId: update.providerTenantId,
      observedAt: now,
    });
    const membershipSync = await identityEntitlementMappingService.syncMembershipsInStore(store, update.userId, tenantId, normalized);

    if (existing) {
      await repo.update({ id: existing.id }, update);
      await externalIdentityService.upsertInStore(store, {
        tenantId, providerId, providerType: update.providerType, subjectId: providerSubject,
        directoryTenantId: update.providerTenantId, userId: update.userId, emailHint: update.email, now,
      });
      return { id: existing.id, created: false, groupMembershipsCreated: membershipSync.created, groupMembershipsRemoved: membershipSync.removed };
    }

    const id = generateId();
    await repo.insert({
      id,
      ...update,
      lastProviderCheckAt: null,
      createdAt: now,
    });
    await externalIdentityService.upsertInStore(store, {
      tenantId, providerId, providerType: update.providerType, subjectId: providerSubject,
      directoryTenantId: update.providerTenantId, userId: update.userId, emailHint: update.email, now,
    });
    return { id, created: true, groupMembershipsCreated: membershipSync.created, groupMembershipsRemoved: membershipSync.removed };
  }
}

export const ssoNormalizedIdentityService = new SsoNormalizedIdentityServiceClass();
