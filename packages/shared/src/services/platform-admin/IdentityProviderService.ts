import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import type {
  IdentityProviderAuthenticationMode as SchemaIdentityProviderAuthenticationMode,
  IdentityProviderType as SchemaIdentityProviderProtocol,
} from '@enterpriseglue/shared/schemas/platform-admin/identity.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { In, IsNull, type DataSource, type EntityManager } from 'typeorm';
import { identityProviderMembershipSourceRefs } from './IdentityEntitlementMappingService.js';

/** Compatibility exports; shared schemas remain the canonical vocabulary. */
export type IdentityProviderProtocol = SchemaIdentityProviderProtocol;
export type IdentityProviderAuthenticationMode = SchemaIdentityProviderAuthenticationMode;

export interface IdentityProviderInput {
  tenantId?: string | null;
  key: string;
  protocol: IdentityProviderProtocol;
  isEnabled?: boolean;
  authenticationMode?: IdentityProviderAuthenticationMode;
  directoryTenantId?: string | null;
  configuration: Record<string, unknown>;
  sync?: Record<string, unknown>;
  ownershipMode?: string;
  sourceRef?: string | null;
  sourceHash?: string | null;
  lastAppliedAt?: number | null;
  driftStatus?: string | null;
}

export type IdentityConnectorCapability = 'claim_only' | 'ldap_directory' | 'scim' | 'graph';

export interface IdentityProviderArchiveResult {
  providerId: string;
  providerManagedMembershipsRemoved: number;
  normalizedIdentitiesMarked: number;
  externalIdentitiesMarked: number;
  providerRefreshSessionsRevoked: number;
  providerUserSessionsInvalidated: number;
}

function normalized(value?: string | null): string | null { return value?.trim() || null; }
function json(value: Record<string, unknown> | undefined): string { return JSON.stringify(value || {}); }
export function identityProviderKeyIdentity(tenantId: string | null | undefined, key: string): string {
  return `${tenantId || 'platform'}:${key.trim()}`;
}
function ensureAuthorizationAttributeKeys(configuration: Record<string, unknown>): void {
  const keys = configuration.authorizationAttributeKeys;
  if (keys === undefined) return;
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key))) {
    throw Errors.validation('authorizationAttributeKeys must contain valid claim names');
  }
  if (keys.length > 20 || new Set(keys).size !== keys.length) {
    throw Errors.validation('authorizationAttributeKeys must contain at most 20 unique claim names');
  }
}

