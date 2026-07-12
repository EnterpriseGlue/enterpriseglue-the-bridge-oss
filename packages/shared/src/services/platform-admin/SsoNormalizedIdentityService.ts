import { DataSource, EntityManager } from 'typeorm';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { externalIdentityService } from './ExternalIdentityService.js';
import { getIdentityProviderAdapter, type IdentityProviderType } from './IdentityProviderAdapter.js';
import { identityEntitlementMappingService } from './IdentityEntitlementMappingService.js';
import type { SsoClaims } from './SsoClaimsMappingService.js';

type SsoNormalizedIdentityStore = DataSource | EntityManager;

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
  claims: SsoClaims;
  now?: number;
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
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
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

/**
 * Snapshots are used only for entitlement reconciliation. Never persist the
 * raw protocol payload: it can contain JWT assertions, SAML attributes, LDAP
 * directory data, or unrelated PII.
 */
export function allowlistedIdentityClaims(claims: SsoClaims): SsoClaims {
  const source = claims as Record<string, unknown>;
  const groups = normalizeStringArray(source.groups ?? source.group ?? source.memberOf).sort();
  const roles = normalizeStringArray(source.roles ?? source.role ?? source.appRoles).sort();
  const scopes = normalizeStringArray(source.scp ?? source.scope)
    .flatMap((scope) => scope.split(/\s+/))
    .filter(Boolean)
    .sort();
  return {
    ...(groups.length > 0 ? { groups } : {}),
    ...(roles.length > 0 ? { roles } : {}),
    ...(scopes.length > 0 ? { scp: Array.from(new Set(scopes)) } : {}),
  } as SsoClaims;
}

function adapterType(providerType: string): IdentityProviderType {
  if (providerType === 'saml') return 'saml';
  if (providerType === 'ldap') return 'ldap';
  return 'oidc';
}

class SsoNormalizedIdentityServiceClass {
  async upsertIdentity(input: UpsertSsoNormalizedIdentityInput): Promise<{ id: string; created: boolean }> {
    const dataSource = await getDataSource();
    return this.upsertIdentityInStore(dataSource, input);
  }

  async upsertIdentityWithManager(
    manager: EntityManager,
    input: UpsertSsoNormalizedIdentityInput
  ): Promise<{ id: string; created: boolean }> {
    return this.upsertIdentityInStore(manager, input);
  }

  private async upsertIdentityInStore(
    store: SsoNormalizedIdentityStore,
    input: UpsertSsoNormalizedIdentityInput
  ): Promise<{ id: string; created: boolean }> {
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

    const persistedClaims = allowlistedIdentityClaims(input.claims);
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
      claims: input.claims as Record<string, unknown>,
      username: update.email,
      email: update.email,
      directoryTenantId: update.providerTenantId,
      observedAt: now,
    });
    await identityEntitlementMappingService.syncMembershipsInStore(store, update.userId, tenantId, normalized);

    if (existing) {
      await repo.update({ id: existing.id }, update);
      await externalIdentityService.upsertInStore(store, {
        tenantId, providerId, providerType: update.providerType, subjectId: providerSubject,
        directoryTenantId: update.providerTenantId, userId: update.userId, emailHint: update.email, now,
      });
      return { id: existing.id, created: false };
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
    return { id, created: true };
  }
}

export const ssoNormalizedIdentityService = new SsoNormalizedIdentityServiceClass();
