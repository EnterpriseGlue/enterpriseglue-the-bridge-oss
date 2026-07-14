import { In, IsNull, type DataSource, type EntityManager, type Repository } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

type ExternalIdentityStore = DataSource | EntityManager;
type ExternalIdentityUpdate = Pick<ExternalIdentity,
  'tenantId' | 'providerId' | 'providerType' | 'subjectId' | 'directoryTenantId' |
  'userId' | 'emailHint' | 'status' | 'lastSeenAt' | 'updatedAt'
>;

export interface UpsertExternalIdentityInput {
  tenantId?: string | null;
  providerId: string;
  providerType: string;
  subjectId: string;
  directoryTenantId?: string | null;
  userId: string;
  emailHint?: string | null;
  now?: number;
}

export interface UnlinkExternalIdentityInput {
  tenantId?: string | null;
  providerId: string;
  subjectId: string;
  userId: string;
  now?: number;
}

export interface UnlinkExternalIdentityResult {
  identityId: string;
  providerManagedMembershipsRemoved: number;
  normalizedIdentitiesMarked: number;
  providerRefreshSessionsRevoked: number;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function optional(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function externalIdentityKey(input: Pick<UpsertExternalIdentityInput, 'tenantId' | 'providerId' | 'subjectId'>): string {
  const values = [input.tenantId || '', input.providerId, input.subjectId];
  return values.map((value) => `${value.length}:${value}`).join('|');
}

class ExternalIdentityService {
  async upsert(input: UpsertExternalIdentityInput): Promise<{ id: string; created: boolean }> {
    return this.upsertInStore(await getDataSource(), input);
  }

  async upsertWithManager(manager: EntityManager, input: UpsertExternalIdentityInput): Promise<{ id: string; created: boolean }> {
    return this.upsertInStore(manager, input);
  }

  async upsertInStore(store: ExternalIdentityStore, input: UpsertExternalIdentityInput): Promise<{ id: string; created: boolean }> {
    const tenantId = optional(input.tenantId);
    const providerId = required(input.providerId, 'providerId');
    const subjectId = required(input.subjectId, 'subjectId');
    const now = input.now ?? Date.now();
    const identityKey = externalIdentityKey({ tenantId, providerId, subjectId });
    const repo = store.getRepository(ExternalIdentity);
    const existing = await repo.findOne({ where: { identityKey } });
    const update = {
      tenantId,
      providerId,
      providerType: required(input.providerType, 'providerType'),
      subjectId,
      directoryTenantId: optional(input.directoryTenantId),
      userId: required(input.userId, 'userId'),
      emailHint: optional(input.emailHint)?.toLowerCase() ?? null,
      status: 'active',
      lastSeenAt: now,
      updatedAt: now,
    };
    if (existing) {
      return this.updateExisting(repo, existing, update);
    }
    const id = generateId();
    try {
      await repo.insert({ id, identityKey, ...update, linkedAt: now, createdAt: now });
      return { id, created: true };
    } catch (error) {
      // The canonical unique key makes competing first logins deterministic. Re-read
      // after a duplicate-key failure so a concurrent request cannot reassign a subject.
      const concurrentlyCreated = await repo.findOne({ where: { identityKey } });
      if (!concurrentlyCreated) throw error;
      return this.updateExisting(repo, concurrentlyCreated, update);
    }
  }

  async unlink(input: UnlinkExternalIdentityInput): Promise<UnlinkExternalIdentityResult> {
    const dataSource = await getDataSource();
    return dataSource.transaction((manager) => this.unlinkInStore(manager, input));
  }

  async unlinkInStore(store: ExternalIdentityStore, input: UnlinkExternalIdentityInput): Promise<UnlinkExternalIdentityResult> {
    const tenantId = optional(input.tenantId);
    const providerId = required(input.providerId, 'providerId');
    const subjectId = required(input.subjectId, 'subjectId');
    const userId = required(input.userId, 'userId');
    const now = input.now ?? Date.now();
    const identityKey = externalIdentityKey({ tenantId, providerId, subjectId });
    const identityRepo = store.getRepository(ExternalIdentity);
    const identity = await identityRepo.findOne({ where: { identityKey } });
    if (!identity) throw new Error('External identity link was not found');
    if (identity.userId !== userId) throw new Error('External identity is linked to a different user account');

    const tenantScope = tenantId ? { tenantId } : { tenantId: IsNull() };
    const mappings = await store.getRepository(IdentityEntitlementMapping).find({
      where: { ...tenantScope, providerId } as any,
      select: ['id'],
    });
    const sourceRefs = mappings.map((mapping) => `identity_mapping:${mapping.id}`);
    const memberships = sourceRefs.length > 0
      ? await store.getRepository(AuthzGroupMembership).delete({
        ...tenantScope,
        userId,
        source: 'identity_provider',
        sourceRef: In(sourceRefs),
      } as any)
      : { affected: 0 };
    const normalized = await store.getRepository(SsoNormalizedIdentity).update({
      ...tenantScope,
      providerId,
      providerSubject: subjectId,
      userId,
    } as any, {
      providerStatus: 'unlinked',
      lastProviderCheckAt: now,
      updatedAt: now,
    });
    const sessions = await store.getRepository(RefreshToken).update({
      userId,
      identityProviderId: providerId,
      revokedAt: IsNull(),
    }, { revokedAt: now });
    await identityRepo.update({ id: identity.id }, { status: 'unlinked', updatedAt: now });

    return {
      identityId: identity.id,
      providerManagedMembershipsRemoved: memberships.affected || 0,
      normalizedIdentitiesMarked: normalized.affected || 0,
      providerRefreshSessionsRevoked: sessions.affected || 0,
    };
  }

  private async updateExisting(
    repo: Repository<ExternalIdentity>,
    existing: Pick<ExternalIdentity, 'id' | 'userId' | 'status'>,
    update: ExternalIdentityUpdate,
  ): Promise<{ id: string; created: false }> {
    if (existing.status === 'unlinked') {
      throw new Error('External identity has been unlinked and requires administrator relinking');
    }
    if (existing.userId !== update.userId) {
      throw new Error('External identity is already linked to a different user account');
    }
    await repo.update({ id: existing.id }, update);
    return { id: existing.id, created: false };
  }
}

export const externalIdentityService = new ExternalIdentityService();
