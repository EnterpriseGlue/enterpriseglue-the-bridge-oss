import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { generateId } from '@enterpriseglue/shared/utils/id.js';
import { IsNull } from 'typeorm';

export type IdentityProviderProtocol = 'oidc' | 'saml' | 'ldap';
export type IdentityProviderAuthenticationMode = 'direct' | 'claims_only';

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
}

export type IdentityConnectorCapability = 'claim_only' | 'ldap_directory' | 'scim' | 'graph';

function normalized(value?: string | null): string | null { return value?.trim() || null; }
function json(value: Record<string, unknown> | undefined): string { return JSON.stringify(value || {}); }
function ensureConfig(protocol: IdentityProviderProtocol, configuration: Record<string, unknown>): void {
  if (!configuration || Array.isArray(configuration)) throw Errors.validation('Provider configuration is required');
  const rawSecrets = Object.keys(configuration).filter((key) => /(?:secret|password|private.?key)$/i.test(key) && !/ref$/i.test(key));
  if (rawSecrets.length) throw Errors.validation(`Provider configuration must use secret references: ${rawSecrets.join(', ')}`);
  if (protocol === 'oidc' && (typeof configuration.issuerUrl !== 'string' || typeof configuration.clientId !== 'string')) throw Errors.validation('OIDC providers require issuerUrl and clientId');
  if (protocol === 'saml') {
    for (const field of ['entityId', 'callbackUrl', 'ssoUrl', 'signingCertificateRef']) {
      if (typeof configuration[field] !== 'string' || !String(configuration[field]).trim()) throw Errors.validation(`SAML providers require ${field}`);
    }
  }
  if (protocol === 'ldap') {
    if (typeof configuration.url !== 'string' || !String(configuration.url).startsWith('ldaps://')) throw Errors.validation('LDAP providers require an ldaps:// URL');
    for (const field of ['bindDn', 'bindPasswordRef', 'userBaseDn', 'userSearchFilter', 'groupBaseDn', 'groupIdAttribute']) {
      if (typeof configuration[field] !== 'string' || !String(configuration[field]).trim()) throw Errors.validation(`LDAP providers require ${field}`);
    }
    if (configuration.userEnumerationFilter !== undefined && (typeof configuration.userEnumerationFilter !== 'string' || !String(configuration.userEnumerationFilter).trim())) throw Errors.validation('LDAP userEnumerationFilter must be a non-empty LDAP filter');
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

class IdentityProviderServiceClass {
  async list(tenantId?: string | null): Promise<IdentityProvider[]> {
    const repo = (await getDataSource()).getRepository(IdentityProvider);
    return repo.find({ where: normalized(tenantId) ? { tenantId: normalized(tenantId)! } : { tenantId: IsNull() }, order: { key: 'ASC' } });
  }
  async getByKey(key: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    return (await getDataSource()).getRepository(IdentityProvider).findOne({ where: normalized(tenantId) ? { key: key.trim(), tenantId: normalized(tenantId)! } : { key: key.trim(), tenantId: IsNull() } });
  }
  async getById(id: string, tenantId?: string | null): Promise<IdentityProvider | null> {
    return (await getDataSource()).getRepository(IdentityProvider).findOne({ where: normalized(tenantId) ? { id: id.trim(), tenantId: normalized(tenantId)! } : { id: id.trim(), tenantId: IsNull() } });
  }
  async listEnabledDirectLoginProviders(tenantId?: string | null): Promise<IdentityProvider[]> {
    return (await this.list(tenantId)).filter((provider) => provider.isEnabled && provider.authenticationMode === 'direct' && (provider.protocol === 'oidc' || provider.protocol === 'saml' || provider.protocol === 'ldap'));
  }
  async upsert(input: IdentityProviderInput): Promise<IdentityProvider> {
    const tenantId = normalized(input.tenantId); const key = input.key.trim();
    if (!key) throw Errors.validation('Identity provider key is required');
    ensureConfig(input.protocol, input.configuration);
    ensureSync(input.sync);
    const repo = (await getDataSource()).getRepository(IdentityProvider); const now = Date.now();
    const existing = await repo.findOne({ where: tenantId ? { tenantId, key } : { tenantId: IsNull(), key } });
    const values = { protocol: input.protocol, isEnabled: input.isEnabled ?? false, authenticationMode: input.authenticationMode ?? 'claims_only', directoryTenantId: normalized(input.directoryTenantId), configurationJson: json(input.configuration), syncJson: json(input.sync), ownershipMode: input.ownershipMode || 'manual', sourceRef: normalized(input.sourceRef), updatedAt: now };
    if (existing) { await repo.update({ id: existing.id }, values); return { ...existing, ...values } as IdentityProvider; }
    const provider = { id: generateId(), tenantId, key, ...values, createdAt: now } as unknown as IdentityProvider;
    await repo.insert(provider); return provider;
  }
  async archive(key: string, tenantId?: string | null): Promise<void> {
    const provider = await this.getByKey(key, tenantId); if (!provider) throw Errors.notFound('Identity provider not found');
    await (await getDataSource()).getRepository(IdentityProvider).update({ id: provider.id }, { isEnabled: false, updatedAt: Date.now() });
  }
}
export const identityProviderService = new IdentityProviderServiceClass();
