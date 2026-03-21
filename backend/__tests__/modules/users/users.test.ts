import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import usersRouter from '../../../../packages/backend-host/src/modules/users/routes/users.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  createUserLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/middleware/validate.js', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/UserService.js', () => ({
  userService: {
    createPendingUser: vi.fn(),
    listUsers: vi.fn().mockResolvedValue([]),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    deactivateUser: vi.fn(),
    deleteUserPermanently: vi.fn(),
    unlockUser: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/invitations.js', () => ({
  invitationService: {
    createInvitation: vi.fn(),
    isLocalLoginDisabled: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
  AuditActions: { USER_CREATE: 'USER_CREATE' },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    USER_MANAGE: 'user:manage',
  },
}));

describe('users routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(usersRouter);
    vi.clearAllMocks();

    const userRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com' }),
      save: vi.fn().mockResolvedValue({ id: 'u1', email: 'test@example.com' }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), save: vi.fn(), delete: vi.fn() };
      },
    });
  });

  it('creates a platform user via onboarding invitation and returns reveal-once credentials for manual delivery', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');

    (userService.createPendingUser as unknown as Mock).mockResolvedValue({
      id: 'u1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      platformRole: 'user',
    });
    (invitationService.createInvitation as unknown as Mock).mockResolvedValue({
      invitationId: 'inv-1',
      inviteUrl: 'http://frontend.test/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    });

    const response = await request(app)
      .post('/api/users')
      .send({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        platformRole: 'user',
        sendEmail: false,
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      user: expect.objectContaining({
        id: 'u1',
        email: 'test@example.com',
        platformRole: 'user',
      }),
      inviteUrl: 'http://frontend.test/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    }));
    expect(invitationService.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      tenantSlug: 'default',
      resourceType: 'platform_user',
      deliveryMethod: 'manual',
    }));
  });

  it('soft deactivates a user through DELETE /api/users/:id', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');

    const response = await request(app).delete('/api/users/user-2');

    expect(response.status).toBe(200);
    expect(userService.deactivateUser).toHaveBeenCalledWith('user-2');
  });

  it('unlocks a user through POST /api/users/:id/unlock', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');

    const response = await request(app).post('/api/users/user-2/unlock');

    expect(response.status).toBe(200);
    expect(userService.unlockUser).toHaveBeenCalledWith('user-2');
  });

  it('permanently deletes a safe pending local user when local login is enabled', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');

    (invitationService.isLocalLoginDisabled as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).delete('/api/users/user-2/permanent');

    expect(response.status).toBe(200);
    expect(invitationService.isLocalLoginDisabled).toHaveBeenCalled();
    expect(userService.deleteUserPermanently).toHaveBeenCalledWith('user-2');
  });

  it('blocks permanent delete while local login is disabled by SSO policy', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');

    (invitationService.isLocalLoginDisabled as unknown as Mock).mockResolvedValue(true);

    const response = await request(app).delete('/api/users/user-2/permanent');

    expect(response.status).toBe(403);
    expect(userService.deleteUserPermanently).not.toHaveBeenCalled();
  });
});
