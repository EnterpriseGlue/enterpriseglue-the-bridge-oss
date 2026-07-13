import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoProvider.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { DEFAULT_PLATFORM_GROUP_IDS } from './AuthzGroupService.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { secretResolver } from './SecretResolver.js';
import { IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';

type LegacyMigratableProviderType = 'microsoft' | 'google' | 'oidc';
type EnvironmentMigratableProviderType = 'microsoft' | 'google';
type RepositoryManager = Pick<EntityManager, 'getRepository'>;

export interface LegacyIdentityProviderMigrationDraft {
  legacyProvider: {
    id: string;
    name: string;
    type: LegacyMigratableProviderType;
    enabled: boolean;
    clientSecretConfigured: boolean;
  };
  provider: {
    key: string;
    protocol: 'oidc';
    isEnabled: false;
    authenticationMode: 'direct';
    directoryTenantId: string | null;
    configuration: {
      issuerUrl: string;
      clientId: string;
      callbackUrl: string;
      scopes: string[];
      clientSecretRef?: string;
    };
  };
  requirements: Array<'client_secret_reference' | 'identity_provider_redirect_uri' | 'identity_mappings' | 'legacy_provider_cutover'>;
  warnings: string[];
}

export interface LegacyIdentityProviderMigrationReadiness {
  ready: boolean;
  targetProviderKey: string;
  activeMappingCount: number;
  checks: {
    targetExists: boolean;
    directOidc: boolean;
    enabled: boolean;
    secretReferenceConfigured: boolean;
    secretReferenceAvailable: boolean;
    activeMappingsConfigured: boolean;
  };
  blockers: Array<'target_not_found' | 'target_not_direct_oidc' | 'target_disabled' | 'secret_reference_missing' | 'secret_reference_unavailable' | 'identity_mappings_missing'>;
}

export interface LegacyIdentityProviderCutoverResult {
  legacyProvider: {
    id: string;
    name: string;
    type: LegacyMigratableProviderType;
  };
  targetProviderKey: string;
  legacyProviderDisabled: boolean;
  alreadyDisabled: boolean;
}

function parseScopes(rawScopes: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(rawScopes || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((scope): scope is string => typeof scope === 'string' && Boolean(scope.trim()));
    }
  } catch {
    // A malformed legacy value is handled by the safe default below.
  }
  return ['openid', 'profile', 'email'];
}

function issuerUrl(provider: SsoProvider): string | null {
  if (provider.type === 'google') return 'https://accounts.google.com';
  if (provider.type === 'microsoft') {
    return `https://login.microsoftonline.com/${encodeURIComponent(provider.tenantId?.trim() || 'common')}/v2.0`;
  }
  return provider.issuerUrl?.trim() || null;
}

function callbackUrl(): string {
  return new URL('/api/auth/identity/callback', `${config.frontendUrl.replace(/\/$/, '')}/`).toString();
}

class LegacyIdentityProviderMigrationServiceClass {
  /**
   * Builds a non-persistent draft. Legacy ciphertext is deliberately never
   * decrypted or returned; the administrator must supply a new secret ref.
   */
  async createDraft(legacyProviderId: string): Promise<LegacyIdentityProviderMigrationDraft> {
    const provider = await (await getDataSource()).getRepository(SsoProvider).findOneBy({ id: legacyProviderId.trim() });
    if (!provider) throw Errors.notFound('Legacy SSO provider not found');
    if (!['microsoft', 'google', 'oidc'].includes(provider.type)) {
      throw Errors.validation('Only legacy Microsoft, Google, and OIDC providers can be migrated to provider-neutral OIDC');
    }
    if (!provider.clientId?.trim()) {
      throw Errors.validation('The legacy provider has no client id and cannot produce an OIDC migration draft');
    }
    const issuer = issuerUrl(provider);
    if (!issuer) {
      throw Errors.validation('The legacy OIDC provider has no issuer URL and cannot produce a migration draft');
    }

    const type = provider.type as LegacyMigratableProviderType;
    const warnings = [
      'The generated provider is disabled to avoid two active login paths during migration.',
      'The legacy client secret is not copied. Add an external secret reference before enabling the new provider.',
      'Update the identity provider application redirect URI to the generated callback URL before cutover.',
      'Configure provider-neutral identity mappings before disabling the legacy provider.',
    ];

    return {
      legacyProvider: {
        id: provider.id,
        name: provider.name,
        type,
        enabled: provider.enabled,
        clientSecretConfigured: Boolean(provider.clientSecretEnc),
      },
      provider: {
        key: `legacy-${type}-${provider.id}`,
        protocol: 'oidc',
        isEnabled: false,
        authenticationMode: 'direct',
        directoryTenantId: type === 'microsoft' ? provider.tenantId?.trim() || null : null,
        configuration: {
          issuerUrl: issuer,
          clientId: provider.clientId.trim(),
          callbackUrl: callbackUrl(),
          scopes: parseScopes(provider.scopes),
        },
      },
      requirements: ['client_secret_reference', 'identity_provider_redirect_uri', 'identity_mappings', 'legacy_provider_cutover'],
      warnings,
    };
  }

