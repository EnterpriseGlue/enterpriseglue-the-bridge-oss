import { beforeEach, describe, expect, it, vi } from 'vitest';

const dataSource = vi.hoisted(() => ({ transaction: vi.fn() }));
const authzGroupService = vi.hoisted(() => ({
  ensureAuthenticatedUserMembershipWithManager: vi.fn(),
  removeAuthenticatedUserMembershipWithManager: vi.fn(),
  ensureManualPlatformAdministratorMembershipWithManager: vi.fn(),
  removeManualPlatformAdministratorMembershipWithManager: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn(async () => dataSource) }));
vi.mock('@enterpriseglue/shared/infrastructure/persistence/adapters/QueryHelpers.js', () => ({
  addCaseInsensitiveEquals: (queryBuilder: unknown) => queryBuilder,
}));
vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({ authzGroupService }));
vi.mock('@enterpriseglue/shared/utils/password.js', () => ({
  generatePassword: () => 'temporary-password',
  hashPassword: vi.fn(async () => 'password-hash'),
}));

import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';

describe('UserService authorization baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authzGroupService.ensureAuthenticatedUserMembershipWithManager.mockResolvedValue({ id: 'baseline-1', created: true });
    authzGroupService.removeAuthenticatedUserMembershipWithManager.mockResolvedValue({ removed: true });
    authzGroupService.ensureManualPlatformAdministratorMembershipWithManager.mockResolvedValue({ id: 'admin-1', created: true });
    authzGroupService.removeManualPlatformAdministratorMembershipWithManager.mockResolvedValue({ removed: true });
  });

  function mockCreateTransaction(platformRole: 'admin' | 'user') {
    const user = {
      id: 'user-1',
      email: 'person@example.test',
      firstName: null,
      lastName: null,
      platformRole,
      authSessionVersion: 4,
      authProvider: 'local',
      isActive: true,
      isEmailVerified: false,
      mustResetPassword: false,
      createdAt: 1,
      updatedAt: 1,
      lastLoginAt: null,
      createdByUserId: 'actor-1',
    };
    const userRepo = {
      createQueryBuilder: vi.fn(() => ({ getOne: vi.fn().mockResolvedValue(null) })),
      insert: vi.fn(),
      update: vi.fn(),
      findOneBy: vi.fn().mockResolvedValue(user),
    };
    const membershipRepo = {
      find: vi.fn().mockResolvedValue(platformRole === 'admin'
        ? [{ userId: 'user-1', expiresAt: null }]
        : []),
    };
    const refreshTokenRepo = { update: vi.fn() };
    const manager = {
      getRepository: vi.fn((entity: unknown) => {
        if (entity === AuthzGroupMembership) return membershipRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        return userRepo;
      }),
    };
    dataSource.transaction.mockImplementation(async (callback: (transactionManager: typeof manager) => unknown) => callback(manager));
    return { manager, userRepo, refreshTokenRepo };
  }

  it('creates a baseline system-group membership for a normal pending local user', async () => {
    const { manager, userRepo } = mockCreateTransaction('user');

    await userService.createPendingUser({
      email: 'person@example.test',
      createdByUserId: 'actor-1',
    });

    expect(userRepo.insert.mock.calls[0]?.[0]).not.toHaveProperty('platformRole');
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, expect.any(String));
    expect(authzGroupService.ensureManualPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
  });

  it('adds a manually managed platform-administrator membership when an admin is created', async () => {
    const { manager, userRepo } = mockCreateTransaction('admin');

    await userService.createUser({
      email: 'admin@example.test',
      platformRole: 'admin',
      createdByUserId: 'actor-1',
    });

    expect(userRepo.insert.mock.calls[0]?.[0]).not.toHaveProperty('platformRole');
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, expect.any(String));
    expect(authzGroupService.ensureManualPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(manager, expect.any(String));
  });

  it('removes only the manual administrator membership when a user is demoted', async () => {
    const { manager, userRepo, refreshTokenRepo } = mockCreateTransaction('admin');
    userRepo.findOneBy
      .mockResolvedValueOnce({
        id: 'user-1', email: 'admin@example.test', firstName: null, lastName: null,
        platformRole: 'admin', authProvider: 'local', isActive: true, isEmailVerified: true,
        mustResetPassword: false, createdAt: 1, updatedAt: 1, lastLoginAt: null, createdByUserId: 'actor-1',
      })
      .mockResolvedValueOnce({
        id: 'user-1', email: 'admin@example.test', firstName: null, lastName: null,
        platformRole: 'user', authProvider: 'local', isActive: true, isEmailVerified: true,
        mustResetPassword: false, createdAt: 1, updatedAt: 2, lastLoginAt: null, createdByUserId: 'actor-1',
      });

    await userService.updateUser('user-1', { platformRole: 'user' });

    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, 'user-1');
    expect(authzGroupService.removeManualPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(manager, 'user-1');
    expect(authzGroupService.ensureManualPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
    expect(userRepo.update).toHaveBeenCalledWith({ id: 'user-1' }, { authSessionVersion: 1 });
    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { revokedAt: expect.any(Number) },
    );
  });

  it('removes baseline access and revokes refresh tokens when update deactivates a user', async () => {
    const { manager, userRepo, refreshTokenRepo } = mockCreateTransaction('user');
    userRepo.findOneBy
      .mockResolvedValueOnce({
        id: 'user-1', email: 'person@example.test', firstName: null, lastName: null,
        authProvider: 'local', isActive: true, isEmailVerified: true, mustResetPassword: false,
        createdAt: 1, updatedAt: 1, lastLoginAt: null, createdByUserId: 'actor-1',
      })
      .mockResolvedValueOnce({
        id: 'user-1', email: 'person@example.test', firstName: null, lastName: null,
        authProvider: 'local', isActive: false, isEmailVerified: true, mustResetPassword: false,
        createdAt: 1, updatedAt: 2, lastLoginAt: null, createdByUserId: 'actor-1',
      });

    await userService.updateUser('user-1', { isActive: false });

    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).not.toHaveBeenCalled();
    expect(authzGroupService.removeAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, 'user-1');
    expect(refreshTokenRepo.update).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { revokedAt: expect.any(Number) },
    );
  });

  it('derives displayed platform administration from active canonical memberships', async () => {
    const now = Date.now();
    const users = [
      { id: 'manual-admin', email: 'manual@example.test', platformRole: 'user', authProvider: 'local', isActive: true, isEmailVerified: true, mustResetPassword: false, createdAt: 1, updatedAt: 1, lastLoginAt: null, createdByUserId: null },
      { id: 'sso-admin', email: 'sso@example.test', platformRole: 'user', authProvider: 'saml', isActive: true, isEmailVerified: true, mustResetPassword: false, createdAt: 1, updatedAt: 1, lastLoginAt: null, createdByUserId: null },
      { id: 'expired-admin', email: 'expired@example.test', platformRole: 'admin', authProvider: 'local', isActive: true, isEmailVerified: true, mustResetPassword: false, createdAt: 1, updatedAt: 1, lastLoginAt: null, createdByUserId: null },
    ];
    const invitationRepo = { find: vi.fn().mockResolvedValue([]) };
    const userRepo = { find: vi.fn().mockResolvedValue(users) };
    const membershipRepo = {
      find: vi.fn().mockResolvedValue([
        { userId: 'manual-admin', expiresAt: null, source: 'manual' },
        { userId: 'sso-admin', expiresAt: null, source: 'sso' },
        { userId: 'expired-admin', expiresAt: now - 1, source: 'manual' },
      ]),
    };
    (dataSource as any).getRepository = vi.fn((entity: unknown) => {
      if (entity === Invitation) return invitationRepo;
      if (entity === User) return userRepo;
      if (entity === AuthzGroupMembership) return membershipRepo;
      throw new Error('Unexpected repository');
    });

    const result = await userService.listUsers();

    expect(result.map((user) => [user.id, user.platformRole])).toEqual([
      ['manual-admin', 'admin'],
      ['sso-admin', 'admin'],
      ['expired-admin', 'user'],
    ]);
    expect(membershipRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ groupId: 'system.group.platform_administrators' }),
    }));
  });
});
