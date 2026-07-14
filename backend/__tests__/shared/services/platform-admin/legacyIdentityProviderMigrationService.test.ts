import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { legacyIdentityProviderMigrationService } from '@enterpriseglue/shared/services/platform-admin/LegacyIdentityProviderMigrationService.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { SsoProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoProvider.js';

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

    expect(draft.provider.protocol).toBe('oidc');
    if (draft.provider.protocol !== 'oidc') throw new Error('Expected an OIDC migration draft');
    expect(draft.provider.directoryTenantId).toBe('directory-tenant');
    expect(draft.provider.configuration.issuerUrl).toBe('https://login.microsoftonline.com/directory-tenant/v2.0');
    expect(draft.provider.configuration.scopes).toEqual(['openid', 'profile', 'email']);
  });

  it('creates a disabled SAML draft without reading or returning legacy certificate ciphertext', async () => {
    findOneBy.mockResolvedValueOnce({ id: 'legacy-saml', name: 'Legacy SAML', type: 'saml', enabled: true, entityId: 'https://sp.example.test/metadata', ssoUrl: 'https://idp.example.test/sso', certificateEnc: 'enc:must-not-leak', signatureAlgorithm: 'sha512' });
    const draft = await legacyIdentityProviderMigrationService.createDraft('legacy-saml');
    expect(draft).toEqual(expect.objectContaining({
      legacyProvider: expect.objectContaining({ type: 'saml', signingCertificateConfigured: true }),
      provider: expect.objectContaining({ protocol: 'saml', configuration: expect.objectContaining({ callbackUrl: 'https://app.example.test/api/auth/providers/saml/callback', signingCertificateRef: 'env://REPLACE_WITH_SAML_SIGNING_CERTIFICATE', signatureAlgorithm: 'sha512' }) }),
    }));
    expect(draft.requirements).toContain('signing_certificate_reference');
    expect(JSON.stringify(draft)).not.toContain('must-not-leak');
  });

  it('rejects unsupported legacy provider types and incomplete OIDC records', async () => {
    findOneBy.mockResolvedValueOnce({ id: 'legacy-ldap', type: 'ldap' });
    await expect(legacyIdentityProviderMigrationService.createDraft('legacy-ldap')).rejects.toThrow('Only legacy Microsoft, Google, OIDC, and SAML providers');

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

  it('reports missing mappings as a cutover blocker without resolving the secret value', async () => {
    const providerFindOne = vi.fn().mockResolvedValue({
      id: 'target-1', key: 'migrated-entra', tenantId: 'tenant-1', protocol: 'oidc', authenticationMode: 'direct', isEnabled: true,
      configurationJson: JSON.stringify({ clientSecretRef: 'env://MISSING_MIGRATION_SECRET' }),
    });
    const mappingCount = vi.fn().mockResolvedValue(0);
    (getDataSource as any).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === IdentityProvider) return { findOne: providerFindOne };
      if (entity === IdentityEntitlementMapping) return { count: mappingCount };
      throw new Error('Unexpected repository');
    }});

    const readiness = await legacyIdentityProviderMigrationService.getReadiness({ targetProviderKey: 'migrated-entra', tenantId: 'tenant-1' });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(expect.arrayContaining(['secret_reference_unavailable', 'identity_mappings_missing']));
    expect(readiness.checks.secretReferenceConfigured).toBe(true);
    expect(readiness.checks.secretReferenceAvailable).toBe(false);
    expect(mappingCount).toHaveBeenCalledOnce();
  });

  it('reports a missing authenticated default-role mapping for the selected legacy provider', async () => {
    process.env.READY_MIGRATION_SECRET = 'test-secret';
    const mappingCount = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    (getDataSource as any).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue({ id: 'target-1', key: 'migrated-entra', tenantId: 'tenant-1', protocol: 'oidc', authenticationMode: 'direct', isEnabled: true, configurationJson: JSON.stringify({ clientSecretRef: 'env://READY_MIGRATION_SECRET' }) }) };
      if (entity === SsoProvider) return { findOneBy: vi.fn().mockResolvedValue({ id: 'legacy-entra', defaultRole: 'admin' }) };
      if (entity === IdentityEntitlementMapping) return { count: mappingCount };
      throw new Error('Unexpected repository');
    }});
    try {
      const readiness = await legacyIdentityProviderMigrationService.getReadiness({ targetProviderKey: 'migrated-entra', legacyProviderId: 'legacy-entra', tenantId: 'tenant-1' });

      expect(readiness.ready).toBe(false);
      expect(readiness.requiredDefaultGroupId).toBe('system.group.platform_administrators');
      expect(readiness.checks.defaultRoleMappingConfigured).toBe(false);
      expect(readiness.blockers).toContain('default_role_mapping_missing');
    } finally { delete process.env.READY_MIGRATION_SECRET; }
  });

  it('disables a persisted legacy provider only after the replacement passes readiness checks', async () => {
    process.env.READY_MIGRATION_SECRET = 'test-secret';
    const legacyProvider = { id: 'legacy-google', name: 'Google Workspace', type: 'google', enabled: true, updatedAt: 1 };
    const targetProvider = { id: 'target-1', key: 'migrated-google', tenantId: 'tenant-1', protocol: 'oidc', authenticationMode: 'direct', isEnabled: true, configurationJson: JSON.stringify({ clientSecretRef: 'env://READY_MIGRATION_SECRET' }) };
    const save = vi.fn().mockResolvedValue(undefined);
    const getRepository = (entity: unknown) => {
      if (entity === SsoProvider) return { findOneBy: vi.fn().mockResolvedValue(legacyProvider), save };
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue(targetProvider) };
      if (entity === IdentityEntitlementMapping) return { count: vi.fn().mockResolvedValue(1) };
      throw new Error('Unexpected repository');
    };
    (getDataSource as any).mockResolvedValue({ transaction: (callback: any) => callback({ getRepository }) });

    try {
      const result = await legacyIdentityProviderMigrationService.cutover({ legacyProviderId: 'legacy-google', targetProviderKey: 'migrated-google', tenantId: 'tenant-1' });

      expect(result).toEqual(expect.objectContaining({ targetProviderKey: 'migrated-google', legacyProviderDisabled: true, alreadyDisabled: false }));
      expect(legacyProvider.enabled).toBe(false);
      expect(save).toHaveBeenCalledWith(legacyProvider);
    } finally {
      delete process.env.READY_MIGRATION_SECRET;
    }
  });

  it('refuses cutover when only unrelated identity mappings exist', async () => {
    process.env.READY_MIGRATION_SECRET = 'test-secret';
    const legacyProvider = { id: 'legacy-google', name: 'Google Workspace', type: 'google', defaultRole: 'user', enabled: true, updatedAt: 1 };
    const targetProvider = { id: 'target-1', key: 'migrated-google', tenantId: 'tenant-1', protocol: 'oidc', authenticationMode: 'direct', isEnabled: true, configurationJson: JSON.stringify({ clientSecretRef: 'env://READY_MIGRATION_SECRET' }) };
    const save = vi.fn();
    const mappingCount = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const getRepository = (entity: unknown) => {
      if (entity === SsoProvider) return { findOneBy: vi.fn().mockResolvedValue(legacyProvider), save };
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue(targetProvider) };
      if (entity === IdentityEntitlementMapping) return { count: mappingCount };
      throw new Error('Unexpected repository');
    };
    (getDataSource as any).mockResolvedValue({ transaction: (callback: any) => callback({ getRepository }) });
    try {
      await expect(legacyIdentityProviderMigrationService.cutover({ legacyProviderId: 'legacy-google', targetProviderKey: 'migrated-google', tenantId: 'tenant-1' })).rejects.toThrow('default_role_mapping_missing');
      expect(save).not.toHaveBeenCalled();
      expect(legacyProvider.enabled).toBe(true);
    } finally { delete process.env.READY_MIGRATION_SECRET; }
  });

  it('refuses to cut over an environment-managed provider or an unready replacement', async () => {
    await expect(legacyIdentityProviderMigrationService.cutover({ legacyProviderId: 'environment:microsoft', targetProviderKey: 'migrated-entra' })).rejects.toThrow('Environment-based legacy authentication');

    const legacyProvider = { id: 'legacy-google', name: 'Google Workspace', type: 'google', enabled: true };
    const getRepository = (entity: unknown) => {
      if (entity === SsoProvider) return { findOneBy: vi.fn().mockResolvedValue(legacyProvider) };
      if (entity === IdentityProvider) return { findOne: vi.fn().mockResolvedValue(null) };
      if (entity === IdentityEntitlementMapping) return { count: vi.fn() };
      throw new Error('Unexpected repository');
    };
    (getDataSource as any).mockResolvedValue({ transaction: (callback: any) => callback({ getRepository }) });

    await expect(legacyIdentityProviderMigrationService.cutover({ legacyProviderId: 'legacy-google', targetProviderKey: 'missing-provider', tenantId: 'tenant-1' })).rejects.toThrow('target_not_found');
  });
});
