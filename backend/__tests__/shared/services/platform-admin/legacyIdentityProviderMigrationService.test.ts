import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { legacyIdentityProviderMigrationService } from '@enterpriseglue/shared/services/platform-admin/LegacyIdentityProviderMigrationService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('legacyIdentityProviderMigrationService', () => {
  const findOneBy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({ findOneBy }),
    });
  });

  it('creates a disabled Google OIDC draft without reading or returning the legacy secret', async () => {
    findOneBy.mockResolvedValue({
      id: 'legacy-google', name: 'Google Workspace', type: 'google', enabled: true,
      clientId: 'google-client', clientSecretEnc: 'enc:should-not-be-returned', tenantId: null,
      issuerUrl: null, scopes: '["openid","email","profile"]',
    });

    const draft = await legacyIdentityProviderMigrationService.createDraft('legacy-google');

    expect(draft).toEqual(expect.objectContaining({
      legacyProvider: expect.objectContaining({ type: 'google', clientSecretConfigured: true }),
      provider: expect.objectContaining({
        protocol: 'oidc', isEnabled: false, authenticationMode: 'direct',
        configuration: expect.objectContaining({ issuerUrl: 'https://accounts.google.com', clientId: 'google-client' }),
      }),
    }));
    expect(draft.requirements).toContain('client_secret_reference');
    expect(JSON.stringify(draft)).not.toContain('should-not-be-returned');
  });

  it('uses the Microsoft directory tenant in its issuer and draft metadata', async () => {
    findOneBy.mockResolvedValue({
      id: 'legacy-entra', name: 'Entra ID', type: 'microsoft', enabled: false,
      clientId: 'entra-client', clientSecretEnc: null, tenantId: 'directory-tenant',
      issuerUrl: null, scopes: 'invalid-json',
    });

    const draft = await legacyIdentityProviderMigrationService.createDraft('legacy-entra');

    expect(draft.provider.directoryTenantId).toBe('directory-tenant');
    expect(draft.provider.configuration.issuerUrl).toBe('https://login.microsoftonline.com/directory-tenant/v2.0');
    expect(draft.provider.configuration.scopes).toEqual(['openid', 'profile', 'email']);
  });

  it('rejects unsupported legacy provider types and incomplete OIDC records', async () => {
    findOneBy.mockResolvedValueOnce({ id: 'legacy-saml', type: 'saml' });
    await expect(legacyIdentityProviderMigrationService.createDraft('legacy-saml')).rejects.toThrow('Only legacy Microsoft, Google, and OIDC providers');

    findOneBy.mockResolvedValueOnce({ id: 'legacy-oidc', type: 'oidc', clientId: 'client', issuerUrl: null });
    await expect(legacyIdentityProviderMigrationService.createDraft('legacy-oidc')).rejects.toThrow('no issuer URL');
  });
});
