import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  externalIdentity: { findOne: vi.fn(), insert: vi.fn(), update: vi.fn() },
  user: { findOneBy: vi.fn(), insert: vi.fn(), update: vi.fn() },
  identityProvider: { update: vi.fn() },
}));
const manager = vi.hoisted(() => ({ getRepository: vi.fn() }));
const normalized = vi.hoisted(() => ({ upsertIdentityWithManager: vi.fn() }));
const groups = vi.hoisted(() => ({ ensureAuthenticatedUserMembershipWithManager: vi.fn() }));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config: { tenancyMode: 'pooled' } }));
vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(async () => ({ transaction: async (callback: (value: typeof manager) => unknown) => callback(manager) })),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService: normalized }));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({ authzGroupService: groups }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService: {} }));

import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';

describe('pooled provider email is not shared-account control', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    manager.getRepository.mockImplementation((entity: { name: string }) => {
      if (entity.name === 'ExternalIdentity') return stores.externalIdentity;
      if (entity.name === 'IdentityProvider') return stores.identityProvider;
      if (entity.name === 'User') return stores.user;
      throw new Error(`Unexpected repository: ${entity.name}`);
    });
    stores.identityProvider.update.mockResolvedValue({ affected: 1 });
    stores.externalIdentity.findOne.mockResolvedValue(null);
    stores.user.findOneBy.mockResolvedValue({
      id: 'existing-bravo-user', email: 'same@example.test', isActive: true,
      authProvider: 'oidc', authSessionVersion: 0, firstName: 'Existing', lastName: 'User',
    });
    normalized.upsertIdentityWithManager.mockResolvedValue({ id: 'snapshot', groupMembershipsCreated: 0, groupMembershipsRemoved: 0 });
  });

  it.each(['oidc', 'saml', 'ldap'] as const)('does not adopt another account using a new %s provider subject and matching verified email', async (protocol) => {
    const provider = {
      id: 'alpha-provider', tenantId: 'alpha', protocol, isEnabled: true,
      authenticationMode: 'direct', configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }),
    } as any;
    const identity = { subjectId: 'alpha-new-subject', email: 'same@example.test', claims: {} };
    const result = protocol === 'oidc'
      ? identityProviderProvisioningService.provisionOidcUser(provider, { sub: identity.subjectId, email: identity.email, email_verified: true } as any)
      : protocol === 'saml'
        ? identityProviderProvisioningService.provisionSamlUser(provider, identity)
        : identityProviderProvisioningService.provisionLdapUser(provider, identity);
    await expect(result).rejects.toThrow('Existing account control is required for pooled identity linking');
    expect(stores.user.update).not.toHaveBeenCalled();
    expect(stores.externalIdentity.insert).not.toHaveBeenCalled();
    expect(normalized.upsertIdentityWithManager).not.toHaveBeenCalled();
    expect(groups.ensureAuthenticatedUserMembershipWithManager).not.toHaveBeenCalled();
  });

  it('does not turn an unlinked identity into email-only account-control evidence', async () => {
    stores.externalIdentity.findOne.mockResolvedValue({
      id: 'prior-link', userId: 'existing-bravo-user', status: 'unlinked', emailHint: 'same@example.test',
    });
    await expect(identityProviderProvisioningService.provisionLdapUser({
      id: 'alpha-provider', tenantId: 'alpha', protocol: 'ldap',
      configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }),
    } as any, { subjectId: 'alpha-subject', email: 'same@example.test', claims: {} }))
      .rejects.toThrow('Existing account control is required for pooled identity linking');
    expect(stores.externalIdentity.update).not.toHaveBeenCalled();
    expect(stores.user.update).not.toHaveBeenCalled();
    expect(normalized.upsertIdentityWithManager).not.toHaveBeenCalled();
  });

  it('still provisions a new, verified account when no shared email account exists', async () => {
    stores.user.findOneBy.mockResolvedValue(null);
    const user = await identityProviderProvisioningService.provisionOidcUser({
      id: 'alpha-provider', tenantId: 'alpha', protocol: 'oidc', configurationJson: '{}',
    } as any, { sub: 'alpha-subject', email: 'new@example.test', email_verified: true } as any);
    expect(user).toMatchObject({ id: expect.any(String), email: 'new@example.test' });
    expect(stores.user.insert).toHaveBeenCalledWith(expect.objectContaining({ id: user.id, email: 'new@example.test' }));
    expect(stores.externalIdentity.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: user.id, tenantId: 'alpha', providerId: 'alpha-provider', subjectId: 'alpha-subject' }));
  });

  it('does not adopt the other provider account when a concurrent first-login insert wins the email race', async () => {
    stores.user.findOneBy.mockResolvedValueOnce(null);
    stores.user.insert.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    await expect(identityProviderProvisioningService.provisionLdapUser({
      id: 'alpha-provider', tenantId: 'alpha', protocol: 'ldap',
      configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }),
    } as any, { subjectId: 'alpha-subject', email: 'same@example.test', claims: {} }))
      .rejects.toThrow('Existing account control is required for pooled identity linking');
    expect(stores.user.insert).toHaveBeenCalledTimes(1);
    expect(stores.user.findOneBy).toHaveBeenCalledTimes(2);
    expect(stores.user.update).not.toHaveBeenCalled();
    expect(stores.externalIdentity.insert).not.toHaveBeenCalled();
    expect(normalized.upsertIdentityWithManager).not.toHaveBeenCalled();
  });

  it.each(['oidc', 'saml', 'ldap'] as const)('preserves an established %s subject without rewriting the shared profile', async (protocol) => {
    stores.externalIdentity.findOne.mockResolvedValue({ id: 'canonical-link', userId: 'existing-bravo-user', status: 'active' });
    const provider = { id: 'alpha-provider', tenantId: 'alpha', protocol, configurationJson: '{}' } as any;
    const identity = { subjectId: 'established-subject', email: 'changed@example.test', firstName: 'Changed', lastName: 'Name', claims: {} };
    const user = await (protocol === 'oidc'
      ? identityProviderProvisioningService.provisionOidcUser(provider, { sub: identity.subjectId, email: identity.email, email_verified: true, given_name: identity.firstName, family_name: identity.lastName } as any)
      : protocol === 'saml'
        ? identityProviderProvisioningService.provisionSamlUser(provider, identity)
        : identityProviderProvisioningService.provisionLdapUser(provider, identity));
    expect(user).toMatchObject({ id: 'existing-bravo-user', email: 'same@example.test', firstName: 'Existing', lastName: 'User' });
    expect(stores.user.findOneBy).toHaveBeenCalledExactlyOnceWith({ id: 'existing-bravo-user' });
    expect(stores.user.update).toHaveBeenCalledExactlyOnceWith({ id: user.id }, { lastLoginAt: expect.any(Number), updatedAt: expect.any(Number) });
    expect(stores.user.insert).not.toHaveBeenCalled();
    expect(normalized.upsertIdentityWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({ tenantId: 'alpha', userId: user.id, email: identity.email }));
  });
});
