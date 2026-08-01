import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import loginRouter from '../../../../../packages/backend-host/src/modules/auth/routes/login.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { verifyPassword } from '@enterpriseglue/shared/utils/password.js';
import { buildUserCapabilities } from '@enterpriseglue/shared/services/capabilities.js';
import { getDatabaseType } from '@enterpriseglue/shared/db/adapters/QueryHelpers.js';
import { authzGroupService } from '@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js';

const getActivePlatformAdministratorUserIds = vi.hoisted(() => vi.fn().mockResolvedValue(new Set()));
const authSessionService = vi.hoisted(() => ({ issue: vi.fn() }));
const loginMethodService = vi.hoisted(() => ({ ordinaryLocalPasswordEnabled: vi.fn().mockResolvedValue(true) }));
const recordLoginExperienceMetric = vi.hoisted(() => vi.fn());

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/utils/password.js', () => ({
  verifyPassword: vi.fn().mockResolvedValue(false),
}));

vi.mock('@enterpriseglue/shared/services/capabilities.js', () => ({
  buildUserCapabilities: vi.fn().mockResolvedValue({ canManagePlatform: false }),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PlatformAdministratorMembershipService.js', () => ({
  getActivePlatformAdministratorUserIds,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/AuthzGroupService.js', () => ({
  authzGroupService: {
    ensureAuthenticatedUserMembershipWithManager: vi.fn().mockResolvedValue({ id: 'membership-1', created: true }),
  },
}));

