import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  externalIdentity: { findOne: vi.fn() },
  user: { findOneBy: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));
const manager = vi.hoisted(() => ({
  getRepository: vi.fn(),
}));
const ssoNormalizedIdentityService = vi.hoisted(() => ({ upsertIdentityWithManager: vi.fn() }));
const authzGroupService = vi.hoisted(() => ({ ensureAuthenticatedUserMembershipWithManager: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(async () => ({ transaction: async (callback: (transactionManager: typeof manager) => unknown) => callback(manager) })),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({ authzGroupService }));

import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';

describe('IdentityProviderProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager.getRepository.mockImplementation((entity: { name: string }) => entity.name === 'ExternalIdentity' ? stores.externalIdentity : stores.user);
    stores.externalIdentity.findOne.mockResolvedValue(null);
    stores.user.findOneBy.mockResolvedValue(null);
    stores.user.insert.mockResolvedValue(undefined);
    ssoNormalizedIdentityService.upsertIdentityWithManager.mockResolvedValue({ id: 'snapshot-1', created: true });
    authzGroupService.ensureAuthenticatedUserMembershipWithManager.mockResolvedValue({ id: 'baseline-1', created: true });
  });

  it('writes the normalized identity in the provisioning transaction, where membership reconciliation is orchestrated', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1' } as any;
    await identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1',
      email: 'person@example.test',
      claims: { sub: 'subject-1', email: 'person@example.test', groups: ['team-a'] },
    });

    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        providerId: 'provider-1',
        providerSubject: 'subject-1',
        providerTenantId: 'directory-1',
        claims: expect.objectContaining({ groups: ['team-a'] }),
      }),
    );
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, expect.any(String));
  });

  it('rejects a new provider subject that tries to link an existing local account without explicit provider approval', async () => {
    stores.user.findOneBy.mockResolvedValueOnce({ id: 'local-user-1', email: 'person@example.test', isEmailVerified: true });
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: '{}' } as any;

    await expect(identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    })).rejects.toThrow('Verified email account linking is disabled');
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).not.toHaveBeenCalled();
  });

  it('allows verified email linking only when the selected provider explicitly enables it', async () => {
    const existingUser = { id: 'local-user-1', email: 'person@example.test', firstName: null, lastName: null, platformRole: 'user', isActive: true, isEmailVerified: true };
    stores.user.findOneBy.mockResolvedValueOnce(existingUser);
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }) } as any;

    await identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    });
    expect(stores.user.update).toHaveBeenCalledWith({ id: 'local-user-1' }, expect.objectContaining({ email: 'person@example.test' }));
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({ userId: 'local-user-1' }));
  });

  it('rejects a linked provider subject when its verified email belongs to another user', async () => {
    stores.externalIdentity.findOne.mockResolvedValueOnce({ userId: 'linked-user-1' });
    const linkedUser = { id: 'linked-user-1', email: 'before@example.test', isEmailVerified: true };
    const conflictingUser = { id: 'other-user-1', email: 'person@example.test', isEmailVerified: true };
    stores.user.findOneBy.mockResolvedValueOnce(linkedUser).mockResolvedValueOnce(conflictingUser);
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: '{}' } as any;

    await expect(identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    })).rejects.toThrow('already linked to another user account');
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).not.toHaveBeenCalled();
  });
});
