import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { bootstrapAdmin } from '@enterpriseglue/shared/db/bootstrap.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';
import { hashPassword } from '@enterpriseglue/shared/utils/password.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('password-hash'),
}));

vi.mock('@enterpriseglue/shared/utils/id.js', () => ({
  generateId: vi.fn().mockReturnValue('admin-1'),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({
  authzGroupService: {
    ensureAuthenticatedUserMembershipWithManager: vi.fn().mockResolvedValue({ id: 'baseline-1', created: true }),
    ensureBootstrapPlatformAdministratorMembershipWithManager: vi.fn().mockResolvedValue({ id: 'admin-membership-1', created: true }),
  },
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    adminEmail: 'admin@example.com',
    adminPassword: 'Password123!',
  },
}));

describe('bootstrapAdmin authorization boundary', () => {
  const save = vi.fn();
  const manager = {
    getRepository: vi.fn(() => ({ save })),
  };
  const userRepo = {
    count: vi.fn(),
    create: vi.fn((value) => value),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    userRepo.count.mockResolvedValue(0);
    save.mockResolvedValue(undefined);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === User ? userRepo : undefined,
      transaction: vi.fn(async (callback: (providedManager: typeof manager) => unknown) => callback(manager)),
    });
  });

  it('creates baseline and administrator assignments in the originating user transaction', async () => {
    await bootstrapAdmin();

    expect(hashPassword).toHaveBeenCalledWith('Password123!');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'admin-1',
      email: 'admin@example.com',
    }));
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('platformRole');
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, 'admin-1');
    expect(authzGroupService.ensureBootstrapPlatformAdministratorMembershipWithManager).toHaveBeenCalledWith(manager, 'admin-1');
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      (authzGroupService.ensureAuthenticatedUserMembershipWithManager as Mock).mock.invocationCallOrder[0],
    );
  });

  it('omits the administrator assignment when privileged bootstrap is disabled', async () => {
    await bootstrapAdmin({ allowPlatformAdmin: false });

    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(manager, 'admin-1');
    expect(authzGroupService.ensureBootstrapPlatformAdministratorMembershipWithManager).not.toHaveBeenCalled();
  });
});
