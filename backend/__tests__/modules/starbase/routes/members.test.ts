import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import membersRouter from '../../../../src/modules/starbase/routes/members.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { ProjectMember } from '../../../../src/shared/db/entities/ProjectMember.js';
import { User } from '../../../../src/shared/db/entities/User.js';
import { logAudit } from '../../../../src/shared/services/audit.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'owner-1' };
    next();
  },
}));

vi.mock('@shared/middleware/projectAuth.js', () => ({
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
    hasRole: vi.fn().mockResolvedValue(true),
    getMembers: vi.fn().mockResolvedValue([]),
    getMembership: vi.fn().mockResolvedValue({ role: 'owner', roles: ['owner'] }),
    addMember: vi.fn().mockResolvedValue({ id: 'pm1', userId: 'target-1', role: 'viewer' }),
    updateRoles: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('starbase members routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(membersRouter);
    vi.clearAllMocks();
  });

  it('adds existing user as project member and logs audit', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({ id: 'target-1', email: 'target@example.com' }),
      }),
    };
    const memberRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === ProjectMember) return memberRepo;
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });

    const { projectMemberService } = await import('../../../../src/shared/services/platform-admin/ProjectMemberService.js');
    (projectMemberService.getMembership as Mock).mockResolvedValueOnce({ role: 'owner', roles: ['owner'] })
      .mockResolvedValueOnce(null);

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'target@example.com', roles: ['viewer'] });

    expect(response.status).toBe(201);
    expect(response.body.invited).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project.member.added',
      resourceType: 'project',
    }));
  });

  it('rejects adding non-existent user in OSS', async () => {
    const userRepo = {
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(null),
      }),
    };
    const memberRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === User) return userRepo;
        if (entity === ProjectMember) return memberRepo;
        return { find: vi.fn().mockResolvedValue([]) };
      },
    });

    const response = await request(app)
      .post('/starbase-api/projects/00000000-0000-0000-0000-000000000001/members')
      .send({ email: 'nonexistent@example.com', roles: ['viewer'] });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('not found');
  });
});
