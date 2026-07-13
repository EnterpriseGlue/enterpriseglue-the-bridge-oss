import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { legacyIdentityProviderMigrationService } from '@enterpriseglue/shared/services/platform-admin/LegacyIdentityProviderMigrationService.js';

const testConfig = vi.hoisted(() => ({
  frontendUrl: 'https://app.example.test',
  microsoftClientId: undefined as string | undefined,
  microsoftClientSecret: undefined as string | undefined,
  microsoftTenantId: undefined as string | undefined,
  microsoftRedirectUri: undefined as string | undefined,
  googleClientId: undefined as string | undefined,
  googleClientSecret: undefined as string | undefined,
  googleRedirectUri: undefined as string | undefined,
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config: testConfig }));

describe('legacyIdentityProviderMigrationService', () => {
  const findOneBy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(testConfig, {
      microsoftClientId: undefined, microsoftClientSecret: undefined, microsoftTenantId: undefined, microsoftRedirectUri: undefined,
      googleClientId: undefined, googleClientSecret: undefined, googleRedirectUri: undefined,
    });
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

  it('creates disabled environment-backed drafts with opaque environment references', () => {
    Object.assign(testConfig, {
      microsoftClientId: 'entra-client', microsoftClientSecret: 'not-exported', microsoftTenantId: 'directory-tenant', microsoftRedirectUri: 'https://old.example.test/api/auth/microsoft/callback',
      googleClientId: 'google-client', googleClientSecret: 'not-exported', googleRedirectUri: 'https://old.example.test/api/auth/google/callback',
    });

    const drafts = legacyIdentityProviderMigrationService.listEnvironmentDrafts();

    expect(drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: expect.objectContaining({ key: 'legacy-environment-microsoft', isEnabled: false, configuration: expect.objectContaining({ clientSecretRef: 'env://MICROSOFT_CLIENT_SECRET' }) }) }),
      expect.objectContaining({ provider: expect.objectContaining({ key: 'legacy-environment-google', isEnabled: false, configuration: expect.objectContaining({ clientSecretRef: 'env://GOOGLE_CLIENT_SECRET' }) }) }),
    ]));
    expect(JSON.stringify(drafts)).not.toContain('not-exported');
  });
});
