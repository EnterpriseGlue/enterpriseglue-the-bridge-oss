import { beforeEach, describe, expect, it, vi } from 'vitest';

const dataSource = vi.hoisted(() => ({ transaction: vi.fn() }));
const authzGroupService = vi.hoisted(() => ({
  ensureAuthenticatedUserMembershipWithManager: vi.fn(),
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

describe('UserService authorization baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authzGroupService.ensureAuthenticatedUserMembershipWithManager.mockResolvedValue({ id: 'baseline-1', created: true });
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
    const manager = { getRepository: vi.fn(() => userRepo) };
    dataSource.transaction.mockImplementation(async (callback: (transactionManager: typeof manager) => unknown) => callback(manager));
    return { manager, userRepo };
  }

  it('creates a baseline system-group membership for a normal pending local user', async () => {
    const { manager, userRepo } = mockCreateTransaction('user');

    await userService.createPendingUser({
      email: 'person@example.test',
      createdByUserId: 'actor-1',
    });

    expect(userRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ platformRole: 'user' }));
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

    expect(userRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ platformRole: 'admin' }));
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, expect.any(String));
    expect(authzGroupService.ensureManualPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(manager, expect.any(String));
  });

  it('removes only the manual administrator membership when a user is demoted', async () => {
    const { manager, userRepo } = mockCreateTransaction('admin');
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
  });
});