  /** Lists safe drafts for legacy providers configured only through environment variables. */
  listEnvironmentDrafts(): LegacyIdentityProviderMigrationDraft[] {
    const drafts: LegacyIdentityProviderMigrationDraft[] = [];
    if (config.microsoftClientId && config.microsoftClientSecret && config.microsoftTenantId && config.microsoftRedirectUri) {
      drafts.push(this.createEnvironmentDraft('microsoft'));
    }
    if (config.googleClientId && config.googleClientSecret && config.googleRedirectUri) {
      drafts.push(this.createEnvironmentDraft('google'));
    }
    return drafts;
  }

  createEnvironmentDraft(type: EnvironmentMigratableProviderType): LegacyIdentityProviderMigrationDraft {
    const isMicrosoft = type === 'microsoft';
    const clientId = isMicrosoft ? config.microsoftClientId : config.googleClientId;
    const directoryTenantId = isMicrosoft ? config.microsoftTenantId : null;
    if (!clientId || (isMicrosoft && !directoryTenantId)) {
      throw Errors.validation(`The legacy ${type} environment configuration is incomplete`);
    }
    const secretReference = isMicrosoft ? 'env://MICROSOFT_CLIENT_SECRET' : 'env://GOOGLE_CLIENT_SECRET';
    const issuer = isMicrosoft
      ? `https://login.microsoftonline.com/${encodeURIComponent(directoryTenantId!)}/v2.0`
      : 'https://accounts.google.com';
    return {
      legacyProvider: {
        id: `environment:${type}`,
        name: isMicrosoft ? 'Microsoft Entra ID environment configuration' : 'Google environment configuration',
        type,
        enabled: true,
        clientSecretConfigured: true,
      },
      provider: {
        key: `legacy-environment-${type}`,
        protocol: 'oidc',
        isEnabled: false,
        authenticationMode: 'direct',
        directoryTenantId: directoryTenantId || null,
        configuration: {
          issuerUrl: issuer,
          clientId,
          callbackUrl: callbackUrl(),
          scopes: isMicrosoft ? ['openid', 'profile', 'email', 'User.Read'] : ['openid', 'profile', 'email'],
          clientSecretRef: secretReference,
        },
      },
      requirements: ['identity_provider_redirect_uri', 'identity_mappings', 'legacy_provider_cutover'],
      warnings: [
        'The generated provider is disabled to avoid two active login paths during migration.',
        `The generated configuration references ${secretReference}; the environment variable must remain available until the secret is moved to the configured secret provider.`,
        'Update the identity provider application redirect URI to the generated callback URL before cutover.',
        'Configure provider-neutral identity mappings before disabling the legacy provider.',
      ],
    };
  }

  private async getReadinessInStore(manager: RepositoryManager, input: { targetProviderKey: string; tenantId?: string | null }): Promise<LegacyIdentityProviderMigrationReadiness> {
    const key = input.targetProviderKey.trim();
    const tenantId = input.tenantId?.trim() || null;
    const provider = await manager.getRepository(IdentityProvider).findOne({ where: tenantId ? { key, tenantId } : { key, tenantId: IsNull() } });
    if (!provider) {
      return { ready: false, targetProviderKey: key, activeMappingCount: 0, checks: { targetExists: false, directOidc: false, enabled: false, secretReferenceConfigured: false, secretReferenceAvailable: false, activeMappingsConfigured: false }, blockers: ['target_not_found'] };
    }
    let rawConfiguration: Record<string, unknown> = {};
    try { rawConfiguration = JSON.parse(provider.configurationJson); } catch { rawConfiguration = {}; }
    const secretReference = typeof rawConfiguration.clientSecretRef === 'string' ? rawConfiguration.clientSecretRef.trim() : '';
    const secretAvailability = secretReference ? secretResolver.checkExternalReference(secretReference.startsWith('ref:') ? secretReference.slice(4) : secretReference) : { available: false };
    const activeMappingCount = await manager.getRepository(IdentityEntitlementMapping).count({ where: { tenantId: tenantId || IsNull(), providerId: provider.id, isActive: true } as any });
    const blockers: LegacyIdentityProviderMigrationReadiness['blockers'] = [];
    if (provider.protocol !== 'oidc' || provider.authenticationMode !== 'direct') blockers.push('target_not_direct_oidc');
    if (!provider.isEnabled) blockers.push('target_disabled');
    if (!secretReference) blockers.push('secret_reference_missing');
    else if (!secretAvailability.available) blockers.push('secret_reference_unavailable');
    if (!activeMappingCount) blockers.push('identity_mappings_missing');
    return {
      ready: blockers.length === 0,
      targetProviderKey: key,
      activeMappingCount,
      checks: { targetExists: true, directOidc: provider.protocol === 'oidc' && provider.authenticationMode === 'direct', enabled: provider.isEnabled, secretReferenceConfigured: Boolean(secretReference), secretReferenceAvailable: Boolean(secretAvailability.available), activeMappingsConfigured: activeMappingCount > 0 },
      blockers,
    };
  }

