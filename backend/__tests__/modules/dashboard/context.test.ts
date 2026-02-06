import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import contextRouter from '../../../src/modules/dashboard/routes/context.js';
import { getDataSource } from '../../../src/shared/db/data-source.js';
import { Engine } from '../../../src/shared/db/entities/Engine.js';
import { EngineMember } from '../../../src/shared/db/entities/EngineMember.js';
import { ProjectMember } from '../../../src/shared/db/entities/ProjectMember.js';
import { Project } from '../../../src/shared/db/entities/Project.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'user' };
    next();
  },
}));

vi.mock('@shared/middleware/platformAuth.js', () => ({
  isPlatformAdmin: (req: any) => req.user?.platformRole === 'admin',
}));

describe('GET /api/dashboard/context', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(contextRouter);
    vi.clearAllMocks();
  });

  it('returns context for regular user', async () => {
    const engineRepo = { find: vi.fn().mockResolvedValue([]) };
    const engineMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return engineMemberRepo;
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(response.body.isPlatformAdmin).toBe(false);
    expect(response.body.ownedEngineIds).toEqual([]);
    expect(response.body.projectMemberships).toEqual([]);
  });

  it('returns context with engine ownership', async () => {
    const engineRepo = { find: vi.fn().mockResolvedValue([{ id: 'engine-1' }]) };
    const engineMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return engineMemberRepo;
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(response.body.ownedEngineIds).toEqual(['engine-1']);
    expect(response.body.canViewEngines).toBe(true);
  });

  it('returns context with project memberships', async () => {
    const engineRepo = { find: vi.fn().mockResolvedValue([]) };
    const engineMemberRepo = { find: vi.fn().mockResolvedValue([]) };
    const projectMemberRepo = { find: vi.fn().mockResolvedValue([
      { projectId: 'project-1', role: 'owner' }
    ]) };
    const projectRepo = { find: vi.fn().mockResolvedValue([
      { id: 'project-1', name: 'Test Project' }
    ]) };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return engineRepo;
        if (entity === EngineMember) return engineMemberRepo;
        if (entity === ProjectMember) return projectMemberRepo;
        if (entity === Project) return projectRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app).get('/api/dashboard/context');

    expect(response.status).toBe(200);
    expect(response.body.projectMemberships).toHaveLength(1);
    expect(response.body.projectMemberships[0].projectName).toBe('Test Project');
    expect(response.body.canViewDeployments).toBe(true);
  });
});
