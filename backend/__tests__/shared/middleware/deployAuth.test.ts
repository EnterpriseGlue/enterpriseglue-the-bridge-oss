import { beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDataSource: vi.fn(),
  hasProjectAccess: vi.fn(),
  grantAccess: vi.fn(),
  hasPermission: vi.fn(),
  evaluateDeploymentEligibility: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: mocks.getDataSource,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EngineAccessService.js', () => ({
  engineAccessService: {
    hasProjectAccess: mocks.hasProjectAccess,
    grantAccess: mocks.grantAccess,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js', () => ({
  deploymentEligibilityService: {
    evaluate: mocks.evaluateDeploymentEligibility,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  ProjectPermissions: {
    DEPLOY: 'project:deploy',
  },
  EnginePermissions: {
    DEPLOY: 'engine:deploy',
    DEPLOY_VIEW: 'engine:deploy:view',
    INSTANCE_VIEW: 'engine:instance:view',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
  },
  permissionService: {
    hasPermission: mocks.hasPermission,
  },
}));

import { requireDeployPermission } from '@enterpriseglue/shared/middleware/deployAuth.js';

describe('deployAuth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasProjectAccess.mockResolvedValue(true);
    mocks.grantAccess.mockResolvedValue(undefined);
    mocks.hasPermission.mockImplementation(async (permission: string) => (
      permission === 'project:deploy' || permission === 'engine:deploy'
    ));
    mocks.evaluateDeploymentEligibility.mockResolvedValue({
      allowed: true,
      decision: 'allow',
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [
        { id: 'project.permission.deploy', allowed: true, reason: 'User has project deploy permission' },
        { id: 'engine.permission.deploy', allowed: true, reason: 'User has engine deploy permission' },
        { id: 'project_engine_target.active', allowed: true, reason: 'Project-engine target allows manual mode' },
      ],
      reasons: [],
    });

    mocks.getDataSource.mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'Engine') {
          return {
            findOneBy: vi.fn().mockResolvedValue({
              id: 'engine-1',
              name: 'Dev Engine',
              environmentLocked: false,
              environmentTagId: null,
            }),
          };
        }

        return {
          count: vi.fn().mockResolvedValue(0),
          findOneBy: vi.fn().mockResolvedValue(null),
        };
      },
    });
  });

  it('allows deployment from scoped project and engine deploy permissions without legacy memberships', async () => {
    const req: any = {
      body: {
        projectId: 'project-1',
        engineId: 'engine-1',
      },
      user: {
        userId: 'user-1',
      },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await requireDeployPermission()(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.deployContext).toMatchObject({
      projectId: 'project-1',
      engineId: 'engine-1',
      projectRole: 'permission',
      engineName: 'Dev Engine',
    });
    expect(mocks.evaluateDeploymentEligibility).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'engine-1',
      mode: 'manual',
    });
  });

  it('returns eligibility denial reasons when manual deployment is not allowed', async () => {
    mocks.evaluateDeploymentEligibility.mockResolvedValueOnce({
      allowed: false,
      decision: 'deny',
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [
        {
          id: 'project_engine_target.active',
          allowed: false,
          reason: 'No active project-engine target allows manual mode',
          remediation: 'Create or enable a project-engine target for this project and engine.',
        },
      ],
      reasons: ['No active project-engine target allows manual mode'],
    });

    const req: any = {
      body: {
        projectId: 'project-1',
        engineId: 'engine-1',
      },
      user: {
        userId: 'user-1',
      },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await requireDeployPermission()(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'No active project-engine target allows manual mode',
      reasons: ['No active project-engine target allows manual mode'],
      hint: 'Create or enable a project-engine target for this project and engine.',
    }));
  });

  it('keeps auto-grant when project-access approve permission only lacks the project-engine target', async () => {
    mocks.evaluateDeploymentEligibility
      .mockResolvedValueOnce({
        allowed: false,
        decision: 'deny',
        mode: 'manual',
        projectId: 'project-1',
        engineId: 'engine-1',
        checks: [
          { id: 'project_engine_target.active', allowed: false, reason: 'No active project-engine target allows manual mode' },
        ],
        reasons: ['No active project-engine target allows manual mode'],
      })
      .mockResolvedValueOnce({
        allowed: true,
        decision: 'allow',
        mode: 'manual',
        projectId: 'project-1',
        engineId: 'engine-1',
        checks: [
          { id: 'project_engine_target.active', allowed: true, reason: 'Project-engine target allows manual mode' },
        ],
        reasons: [],
      });
    mocks.hasPermission.mockImplementation(async (permission: string) => (
      permission === 'engine:project-access:approve'
    ));

    const req: any = {
      body: {
        projectId: 'project-1',
        engineId: 'engine-1',
      },
      user: {
        userId: 'user-1',
      },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await requireDeployPermission()(req, res, next);

    expect(mocks.hasPermission).toHaveBeenCalledWith('engine:project-access:approve', expect.objectContaining({
      userId: 'user-1',
      tenantId: null,
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(mocks.grantAccess).toHaveBeenCalledWith('project-1', 'engine-1', 'user-1', true);
    expect(next).toHaveBeenCalledOnce();
    expect(req.deployContext).toMatchObject({
      projectId: 'project-1',
      engineId: 'engine-1',
    });
  });
});
