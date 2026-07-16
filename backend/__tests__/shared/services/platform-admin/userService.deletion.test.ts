import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { AuthzGroupMembership } from '@enterpriseglue/shared/infrastructure/persistence/entities/AuthzGroupMembership.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineMember.js';
import { ExternalIdentity } from '@enterpriseglue/shared/infrastructure/persistence/entities/ExternalIdentity.js';
import { Invitation } from '@enterpriseglue/shared/infrastructure/persistence/entities/Invitation.js';
import { Notification } from '@enterpriseglue/shared/infrastructure/persistence/entities/Notification.js';
import { PasswordResetToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/PasswordResetToken.js';
import { PermissionGrant } from '@enterpriseglue/shared/infrastructure/persistence/entities/PermissionGrant.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { ProjectMember } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMember.js';
import { ProjectMemberRole } from '@enterpriseglue/shared/infrastructure/persistence/entities/ProjectMemberRole.js';
import { RbacRoleAssignment } from '@enterpriseglue/shared/infrastructure/persistence/entities/RbacRoleAssignment.js';
import { RefreshToken } from '@enterpriseglue/shared/infrastructure/persistence/entities/RefreshToken.js';
import { User } from '@enterpriseglue/shared/infrastructure/persistence/entities/User.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({ getDataSource: vi.fn() }));

describe('UserService permanent deletion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revokes canonical identity and authorization rows before deleting an eligible local user', async () => {
    const deletes = new Map<unknown, ReturnType<typeof vi.fn>>();
    const repository = (entity: unknown) => {
      if (!deletes.has(entity)) deletes.set(entity, vi.fn().mockResolvedValue({ affected: 1 }));
      return { delete: deletes.get(entity) };
    };
    const userRepo = {
      findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', authProvider: 'local', isActive: false }),
    };
    const invitationRepo = { count: vi.fn().mockResolvedValue(0) };
    const projectRepo = { count: vi.fn().mockResolvedValue(0) };
    const engineRepo = { count: vi.fn().mockResolvedValue(0) };
    const manager = {
      getRepository: (entity: unknown) => entity === User ? repository(entity) : repository(entity),
    };

    (getDataSource as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === Invitation) return invitationRepo;
        if (entity === Project) return projectRepo;
        if (entity === Engine) return engineRepo;
        throw new Error('Unexpected preflight repository');
      },
      transaction: async (callback: (providedManager: typeof manager) => unknown) => callback(manager),
    });

    await userService.deleteUserPermanently('user-1');

    expect(deletes.get(RbacRoleAssignment)).toHaveBeenCalledWith({ principalType: 'user', principalId: 'user-1' });
    expect(deletes.get(RbacRoleAssignment)).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(deletes.get(AuthzGroupMembership)).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(deletes.get(ExternalIdentity)).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(deletes.get(ProjectMemberRole)).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(deletes.get(ProjectMember)).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(deletes.get(EngineMember)).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(deletes.get(User)).toHaveBeenCalledWith({ id: 'user-1' });
  });
});