function findRawSecretFields(value: unknown, path = 'configuration'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findRawSecretFields(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`;
    const current = /(?:secret|password|private.?key|certificate|token|api.?key|credential)$/i.test(key) && !/ref$/i.test(key)
      ? [childPath]
      : [];
    return [...current, ...findRawSecretFields(child, childPath)];
  });
}

function ensureConfig(protocol: IdentityProviderProtocol, configuration: Record<string, unknown>): void {
  if (!configuration || Array.isArray(configuration)) throw Errors.validation('Provider configuration is required');
  ensureAuthorizationAttributeKeys(configuration);
  const rawSecrets = findRawSecretFields(configuration);
  if (rawSecrets.length) throw Errors.validation(`Provider configuration must use secret references: ${rawSecrets.join(', ')}`);
  if (protocol === 'oidc' && (typeof configuration.issuerUrl !== 'string' || typeof configuration.clientId !== 'string')) throw Errors.validation('OIDC providers require issuerUrl and clientId');
  if (protocol === 'saml') {
    for (const field of ['entityId', 'callbackUrl', 'ssoUrl', 'signingCertificateRef']) {
      if (typeof configuration[field] !== 'string' || !String(configuration[field]).trim()) throw Errors.validation(`SAML providers require ${field}`);
    }
    if (configuration.signatureAlgorithm !== undefined && configuration.signatureAlgorithm !== 'sha256' && configuration.signatureAlgorithm !== 'sha512') {
      throw Errors.validation('SAML signatureAlgorithm must be sha256 or sha512');
    }
  }
  if (protocol === 'ldap') {
    if (typeof configuration.url !== 'string' || !String(configuration.url).startsWith('ldaps://')) throw Errors.validation('LDAP providers require an ldaps:// URL');
    for (const field of ['bindDn', 'bindPasswordRef', 'userBaseDn', 'userSearchFilter', 'groupBaseDn', 'groupIdAttribute']) {
      if (typeof configuration[field] !== 'string' || !String(configuration[field]).trim()) throw Errors.validation(`LDAP providers require ${field}`);
    }
    if (configuration.userEnumerationFilter !== undefined && (typeof configuration.userEnumerationFilter !== 'string' || !String(configuration.userEnumerationFilter).trim())) throw Errors.validation('LDAP userEnumerationFilter must be a non-empty LDAP filter');
    if (configuration.tlsTrustRef !== undefined && (typeof configuration.tlsTrustRef !== 'string' || !String(configuration.tlsTrustRef).trim())) throw Errors.validation('LDAP tlsTrustRef must be a non-empty secret reference');
    if (configuration.pageSize !== undefined && (!Number.isInteger(configuration.pageSize) || Number(configuration.pageSize) < 1 || Number(configuration.pageSize) > 1000)) throw Errors.validation('LDAP pageSize must be between 1 and 1000');
    if (!['memberOf', 'group_search'].includes(String(configuration.membershipMode))) throw Errors.validation('LDAP membershipMode must be memberOf or group_search');
    if (!String(configuration.userSearchFilter).includes('{username}')) throw Errors.validation('LDAP userSearchFilter must contain {username}');
  }
}

function ensureSync(sync: Record<string, unknown> | undefined): void {
  if (!sync) return;
  const connector = sync.connectorCapability;
  if (connector !== undefined && !['claim_only', 'ldap_directory', 'scim', 'graph'].includes(String(connector))) {
    throw Errors.validation('Unsupported identity connector capability');
  }
  if (connector === 'ldap_directory' && sync.scheduled === true && sync.intervalSeconds !== undefined && (!Number.isInteger(sync.intervalSeconds) || Number(sync.intervalSeconds) < 60)) {
    throw Errors.validation('Scheduled LDAP reconciliation intervalSeconds must be at least 60');
  }
}

/**
 * Archives a provider without deleting its configuration or any manual access.
 * Provider mappings stay available for an intentional re-enable, while only
 * memberships derived from those mappings are removed.
 */
export async function archiveIdentityProviderInStore(manager: EntityManager, provider: IdentityProvider): Promise<IdentityProviderArchiveResult> {
  const now = Date.now();
  const tenantScope = provider.tenantId ? { tenantId: provider.tenantId } : { tenantId: IsNull() };
  const mappingRepo = manager.getRepository(IdentityEntitlementMapping);
  const mappings = await mappingRepo.find({ where: { ...tenantScope, providerId: provider.id } as any });
  const mappingRefs = mappings.flatMap((mapping) => identityProviderMembershipSourceRefs(provider.id, mapping.id));

  const memberships = mappingRefs.length
    ? await manager.getRepository(AuthzGroupMembership).delete({
      ...tenantScope,
      source: 'identity_provider',
      sourceRef: In(mappingRefs),
    } as any)
    : { affected: 0 };
  const normalizedIdentities = await manager.getRepository(SsoNormalizedIdentity).update(
    { ...tenantScope, providerId: provider.id } as any,
    { providerStatus: 'provider_disabled', lastProviderCheckAt: now, updatedAt: now },
  );
  const externalIdentityRepo = manager.getRepository(ExternalIdentity);
  const linkedIdentities = await externalIdentityRepo.find({ where: { ...tenantScope, providerId: provider.id } as any, select: ['userId'] });
  const externalIdentities = await externalIdentityRepo.update(
    { ...tenantScope, providerId: provider.id } as any,
    { status: 'provider_disabled', updatedAt: now },
  );
  const refreshSessions = await manager.getRepository(RefreshToken).update(
    { identityProviderId: provider.id, revokedAt: IsNull() },
    { revokedAt: now },
  );
  const linkedUserIds = Array.from(new Set(linkedIdentities.map((identity) => identity.userId)));
  let providerUserSessionsInvalidated = 0;
  if (linkedUserIds.length) {
    const userRepo = manager.getRepository(User);
    const users = await userRepo.find({ where: { id: In(linkedUserIds) } as any, select: ['id', 'authSessionVersion'] });
    for (const user of users) {
      await userRepo.update({ id: user.id }, { authSessionVersion: (user.authSessionVersion || 0) + 1 });
      providerUserSessionsInvalidated += 1;
    }
  }
  await manager.getRepository(IdentityProvider).update({ id: provider.id }, { isEnabled: false, updatedAt: now });

  return {
    providerId: provider.id,
    providerManagedMembershipsRemoved: memberships.affected || 0,
    normalizedIdentitiesMarked: normalizedIdentities.affected || 0,
    externalIdentitiesMarked: externalIdentities.affected || 0,
    providerRefreshSessionsRevoked: refreshSessions.affected || 0,
    providerUserSessionsInvalidated,
  };
}

class IdentityProviderServiceClass {
  async list(tenantId?: string | null): Promise<IdentityProvider[]> {
    const repo = (await getDataSource()).getRepository(IdentityProvider);
    return repo.find({ where: normalized(tenantId) ? { tenantId: normalized(tenantId)! } : { tenantId: IsNull() }, order: { key: 'ASC' } });
  }
  async getByKey(key: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    return (await getDataSource()).getRepository(IdentityProvider).findOne({ where: { providerKeyIdentity: identityProviderKeyIdentity(normalized(tenantId), key) } });
  }
  async getById(id: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    return (await getDataSource()).getRepository(IdentityProvider).findOne({ where: normalized(tenantId) ? { id: id.trim(), tenantId: normalized(tenantId)! } : { id: id.trim(), tenantId: IsNull() } });
  }
  async listEnabledDirectLoginProviders(tenantId?: string | null): Promise<IdentityProvider[]> {
    return (await this.list(tenantId)).filter((provider) => provider.isEnabled && provider.authenticationMode === 'direct' && (provider.protocol === 'oidc' || provider.protocol === 'saml' || provider.protocol === 'ldap'));
  }
  async upsert(input: IdentityProviderInput, store?: DataSource | EntityManager): Promise<IdentityProvider> {
    const tenantId = normalized(input.tenantId); const key = input.key.trim();
    if (!key) throw Errors.validation('Identity provider key is required');
    ensureConfig(input.protocol, input.configuration);
    ensureSync(input.sync);
    const repo = (store || await getDataSource()).getRepository(IdentityProvider); const now = Date.now();
    const providerKeyIdentity = identityProviderKeyIdentity(tenantId, key);
    const existing = await repo.findOne({ where: { providerKeyIdentity } });
    const values = { protocol: input.protocol, isEnabled: input.isEnabled ?? false, authenticationMode: input.authenticationMode ?? 'claims_only', directoryTenantId: normalized(input.directoryTenantId), configurationJson: json(input.configuration), syncJson: json(input.sync), ownershipMode: input.ownershipMode || 'manual', sourceRef: normalized(input.sourceRef), sourceHash: input.sourceHash ?? null, lastAppliedAt: input.lastAppliedAt ?? null, driftStatus: input.driftStatus ?? null, updatedAt: now };
    if (existing) { await repo.update({ id: existing.id }, values); return { ...existing, ...values } as IdentityProvider; }
    const provider = { id: generateId(), tenantId, key, providerKeyIdentity, ...values, createdAt: now } as unknown as IdentityProvider;
    await repo.insert(provider); return provider;
  }
  async archive(key: string, tenantId?: string | null): Promise<IdentityProviderArchiveResult> {
    const provider = await this.getByKey(key, tenantId); if (!provider) throw Errors.notFound('Identity provider not found');
    return (await getDataSource()).transaction((manager) => archiveIdentityProviderInStore(manager, provider));
  }
}
export const identityProviderService = new IdentityProviderServiceClass();
