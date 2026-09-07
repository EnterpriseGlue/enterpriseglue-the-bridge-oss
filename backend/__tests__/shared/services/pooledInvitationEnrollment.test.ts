import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationService } from '@enterpriseglue/shared/services/invitations.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));
vi.mock('@enterpriseglue/shared/config/index.js', () => ({ config: { tenancyMode: 'pooled', frontendUrl: 'https://fixture.example.test' } }));
vi.mock('@enterpriseglue/shared/utils/password.js', () => ({ hashPassword: vi.fn(async () => 'fixture-password-hash'), generatePassword: () => 'fixture-otp', verifyPassword: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/email/index.js', () => ({ sendInvitationEmail: vi.fn() }));
const assignRole = vi.hoisted(() => vi.fn());
vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({ permissionService: { assignRole }, SYSTEM_ROLE_IDS: {} }));
vi.mock('@enterpriseglue/shared/services/platform-admin/LoginMethodService.js', () => ({ loginMethodService: { ordinaryLocalPasswordEnabled: async () => true } }));
vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', () => ({ getActivePlatformAdministratorUserIds: async () => new Set() }));
vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({ projectMemberService: {} }));
vi.mock('@enterpriseglue/shared/services/platform-admin/EngineService.js', () => ({ engineService: {} }));

describe('pooled invitation account ownership', () => {
  const service = new InvitationService();
  const claimUser = vi.fn(); const claimInvitation = vi.fn(); const findUser = vi.fn(); const existsIdentity = vi.fn();
  const pendingUser = { id: 'pending-user', email: 'invitee@example.test', authProvider: 'local', passwordHash: null,
    isActive: true, isEmailVerified: false, lastLoginAt: null, authSessionVersion: 0, createdByUserId: 'inviter-a', createdAt: 10 };
  let invitation: any;
  const insertInvitation = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    invitation = { id: 'invitation-a', userId: pendingUser.id, email: pendingUser.email, tenantId: 'alpha', tenantSlug: 'alpha',
      resourceType: 'tenant', createdByUserId: 'inviter-a', status: 'otp_verified', otpVerifiedAt: Date.now() - 1000,
      expiresAt: Date.now() + 60000, revokedAt: null, completedAt: null };
    claimUser.mockResolvedValue({ affected: 1 }); claimInvitation.mockResolvedValue({ affected: 1 });
    findUser.mockResolvedValue(pendingUser); existsIdentity.mockResolvedValue(false);
    const builder = { update: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), execute: vi.fn().mockResolvedValue({ affected: 0 }) };
    const users = { findOneBy: findUser, findOneByOrFail: async () => ({ ...pendingUser, isEmailVerified: true }), update: claimUser };
    const invitations = { findOneBy: async () => invitation, findOneByOrFail: async () => invitation, update: claimInvitation, createQueryBuilder: () => builder, insert: insertInvitation };
    const manager = { getRepository: (entity: unknown) => {
      if (entity === User) return users; if (entity === Invitation) return invitations;
      if (entity === ExternalIdentity) return { existsBy: existsIdentity };
      throw new Error('Unexpected repository');
    } };
    vi.mocked(getDataSource).mockResolvedValue({ ...manager, transaction: async (work: any) => work(manager) } as any);
  });

  it.each(['oidc', 'saml', 'ldap'])('does not turn an existing %s identity into password onboarding', async (authProvider) => {
    findUser.mockResolvedValue({ ...pendingUser, authProvider, isEmailVerified: true, lastLoginAt: Date.now(), createdByUserId: null });
    await expect(service.completeInvitation(invitation.id, 'new-password')).rejects.toThrow('existing account');
    expect(claimUser).not.toHaveBeenCalled(); expect(assignRole).not.toHaveBeenCalled();
  });

  it('does not create an enrollment invitation for an established account', async () => {
    findUser.mockResolvedValue({ ...pendingUser, authProvider: 'oidc', isEmailVerified: true });
    await expect(service.createInvitation({ userId: pendingUser.id, email: pendingUser.email, tenantId: 'alpha', tenantSlug: 'alpha',
      resourceType: 'tenant', createdByUserId: 'inviter-a', invitedByName: 'Fixture', deliveryMethod: 'manual' })).rejects.toThrow('existing account');
    expect(insertInvitation).not.toHaveBeenCalled();
  });

  it('initializes only its unused pending account and consumes the invitation before granting membership', async () => {
    await expect(service.completeInvitation(invitation.id, 'new-password')).resolves.toMatchObject({ tenantId: 'alpha', user: { id: pendingUser.id } });
    expect(claimInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: invitation.id, tenantId: 'alpha', userId: pendingUser.id,
      status: 'otp_verified', expiresAt: expect.objectContaining({ _type: 'moreThan' }), revokedAt: expect.objectContaining({ _type: 'isNull' }), completedAt: expect.objectContaining({ _type: 'isNull' }) }), expect.objectContaining({ status: 'completed' }));
    expect(claimUser).toHaveBeenCalledWith(expect.objectContaining({ id: pendingUser.id, createdByUserId: 'inviter-a', authProvider: 'local',
      authSessionVersion: 0, passwordHash: expect.objectContaining({ _type: 'isNull' }), isEmailVerified: false }), expect.objectContaining({ passwordHash: 'fixture-password-hash', authSessionVersion: 1 }));
    expect(claimInvitation.mock.invocationCallOrder[0]).toBeLessThan(claimUser.mock.invocationCallOrder[0]);
    expect(claimUser.mock.invocationCallOrder[0]).toBeLessThan(assignRole.mock.invocationCallOrder[0]);
  });

  it.each([
    { passwordHash: 'existing-hash' }, { isEmailVerified: true }, { lastLoginAt: 123 },
    { authSessionVersion: 1 }, { createdByUserId: 'other-inviter' }, { isActive: false }, { email: 'different@example.test' },
  ])('rejects an account that is no longer the inviter-owned pending account (%j)', async (changed) => {
    findUser.mockResolvedValue({ ...pendingUser, ...changed });
    await expect(service.completeInvitation(invitation.id, 'new-password')).rejects.toThrow('existing account');
    expect(claimUser).not.toHaveBeenCalled(); expect(assignRole).not.toHaveBeenCalled();
  });

  it('rejects an external binding even if the shared user fields look unused', async () => {
    existsIdentity.mockResolvedValue(true);
    await expect(service.completeInvitation(invitation.id, 'new-password')).rejects.toThrow('existing account');
    expect(claimUser).not.toHaveBeenCalled();
  });

  it.each(['invitation', 'user'] as const)('rejects a lost conditional %s claim without granting membership', async (which) => {
    (which === 'invitation' ? claimInvitation : claimUser).mockResolvedValue({ affected: 0 });
    await expect(service.completeInvitation(invitation.id, 'new-password')).rejects.toThrow(which === 'invitation' ? 'no longer available' : 'existing account');
    expect(assignRole).not.toHaveBeenCalled();
  });
});
