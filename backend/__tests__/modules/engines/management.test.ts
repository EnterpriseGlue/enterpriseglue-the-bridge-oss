import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import managementRouter from '../../../src/modules/engines/routes/management.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { User } from '../../../src/shared/db/entities/User.js';
import { errorHandler } from '../../../src/shared/middleware/errorHandler.js';
import { logAudit } from '../../../src/shared/services/audit.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'owner-1' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@shared/db/adapters/QueryHelpers.js', () => ({
  addCaseInsensitiveEquals: (_qb: any) => _qb,
}));

vi.mock('@shared/config/index.js', () => ({
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:5173',
  },
}));

vi.mock('@shared/constants/roles.js', () => ({
  ENGINE_VIEW_ROLES: ['owner', 'delegate', 'operator', 'viewer'],
  ENGINE_MANAGE_ROLES: ['owner', 'delegate'],
  MANAGE_ROLES: ['owner', 'delegate'],
}));

vi.mock('@shared/services/email/index.js', () => ({
  sendInvitationEmail: vi.fn(),
}));

vi.mock('@shared/services/platform-admin/index.js', () => ({
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
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com' }),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]) };
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

  it('rejects adding non-existent user in OSS', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });

    const response = await request(app)
      .post('/engines-api/engines/e1/members')
      .send({ email: 'nonexistent@example.com', role: 'operator' });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('not found');
  });
});
