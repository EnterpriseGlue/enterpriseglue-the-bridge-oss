import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  externalIdentity: { findOne: vi.fn(), insert: vi.fn(), update: vi.fn() },
  user: { findOneBy: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));
const manager = vi.hoisted(() => ({
  getRepository: vi.fn(),
}));
const ssoNormalizedIdentityService = vi.hoisted(() => ({ upsertIdentityWithManager: vi.fn() }));
const authzGroupService = vi.hoisted(() => ({ ensureAuthenticatedUserMembershipWithManager: vi.fn() }));
const ssoSyncDiagnosticsService = vi.hoisted(() => ({ startRun: vi.fn(), completeRun: vi.fn(), failRun: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(async () => ({ transaction: async (callback: (transactionManager: typeof manager) => unknown) => callback(manager) })),
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoNormalizedIdentityService.js', () => ({ ssoNormalizedIdentityService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({ authzGroupService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/SsoSyncDiagnosticsService.js', () => ({ ssoSyncDiagnosticsService }));

import { identityProviderProvisioningService } from '@enterpriseglue/shared/services/platform-admin/IdentityProviderProvisioningService.js';

describe('IdentityProviderProvisioningService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager.getRepository.mockImplementation((entity: { name: string }) => entity.name === 'ExternalIdentity' ? stores.externalIdentity : stores.user);
    stores.externalIdentity.findOne.mockResolvedValue(null);
    stores.externalIdentity.insert.mockResolvedValue(undefined);
    stores.externalIdentity.update.mockResolvedValue(undefined);
    stores.user.findOneBy.mockResolvedValue(null);
    stores.user.insert.mockResolvedValue(undefined);
    ssoNormalizedIdentityService.upsertIdentityWithManager.mockResolvedValue({ id: 'snapshot-1', created: true, groupMembershipsCreated: 2, groupMembershipsRemoved: 1 });
    authzGroupService.ensureAuthenticatedUserMembershipWithManager.mockResolvedValue({ id: 'baseline-1', created: true });
    ssoSyncDiagnosticsService.startRun.mockResolvedValue('run-1');
    ssoSyncDiagnosticsService.completeRun.mockResolvedValue(undefined);
    ssoSyncDiagnosticsService.failRun.mockResolvedValue(undefined);
  });

  it('writes the normalized identity in the provisioning transaction, where membership reconciliation is orchestrated', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1' } as any;
    await identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1',
      email: 'person@example.test',
      claims: { sub: 'subject-1', email: 'person@example.test', groups: ['team-a'] },
    });
    expect(stores.externalIdentity.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', providerId: 'provider-1', providerType: 'ldap', subjectId: 'subject-1',
      identityKey: expect.any(String), status: 'active', emailHint: 'person@example.test',
    }));
    expect(stores.user.insert.mock.calls[0]?.[0]).not.toHaveProperty('platformRole');

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

  it('retries a first-login unique-key race so the concurrent subject link is reused', async () => {
    const existingUser = { id: 'user-1', email: 'person@example.test', firstName: null, lastName: null, platformRole: 'user', authProvider: 'ldap', passwordHash: null, isActive: true, isEmailVerified: true };
    const existingIdentity = { id: 'identity-1', userId: 'user-1', status: 'active' };
    stores.externalIdentity.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingIdentity)
      .mockResolvedValueOnce(existingIdentity);
    stores.user.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingUser);
    stores.user.insert.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: '{}' } as any;

    await expect(identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    })).resolves.toMatchObject({ id: 'user-1', email: 'person@example.test' });

    expect(stores.user.insert).toHaveBeenCalledTimes(1);
    expect(stores.externalIdentity.update).toHaveBeenCalledWith({ id: 'identity-1' }, expect.objectContaining({ userId: 'user-1' }));
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
    const existingUser = { id: 'local-user-1', email: 'person@example.test', firstName: null, lastName: null, platformRole: 'user', authProvider: 'local', passwordHash: 'local-password-hash', isActive: true, isEmailVerified: true };
    stores.user.findOneBy.mockResolvedValueOnce(existingUser);
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }) } as any;

    await identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    });
    expect(stores.user.update).toHaveBeenCalledWith({ id: 'local-user-1' }, expect.objectContaining({ email: 'person@example.test', authProvider: 'local' }));
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({ userId: 'local-user-1' }));
  });

  it('never uses an unverified OIDC email for an account link, even when the provider enables verified-email linking', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }) } as any;

    await expect(identityProviderProvisioningService.provisionOidcUser(provider, {
      sub: 'subject-1', email: 'person@example.test', email_verified: false,
    } as any)).rejects.toThrow('email must be verified');

    expect(stores.user.findOneBy).not.toHaveBeenCalled();
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).not.toHaveBeenCalled();
  });

  it('fails closed before identity writes when OIDC reports an incomplete group result', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: '{}' } as any;

    await expect(identityProviderProvisioningService.provisionOidcUser(provider, {
      sub: 'subject-1', email: 'person@example.test', email_verified: true, hasgroups: true,
    } as any)).rejects.toThrow('OIDC group claims are incomplete');

    expect(stores.externalIdentity.findOne).not.toHaveBeenCalled();
    expect(stores.user.findOneBy).not.toHaveBeenCalled();
    expect(stores.user.insert).not.toHaveBeenCalled();
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).not.toHaveBeenCalled();
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).not.toHaveBeenCalled();
  });

  it('normalizes the configured OIDC group claim before entitlement mappings are evaluated', async () => {
    const provider = {
      id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1',
      configurationJson: JSON.stringify({ groupClaim: 'enterprise_groups' }),
    } as any;

    await identityProviderProvisioningService.provisionOidcUser(provider, {
      sub: 'subject-1', email: 'person@example.test', email_verified: true, enterprise_groups: ['operators', 'auditors'],
    } as any);

    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({
      claims: expect.objectContaining({ groups: ['operators', 'auditors'] }),
    }));
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

  it('fails closed after an external identity has been explicitly unlinked', async () => {
    stores.externalIdentity.findOne.mockResolvedValueOnce({ userId: 'linked-user-1', status: 'unlinked' });
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: '{}' } as any;

    await expect(identityProviderProvisioningService.provisionLdapUser(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    })).rejects.toThrow('administrator-approved verified sign-in recovery');
    expect(stores.user.findOneBy).not.toHaveBeenCalled();
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).not.toHaveBeenCalled();
  });

  it('recovers an explicitly unlinked identity only from a fresh verified sign-in for its recorded email', async () => {
    const unlinkedIdentity = { id: 'identity-1', userId: 'old-user-1', status: 'unlinked', emailHint: 'person@example.test' };
    const recoveredUser = { id: 'recovered-user-1', email: 'person@example.test', firstName: null, lastName: null, platformRole: 'user', authProvider: 'local', passwordHash: 'local-password-hash', isActive: true, isEmailVerified: true };
    stores.externalIdentity.findOne
      .mockResolvedValueOnce(unlinkedIdentity)
      .mockResolvedValueOnce(unlinkedIdentity)
      .mockResolvedValueOnce({ ...unlinkedIdentity, userId: 'recovered-user-1', status: 'active' });
    stores.user.findOneBy.mockResolvedValue(recoveredUser);
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }) } as any;

    await expect(identityProviderProvisioningService.provisionOidcUser(provider, {
      sub: 'subject-1', email: 'person@example.test', email_verified: true,
    } as any)).resolves.toMatchObject({ id: 'recovered-user-1' });

    expect(stores.externalIdentity.update).toHaveBeenCalledWith({ id: 'identity-1' }, expect.objectContaining({ userId: 'recovered-user-1', status: 'active' }));
    expect(ssoNormalizedIdentityService.upsertIdentityWithManager).toHaveBeenCalledWith(manager, expect.objectContaining({ userId: 'recovered-user-1' }));
  });

  it('keeps an unlinked identity blocked when the fresh provider email differs from its recorded email', async () => {
    stores.externalIdentity.findOne.mockResolvedValue({ id: 'identity-1', userId: 'old-user-1', status: 'unlinked', emailHint: 'other@example.test' });
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1', configurationJson: JSON.stringify({ allowVerifiedEmailLinking: true }) } as any;

    await expect(identityProviderProvisioningService.provisionOidcUser(provider, {
      sub: 'subject-1', email: 'person@example.test', email_verified: true,
    } as any)).rejects.toThrow('administrator-approved verified sign-in recovery');

    expect(stores.user.findOneBy).not.toHaveBeenCalled();
    expect(stores.externalIdentity.update).not.toHaveBeenCalled();
  });

  it('records the same diagnostics model for direct login reconciliation', async () => {
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1' } as any;
    await identityProviderProvisioningService.reconcileLdapLogin(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    });

    expect(ssoSyncDiagnosticsService.startRun).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', providerId: 'provider-1', trigger: 'login', details: expect.objectContaining({ source: 'identity_provider_reconciliation', protocol: 'ldap' }),
    }));
    expect(ssoSyncDiagnosticsService.completeRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      tenantId: 'tenant-1', providerId: 'provider-1', userId: expect.any(String),
      groupMembershipsCreated: 2, groupMembershipsRemoved: 1,
    }));
  });

  it('records a failed login reconciliation without suppressing the provisioning failure', async () => {
    stores.externalIdentity.findOne.mockResolvedValueOnce({ userId: 'linked-user-1', status: 'unlinked' });
    const provider = { id: 'provider-1', tenantId: 'tenant-1', directoryTenantId: 'directory-1' } as any;

    await expect(identityProviderProvisioningService.reconcileLdapLogin(provider, {
      subjectId: 'subject-1', email: 'person@example.test', claims: { sub: 'subject-1', email: 'person@example.test' },
    })).rejects.toThrow('administrator-approved verified sign-in recovery');

    expect(ssoSyncDiagnosticsService.failRun).toHaveBeenCalledWith('run-1', expect.any(Error), expect.objectContaining({
      tenantId: 'tenant-1', providerId: 'provider-1', details: expect.objectContaining({ mode: 'login' }),
    }));
  });
});
