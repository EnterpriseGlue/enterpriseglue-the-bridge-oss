import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import invitationsRouter from '../../../../packages/backend-host/src/modules/invitations/routes/invitations.js';
import onboardingRouter from '../../../../packages/backend-host/src/modules/auth/routes/onboarding.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { Engine } from '@enterpriseglue/shared/db/entities/Engine.js';
import { RefreshToken } from '@enterpriseglue/shared/db/entities/RefreshToken.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';
import { userService } from '@enterpriseglue/shared/services/platform-admin/UserService.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { engineService } from '@enterpriseglue/shared/services/platform-admin/EngineService.js';
import { buildUserCapabilities } from '@enterpriseglue/shared/services/capabilities.js';
import { getEmailConfigForTenant } from '@enterpriseglue/shared/services/email/index.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', async () => {
  const actual = await vi.importActual<typeof import('@enterpriseglue/shared/middleware/auth.js')>('@enterpriseglue/shared/middleware/auth.js');
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'admin-1', email: 'admin@example.com', platformRole: 'admin' };
      next();
    },
    requireOnboarding: (req: any, _res: any, next: any) => {
      req.onboarding = { invitationId: 'inv-1', userId: 'user-1', email: 'invitee@example.com', type: 'onboarding', platformRole: 'user' };
      next();
    },
  };
});

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  createUserLimiter: (_req: any, _res: any, next: any) => next(),
  passwordResetVerifyLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/db/adapters/QueryHelpers.js', () => ({
  addCaseInsensitiveEquals: (qb: any) => qb,
}));

