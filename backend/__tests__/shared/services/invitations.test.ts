import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createHash } from 'crypto';
import { InvitationService } from '@enterpriseglue/shared/services/invitations.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Invitation } from '@enterpriseglue/shared/db/entities/Invitation.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { SsoProvider } from '@enterpriseglue/shared/db/entities/SsoProvider.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import { generatePassword, hashPassword, verifyPassword } from '@enterpriseglue/shared/utils/password.js';
import { sendInvitationEmail } from '@enterpriseglue/shared/services/email/index.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/password.js', () => ({
  generatePassword: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/email/index.js', () => ({
  sendInvitationEmail: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    addMember: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EngineService.js', () => ({
  engineService: {
    addEngineMember: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    frontendUrl: 'http://frontend.test',
    nodeEnv: 'test',
    jwtAccessTokenExpires: 900,
    jwtRefreshTokenExpires: 604800,
  },
}));

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('InvitationService', () => {
  const now = 1_700_000_000_000;
  const service = new InvitationService();

  let invitationRepo: {
    insert: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let userRepo: {
    findOneBy: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let ssoProviderRepo: {
    count: ReturnType<typeof vi.fn>;
  };
  let managerUserRepo: {
    update: ReturnType<typeof vi.fn>;
  };
  let managerInvitationRepo: {
    update: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    const defaultExecute = vi.fn().mockResolvedValue({ affected: 1 });
    const defaultQueryBuilder = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute: defaultExecute,
    };

    invitationRepo = {
      insert: vi.fn().mockResolvedValue(undefined),
      findOneBy: vi.fn(),
      findOneByOrFail: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn().mockReturnValue(defaultQueryBuilder),
    };

    userRepo = {
      findOneBy: vi.fn(),
      findOneByOrFail: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    };

    ssoProviderRepo = {
      count: vi.fn().mockResolvedValue(0),
    };

    managerUserRepo = {
      update: vi.fn().mockResolvedValue(undefined),
    };

    managerInvitationRepo = {
      update: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 1 }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Invitation) return invitationRepo;
        if (entity === User) return userRepo;
        if (entity === SsoProvider) return ssoProviderRepo;
        throw new Error('Unexpected repository');
      },
      transaction: async (callback: (manager: { getRepository: (entity: unknown) => unknown }) => Promise<void>) => callback({
        getRepository: (entity: unknown) => {
          if (entity === User) return managerUserRepo;
          if (entity === Invitation) return managerInvitationRepo;
          throw new Error('Unexpected manager repository');
        },
      }),
    });
  });

  it('creates a manual invitation and returns a reveal-once one-time password', async () => {
    (generatePassword as unknown as Mock).mockReturnValue('RevealMe123!');
    (hashPassword as unknown as Mock).mockResolvedValue('otp-hash');
    invitationRepo.findOneByOrFail.mockResolvedValue({ id: 'inv-1' });

    const result = await service.createInvitation({
      userId: 'user-1',
      email: 'Person@Example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceName: 'Project One',
      resourceRoles: ['viewer'],
      resourceRole: 'viewer',
      createdByUserId: 'admin-1',
      invitedByName: 'admin@example.com',
      deliveryMethod: 'manual',
    });

    expect(invitationRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      email: 'person@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceName: 'Project One',
      resourceRole: 'viewer',
      resourceRolesJson: JSON.stringify(['viewer']),
      oneTimePasswordHash: 'otp-hash',
      status: 'pending',
      expiresAt: now + 24 * 60 * 60 * 1000,
    }));
    expect(sendInvitationEmail).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      invitationId: 'inv-1',
      emailSent: false,
      oneTimePassword: 'RevealMe123!',
    }));
    expect(result.inviteUrl).toContain('/t/default/invite/');
  });

  it('creates an email invitation without exposing an OTP in the email payload or response', async () => {
    (generatePassword as unknown as Mock).mockReturnValue('EmailOtpShouldStayHidden123!');
    (hashPassword as unknown as Mock).mockResolvedValue('otp-hash');
    invitationRepo.findOneByOrFail.mockResolvedValue({ id: 'inv-2' });
    (sendInvitationEmail as unknown as Mock).mockResolvedValue({ success: true });

    const result = await service.createInvitation({
      userId: 'user-1',
      email: 'Person@Example.com',
      tenantSlug: 'default',
      resourceType: 'tenant',
      resourceName: 'default',
      createdByUserId: 'admin-1',
      invitedByName: 'admin@example.com',
      deliveryMethod: 'email',
    });

    expect(sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'Person@Example.com',
      inviteUrl: expect.stringContaining('/t/default/invite/'),
    }));
    expect((sendInvitationEmail as unknown as Mock).mock.calls[0][0]).not.toHaveProperty('oneTimePassword');
    expect(result).toEqual(expect.objectContaining({
      invitationId: 'inv-2',
      emailSent: true,
      oneTimePassword: undefined,
    }));
  });

  it('reports expired invitations when fetching info', async () => {
    invitationRepo.findOneBy.mockResolvedValue({
      id: 'inv-1',
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      resourceName: 'Project One',
      resourceRole: 'viewer',
      resourceRolesJson: JSON.stringify(['viewer']),
      deliveryMethod: 'email',
      expiresAt: now - 1,
      status: 'pending',
      revokedAt: null,
      completedAt: null,
      inviteTokenHash: hashToken('invite-token'),
    });

    await expect(service.getInvitationInfo('invite-token')).resolves.toEqual(expect.objectContaining({
      email: 'invitee@example.com',
      deliveryMethod: 'email',
      status: 'expired',
    }));
  });

  it('locks the invitation after the fifth invalid one-time password attempt', async () => {
    invitationRepo.findOneBy.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      oneTimePasswordHash: 'otp-hash',
      failedAttempts: 4,
      lockedUntil: null,
      expiresAt: now + 60_000,
      status: 'pending',
      revokedAt: null,
      completedAt: null,
      inviteTokenHash: hashToken('invite-token'),
    });
    (verifyPassword as unknown as Mock).mockResolvedValue(false);

    await expect(service.verifyOneTimePassword('invite-token', 'wrong-password')).rejects.toThrow('Invalid one-time password');

    expect(invitationRepo.update).toHaveBeenCalledWith(
      { id: 'inv-1' },
      expect.objectContaining({
        failedAttempts: 5,
        lockedUntil: now + 15 * 60 * 1000,
        updatedAt: now,
      }),
    );
  });

  it('enforces one-time atomic OTP consumption', async () => {
    const execute = vi.fn().mockResolvedValue({ affected: 0 });
    const queryBuilder = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute,
    };
    invitationRepo.findOneBy.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      oneTimePasswordHash: 'otp-hash',
      failedAttempts: 0,
      lockedUntil: null,
      expiresAt: now + 60_000,
      status: 'pending',
      otpVerifiedAt: null,
      revokedAt: null,
      completedAt: null,
      inviteTokenHash: hashToken('invite-token'),
    });
    invitationRepo.createQueryBuilder.mockReturnValue(queryBuilder);
    (verifyPassword as unknown as Mock).mockResolvedValue(true);

    await expect(service.verifyOneTimePassword('invite-token', 'correct-password')).rejects.toThrow('already been used');
    expect(execute).toHaveBeenCalled();
  });

  it('redeems an email invitation into onboarding state', async () => {
    const execute = vi.fn().mockResolvedValue({ affected: 1 });
    const queryBuilder = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      execute,
    };
    invitationRepo.createQueryBuilder.mockReturnValue(queryBuilder);
    invitationRepo.findOneBy.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      deliveryMethod: 'email',
      expiresAt: now + 60_000,
      status: 'pending',
      revokedAt: null,
      completedAt: null,
      inviteTokenHash: hashToken('invite-token'),
    });

    await expect(service.redeemEmailInvitation('invite-token')).resolves.toEqual({
      invitationId: 'inv-1',
      userId: 'user-1',
      tenantSlug: 'default',
    });
    expect(execute).toHaveBeenCalled();
  });

  it('allows reopening an already redeemed email invitation during onboarding', async () => {
    invitationRepo.findOneBy.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      deliveryMethod: 'email',
      expiresAt: now + 60_000,
      status: 'otp_verified',
      otpVerifiedAt: now - 500,
      revokedAt: null,
      completedAt: null,
      inviteTokenHash: hashToken('invite-token'),
    });

    await expect(service.redeemEmailInvitation('invite-token')).resolves.toEqual({
      invitationId: 'inv-1',
      userId: 'user-1',
      tenantSlug: 'default',
    });
    expect(invitationRepo.createQueryBuilder).not.toHaveBeenCalledWith(expect.anything());
  });

  it('rejects redeeming an expired email invitation', async () => {
    invitationRepo.findOneBy.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      deliveryMethod: 'email',
      expiresAt: now - 1,
      status: 'pending',
      revokedAt: null,
      completedAt: null,
      inviteTokenHash: hashToken('invite-token'),
    });

    await expect(service.redeemEmailInvitation('invite-token')).rejects.toThrow('expired');
  });

  it('completes onboarding and activates delayed project membership', async () => {
    invitationRepo.findOneBy.mockResolvedValue({
      id: 'inv-1',
      userId: 'user-1',
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceRole: 'viewer',
      resourceRolesJson: JSON.stringify(['delegate', 'viewer']),
      createdByUserId: 'admin-1',
      status: 'otp_verified',
      otpVerifiedAt: now - 1000,
      revokedAt: null,
      completedAt: null,
    });
    userRepo.findOneBy.mockResolvedValue({
      id: 'user-1',
      email: 'invitee@example.com',
      firstName: 'Invitee',
      lastName: 'Example',
      platformRole: 'user',
      isActive: true,
      isEmailVerified: false,
      mustResetPassword: true,
      createdAt: now - 10_000,
      lastLoginAt: null,
      createdByUserId: 'admin-1',
    });
    userRepo.findOneByOrFail.mockResolvedValue({
      id: 'user-1',
      email: 'invitee@example.com',
      firstName: 'Invitee',
      lastName: 'Example',
      platformRole: 'user',
      isActive: true,
      isEmailVerified: true,
      mustResetPassword: false,
      createdAt: now - 10_000,
      lastLoginAt: null,
    });
    (hashPassword as unknown as Mock).mockResolvedValue('new-password-hash');

    const result = await service.completeInvitation('inv-1', 'StrongPass!123');

    expect(managerUserRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({
        passwordHash: 'new-password-hash',
        mustResetPassword: false,
        isEmailVerified: true,
      }),
    );
    expect(projectMemberService.addMember).toHaveBeenCalledWith('project-1', 'user-1', ['delegate', 'viewer'], 'admin-1');
    expect(engineService.addEngineMember).not.toHaveBeenCalled();
    expect(managerInvitationRepo.update).toHaveBeenCalledWith(
      { id: 'inv-1' },
      expect.objectContaining({
        status: 'completed',
        completedAt: now,
      }),
    );
    expect(result.tenantSlug).toBe('default');
    expect(result.user.mustResetPassword).toBe(false);
    expect(result.user.isEmailVerified).toBe(true);
  });
});
