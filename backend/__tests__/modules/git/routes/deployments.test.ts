import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import deploymentsRouter from '../../../../../packages/backend-host/src/modules/git/routes/deployments.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { GitDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitDeployment.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const gitRouteMocks = vi.hoisted(() => ({
  evaluateDeploymentEligibility: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: 'tenant-a' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectAccess: () => (_req: any, _res: any, next: any) => next(),
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/git/GitService.js', () => ({
  GitService: class {
    listDeployments = vi.fn().mockResolvedValue([]);
    getCommitHistory = vi.fn().mockResolvedValue([]);
    deployProject = vi.fn().mockResolvedValue({ deploymentId: 'deployment-1' });
    rollbackToCommit = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    DEPLOY: 'project:deploy',
    FILES_VIEW: 'project:files:view',
    MEMBERS_MANAGE: 'project:members:manage',
    VERSIONS_RESTORE: 'project:versions:restore',
  },
  EnginePermissions: {
    DEPLOY: 'engine:deploy',
    DEPLOY_VIEW: 'engine:deploy:view',
    INSTANCE_VIEW: 'engine:instance:view',
    MEMBERS_MANAGE: 'engine:members:manage',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
  },
  SYSTEM_ROLE_IDS: {
    ENGINE_OWNER: 'system.engine.owner',
    ENGINE_DELEGATE: 'system.engine.delegate',
    ENGINE_OPERATOR: 'system.engine.operator',
    ENGINE_DEPLOYER: 'system.engine.deployer',
  },
  ENGINE_SYSTEM_ROLE_TO_LEGACY_ROLE: {
    'system.engine.owner': 'owner',
    'system.engine.delegate': 'delegate',
    'system.engine.operator': 'operator',
    'system.engine.deployer': 'deployer',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
    getKnownEngineIdsForUser: vi.fn().mockResolvedValue([]),
    syncLegacyRoleAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js', () => ({
  deploymentEligibilityService: {
    evaluate: gitRouteMocks.evaluateDeploymentEligibility,
  },
}));

describe('git deployments routes', () => {
  let app: express.Application;
  let deploymentFind: ReturnType<typeof vi.fn>;
  let environmentFindOneBy: ReturnType<typeof vi.fn>;
  let environmentFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(deploymentsRouter);
    vi.clearAllMocks();
    deploymentFind = vi.fn().mockResolvedValue([]);
    environmentFindOneBy = vi.fn().mockResolvedValue(null);
    environmentFind = vi.fn().mockResolvedValue([]);
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([]);
    gitRouteMocks.evaluateDeploymentEligibility.mockResolvedValue({
      allowed: true,
      decision: 'allow',
      mode: 'ci',
      projectId: '11111111-1111-4111-8111-111111111111',
      engineId: 'engine-1',
      checks: [
        { id: 'project.permission.deploy', allowed: true, reason: 'User has project deploy permission' },
        { id: 'engine.permission.deploy', allowed: true, reason: 'User has engine deploy permission' },
        { id: 'project_engine_target.active', allowed: true, reason: 'Project-engine target allows ci mode' },
      ],
      reasons: [],
    });
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === GitDeployment) {
          return {
            find: deploymentFind,
            findOneBy: vi.fn().mockResolvedValue(null),
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        if (entity === Project) {
          return {
            findOne: vi.fn(async ({ where }: any) => ({ id: String(where?.id), tenantId: null })),
          };
        }
        if (entity === EnvironmentTag) {
          return {
            findOneBy: environmentFindOneBy,
            find: environmentFind,
          };
        }
        return {
          find: vi.fn().mockResolvedValue([]),
          findOneBy: vi.fn().mockResolvedValue(null),
        };
      },
    });
  });

  it('placeholder test for git deployments', () => {
    expect(true).toBe(true);
  });

  it('evaluates CI deployment eligibility when an engine target is provided', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:deploy');

    const response = await request(app)
      .post('/git-api/deploy')
      .send({
        projectId,
        engineId: 'engine-1',
        message: 'Deploy through Git',
      });

    expect(response.status).toBe(201);
    expect(gitRouteMocks.evaluateDeploymentEligibility).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: 'tenant-a',
      projectId,
      engineId: 'engine-1',
      mode: 'ci',
    });
  });

  it('denies Git deployment when the selected engine target is not eligible for CI mode', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:deploy');
    gitRouteMocks.evaluateDeploymentEligibility.mockResolvedValueOnce({
      allowed: false,
      decision: 'deny',
      mode: 'ci',
      projectId,
      engineId: 'engine-1',
      checks: [
        {
          id: 'project_engine_target.active',
          allowed: false,
          reason: 'No active project-engine target allows ci mode',
          remediation: 'Create or enable a project-engine target for this project and engine.',
        },
      ],
      reasons: ['No active project-engine target allows ci mode'],
    });

    const response = await request(app)
      .post('/git-api/deploy')
      .send({
        projectId,
        engineId: 'engine-1',
        message: 'Deploy through Git',
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'No active project-engine target allows ci mode',
      reasons: ['No active project-engine target allows ci mode'],
      hint: 'Create or enable a project-engine target for this project and engine.',
    });
  });

  it('keeps legacy environment-only deployment path outside composite engine eligibility', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:deploy');
    environmentFindOneBy.mockResolvedValueOnce({
      id: 'prod',
      name: 'Production',
      manualDeployAllowed: false,
    });

    const response = await request(app)
      .post('/git-api/deploy')
      .send({
        projectId,
        environment: 'prod',
        message: 'Legacy deploy through Git',
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Manual deployment not allowed for this environment',
      environment: 'Production',
      hint: 'Use CI/CD pipeline for this environment',
    });
    expect(gitRouteMocks.evaluateDeploymentEligibility).not.toHaveBeenCalled();
  });

  it('lists deployments through scoped files-view permission without legacy project access', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission === 'project:files:view');
    deploymentFind.mockResolvedValue([
      {
        id: 'deployment-1',
        projectId,
        commitSha: 'abc1234',
        deployedAt: 1700000000,
        status: 'success',
      },
    ]);

    const response = await request(app)
      .get('/git-api/deployments')
      .query({ projectId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'deployment-1',
        projectId,
      }),
    ]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(deploymentFind).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectId },
    }));
  });
});
