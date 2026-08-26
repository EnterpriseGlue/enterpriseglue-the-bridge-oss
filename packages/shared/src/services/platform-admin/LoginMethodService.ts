import type { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import {
  platformSettingsService,
  type PlatformSettingsData,
} from '@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js';
import {
  identityProviderService,
} from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import type {
  PublicLoginMethodsResponse,
  PublicLoginProvider,
} from '@enterpriseglue/shared/schemas/platform-admin/authz.js';
import { isOssDefaultTenantId } from '@enterpriseglue/shared/authz/tenant-scope.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { tenantLoginPolicyService } from './TenantLoginPolicyService.js';

function parseLoginDomains(provider: IdentityProvider): string[] {
  try {
    const parsed = JSON.parse(provider.loginDomainsJson || '[]');
    return Array.isArray(parsed)
      ? Array.from(new Set(parsed.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))).sort()
      : [];
  } catch {
    return [];
  }
}

export function isOrdinaryLocalPasswordEnabled(
  mode: PlatformSettingsData['localPasswordLoginMode'],
  directProviderCount: number,
): boolean {
  if (mode === 'enabled') return true;
  if (mode === 'disabled') return false;
  return directProviderCount === 0;
}

function toPublicProvider(provider: IdentityProvider): PublicLoginProvider {
  return {
    id: provider.id,
    key: provider.key,
    displayName: provider.displayName?.trim() || provider.key,
    organization: provider.organization?.trim() || null,
    protocol: provider.protocol,
    loginMethod: provider.protocol === 'ldap' ? 'password' : 'redirect',
    preferred: Boolean(provider.isPreferred),
    loginDomains: parseLoginDomains(provider),
  };
}

export class LoginMethodService {
  async get(tenantId?: string | null): Promise<PublicLoginMethodsResponse> {
    const tenantScoped = Boolean(tenantId && (config.tenancyMode === 'pooled' || !isOssDefaultTenantId(tenantId)));
    const [settings, tenantPolicy, providers] = await Promise.all([
      platformSettingsService.get(),
      tenantId && config.tenancyMode === 'pooled'
        ? tenantLoginPolicyService.get(tenantId)
        : Promise.resolve(null),
      tenantScoped
        ? identityProviderService.listEnabledDirectLoginProviders(tenantId!)
        : identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin(),
    ]);
    const sorted = [...providers].sort((left, right) => (
      Number(Boolean(right.isPreferred)) - Number(Boolean(left.isPreferred))
      || Number(left.displayOrder || 0) - Number(right.displayOrder || 0)
      || String(left.displayName || left.key).localeCompare(String(right.displayName || right.key))
      || left.key.localeCompare(right.key)
    ));
    const publicProviders = sorted.map(toPublicProvider);
    const localPasswordMode = tenantPolicy?.localPasswordMode || settings.localPasswordLoginMode;
    const providerSelectionMode = tenantPolicy?.providerSelectionMode || settings.ssoProviderSelectionMode;
    const localPasswordEnabled = isOrdinaryLocalPasswordEnabled(localPasswordMode, publicProviders.length);
    const singleRedirectProvider = publicProviders.length === 1 && publicProviders[0].loginMethod === 'redirect'
      ? publicProviders[0]
      : null;
    const autoRedirectProviderId = !localPasswordEnabled
      && providerSelectionMode === 'auto_redirect_single'
      && singleRedirectProvider
      ? singleRedirectProvider.id
      : null;

    return {
      localPassword: { enabled: localPasswordEnabled },
      providerSelection: providerSelectionMode,
      autoRedirectProviderId,
      providers: publicProviders,
      configurationStatus: localPasswordEnabled || publicProviders.length > 0 ? 'ready' : 'no_login_method',
    };
  }

  async ordinaryLocalPasswordEnabled(tenantId?: string | null): Promise<boolean> {
    return (await this.get(tenantId)).localPassword.enabled;
  }
}

export const loginMethodService = new LoginMethodService();
