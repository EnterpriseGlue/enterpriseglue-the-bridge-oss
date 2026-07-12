import type { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';

type ExternalIdentityStore = DataSource | EntityManager;

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
      await repo.update({ id: existing.id }, update);
      return { id: existing.id, created: false };
    }
    const id = generateId();
    await repo.insert({ id, identityKey, ...update, linkedAt: now, createdAt: now });
    return { id, created: true };
  }
}

export const externalIdentityService = new ExternalIdentityService();
