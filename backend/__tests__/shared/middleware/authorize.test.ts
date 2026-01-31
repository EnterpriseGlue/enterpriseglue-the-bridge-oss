import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authorize } from '../../../src/shared/middleware/authorize.js';
import { Errors } from '../../../src/shared/middleware/errorHandler.js';
import { projectMemberService } from '../../../src/shared/services/platform-admin/ProjectMemberService.js';
import { engineService } from '../../../src/shared/services/platform-admin/EngineService.js';
import { logAudit } from '../../../src/shared/services/audit.js';

vi.mock('@shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    getMembership: vi.fn(),
  },
}));

vi.mock('@shared/services/platform-admin/EngineService.js', () => ({
  engineService: {
    getEngineRole: vi.fn(),
  },
}));

vi.mock('@shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

describe('authorize middleware', () => {
  let req: any;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      user: { userId: 'user-1', platformRole: 'user' },
      params: {},
      body: {},
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      path: '/api/test',
      method: 'GET',
    };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
  });

  it('allows platform admin role', async () => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    const middleware = authorize({ platformRoles: ['admin'] });

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  it('denies when missing user', async () => {
    req.user = undefined;
    const middleware = authorize({ platformRoles: ['admin'] });

    await expect(middleware(req as Request, res as Response, next)).rejects.toEqual(
      Errors.unauthorized('Authentication required')
    );
  });

  it('adds project membership info on success', async () => {
    (projectMemberService.getMembership as any).mockResolvedValue({
      role: 'owner',
      projectId: 'project-1',
    });
    req.params = { projectId: 'project-1' } as any;

    const middleware = authorize({ projectRoles: ['owner', 'delegate'] });
    await middleware(req as Request, res as Response, next);

    expect((req as any).projectRole).toBe('owner');
    expect(next).toHaveBeenCalled();
  });

  it('logs denial when roles do not match', async () => {
    (engineService.getEngineRole as any).mockResolvedValue('operator');
    req.params = { engineId: 'engine-1' } as any;

    const middleware = authorize({ engineRoles: ['owner'], auditDenials: true });

    await expect(middleware(req as Request, res as Response, next)).rejects.toEqual(
      Errors.internal('Authorization check failed')
    );

    expect(logAudit).toHaveBeenCalled();
  });

  it('runs custom checks', async () => {
    const middleware = authorize({
      custom: async () => true,
    });

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });
});
