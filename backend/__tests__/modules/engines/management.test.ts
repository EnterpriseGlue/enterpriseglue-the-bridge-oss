import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import managementRouter from '../../../../packages/backend-host/src/modules/engines/routes/management.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { User } from '@enterpriseglue/shared/db/entities/User.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { logAudit } from '@enterpriseglue/shared/services/audit.js';
import { invitationService } from '@enterpriseglue/shared/services/invitations.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'owner-1', email: 'owner@example.com' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/adapters/QueryHelpers.js', () => ({
  addCaseInsensitiveEquals: (_qb: any) => _qb,
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:5173',
  },
}));

vi.mock('@enterpriseglue/shared/constants/roles.js', () => ({
  ENGINE_VIEW_ROLES: ['owner', 'delegate', 'operator', 'viewer'],
  ENGINE_MANAGE_ROLES: ['owner', 'delegate'],
  MANAGE_ROLES: ['owner', 'delegate'],
}));

vi.mock('@enterpriseglue/shared/services/email/index.js', () => ({
  sendInvitationEmail: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/invitations.js', () => ({
  invitationService: {
    createInvitation: vi.fn().mockResolvedValue({
      invitationId: 'inv-1',
      inviteUrl: 'http://localhost:5173/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
      emailSent: false,
    }),
    isLocalLoginDisabled: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/UserService.js', () => ({
  userService: {
    createPendingUser: vi.fn().mockResolvedValue({ id: 'pending-1', email: 'nonexistent@example.com' }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  engineService: {
    canManageEngine: vi.fn().mockResolvedValue(true),
    canViewEngine: vi.fn().mockResolvedValue(true),
    getEngineMembers: vi.fn().mockResolvedValue([]),
    getEngineRole: vi.fn().mockResolvedValue(null),
    getUserEngines: vi.fn().mockResolvedValue([]),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
    listEngines: vi.fn().mockResolvedValue([]),
    addEngineMember: vi.fn().mockResolvedValue({ id: 'em1', userId: 'target-1', role: 'operator' }),
  },
  engineAccessService: {},
  projectMemberService: {},
}));

describe('engines management routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(managementRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
      }),
    });
  });

  it('gets engine members list', async () => {
    const response = await request(app).get('/engines-api/engines/e1/members');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ members: [], pendingInvites: [] });
  });

  it('gets current user role on engine', async () => {
    const response = await request(app).get('/engines-api/engines/e1/my-role');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('role');
  });

  it('gets user engines list', async () => {
    const response = await request(app).get('/engines-api/my-engines');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('adds existing user as engine member and logs audit', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com', passwordHash: 'hash' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'target@example.com', role: 'operator' });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'engine.member.added',
      resourceType: 'engine',
    }));
  });

  it('creates an invitation for a non-existent engine user', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'nonexistent@example.com', role: 'operator' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      invited: true,
      emailSent: false,
      inviteUrl: 'http://localhost:5173/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
    }));
  });

  it('rejects delegate role on the generic engine members endpoint', async () => {
    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'target@example.com', role: 'delegate' });

    expect(response.status).toBe(400);
  });

  it('reissues a manual engine invitation', async () => {
    const invitationId = '11111111-1111-4111-8111-111111111111';
    const invitationRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({
        id: invitationId,
        resourceType: 'engine',
        resourceId: 'e1',
        userId: 'pending-1',
        email: 'pending@example.com',
        tenantSlug: 'default',
        resourceName: 'Engine One',
        resourceRole: 'operator',
        deliveryMethod: 'manual',
        status: 'pending',
        revokedAt: null,
        completedAt: null,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) {
          return {
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if ((entity as any)?.name === 'Invitation') return invitationRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue({ name: 'Engine One' }) };
      },
    });

    const response = await request(app)
      .post(`/engines-api/engines/e1/pending-invites/${invitationId}/reissue`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      invited: true,
      emailSent: false,
      inviteUrl: 'http://localhost:5173/t/default/invite/token-1',
      oneTimePassword: 'RevealMe123!',
    }));
    expect(invitationService.createInvitation).toHaveBeenCalled();
  });
});
