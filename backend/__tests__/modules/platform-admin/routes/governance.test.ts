import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import governanceRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/governance.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  engineService,
  projectMemberService,
} from '@enterpriseglue/shared/services/platform-admin/index.js';

const accessAuthorityDecisionMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/audit.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/requirePermission.js', () => ({
  requirePermission: () => (req: any, _res: unknown, next: () => void) => {
    req.user = { userId: 'admin-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/requireAction.js', () => ({
  requireAction: () => (req: any, _res: unknown, next: () => void) => {
    req.user = { userId: 'access-admin-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  getAccessAuthorityDecision: accessAuthorityDecisionMock,
  projectMemberService: {
    addMember: vi.fn().mockResolvedValue(undefined),
  },
  engineService: {
    transferOwnership: vi.fn().mockResolvedValue(undefined),
    assignDelegate: vi.fn().mockResolvedValue(undefined),
  },
  policyService: {
    listPolicies: vi.fn().mockResolvedValue([]),
  },
}));

describe('platform-admin governance routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(governanceRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    accessAuthorityDecisionMock.mockResolvedValue(null);

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn(),
      }),
    });
  });

  it('serializes governance user-search results through the shared safe schema', async () => {
    const qb = {
      select: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'user-1', email: 'owner@example.test', firstName: 'Owner', lastName: null,
        passwordHash: 'must-not-leak',
      }]),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ createQueryBuilder: vi.fn().mockReturnValue(qb) }),
    });

    const response = await request(app).get('/users/search').query({ q: 'owner' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id: 'user-1', email: 'owner@example.test', firstName: 'Owner', lastName: null,
    }]);
    expect(response.body[0]).not.toHaveProperty('passwordHash');
  });

  it('keeps project governance readable but rejects owner assignment when project access is SSO-managed', async () => {
    accessAuthorityDecisionMock.mockImplementation(async (resourceType) => resourceType === 'project'
      ? {
          domain: 'project',
          mode: 'sso_managed',
          manualMutationsAllowed: false,
          reason: 'Project access is SSO-managed; manual access changes are disabled',
        }
      : null);
    const qb = {
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ createQueryBuilder: vi.fn().mockReturnValue(qb) }),
    });

    const listResponse = await request(app).get('/projects');
    expect(listResponse.status).toBe(200);

    const mutationResponse = await request(app)
      .post('/projects/00000000-0000-4000-8000-000000000001/assign-owner')
      .send({
        userId: '00000000-0000-4000-8000-000000000002',
        reason: 'Recovery',
      });

    expect(mutationResponse.status).toBe(403);
    expect(projectMemberService.addMember).not.toHaveBeenCalled();
  });

  it('returns non-secret engine candidates for access-control selectors', async () => {
    const qb = {
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([{
        id: 'engine-1',
        name: 'Operations',
        type: 'operaton',
        lifecycleStatus: 'active',
        username: 'must-not-leak',
        passwordEnc: 'must-not-leak',
        createdAt: 123,
      }]),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ createQueryBuilder: vi.fn().mockReturnValue(qb) }),
    });

    const response = await request(app).get('/engines');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id: 'engine-1',
      name: 'Operations',
      type: 'operaton',
      lifecycleStatus: 'active',
      ownerEmail: null,
      ownerName: null,
      delegateEmail: null,
      delegateName: null,
      createdAt: 123,
    }]);
    expect(response.body[0]).not.toHaveProperty('username');
    expect(response.body[0]).not.toHaveProperty('passwordEnc');
  });

  it('rejects engine governance assignment when engine access is SSO-managed', async () => {
    accessAuthorityDecisionMock.mockImplementation(async (resourceType) => resourceType === 'engine'
      ? {
          domain: 'engine',
          mode: 'sso_managed',
          manualMutationsAllowed: false,
          reason: 'Engine access is SSO-managed; manual access changes are disabled',
        }
      : null);

    const response = await request(app)
      .post('/engines/engine-1/assign-owner')
      .send({
        userId: '00000000-0000-4000-8000-000000000002',
        reason: 'Recovery',
      });

    expect(response.status).toBe(403);
    expect(engineService.transferOwnership).not.toHaveBeenCalled();
  });
});
