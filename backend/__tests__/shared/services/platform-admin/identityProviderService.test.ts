import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { IdentityEntitlementMapping } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityEntitlementMapping.js';
import { IdentityProvider } from '@enterpriseglue/shared/infrastructure/persistence/entities/IdentityProvider.js';
import { SsoNormalizedIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/SsoNormalizedIdentity.js';
import { identityProviderService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderService.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('identityProviderService', () => {
  const findOne = vi.fn(); const insert = vi.fn(); const update = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks(); findOne.mockResolvedValue(null); insert.mockResolvedValue(undefined);
    (getDataSource as any).mockResolvedValue({ getRepository: (entity: unknown) => {
      if (entity === IdentityProvider) return { findOne, insert, update, find: vi.fn() };
      throw new Error('Unexpected repository');
    }});
  });
  it('creates OIDC providers with secret references only', async () => {
    const provider = await identityProviderService.upsert({ key: 'entra', protocol: 'oidc', configuration: { issuerUrl: 'https://login.example.test', clientId: 'client', clientSecretRef: 'EG_ENTRA_SECRET' } });
    expect(provider.key).toBe('entra');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ protocol: 'oidc', configurationJson: expect.stringContaining('clientSecretRef') }));
  });
  it('rejects raw secrets and non-LDAPS LDAP endpoints', async () => {
    await expect(identityProviderService.upsert({ key: 'bad', protocol: 'oidc', configuration: { issuerUrl: 'https://idp.test', clientId: 'x', clientSecret: 'raw' } })).rejects.toThrow('secret references');
    await expect(identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: { url: 'ldap://directory.test' } })).rejects.toThrow('ldaps://');
  });
  it('requires a complete direct LDAP configuration', async () => {
    await expect(identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: { url: 'ldaps://directory.test' } })).rejects.toThrow('bindDn');
    const provider = await identityProviderService.upsert({ key: 'ldap', protocol: 'ldap', configuration: {
      url: 'ldaps://directory.test', bindDn: 'cn=service,dc=example,dc=test', bindPasswordRef: 'LDAP_BIND_PASSWORD', userBaseDn: 'ou=users,dc=example,dc=test', userSearchFilter: '(uid={username})', groupBaseDn: 'ou=groups,dc=example,dc=test', groupIdAttribute: 'cn', membershipMode: 'memberOf',
    } });
    expect(provider.protocol).toBe('ldap');
  });

  it('archives provider access without removing manual or other-provider memberships', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', key: 'entra', protocol: 'oidc' } as IdentityProvider;
    const mappingFind = vi.fn().mockResolvedValue([{ id: 'mapping-1' }]);
    const membershipDelete = vi.fn().mockResolvedValue({ affected: 2 });
    const normalizedUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const externalUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const providerUpdate = vi.fn().mockResolvedValue({ affected: 1 });
    const manager = { getRepository: (entity: unknown) => {
      if (entity === IdentityEntitlementMapping) return { find: mappingFind };
      if (entity === AuthzGroupMembership) return { delete: membershipDelete };
      if (entity === SsoNormalizedIdentity) return { update: normalizedUpdate };
      if (entity === ExternalIdentity) return { update: externalUpdate };
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
      providerId: 'provider-1', providerManagedMembershipsRemoved: 2, normalizedIdentitiesMarked: 1, externalIdentitiesMarked: 1,
    });

    expect(membershipDelete).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', source: 'identity_provider' }));
    expect(normalizedUpdate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', providerId: 'provider-1' }), expect.objectContaining({ providerStatus: 'provider_disabled' }));
    expect(externalUpdate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', providerId: 'provider-1' }), expect.objectContaining({ status: 'provider_disabled' }));
    expect(providerUpdate).toHaveBeenCalledWith({ id: 'provider-1' }, expect.objectContaining({ isEnabled: false }));
  });
});
