import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import usersRouter from '../../../../packages/backend-host/src/modules/users/routes/users.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

const permissionGate = vi.hoisted(() => ({
  allowedPermissions: new Set<string>(),
  isAllowed(permission: string): boolean {
    const aliases: Record<string, string[]> = {
      'platform:users:view': ['platform:users:view', 'platform:user:view', 'platform:user:manage'],
      'platform:users:create': ['platform:users:create', 'platform:user:manage'],
      'platform:users:update': ['platform:users:update', 'platform:user:manage'],
      'platform:users:deactivate': ['platform:users:deactivate', 'platform:users:delete', 'platform:user:manage'],
      'platform:users:permanent-delete': ['platform:users:permanent-delete', 'platform:user:manage'],
      'platform:users:unlock': ['platform:users:unlock', 'platform:user:manage'],
    };
    return (aliases[permission] || [permission]).some((candidate) =>
      permissionGate.allowedPermissions.has(candidate)
    );
  },
  permissionService: {
    hasPermission: vi.fn(async (permission: string) => permissionGate.isAllowed(permission)),
  },
}));

const userDirectoryServiceMock = vi.hoisted(() => ({
  list: vi.fn(),
  identityContext: vi.fn(),
  effectiveAccess: vi.fn(),
  sessions: vi.fn(),
  audit: vi.fn(),
  deactivate: vi.fn(),
  reactivate: vi.fn(),
  revokeSessions: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  createUserLimiter: (_req: any, _res: any, next: any) => next(),
  identityAdminLimiter: (_req: any, _res: any, next: any) => next(),
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

vi.mock('@enterpriseglue/shared/services/platform-admin/UserDirectoryService.js', () => ({
  userDirectoryService: userDirectoryServiceMock,
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
    USER_MANAGE: 'platform:user:manage',
    USER_VIEW: 'platform:user:view',
    USERS_VIEW: 'platform:users:view',
    USERS_CREATE: 'platform:users:create',
    USERS_UPDATE: 'platform:users:update',
    USERS_DEACTIVATE: 'platform:users:deactivate',
    USERS_DELETE: 'platform:users:delete',
    USERS_PERMANENT_DELETE: 'platform:users:permanent-delete',
    USERS_UNLOCK: 'platform:users:unlock',
  },
  permissionService: permissionGate.permissionService,
}));

describe('users routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(usersRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:user:manage');

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
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:create');

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

  it('uses the preferred role field for the canonical user-management grant', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:create');
    (userService.createPendingUser as unknown as Mock).mockResolvedValue({ id: 'u-admin', email: 'admin@example.com' });
    (invitationService.createInvitation as unknown as Mock).mockResolvedValue({
      invitationId: 'inv-admin',
      inviteUrl: 'http://frontend.test/t/default/invite/token-admin',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    });

    const response = await request(app)
      .post('/api/users')
      .send({ email: 'admin@example.com', role: 'admin', sendEmail: false });

    expect(response.status).toBe(201);
    expect(userService.createPendingUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'admin@example.com',
      platformRole: 'admin',
    }));
    expect(invitationService.createInvitation).toHaveBeenCalledWith(expect.not.objectContaining({ platformRole: expect.anything() }));
  });

  it('keeps the deprecated platformRole alias compatible when the canonical role is omitted', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:create');
    (userService.createPendingUser as unknown as Mock).mockResolvedValue({ id: 'u-legacy-admin', email: 'legacy-admin@example.com' });
    (invitationService.createInvitation as unknown as Mock).mockResolvedValue({
      invitationId: 'inv-legacy-admin',
      inviteUrl: 'http://frontend.test/t/default/invite/token-legacy-admin',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    });

    const response = await request(app)
      .post('/api/users')
      .send({ email: 'legacy-admin@example.com', platformRole: 'admin', sendEmail: false });

    expect(response.status).toBe(201);
    expect(userService.createPendingUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'legacy-admin@example.com',
      platformRole: 'admin',
    }));
  });

  it('prefers the canonical role over the deprecated platformRole alias when both are supplied', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:create');
    (userService.createPendingUser as unknown as Mock).mockResolvedValue({ id: 'u-canonical-user', email: 'canonical-user@example.com' });
    (invitationService.createInvitation as unknown as Mock).mockResolvedValue({
      invitationId: 'inv-canonical-user',
      inviteUrl: 'http://frontend.test/t/default/invite/token-canonical-user',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    });

    const response = await request(app)
      .post('/api/users')
      .send({ email: 'canonical-user@example.com', role: 'user', platformRole: 'admin', sendEmail: false });

    expect(response.status).toBe(201);
    expect(userService.createPendingUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'canonical-user@example.com',
      platformRole: 'user',
    }));
  });

  it('lists users with granular users:view permission', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:view');
    (userService.listUsers as unknown as Mock).mockResolvedValue([{ id: 'u1', email: 'test@example.com' }]);

    const response = await request(app).get('/api/users');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'u1', email: 'test@example.com' }]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:users:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
  });

  it('gets user detail with granular users:view permission', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:view');
    (userService.getUser as unknown as Mock).mockResolvedValue({ id: 'user-2', email: 'other@example.com' });

    const response = await request(app).get('/api/users/user-2');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'user-2', email: 'other@example.com' });
    expect(userService.getUser).toHaveBeenCalledWith('user-2');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:users:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
  });

  it('lists the source-aware directory with validated filters and pagination', async () => {
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:view');
    userDirectoryServiceMock.list.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 50 });

    const response = await request(app).get('/api/users/directory?status=active&authenticationSource=oidc&provisioningSource=scim&limit=25&offset=50');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], total: 0, limit: 25, offset: 50 });
    expect(userDirectoryServiceMock.list).toHaveBeenCalledWith({
      status: 'active',
      authenticationSource: 'oidc',
      provisioningSource: 'scim',
      limit: 25,
      offset: 50,
      tenantId: null,
    });
  });

  it('returns source-aware identity, access, session, and audit details', async () => {
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:view');
    userDirectoryServiceMock.identityContext.mockResolvedValue({ user: { id: 'user-2' }, linkedIdentities: [] });
    userDirectoryServiceMock.effectiveAccess.mockResolvedValue({ userId: 'user-2', lineage: [] });
    userDirectoryServiceMock.sessions.mockResolvedValue({ userId: 'user-2', sessions: [] });
    userDirectoryServiceMock.audit.mockResolvedValue({ userId: 'user-2', events: [] });

    const identity = await request(app).get('/api/users/user-2/identity-context');
    const access = await request(app).get('/api/users/user-2/effective-access');
    const sessions = await request(app).get('/api/users/user-2/sessions');
    const audit = await request(app).get('/api/users/user-2/audit?limit=20');

    expect(identity.status).toBe(200);
    expect(access.status).toBe(200);
    expect(sessions.status).toBe(200);
    expect(audit.status).toBe(200);
    expect(userDirectoryServiceMock.identityContext).toHaveBeenCalledWith('user-2', null);
    expect(userDirectoryServiceMock.effectiveAccess).toHaveBeenCalledWith('user-2', null);
    expect(userDirectoryServiceMock.sessions).toHaveBeenCalledWith('user-2');
    expect(userDirectoryServiceMock.audit).toHaveBeenCalledWith('user-2', 20);
    expect(sessions.body).not.toHaveProperty('tokenHash');
  });

  it('validates lifecycle reasons and protects the signed-in user from deactivation', async () => {
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:deactivate');

    const malformed = await request(app).post('/api/users/user-2/deactivate').send({ reason: 'x' });
    const self = await request(app).post('/api/users/user-1/deactivate').send({ reason: 'Emergency response' });

    expect(malformed.status).toBe(400);
    expect(self.status).toBe(400);
    expect(userDirectoryServiceMock.deactivate).not.toHaveBeenCalled();
  });

  it('executes reasoned source-aware lifecycle actions with granular permissions', async () => {
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:deactivate');
    userDirectoryServiceMock.deactivate.mockResolvedValue({ userId: 'user-2', status: 'deactivated', authSessionVersion: 2, changedAt: 1000 });

    const deactivated = await request(app)
      .post('/api/users/user-2/deactivate')
      .send({ reason: 'Confirmed employee departure' });

    expect(deactivated.status).toBe(200);
    expect(userDirectoryServiceMock.deactivate).toHaveBeenCalledWith({
      userId: 'user-2',
      actorId: 'user-1',
      tenantId: null,
      reason: 'Confirmed employee departure',
    });

    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:update');
    userDirectoryServiceMock.reactivate.mockResolvedValue({ userId: 'user-2', status: 'active', authSessionVersion: 2, changedAt: 1001 });
    userDirectoryServiceMock.revokeSessions.mockResolvedValue({ userId: 'user-2', status: 'active', authSessionVersion: 3, changedAt: 1002 });

    const reactivated = await request(app).post('/api/users/user-2/reactivate').send({ reason: 'Return from leave' });
    const revoked = await request(app).post('/api/users/user-2/revoke-sessions').send({ reason: 'Device reported lost' });

    expect(reactivated.status).toBe(200);
    expect(revoked.status).toBe(200);
    expect(userDirectoryServiceMock.reactivate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-2', reason: 'Return from leave' }));
    expect(userDirectoryServiceMock.revokeSessions).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-2', reason: 'Device reported lost' }));
  });

  it('rejects user creation when only users:view is granted', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:view');

    const response = await request(app)
      .post('/api/users')
      .send({ email: 'test@example.com', platformRole: 'user' });

    expect(response.status).toBe(403);
    expect(userService.createPendingUser).not.toHaveBeenCalled();
  });

  it('updates a user with granular users:update permission', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:update');
    (userService.updateUser as unknown as Mock).mockResolvedValue({ id: 'user-2', firstName: 'Updated' });

    const response = await request(app)
      .put('/api/users/user-2')
      .send({ firstName: 'Updated' });

    expect(response.status).toBe(200);
    expect(userService.updateUser).toHaveBeenCalledWith('user-2', { firstName: 'Updated' });
  });

  it('uses the preferred role field when updating platform access', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:update');
    (userService.updateUser as unknown as Mock).mockResolvedValue({ id: 'user-2', platformRole: 'admin' });

    const response = await request(app)
      .put('/api/users/user-2')
      .send({ role: 'admin' });

    expect(response.status).toBe(200);
    expect(userService.updateUser).toHaveBeenCalledWith('user-2', { platformRole: 'admin' });
  });

  it('prefers the canonical role over the deprecated platformRole alias when updating platform access', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:update');
    (userService.updateUser as unknown as Mock).mockResolvedValue({ id: 'user-2', platformRole: 'user' });

    const response = await request(app)
      .put('/api/users/user-2')
      .send({ role: 'user', platformRole: 'admin' });

    expect(response.status).toBe(200);
    expect(userService.updateUser).toHaveBeenCalledWith('user-2', { platformRole: 'user' });
  });

  it('soft deactivates a user through DELETE /api/users/:id', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');

    const response = await request(app).delete('/api/users/user-2');

    expect(response.status).toBe(200);
    expect(userService.deactivateUser).toHaveBeenCalledWith('user-2');
  });

  it('soft deactivates a user with granular users:deactivate permission', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:deactivate');

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

  it('unlocks a user with granular users:unlock permission', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:unlock');

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

  it('permanently deletes with granular users:permanent-delete permission', async () => {
    const { userService } = await import('@enterpriseglue/shared/services/platform-admin/UserService.js');
    const { invitationService } = await import('@enterpriseglue/shared/services/invitations.js');
    permissionGate.allowedPermissions.clear();
    permissionGate.allowedPermissions.add('platform:users:permanent-delete');
    (invitationService.isLocalLoginDisabled as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).delete('/api/users/user-2/permanent');

    expect(response.status).toBe(200);
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
