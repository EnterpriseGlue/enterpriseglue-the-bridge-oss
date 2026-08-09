import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOrdinaryLocalPasswordEnabled,
  LoginMethodService,
} from '@enterpriseglue/shared/services/platform-admin/LoginMethodService.js';

const platformSettingsService = vi.hoisted(() => ({ get: vi.fn() }));
const identityProviderService = vi.hoisted(() => ({
  listEnabledDirectLoginProviders: vi.fn(),
  listEnabledDirectLoginProvidersForUnauthenticatedLogin: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformSettingsService.js', () => ({ platformSettingsService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js', () => ({ identityProviderService }));

function settings(
  localPasswordLoginMode: 'auto' | 'enabled' | 'disabled' = 'auto',
  ssoProviderSelectionMode: 'auto_redirect_single' | 'chooser' | 'progressive' = 'auto_redirect_single',
) {
  return { localPasswordLoginMode, ssoProviderSelectionMode };
}

function provider(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    key: `identity.${id}`,
    displayName: `Provider ${id}`,
    organization: null,
    protocol: 'oidc',
    authenticationMode: 'direct',
    isEnabled: true,
    isPreferred: false,
    displayOrder: 0,
    loginDomainsJson: '[]',
    ...overrides,
  };
}

describe('LoginMethodService', () => {
  const service = new LoginMethodService();

  beforeEach(() => {
    vi.clearAllMocks();
    platformSettingsService.get.mockResolvedValue(settings());
    identityProviderService.listEnabledDirectLoginProviders.mockResolvedValue([]);
    identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin.mockResolvedValue([]);
  });

  it('keeps automatic local password login only while no direct provider exists', () => {
    expect(isOrdinaryLocalPasswordEnabled('auto', 0)).toBe(true);
    expect(isOrdinaryLocalPasswordEnabled('auto', 1)).toBe(false);
    expect(isOrdinaryLocalPasswordEnabled('enabled', 3)).toBe(true);
    expect(isOrdinaryLocalPasswordEnabled('disabled', 0)).toBe(false);
  });

  it('auto-redirects exactly one redirect provider when ordinary local login is disabled', async () => {
    identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin.mockResolvedValue([
      provider('entra', { displayName: 'Microsoft Entra ID', loginDomainsJson: '["example.com"]' }),
    ]);

    await expect(service.get()).resolves.toEqual({
      localPassword: { enabled: false },
      providerSelection: 'auto_redirect_single',
      autoRedirectProviderId: 'entra',
      providers: [{
        id: 'entra',
        key: 'identity.entra',
        displayName: 'Microsoft Entra ID',
        organization: null,
        protocol: 'oidc',
        loginMethod: 'redirect',
        preferred: false,
        loginDomains: ['example.com'],
      }],
      configurationStatus: 'ready',
    });
  });

  it('never auto-redirects LDAP password sign-in and orders a preferred provider first', async () => {
    platformSettingsService.get.mockResolvedValue(settings('disabled', 'auto_redirect_single'));
    identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin.mockResolvedValue([
      provider('ldap', { protocol: 'ldap', displayOrder: 1 }),
      provider('saml', { protocol: 'saml', isPreferred: true, displayOrder: 50 }),
    ]);

    const result = await service.get();
    expect(result.autoRedirectProviderId).toBeNull();
    expect(result.providers.map((item) => item.id)).toEqual(['saml', 'ldap']);
    expect(result.providers.find((item) => item.id === 'ldap')?.loginMethod).toBe('password');
  });

  it('reports a fail-closed configuration when local passwords are disabled without a provider', async () => {
    platformSettingsService.get.mockResolvedValue(settings('disabled', 'chooser'));
    await expect(service.get()).resolves.toMatchObject({
      localPassword: { enabled: false },
      providers: [],
      configurationStatus: 'no_login_method',
    });
  });

  it('uses the tenant-scoped provider lookup when a tenant is resolved', async () => {
    await service.get('tenant-1');
    expect(identityProviderService.listEnabledDirectLoginProviders).toHaveBeenCalledWith('tenant-1');
    expect(identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin).not.toHaveBeenCalled();
  });

  it('retains legacy platform-provider fallback for the canonical OSS tenant route', async () => {
    await service.get('tenant-default');
    expect(identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin).toHaveBeenCalledWith();
    expect(identityProviderService.listEnabledDirectLoginProviders).not.toHaveBeenCalled();
  });
});