  async getReadiness(input: { targetProviderKey: string; tenantId?: string | null }): Promise<LegacyIdentityProviderMigrationReadiness> {
    return this.getReadinessInStore(await getDataSource(), input);
  }

  /**
   * Disables one persisted legacy provider only after its provider-neutral
   * replacement passes the same readiness checks shown to administrators.
   * Environment-backed legacy providers deliberately remain deployment-owned.
   */
  async cutover(input: { legacyProviderId: string; targetProviderKey: string; tenantId?: string | null }): Promise<LegacyIdentityProviderCutoverResult> {
    const legacyProviderId = input.legacyProviderId.trim();
    if (legacyProviderId.startsWith('environment:')) {
      throw Errors.validation('Environment-based legacy authentication must be disabled through deployment configuration after the provider-neutral replacement is validated');
    }

    const targetProviderKey = input.targetProviderKey.trim();
    const dataSource = await getDataSource();
    return dataSource.transaction(async (manager) => {
      const legacyProvider = await manager.getRepository(SsoProvider).findOneBy({ id: legacyProviderId });
      if (!legacyProvider) throw Errors.notFound('Legacy SSO provider not found');
      if (!['microsoft', 'google', 'oidc'].includes(legacyProvider.type)) {
        throw Errors.validation('Only legacy Microsoft, Google, and OIDC providers can be cut over to provider-neutral OIDC');
      }

      const readiness = await this.getReadinessInStore(manager, { targetProviderKey, tenantId: input.tenantId });
      if (!readiness.ready) {
        throw Errors.validation(`The provider-neutral replacement is not ready for cutover: ${readiness.blockers.join(', ')}`);
      }
      const targetProvider = await manager.getRepository(IdentityProvider).findOne({ where: input.tenantId ? { key: targetProviderKey, tenantId: input.tenantId } : { key: targetProviderKey, tenantId: IsNull() } });
      const defaultGroupId = legacyProvider.defaultRole === 'admin'
        ? DEFAULT_PLATFORM_GROUP_IDS.PLATFORM_ADMINISTRATORS
        : DEFAULT_PLATFORM_GROUP_IDS.AUTHENTICATED_USERS;
      const defaultMappingCount = targetProvider ? await manager.getRepository(IdentityEntitlementMapping).count({
        where: { tenantId: input.tenantId ? input.tenantId : IsNull(), providerId: targetProvider.id, targetGroupId: defaultGroupId, entitlementType: 'authenticated', externalId: 'authenticated', matchOperator: 'exact', syncMode: 'authoritative', isActive: true } as any,
      }) : 0;
      if (!defaultMappingCount) {
        throw Errors.validation('The provider-neutral replacement is missing the explicit authenticated identity default-role mapping');
      }

      const alreadyDisabled = !legacyProvider.enabled;
      if (!alreadyDisabled) {
        legacyProvider.enabled = false;
        legacyProvider.updatedAt = Date.now();
        await manager.getRepository(SsoProvider).save(legacyProvider);
      }

      return {
        legacyProvider: {
          id: legacyProvider.id,
          name: legacyProvider.name,
          type: legacyProvider.type as LegacyMigratableProviderType,
        },
        targetProviderKey,
        legacyProviderDisabled: !alreadyDisabled,
        alreadyDisabled,
      };
    });
  }
}

export const legacyIdentityProviderMigrationService = new LegacyIdentityProviderMigrationServiceClass();
