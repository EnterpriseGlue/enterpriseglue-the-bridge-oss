import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  normalizeIdentityProviderSyncForMandatoryLogin,
  type IdentityProviderAuthenticationMode as SchemaIdentityProviderAuthenticationMode,
  type IdentityProviderType as SchemaIdentityProviderProtocol,
} from '@enterpriseglue/shared/schemas/platform-admin/identity.js';
import { isOssDefaultTenantId, OSS_DEFAULT_TENANT_ID } from '@enterpriseglue/shared/authz/tenant-scope.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { In, IsNull, type DataSource, type EntityManager, type FindOptionsWhere } from 'typeorm';
import { identityProviderMembershipSourceRefs } from './IdentityEntitlementMappingService.js';
import { validateIdentityProviderCallbackUrl, validateIdentityProviderEndpointUrl, validateIdentityProviderSamlLogoutCallbackUrl } from './IdentityProviderEndpointPolicy.js';

/** Compatibility exports; shared schemas remain the canonical vocabulary. */
export type IdentityProviderProtocol = SchemaIdentityProviderProtocol;
export type IdentityProviderAuthenticationMode = SchemaIdentityProviderAuthenticationMode;

export interface IdentityProviderInput {
  tenantId?: string | null;
  key: string;
  displayName?: string;
  organization?: string | null;
  displayOrder?: number;
  isPreferred?: boolean;
  loginDomains?: string[];
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

export type IdentityConnectorCapability = 'claim_only' | 'ldap_directory';

function isDirectLoginProvider(provider: IdentityProvider): boolean {
  return provider.isEnabled
    && provider.authenticationMode === 'direct'
    && (provider.protocol === 'oidc' || provider.protocol === 'saml' || provider.protocol === 'ldap');
}

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
function normalizeLoginDomains(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))).sort();
}
export function identityProviderKeyIdentity(tenantId: string | null | undefined, key: string): string {
  return `${tenantId || 'platform'}:${key.trim()}`;
}
export function identityProviderPreferenceIdentity(
  tenantId: string | null | undefined,
  providerId: string,
  preferred: boolean,
): string {
  return preferred ? `preferred:${tenantId || 'platform'}` : `provider:${providerId}`;
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
  if (protocol === 'oidc') {
    if (typeof configuration.issuerUrl !== 'string' || typeof configuration.clientId !== 'string') throw Errors.validation('OIDC providers require issuerUrl and clientId');
    if (typeof configuration.expectedAudience === 'string' && configuration.expectedAudience.trim() !== configuration.clientId.trim()) {
      throw Errors.validation('OIDC expectedAudience must equal clientId');
    }
    try {
      validateIdentityProviderEndpointUrl(configuration.issuerUrl, 'OIDC issuerUrl', ['https:']);
      if (typeof configuration.callbackUrl === 'string') validateIdentityProviderCallbackUrl(configuration.callbackUrl, 'oidc');
    } catch (error) { throw Errors.validation(error instanceof Error ? error.message : 'OIDC endpoint configuration is invalid'); }
  }
  if (protocol === 'saml') {
    for (const field of ['entityId', 'idpEntityId', 'callbackUrl', 'ssoUrl', 'signingCertificateRef']) {
      if (typeof configuration[field] !== 'string' || !String(configuration[field]).trim()) throw Errors.validation(`SAML providers require ${field}`);
    }
    try {
      validateIdentityProviderCallbackUrl(String(configuration.callbackUrl), 'saml');
      validateIdentityProviderEndpointUrl(String(configuration.ssoUrl), 'SAML ssoUrl', ['https:']);
      if (typeof configuration.metadataUrl === 'string' && configuration.metadataUrl.trim()) {
        validateIdentityProviderEndpointUrl(configuration.metadataUrl, 'SAML metadataUrl', ['https:']);
      }
      if (typeof configuration.sloUrl === 'string' && configuration.sloUrl.trim()) {
        validateIdentityProviderEndpointUrl(configuration.sloUrl, 'SAML sloUrl', ['https:']);
        if (typeof configuration.logoutCallbackUrl !== 'string' || !configuration.logoutCallbackUrl.trim()) {
          throw new Error('SAML logoutCallbackUrl is required when sloUrl is configured');
        }
        validateIdentityProviderSamlLogoutCallbackUrl(configuration.logoutCallbackUrl);
        if (typeof configuration.requestSigningPrivateKeyRef !== 'string' || !configuration.requestSigningPrivateKeyRef.trim()) {
          throw new Error('SAML requestSigningPrivateKeyRef is required when sloUrl is configured');
        }
      }
    } catch (error) { throw Errors.validation(error instanceof Error ? error.message : 'SAML endpoint configuration is invalid'); }
    if (configuration.signatureAlgorithm !== undefined && configuration.signatureAlgorithm !== 'sha256' && configuration.signatureAlgorithm !== 'sha512') {
      throw Errors.validation('SAML signatureAlgorithm must be sha256 or sha512');
    }
  }
  if (protocol === 'ldap') {
    if (typeof configuration.url !== 'string' || !String(configuration.url).startsWith('ldaps://')) throw Errors.validation('LDAP providers require an ldaps:// URL');
    try { validateIdentityProviderEndpointUrl(String(configuration.url), 'LDAP URL', ['ldaps:']); }
    catch (error) { throw Errors.validation(error instanceof Error ? error.message : 'LDAP endpoint configuration is invalid'); }
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

function ensureSync(protocol: IdentityProviderProtocol, sync: Record<string, unknown> | undefined): void {
  if (!sync) return;
  if (sync.triggers !== undefined && (!Array.isArray(sync.triggers) || sync.triggers.some((trigger) => !['login', 'scheduled', 'manual'].includes(String(trigger))))) {
    throw Errors.validation('Identity provider synchronization triggers are invalid');
  }
  if (Array.isArray(sync.triggers) && !sync.triggers.includes('login')) {
    throw Errors.validation('Sign-in reconciliation is mandatory');
  }
  if (sync.requiredForLogin !== undefined && sync.requiredForLogin !== true) {
    throw Errors.validation('Sign-in reconciliation is mandatory');
  }
  const connector = sync.connectorCapability;
  if (connector !== undefined && !['claim_only', 'ldap_directory'].includes(String(connector))) {
    throw Errors.validation('Unsupported identity connector capability');
  }
  if (connector === 'ldap_directory' && protocol !== 'ldap') {
    throw Errors.validation('LDAP directory reconciliation is available only for LDAP providers');
  }
  const scheduledTrigger = Array.isArray(sync.triggers) && sync.triggers.includes('scheduled');
  if (scheduledTrigger !== (sync.scheduled === true)) {
    throw Errors.validation('The scheduled flag and scheduled trigger must be enabled or disabled together');
  }
  if ((sync.scheduled === true || scheduledTrigger) && connector !== 'ldap_directory') {
    throw Errors.validation('Scheduled reconciliation is available only for an LDAP directory connector');
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
export async function archiveIdentityProviderInStore(manager: DataSource | EntityManager, provider: IdentityProvider): Promise<IdentityProviderArchiveResult> {
  const now = Date.now();
  const tenantScope = provider.tenantId ? { tenantId: provider.tenantId } : { tenantId: IsNull() };
  // Disable first. This row write serializes with provider-bound session issue
  // and provisioning transactions, so cleanup cannot be followed by a stale
  // callback creating a fresh provider session.
  await manager.getRepository(IdentityProvider).update({ id: provider.id }, { isEnabled: false, updatedAt: now });
  const mappingRepo = manager.getRepository(IdentityEntitlementMapping);
  const mappingWhere: FindOptionsWhere<IdentityEntitlementMapping> = { ...tenantScope, providerId: provider.id };
  const mappings = await mappingRepo.find({ where: mappingWhere });
  const mappingRefs = mappings.flatMap((mapping) => identityProviderMembershipSourceRefs(provider.id, mapping.id));

  const memberships = mappingRefs.length
    ? await manager.getRepository(AuthzGroupMembership).delete({
      ...tenantScope,
      source: 'identity_provider',
      sourceRef: In(mappingRefs),
    } as FindOptionsWhere<AuthzGroupMembership>)
    : { affected: 0 };
  const normalizedIdentities = await manager.getRepository(SsoNormalizedIdentity).update(
    { ...tenantScope, providerId: provider.id } as FindOptionsWhere<SsoNormalizedIdentity>,
    { providerStatus: 'provider_disabled', lastProviderCheckAt: now, updatedAt: now },
  );
  const externalIdentityRepo = manager.getRepository(ExternalIdentity);
  const externalIdentityWhere = { ...tenantScope, providerId: provider.id } as FindOptionsWhere<ExternalIdentity>;
  const linkedIdentities = await externalIdentityRepo.find({ where: externalIdentityWhere, select: ['userId'] });
  const externalIdentities = await externalIdentityRepo.update(
    externalIdentityWhere,
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
    const users = await userRepo.find({ where: { id: In(linkedUserIds) }, select: ['id', 'authSessionVersion'] });
    for (const user of users) {
      await userRepo.update({ id: user.id }, { authSessionVersion: (user.authSessionVersion || 0) + 1 });
      providerUserSessionsInvalidated += 1;
    }
  }
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
    return repo.find({
      where: normalized(tenantId) ? { tenantId: normalized(tenantId)! } : { tenantId: IsNull() },
      order: { displayOrder: 'ASC', displayName: 'ASC', key: 'ASC' },
    });
  }
  async getByKey(key: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    return (await getDataSource()).getRepository(IdentityProvider).findOne({ where: { providerKeyIdentity: identityProviderKeyIdentity(normalized(tenantId), key) } });
  }
  async getById(id: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    return (await getDataSource()).getRepository(IdentityProvider).findOne({ where: normalized(tenantId) ? { id: id.trim(), tenantId: normalized(tenantId)! } : { id: id.trim(), tenantId: IsNull() } });
  }
  async listEnabledDirectLoginProviders(tenantId?: string | null): Promise<IdentityProvider[]> {
    return (await this.list(tenantId)).filter(isDirectLoginProvider);
  }
  /**
   * A logged-out OSS browser has no request tenant yet. Prefer providers in
   * its canonical default tenant and retain platform rows as a compatibility
   * fallback for older provider records. Provider ids, rather than keys, are
   * used to begin the selected flow, so same-key rows cannot cross scopes.
   */
  async listEnabledDirectLoginProvidersForUnauthenticatedLogin(): Promise<IdentityProvider[]> {
    const [defaultTenantProviders, platformProviders] = await Promise.all([
      this.listEnabledDirectLoginProviders(OSS_DEFAULT_TENANT_ID),
      this.listEnabledDirectLoginProviders(null),
    ]);
    const defaultKeys = new Set(defaultTenantProviders.map((provider) => provider.key));
    return [...defaultTenantProviders, ...platformProviders.filter((provider) => !defaultKeys.has(provider.key))];
  }
  async getDirectLoginProviderByKey(key: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    if (normalized(tenantId) && !isOssDefaultTenantId(tenantId)) return this.getByKey(key, tenantId);
    return await this.getByKey(key, OSS_DEFAULT_TENANT_ID) || await this.getByKey(key, null);
  }
  async getDirectLoginProviderById(id: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    if (normalized(tenantId) && !isOssDefaultTenantId(tenantId)) return this.getById(id, tenantId);
    return await this.getById(id, OSS_DEFAULT_TENANT_ID) || await this.getById(id, null);
  }
  async upsert(input: IdentityProviderInput, store?: DataSource | EntityManager): Promise<IdentityProvider> {
    const tenantId = normalized(input.tenantId); const key = input.key.trim();
    if (!key) throw Errors.validation('Identity provider key is required');
    ensureConfig(input.protocol, input.configuration);
    ensureSync(input.protocol, input.sync);
    const sync = normalizeIdentityProviderSyncForMandatoryLogin(input.sync);
    if (!store) {
      const dataSource = await getDataSource();
      return dataSource.transaction((manager) => this.upsert(input, manager));
    }
    const repo = store.getRepository(IdentityProvider); const now = Date.now();
    const providerKeyIdentity = identityProviderKeyIdentity(tenantId, key);
    const existing = await repo.findOne({ where: { providerKeyIdentity } });
    const providerId = existing?.id || generateId();
    const displayName = normalized(input.displayName) || normalized(existing?.displayName) || key;
    const loginDomains = normalizeLoginDomains(input.loginDomains);
    const isPreferred = input.isPreferred ?? existing?.isPreferred ?? false;
    if (isPreferred) {
      const scopedProviders = await repo.find({
        where: tenantId ? { tenantId } : { tenantId: IsNull() },
        select: ['id'],
      });
      for (const scopedProvider of scopedProviders) {
        if (scopedProvider.id === providerId) continue;
        await repo.update({ id: scopedProvider.id }, {
          isPreferred: false,
          preferredScopeIdentity: identityProviderPreferenceIdentity(tenantId, scopedProvider.id, false),
        });
      }
    }
    const values = {
      displayName,
      organization: input.organization !== undefined ? normalized(input.organization) : existing?.organization ?? null,
      displayOrder: input.displayOrder ?? existing?.displayOrder ?? 0,
      isPreferred,
      preferredScopeIdentity: identityProviderPreferenceIdentity(tenantId, providerId, isPreferred),
      loginDomainsJson: loginDomains === undefined ? existing?.loginDomainsJson || '[]' : JSON.stringify(loginDomains),
      protocol: input.protocol,
      isEnabled: input.isEnabled ?? false,
      authenticationMode: input.authenticationMode ?? 'claims_only',
      directoryTenantId: normalized(input.directoryTenantId),
      configurationJson: json(input.configuration),
      syncJson: json(sync),
      ownershipMode: input.ownershipMode || 'manual',
      sourceRef: normalized(input.sourceRef),
      sourceHash: input.sourceHash ?? null,
      lastAppliedAt: input.lastAppliedAt ?? null,
      driftStatus: input.driftStatus ?? null,
      updatedAt: now,
    };
    if (existing) {
      const securityConfigurationChanged = existing.protocol !== values.protocol
        || existing.authenticationMode !== values.authenticationMode
        || existing.directoryTenantId !== values.directoryTenantId
        || existing.configurationJson !== values.configurationJson;
      // A disable or trust-boundary edit revokes sessions and provider-owned
      // memberships in the same transaction. A still-enabled trust edit is
      // re-enabled by the values update and must be proven again by sign-in.
      if (existing.isEnabled && (values.isEnabled === false || securityConfigurationChanged)) {
        await archiveIdentityProviderInStore(store, existing);
      }
      await repo.update({ id: existing.id }, values);
      return { ...existing, ...values } as IdentityProvider;
    }
    const provider = { id: providerId, tenantId, key, providerKeyIdentity, ...values, createdAt: now } as unknown as IdentityProvider;
    await repo.insert(provider); return provider;
  }
  async archive(key: string, tenantId?: string | null): Promise<IdentityProviderArchiveResult> {
    const provider = await this.getByKey(key, tenantId); if (!provider) throw Errors.notFound('Identity provider not found');
    return (await getDataSource()).transaction((manager) => archiveIdentityProviderInStore(manager, provider));
  }
}
export const identityProviderService = new IdentityProviderServiceClass();
