import { config } from '@enterpriseglue/shared/config/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { SsoProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoProvider.js';
import { Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';

type LegacyMigratableProviderType = 'microsoft' | 'google' | 'oidc';

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
    };
  };
  requirements: Array<'client_secret_reference' | 'identity_provider_redirect_uri' | 'identity_mappings' | 'legacy_provider_cutover'>;
  warnings: string[];
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
}

export const legacyIdentityProviderMigrationService = new LegacyIdentityProviderMigrationServiceClass();
