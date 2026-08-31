import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { Tenant } from '@enterpriseglue/shared/infrastructure/persistence/entities/Tenant.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { identityProviderKeyIdentity, identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';
import { OSS_DEFAULT_TENANT_ID } from '@enterpriseglue/shared/authz/tenant-scope.js';
import { config } from '@enterpriseglue/shared/config/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('identityProviderService', () => {
  const find = vi.fn(); const findOne = vi.fn(); const insert = vi.fn(); const update = vi.fn();
  const tenantFindOne = vi.fn(); const transaction = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); findOne.mockResolvedValue(null); tenantFindOne.mockResolvedValue(null); find.mockResolvedValue([]); insert.mockResolvedValue(undefined);
    (config as { tenancyCloudRequired: boolean }).tenancyCloudRequired = false;
    const manager = { getRepository: (entity: unknown) => {
      if (entity === IdentityProvider) return { find, findOne, insert, update };
      if (entity === Tenant) return { findOne: tenantFindOne };
      throw new Error('Unexpected repository');
    }};
    transaction.mockImplementation(async (work: (store: typeof manager) => Promise<unknown>) => work(manager));
    (getDataSource as any).mockResolvedValue({ ...manager, transaction });
  });
  afterEach(() => {
    (config as { tenancyCloudRequired: boolean }).tenancyCloudRequired = false;
    delete process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY;
    delete process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS;
    delete process.env.EG_IDENTITY_PROVIDER_ALLOW_PRIVATE_HOSTS;
  });

  it('requires the exact tenant callback for managed OIDC and SAML providers', async () => {
    (config as { tenancyCloudRequired: boolean }).tenancyCloudRequired = true;
    tenantFindOne.mockResolvedValue({ slug: 'acme' });

    await expect(identityProviderService.upsert({
      tenantId: 'tenant-a', key: 'entra', protocol: 'oidc',
      configuration: {
        issuerUrl: 'https://login.example.test', clientId: 'client',
        callbackUrl: 'http://localhost:5173/api/t/acme/auth/identity/callback',
      },
    })).resolves.toMatchObject({ protocol: 'oidc', tenantId: 'tenant-a' });

    await expect(identityProviderService.upsert({
      tenantId: 'tenant-a', key: 'wrong-tenant', protocol: 'oidc',
      configuration: {
        issuerUrl: 'https://login.example.test', clientId: 'client',
        callbackUrl: 'http://localhost:5173/api/t/other/auth/identity/callback',
      },
    })).rejects.toThrow('/api/t/acme/auth/identity/callback');

    await expect(identityProviderService.upsert({
      tenantId: 'tenant-a', key: 'saml', protocol: 'saml',
      configuration: {
        entityId: 'enterpriseglue', idpEntityId: 'https://idp.example.test',
        callbackUrl: 'http://localhost:5173/api/t/acme/auth/providers/saml/callback',
        ssoUrl: 'https://idp.example.test/sso', signingCertificateRef: 'SAML_CERT',
      },
    })).resolves.toMatchObject({ protocol: 'saml', tenantId: 'tenant-a' });

    expect(tenantFindOne).toHaveBeenCalledWith({ where: { id: 'tenant-a' }, select: ['slug'] });
  });
  it('creates OIDC providers with secret references only', async () => {
    const provider = await identityProviderService.upsert({ key: 'entra', protocol: 'oidc', configuration: { issuerUrl: 'https://login.example.test', clientId: 'client', clientSecretRef: 'EG_ENTRA_SECRET' } });
    expect(provider.key).toBe('entra');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'oidc', providerKeyIdentity: 'platform:entra', configurationJson: expect.stringContaining('clientSecretRef') }));
    expect(JSON.parse(insert.mock.calls[0][0].syncJson)).toEqual({ triggers: ['login'], requiredForLogin: true, incompleteEntitlements: 'fail_closed' });
  });

  it('normalizes login presentation metadata and keeps one preferred provider per scope', async () => {
    find.mockResolvedValue([{ id: 'old-preferred' }]);
    await identityProviderService.upsert({
      tenantId: 'tenant-a',
      key: 'entra',
      displayName: 'Microsoft Entra ID',
      organization: 'Example Corporation',
      displayOrder: 10,
      isPreferred: true,
      loginDomains: ['EXAMPLE.COM', 'example.com', ' subsidiary.example.com '],
      protocol: 'oidc',
      configuration: { issuerUrl: 'https://login.example.test', clientId: 'client' },
    });

    expect(update).toHaveBeenCalledWith({ id: 'old-preferred' }, {
      isPreferred: false,
      preferredScopeIdentity: 'provider:old-preferred',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Microsoft Entra ID',
      organization: 'Example Corporation',
      displayOrder: 10,
      isPreferred: true,
      preferredScopeIdentity: 'preferred:tenant-a',
      loginDomainsJson: JSON.stringify(['example.com', 'subsidiary.example.com']),
    }));
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('requires reconciliation before sign-in even when a service caller bypasses the API schema', async () => {
    const configuration = { issuerUrl: 'https://login.example.test', clientId: 'client' };
    await expect(identityProviderService.upsert({ key: 'manual-only', protocol: 'oidc', configuration, sync: { triggers: ['manual'] } })).rejects.toThrow('Sign-in reconciliation is mandatory');
    await expect(identityProviderService.upsert({ key: 'not-required', protocol: 'oidc', configuration, sync: { triggers: ['login'], requiredForLogin: false } })).rejects.toThrow('Sign-in reconciliation is mandatory');
    expect(insert).not.toHaveBeenCalled();
  });
  it('never lets expectedAudience replace the OIDC client audience', async () => {
    await expect(identityProviderService.upsert({
      key: 'wrong-audience', protocol: 'oidc',
      configuration: { issuerUrl: 'https://login.example.test', clientId: 'enterpriseglue-web', expectedAudience: 'other-client' },
    })).rejects.toThrow('expectedAudience must equal clientId');
    expect(insert).not.toHaveBeenCalled();
  });
  it('rejects unsupported or contradictory background connector declarations', async () => {
    const configuration = { issuerUrl: 'https://login.example.test', clientId: 'client' };
    await expect(identityProviderService.upsert({ key: 'graph', protocol: 'oidc', configuration, sync: { triggers: ['login'], connectorCapability: 'graph' } })).rejects.toThrow('Unsupported identity connector capability');
    await expect(identityProviderService.upsert({ key: 'scim', protocol: 'oidc', configuration, sync: { triggers: ['login'], connectorCapability: 'scim' } })).rejects.toThrow('Unsupported identity connector capability');
    await expect(identityProviderService.upsert({ key: 'ldap-on-oidc', protocol: 'oidc', configuration, sync: { triggers: ['login'], connectorCapability: 'ldap_directory' } })).rejects.toThrow('only for LDAP providers');
    await expect(identityProviderService.upsert({ key: 'false-schedule', protocol: 'oidc', configuration, sync: { triggers: ['login', 'scheduled'], connectorCapability: 'claim_only', scheduled: false } })).rejects.toThrow('scheduled flag and scheduled trigger');
    expect(insert).not.toHaveBeenCalled();
  });
  it('uses a non-null tenant-plus-key identity for provider lookup and writes', async () => {
    await identityProviderService.upsert({ tenantId: 'tenant-a', key: 'identity.main', protocol: 'oidc', configuration: { issuerUrl: 'https://login.example.test', clientId: 'client' } });
    expect(findOne).toHaveBeenCalledWith({ where: { providerKeyIdentity: 'tenant-a:identity.main' } });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ providerKeyIdentity: 'tenant-a:identity.main' }));
    expect(identityProviderKeyIdentity(null, 'identity.main')).toBe('platform:identity.main');
  });
  it('prefers canonical OSS default-tenant direct providers while retaining platform rows as a compatibility fallback', async () => {
    const defaultProvider = { id: 'default-provider', key: 'entra', protocol: 'oidc', isEnabled: true, authenticationMode: 'direct' } as IdentityProvider;
    const platformProvider = { id: 'platform-provider', key: 'legacy-saml', protocol: 'saml', isEnabled: true, authenticationMode: 'direct' } as IdentityProvider;
    const duplicatePlatformProvider = { id: 'old-provider', key: 'entra', protocol: 'oidc', isEnabled: true, authenticationMode: 'direct' } as IdentityProvider;
    find.mockImplementation(({ where }: { where: { tenantId?: string } }) => (
      where.tenantId === OSS_DEFAULT_TENANT_ID
        ? Promise.resolve([defaultProvider])
        : Promise.resolve([duplicatePlatformProvider, platformProvider])
    ));

    await expect(identityProviderService.listEnabledDirectLoginProvidersForUnauthenticatedLogin()).resolves.toEqual([
      defaultProvider,
      platformProvider,
    ]);
    expect(find).toHaveBeenCalledTimes(2);
  });
  it('uses the canonical default tenant before legacy platform records for an unauthenticated provider start', async () => {
    const defaultProvider = { id: 'default-provider', key: 'entra', protocol: 'oidc' } as IdentityProvider;
    findOne.mockImplementation(({ where }: { where: { providerKeyIdentity?: string; id?: string; tenantId?: string } }) => (
      where.providerKeyIdentity === `${OSS_DEFAULT_TENANT_ID}:entra` || (where.id === 'default-provider' && where.tenantId === OSS_DEFAULT_TENANT_ID)
        ? Promise.resolve(defaultProvider)
        : Promise.resolve(null)
    ));

    await expect(identityProviderService.getDirectLoginProviderByKey('entra')).resolves.toBe(defaultProvider);
    await expect(identityProviderService.getDirectLoginProviderById('default-provider')).resolves.toBe(defaultProvider);
    expect(findOne).not.toHaveBeenCalledWith({ where: { providerKeyIdentity: 'platform:entra' } });
  });
  it('uses the same legacy fallback when the OSS default tenant was resolved from the URL', async () => {
    const platformProvider = { id: 'platform-provider', key: 'legacy-saml', protocol: 'saml' } as IdentityProvider;
    findOne.mockImplementation(({ where }: { where: { providerKeyIdentity?: string; id?: string; tenantId?: unknown } }) => (
      where.providerKeyIdentity === 'platform:legacy-saml' || (where.id === 'platform-provider' && where.tenantId !== OSS_DEFAULT_TENANT_ID)
        ? Promise.resolve(platformProvider)
        : Promise.resolve(null)
    ));

    await expect(identityProviderService.getDirectLoginProviderByKey('legacy-saml', OSS_DEFAULT_TENANT_ID)).resolves.toBe(platformProvider);
    await expect(identityProviderService.getDirectLoginProviderById('platform-provider', OSS_DEFAULT_TENANT_ID)).resolves.toBe(platformProvider);
    expect(findOne).toHaveBeenCalledWith({ where: { providerKeyIdentity: 'platform:legacy-saml' } });
  });
  it('persists config provenance through a supplied transaction manager', async () => {
    const transactionInsert = vi.fn().mockResolvedValue(undefined);
    const transactionFindOne = vi.fn().mockResolvedValue(null);
    const store = { getRepository: (entity: unknown) => {
      if (entity === IdentityProvider) return { findOne: transactionFindOne, insert: transactionInsert };
      throw new Error('Unexpected repository');
    }} as any;

    await identityProviderService.upsert({
      tenantId: 'tenant-a', key: 'identity.config', protocol: 'oidc',
      configuration: { issuerUrl: 'https://login.example.test', clientId: 'client' },
      ownershipMode: 'config_locked', sourceRef: 'config_bundle:acme.authz', sourceHash: 'bundle-hash', lastAppliedAt: 123, driftStatus: 'in_sync',
    }, store);

    expect(transactionInsert).toHaveBeenCalledWith(expect.objectContaining({
      providerKeyIdentity: 'tenant-a:identity.config', ownershipMode: 'config_locked', sourceRef: 'config_bundle:acme.authz',
      sourceHash: 'bundle-hash', lastAppliedAt: 123, driftStatus: 'in_sync',
    }));
  });
  it('rejects raw secrets and non-LDAPS LDAP endpoints', async () => {
    await expect(identityProviderService.upsert({ key: 'bad', protocol: 'oidc', configuration: { issuerUrl: 'https://idp.test', clientId: 'x', clientSecret: 'raw' } })).rejects.toThrow('secret references');
    await expect(identityProviderService.upsert({ key: 'nested-secret', protocol: 'oidc', configuration: { issuerUrl: 'https://idp.test', clientId: 'x', discovery: { apiKey: 'raw' } } })).rejects.toThrow('configuration.discovery.apiKey');
    await expect(identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: { url: 'ldap://directory.test' } })).rejects.toThrow('ldaps://');
  });
  it('rejects SHA-1 SAML provider configuration', async () => {
    await expect(identityProviderService.upsert({ key: 'saml', protocol: 'saml', configuration: {
      entityId: 'enterpriseglue', idpEntityId: 'https://idp.example.test', callbackUrl: 'http://localhost:5173/api/auth/providers/saml/callback', ssoUrl: 'https://idp.example.test/sso', signingCertificateRef: 'SAML_CERT', signatureAlgorithm: 'sha1',
    } })).rejects.toThrow('sha256 or sha512');
  });
  it('rejects an unsafe SAML metadata URL before persistence', async () => {
    process.env.EG_ENFORCE_IDENTITY_PROVIDER_ENDPOINT_POLICY = 'true';
    process.env.EG_IDENTITY_PROVIDER_ALLOWED_HOSTS = 'idp.example.test';
    await expect(identityProviderService.upsert({ key: 'saml', protocol: 'saml', configuration: {
      entityId: 'enterpriseglue', idpEntityId: 'https://idp.example.test', callbackUrl: 'http://localhost:5173/api/auth/providers/saml/callback', ssoUrl: 'https://idp.example.test/sso', metadataUrl: 'https://attacker.example.test/metadata', signingCertificateRef: 'SAML_CERT',
    } })).rejects.toThrow('SAML metadataUrl host is not permitted');
    expect(insert).not.toHaveBeenCalled();
  });
  it('requires a complete direct LDAP configuration', async () => {
    await expect(identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: { url: 'ldaps://directory.test' } })).rejects.toThrow('bindDn');
    const provider = await identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: {
      url: 'ldaps://directory.test', bindDn: 'cn=service,dc=example,dc=test', bindPasswordRef: 'LDAP_BIND_PASSWORD', userBaseDn: 'ou=users,dc=example,dc=test', userSearchFilter: '(uid={username})', groupBaseDn: 'ou=groups,dc=example,dc=test', groupIdAttribute: 'cn', membershipMode: 'memberOf',
    } });
    expect(provider.protocol).toBe('ldap');
  });
  it('accepts only a non-empty LDAP TLS trust secret reference', async () => {
    const configuration = {
      url: 'ldaps://directory.test', bindDn: 'cn=service,dc=example,dc=test', bindPasswordRef: 'LDAP_BIND_PASSWORD', userBaseDn: 'ou=users,dc=example,dc=test', userSearchFilter: '(uid={username})', groupBaseDn: 'ou=groups,dc=example,dc=test', groupIdAttribute: 'cn', membershipMode: 'memberOf',
    };
    await expect(identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: { ...configuration, tlsTrustRef: ' ' } })).rejects.toThrow('tlsTrustRef');
    await expect(identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: { ...configuration, tlsTrustRef: 'LDAP_CA_CERTIFICATE' } })).resolves.toMatchObject({ protocol: 'ldap' });
  });

  it('archives provider access without removing manual or other-provider memberships', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', key: 'entra', protocol: 'oidc' } as IdentityProvider;
    const mappingFind = vi.fn().mockResolvedValue([{ id: 'mapping-1' }]);
    const membershipDelete = vi.fn().mockResolvedValue({ affected: 2 });
    const normalizedUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const externalUpdate = vi.fn().mockResolvedValue({ affected: 1 }); const externalFind = vi.fn().mockResolvedValue([{ userId: 'user-1' }]);
    const refreshUpdate = vi.fn().mockResolvedValue({ affected: 3 });
    const providerUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const manager = { getRepository: (entity: unknown) => {
      if (entity === IdentityEntitlementMapping) return { find: mappingFind };
      if (entity === AuthzGroupMembership) return { delete: membershipDelete };
      if (entity === SsoNormalizedIdentity) return { update: normalizedUpdate };
      if (entity === ExternalIdentity) return { update: externalUpdate, find: externalFind };
      if (entity === RefreshToken) return { update: refreshUpdate };
      if (entity === User) return { find: vi.fn().mockResolvedValue([{ id: 'user-1', authSessionVersion: 3 }]), update: vi.fn() };
      if (entity === IdentityProvider) return { update: providerUpdate };
      throw new Error('Unexpected archive repository');
    }};
    const transaction = vi.fn(async (callback: (store: typeof manager) => Promise<unknown>) => callback(manager));
    findOne.mockResolvedValue(provider);
    (getDataSource as any).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === IdentityProvider) return { findOne, insert, update, find: vi.fn() };
      throw new Error('Unexpected repository');
    }, transaction });

    await expect(identityProviderService.archive('entra', 'tenant-1')).resolves.toEqual({
      providerId: 'provider-1', providerManagedMembershipsRemoved: 2, normalizedIdentitiesMarked: 1, externalIdentitiesMarked: 1, providerRefreshSessionsRevoked: 3, providerUserSessionsInvalidated: 1,
    });

    expect(membershipDelete).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', source: 'identity_provider' }));
    expect(normalizedUpdate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', providerId: 'provider-1' }), expect.objectContaining({ providerStatus: 'provider_disabled' }));
    expect(externalUpdate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', providerId: 'provider-1' }), expect.objectContaining({ status: 'provider_disabled' }));
    expect(refreshUpdate).toHaveBeenCalledWith(expect.objectContaining({ identityProviderId: 'provider-1' }), expect.objectContaining({ revokedAt: expect.any(Number) }));
    expect(providerUpdate).toHaveBeenCalledWith({ id: 'provider-1' }, expect.objectContaining({ isEnabled: false }));
  });
});