vi.mock('@enterpriseglue/shared/services/invitations.js', () => ({
  invitationService: {
    createInvitation: vi.fn(),
    getInvitationInfo: vi.fn(),
    isLocalLoginDisabled: vi.fn(),
    verifyOneTimePassword: vi.fn(),
    redeemEmailInvitation: vi.fn(),
    completeInvitation: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/email/index.js', () => ({
  getEmailConfigForTenant: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/UserService.js', () => ({
  userService: {
    createPendingUser: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    getMembership: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EngineService.js', () => ({
  engineService: {
    hasEngineAccess: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/utils/jwt.js', () => ({
  generateOnboardingToken: vi.fn().mockReturnValue('onboarding-token'),
  generateAccessToken: vi.fn().mockReturnValue('access-token'),
  generateRefreshToken: vi.fn().mockReturnValue('refresh-token'),
}));

vi.mock('@enterpriseglue/shared/utils/password.js', () => ({
  validatePassword: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

vi.mock('@enterpriseglue/shared/services/capabilities.js', () => ({
  buildUserCapabilities: vi.fn().mockResolvedValue({ canManageUsers: false }),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    nodeEnv: 'test',
    jwtAccessTokenExpires: 900,
    jwtRefreshTokenExpires: 604800,
  },
}));

describe('invitation and onboarding routes', () => {
  let app: express.Application;
  let userRepo: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    findOneByOrFail: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let projectRepo: {
    findOne: ReturnType<typeof vi.fn>;
  };
  let engineRepo: {
    findOne: ReturnType<typeof vi.fn>;
  };
  let refreshTokenRepo: {
    insert: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(invitationsRouter);
    app.use(onboardingRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
      findOneBy: vi.fn().mockResolvedValue({ id: 'user-1', email: 'invitee@example.com', platformRole: 'user' }),
      findOneByOrFail: vi.fn().mockResolvedValue({ id: 'user-1', email: 'invitee@example.com', platformRole: 'user', isEmailVerified: true, mustResetPassword: false }),
      update: vi.fn().mockResolvedValue(undefined),
    };

    projectRepo = {
      findOne: vi.fn().mockResolvedValue({ name: 'Project One' }),
    };

    engineRepo = {
      findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }),
    };

    refreshTokenRepo = {
      insert: vi.fn().mockResolvedValue(undefined),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === Project) return projectRepo;
        if (entity === Engine) return engineRepo;
        if (entity === RefreshToken) return refreshTokenRepo;
        throw new Error('Unexpected repository');
      },
    });

    (projectMemberService.getMembership as unknown as Mock).mockResolvedValue({ role: 'owner', roles: ['owner'] });
    (engineService.hasEngineAccess as unknown as Mock).mockResolvedValue(true);
    (getEmailConfigForTenant as unknown as Mock).mockResolvedValue(null);
    (userService.createPendingUser as unknown as Mock).mockResolvedValue({ id: 'user-1', email: 'invitee@example.com' });
    (invitationService.createInvitation as unknown as Mock).mockResolvedValue({
      invitationId: 'inv-1',
      inviteUrl: 'http://frontend.test/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    });
    (invitationService.isLocalLoginDisabled as unknown as Mock).mockResolvedValue(false);
    (invitationService.getInvitationInfo as unknown as Mock).mockResolvedValue({
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'project',
      resourceName: 'Project One',
      resourceRole: 'viewer',
      resourceRoles: ['viewer'],
      deliveryMethod: 'manual',
      expiresAt: 1_700_000_000_000,
      status: 'pending',
    });
    (invitationService.verifyOneTimePassword as unknown as Mock).mockResolvedValue({
      invitationId: 'inv-1',
      userId: 'user-1',
      tenantSlug: 'default',
    });
    (invitationService.redeemEmailInvitation as unknown as Mock).mockResolvedValue({
      invitationId: 'inv-1',
      userId: 'user-1',
      tenantSlug: 'default',
    });
    (invitationService.completeInvitation as unknown as Mock).mockResolvedValue({
      tenantSlug: 'default',
      user: {
        id: 'user-1',
        email: 'invitee@example.com',
        platformRole: 'user',
        isActive: true,
        isEmailVerified: true,
        mustResetPassword: false,
        createdAt: 1,
      },
    });
  });

  it('returns invitation capabilities including email configuration readiness', async () => {
    const response = await request(app).get('/api/t/default/invitations/capabilities');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ssoRequired: false,
      emailConfigured: false,
    });
  });

  it('creates a manual invitation and returns reveal-once onboarding details', async () => {
    const response = await request(app)
      .post('/api/t/default/invitations')
      .send({
        email: 'invitee@example.com',
        resourceType: 'project',
        resourceId: 'project-1',
        role: 'viewer',
        deliveryMethod: 'manual',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      invited: true,
      emailSent: false,
      inviteUrl: 'http://frontend.test/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
    }));
    expect(invitationService.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      tenantSlug: 'default',
      resourceType: 'project',
      resourceId: 'project-1',
      resourceName: 'Project One',
      resourceRole: 'viewer',
      deliveryMethod: 'manual',
    }));
  });

  it('creates an email invitation without revealing OTP details in the response', async () => {
    (invitationService.createInvitation as unknown as Mock).mockResolvedValueOnce({
      invitationId: 'inv-2',
      inviteUrl: 'http://frontend.test/t/default/invite/token-2',
      oneTimePassword: 'ShouldNotLeak123!',
      emailSent: true,
    });

    const response = await request(app)
      .post('/api/t/default/invitations')
      .send({
        email: 'invitee@example.com',
        resourceType: 'tenant',
        deliveryMethod: 'email',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      invited: true,
      emailSent: true,
    }));
    expect(response.body).not.toHaveProperty('oneTimePassword');
    expect(response.body).not.toHaveProperty('inviteUrl');
    expect(invitationService.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      deliveryMethod: 'email',
      resourceType: 'tenant',
    }));
  });

  it('verifies one-time password and sets onboarding cookie', async () => {
    const response = await request(app)
      .post('/api/invitations/token-1/verify-otp')
      .send({ oneTimePassword: 'RevealMe123!' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ requiresPasswordSet: true, tenantSlug: 'default', deliveryMethod: 'manual' });
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('onboardingToken=onboarding-token')]),
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.invitation.otp_verified',
      resourceType: 'invitation',
      resourceId: 'inv-1',
      details: expect.objectContaining({
        deliveryMethod: 'manual',
        invitedEmail: 'invitee@example.com',
      }),
    }));
  });

  it('redeems an email invite and sets onboarding cookie', async () => {
    (invitationService.getInvitationInfo as unknown as Mock).mockResolvedValueOnce({
      email: 'invitee@example.com',
      tenantSlug: 'default',
      resourceType: 'tenant',
      resourceName: 'default',
      resourceRole: null,
      resourceRoles: [],
      deliveryMethod: 'email',
      expiresAt: 1_700_000_000_000,
      status: 'pending',
    });

    const response = await request(app)
      .post('/api/invitations/token-1/redeem')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ requiresPasswordSet: true, tenantSlug: 'default', deliveryMethod: 'email' });
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('onboardingToken=onboarding-token')]),
    );
    expect(invitationService.redeemEmailInvitation).toHaveBeenCalledWith('token-1');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.invitation.email_redeemed',
      resourceType: 'invitation',
      resourceId: 'inv-1',
      details: expect.objectContaining({
        deliveryMethod: 'email',
        invitedEmail: 'invitee@example.com',
      }),
    }));
  });

  it('completes onboarding and issues auth cookies', async () => {
    const response = await request(app)
      .post('/api/auth/complete-onboarding')
      .set('Cookie', ['onboardingToken=onboarding-token'])
      .send({ firstName: 'Invitee', lastName: 'Example', newPassword: 'StrongPass!123' });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('invitee@example.com');
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('onboardingToken=;'),
        expect.stringContaining('accessToken=access-token'),
        expect.stringContaining('refreshToken=refresh-token'),
      ]),
    );
    expect(invitationService.completeInvitation).toHaveBeenCalledWith('inv-1', 'StrongPass!123', {
      firstName: 'Invitee',
      lastName: 'Example',
    });
    expect(refreshTokenRepo.insert).toHaveBeenCalled();
    expect(buildUserCapabilities).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });
});