vi.mock('@enterpriseglue/shared/db/adapters/QueryHelpers.js', () => ({
  addCaseInsensitiveEquals: (qb: any) => qb,
  getDatabaseType: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('@enterpriseglue/shared/services/AuthSessionService.js', () => ({ authSessionService }));
vi.mock('@enterpriseglue/shared/services/platform-admin/LoginMethodService.js', () => ({ loginMethodService }));
vi.mock('@enterpriseglue/shared/auth/login-experience-metrics.js', () => ({ recordLoginExperienceMetric }));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: {
    LOGIN_FAILED: 'LOGIN_FAILED',
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  authLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
}));

describe('auth login routes', () => {
  let app: express.Application;
  let userRepo: {
    createQueryBuilder: Mock;
    update: Mock;
    insert: Mock;
  };
  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(loginRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    getActivePlatformAdministratorUserIds.mockResolvedValue(new Set());
    loginMethodService.ordinaryLocalPasswordEnabled.mockResolvedValue(true);
    authSessionService.issue.mockResolvedValue({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 });

    userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
      update: vi.fn(),
      insert: vi.fn(),
    };

    const getRepository = (entity: unknown) => {
      if (entity === User) return userRepo;
      return {};
    };
    const manager = { getRepository };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository,
      transaction: vi.fn(async (callback: (providedManager: typeof manager) => unknown) => callback(manager)),
    });
  });

  it('blocks local login when SSO policy is active', async () => {
    loginMethodService.ordinaryLocalPasswordEnabled.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'Password123!' });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Local login is disabled. Please use your organization sign-in.');
    expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith({ method: 'local', event: 'selected' });
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith(expect.objectContaining({ method: 'local', event: 'failed' }));
  });

  it('does not expose administrator recovery through the ordinary login route', async () => {
    loginMethodService.ordinaryLocalPasswordEnabled.mockResolvedValue(false);
    getActivePlatformAdministratorUserIds.mockResolvedValue(new Set(['break-glass-1']));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'break-glass@example.com', password: 'Password123!' });

    expect(response.status).toBe(403);
    expect(getActivePlatformAdministratorUserIds).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('allows a canonical local platform administrator to use the dedicated recovery route', async () => {
    getActivePlatformAdministratorUserIds.mockResolvedValue(new Set(['break-glass-1']));
    (verifyPassword as unknown as Mock).mockResolvedValue(true);
    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'break-glass-1',
        email: 'break-glass@example.com',
        authProvider: 'local',
        passwordHash: 'local-password-hash',
        failedLoginAttempts: 0,
        lockedUntil: null,
        isEmailVerified: true,
        firstName: 'Break',
        lastName: 'Glass',
        mustResetPassword: false,
        createdByUserId: null,
      }),
    });

    const response = await request(app)
      .post('/api/auth/recovery/login')
      .send({ email: 'break-glass@example.com', password: 'Password123!' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: 'break-glass-1', platformRole: 'admin' });
    expect(getActivePlatformAdministratorUserIds).toHaveBeenCalledWith(['break-glass-1'], expect.any(Object));
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(expect.any(Object), 'break-glass-1');
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith({ method: 'recovery', event: 'selected' });
    expect(recordLoginExperienceMetric).toHaveBeenCalledWith(expect.objectContaining({ method: 'recovery', event: 'succeeded' }));
  });

  it('revokes break-glass access immediately when the canonical administrator membership is removed', async () => {
    getActivePlatformAdministratorUserIds
      .mockResolvedValueOnce(new Set(['break-glass-1']))
      .mockResolvedValueOnce(new Set());
    (verifyPassword as unknown as Mock).mockResolvedValue(true);
    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'break-glass-1',
        email: 'break-glass@example.com',
        authProvider: 'local',
        passwordHash: 'local-password-hash',
        failedLoginAttempts: 0,
        lockedUntil: null,
        isEmailVerified: true,
        firstName: 'Break',
        lastName: 'Glass',
        mustResetPassword: false,
        createdByUserId: null,
      }),
    });

    const beforeRemoval = await request(app)
      .post('/api/auth/recovery/login')
      .send({ email: 'break-glass@example.com', password: 'Password123!' });
    const afterRemoval = await request(app)
      .post('/api/auth/recovery/login')
      .send({ email: 'break-glass@example.com', password: 'Password123!' });

    expect(beforeRemoval.status).toBe(200);
    expect(afterRemoval.status).toBe(403);
    expect(afterRemoval.body.error).toContain('Administrator recovery is unavailable.');
    expect(getActivePlatformAdministratorUserIds).toHaveBeenNthCalledWith(1, ['break-glass-1'], expect.any(Object));
    expect(getActivePlatformAdministratorUserIds).toHaveBeenNthCalledWith(2, ['break-glass-1'], expect.any(Object));
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('keeps local non-administrator accounts blocked while SSO is active', async () => {
    getActivePlatformAdministratorUserIds.mockResolvedValue(new Set());
    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'local-user-1',
        email: 'local@example.com',
        authProvider: 'local',
        passwordHash: 'local-password-hash',
        isActive: true,
      }),
    });

    const response = await request(app)
      .post('/api/auth/recovery/login')
      .send({ email: 'local@example.com', password: 'Password123!' });

    expect(response.status).toBe(403);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).not.toHaveBeenCalled();
  });

  it('blocks local login for an enabled direct provider-neutral identity provider', async () => {
    loginMethodService.ordinaryLocalPasswordEnabled.mockResolvedValue(false);
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'Password123!' });
    expect(response.status).toBe(403);
    expect(loginMethodService.ordinaryLocalPasswordEnabled).toHaveBeenCalledWith(null);
  });

  it('blocks local login for non-local accounts', async () => {
    const getOne = vi.fn().mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      authProvider: 'microsoft',
      passwordHash: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      isEmailVerified: true,
      platformRole: 'user',
      createdByUserId: null,
    });
    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne,
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'Password123!' });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('Local login is disabled for this account. Please use SSO.');
    expect(verifyPassword as unknown as Mock).not.toHaveBeenCalled();
  });

  it('logs in local account and sets auth cookies', async () => {
    (getDatabaseType as unknown as Mock).mockReturnValue('postgres');
    (verifyPassword as unknown as Mock).mockResolvedValue(true);

    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        authProvider: 'local',
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        lockedUntil: null,
        isEmailVerified: true,
        platformRole: 'user',
        firstName: 'Test',
        lastName: 'User',
        mustResetPassword: false,
        createdByUserId: null,
      }),
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'Password123!' });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('user@example.com');
    expect(response.body.user.session).toEqual({
      principal: { type: 'user', id: 'user-1' },
      tenant: { id: null },
    });
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('accessToken='),
        expect.stringContaining('refreshToken='),
      ])
    );
    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: null })
    );
    expect(authzGroupService.ensureAuthenticatedUserMembershipWithManager).toHaveBeenCalledWith(
      expect.objectContaining({ getRepository: expect.any(Function) }),
      'user-1',
    );
    expect(authSessionService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', email: 'user@example.com' }),
      expect.any(Object),
    );
    expect(buildUserCapabilities as unknown as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', tenantId: null })
    );
  });

  it('tracks failed password attempts for local account', async () => {
    (getDatabaseType as unknown as Mock).mockReturnValue('postgres');
    (verifyPassword as unknown as Mock).mockResolvedValue(false);

    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        authProvider: 'local',
        passwordHash: 'hash',
        failedLoginAttempts: 0,
        lockedUntil: null,
        isEmailVerified: true,
        platformRole: 'user',
        createdByUserId: null,
      }),
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'WrongPass!' });

    expect(response.status).toBe(401);
    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({ failedLoginAttempts: 1, lockedUntil: null })
    );
  });

  it('locks account after 5th failed attempt', async () => {
    (getDatabaseType as unknown as Mock).mockReturnValue('postgres');
    (verifyPassword as unknown as Mock).mockResolvedValue(false);

    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        authProvider: 'local',
        passwordHash: 'hash',
        failedLoginAttempts: 4,
        lockedUntil: null,
        isEmailVerified: true,
        platformRole: 'user',
        createdByUserId: null,
      }),
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'WrongPass!' });

    expect(response.status).toBe(423);
    expect(response.body.error).toContain('Account locked due to too many failed attempts');
    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      expect.objectContaining({
        failedLoginAttempts: 5,
        lockedUntil: expect.any(Number),
      })
    );
  });

  it('rejects login when account is already locked', async () => {
    (getDatabaseType as unknown as Mock).mockReturnValue('postgres');

    userRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue({
        id: 'user-1',
        email: 'user@example.com',
        authProvider: 'local',
        passwordHash: 'hash',
        failedLoginAttempts: 5,
        lockedUntil: Date.now() + 60_000,
        isEmailVerified: true,
        platformRole: 'user',
        createdByUserId: null,
      }),
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'Password123!' });

    expect(response.status).toBe(423);
    expect(response.body.error).toContain('temporarily locked');
    expect(verifyPassword as unknown as Mock).not.toHaveBeenCalled();
  });

  it('uses numeric active filter when database type is oracle', async () => {
    (getDatabaseType as unknown as Mock).mockReturnValue('oracle');

    const where = vi.fn().mockReturnThis();
    userRepo.createQueryBuilder.mockReturnValue({
      where,
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'Password123!' });

    expect(where).toHaveBeenCalledWith('u.isActive = :isActive', { isActive: 1 });
    expect(response.status).toBe(401);
  });
});
