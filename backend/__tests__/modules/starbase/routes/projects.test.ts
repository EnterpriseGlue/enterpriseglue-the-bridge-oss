import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import projectsRouter from '../../../../../packages/backend-host/src/modules/starbase/routes/projects.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { Project } from '@enterpriseglue/shared/db/entities/Project.js';
import { CascadeDeleteService } from '@enterpriseglue/shared/services/cascade-delete.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';

const projectId = '00000000-0000-4000-8000-000000000001';

const routeMocks = vi.hoisted(() => ({
  currentUser: { userId: 'user-1' } as any,
  tenantId: null as string | null,
  evaluateDeploymentEligibility: vi.fn(),
  evaluateDeploymentEligibilityModes: vi.fn(),
  applyPreparedEngineImportToProject: vi.fn(),
  assertUserCanImportFromEngine: vi.fn(),
  prepareLatestEngineImport: vi.fn(),
  previewLatestEngineImport: vi.fn(),
  listProjectEngineTargets: vi.fn(),
  getProjectEngineTarget: vi.fn(),
  createProjectEngineTarget: vi.fn(),
  updateProjectEngineTarget: vi.fn(),
  archiveProjectEngineTarget: vi.fn(),
  syncLegacyProjectEngineTargets: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = routeMocks.currentUser;
    req.tenant = { tenantId: routeMocks.tenantId };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/projectAuth.js', () => ({
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/services/cascade-delete.js', () => ({
  CascadeDeleteService: {
    deleteProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    listUserProjects: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    AUTHZ_CHECK: 'platform:authz:check',
    PROJECT_ENGINE_TARGETS_VIEW: 'platform:project-engine-targets:view',
    PROJECT_ENGINE_TARGETS_MANAGE: 'platform:project-engine-targets:manage',
  },
  ProjectPermissions: {
    CREATE: 'project:create',
    READ: 'project:view',
    FILES_VIEW: 'project:files:view',
    FILES_CREATE: 'project:files:create',
    SETTINGS_MANAGE: 'project:settings:manage',
    DEPLOY: 'project:deploy',
    DEPLOYMENT_TARGETS_VIEW: 'project:deployment-targets:view',
    DEPLOYMENT_TARGETS_MANAGE: 'project:deployment-targets:manage',
    DELETE: 'project:delete',
  },
  EnginePermissions: {
    DEPLOY: 'engine:deploy',
    DEPLOY_VIEW: 'engine:deploy:view',
    READ: 'engine:view',
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

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  deploymentEligibilityService: {
    evaluate: routeMocks.evaluateDeploymentEligibility,
    evaluateModes: routeMocks.evaluateDeploymentEligibilityModes,
  },
  projectEngineTargetService: {
    listTargets: routeMocks.listProjectEngineTargets,
    getTarget: routeMocks.getProjectEngineTarget,
    createTarget: routeMocks.createProjectEngineTarget,
    updateTarget: routeMocks.updateProjectEngineTarget,
    archiveTarget: routeMocks.archiveProjectEngineTarget,
    syncLegacyAccessForProject: routeMocks.syncLegacyProjectEngineTargets,
  },
}));

vi.mock('@enterpriseglue/shared/services/starbase/engine-import-service.js', () => ({
  applyPreparedEngineImportToProject: routeMocks.applyPreparedEngineImportToProject,
  assertUserCanImportFromEngine: routeMocks.assertUserCanImportFromEngine,
  prepareLatestEngineImport: routeMocks.prepareLatestEngineImport,
  previewLatestEngineImport: routeMocks.previewLatestEngineImport,
}));

describe('starbase projects routes', () => {
  let app: express.Application;

  function mockEngineAccessDataSource(targetRows: Array<Record<string, unknown>> = []) {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: any) => {
        switch (entity?.name) {
          case 'Project':
            return {
              findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: null }),
            };
          case 'EngineProjectAccess':
            return {
              find: vi.fn().mockResolvedValue([
                { engineId: 'engine-1', createdAt: 1710000000, autoApproved: true },
              ]),
            };
          case 'ProjectEngineTarget':
            return {
              find: vi.fn().mockResolvedValue(targetRows),
            };
          case 'Engine':
            return {
              find: vi.fn((options?: any) => {
                if (options?.where) {
                  return Promise.resolve([
                    {
                      id: 'engine-1',
                      name: 'Dev Engine',
                      baseUrl: 'https://engine.example',
                      environmentTagId: 'env-1',
                    },
                  ]);
                }
                return Promise.resolve([
                  { id: 'engine-1', name: 'Dev Engine', baseUrl: 'https://engine.example' },
                ]);
              }),
            };
          case 'EnvironmentTag':
            return {
              find: vi.fn().mockResolvedValue([
                { id: 'env-1', name: 'Development', color: '#0f62fe', manualDeployAllowed: true },
              ]),
            };
          case 'EngineHealth':
            return {
              find: vi.fn().mockResolvedValue([
                { engineId: 'engine-1', status: 'connected', latencyMs: 42, checkedAt: 1710000001 },
              ]),
            };
          case 'EngineAccessRequest':
            return {
              find: vi.fn().mockResolvedValue([]),
            };
          default:
            return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), save: vi.fn(), delete: vi.fn() };
        }
      },
    });
  }

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(projectsRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    routeMocks.currentUser = { userId: 'user-1' };
    routeMocks.tenantId = null;
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      [
        'project:files:view',
        'project:create',
        'project:settings:manage',
        'project:deployment-targets:view',
        'project:deployment-targets:manage',
        'project:delete',
        'engine:deploy:view',
      ].includes(permission)
    );
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([]);
    (permissionService.syncLegacyRoleAssignments as unknown as Mock).mockResolvedValue(undefined);
    const deploymentEligibilityResult = {
      allowed: true,
      decision: 'allow',
      mode: 'manual',
      projectId,
      engineId: 'engine-1',
      deploymentIntegration: 'enterpriseglue_proxy',
      checks: [
        { id: 'project.permission.deploy', allowed: true, reason: 'User has project deploy permission' },
      ],
      reasons: [],
    };
    routeMocks.evaluateDeploymentEligibility.mockResolvedValue(deploymentEligibilityResult);
    routeMocks.evaluateDeploymentEligibilityModes.mockResolvedValue({
      manual: deploymentEligibilityResult,
      ci: { ...deploymentEligibilityResult, mode: 'ci' },
    });
    routeMocks.previewLatestEngineImport.mockResolvedValue({
      engineId: 'engine-1',
      allowed: true,
      targetAction: 'create_import_target',
      counts: { bpmn: 1, dmn: 1 },
      files: [
        { name: 'Order.bpmn', type: 'bpmn', bpmnProcessId: 'order', dmnDecisionId: null },
        { name: 'Risk.dmn', type: 'dmn', bpmnProcessId: null, dmnDecisionId: 'risk' },
      ],
      warnings: [],
    });
    routeMocks.listProjectEngineTargets.mockResolvedValue([
      {
        id: 'target-1',
        projectId,
        projectName: 'Test Project',
        engineId: 'engine-1',
        engineName: 'Dev Engine',
        engineBaseUrl: 'https://engine.example',
        environment: null,
        status: 'active',
        source: 'manual',
        sourceRef: null,
        allowManualDeploy: true,
        allowCiDeploy: false,
        allowApiDeploy: false,
        allowImport: true,
        createdById: 'user-1',
        approvedById: null,
        lastSeenAt: null,
        createdAt: 1710000000,
        updatedAt: 1710000000,
      },
    ]);
    routeMocks.getProjectEngineTarget.mockResolvedValue({
      id: 'target-1',
      projectId,
    });
    routeMocks.createProjectEngineTarget.mockResolvedValue({ id: 'target-1' });
    routeMocks.updateProjectEngineTarget.mockResolvedValue(undefined);
    routeMocks.archiveProjectEngineTarget.mockResolvedValue(undefined);
    routeMocks.syncLegacyProjectEngineTargets.mockResolvedValue({ createdOrUpdated: 1 });

    const projectRepo = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test Project' }),
      save: vi.fn().mockResolvedValue({ id: 'p1', name: 'Test Project' }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project || (entity as any)?.name === 'Project') return projectRepo;
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn(), save: vi.fn(), delete: vi.fn() };
      },
    });
  });

  it('lists projects through project.projects.read and filters unauthorized candidates', async () => {
    const deniedProjectId = '00000000-0000-4000-8000-000000000099';
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    };
    const projectRepo = {
      find: vi.fn((options?: any) => {
        if (Array.isArray(options?.select) && options.select.includes('tenantId')) {
          return Promise.resolve([
            { id: projectId, tenantId: null },
            { id: deniedProjectId, tenantId: null },
          ]);
        }
        return Promise.resolve([
          { id: projectId, name: 'Visible Project', ownerId: 'user-1', createdAt: 1710000000 },
        ]);
      }),
    };
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([projectId, deniedProjectId]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string, context: any) =>
      permission === 'project:files:view' && context.resourceId === projectId
    );
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: any) => {
        switch (entity?.name) {
          case 'Project':
            return projectRepo;
          case 'File':
          case 'Folder':
            return { createQueryBuilder: vi.fn().mockReturnValue(queryBuilder) };
          case 'GitRepository':
          case 'GitProvider':
          case 'ProjectMember':
          case 'Invitation':
          case 'User':
            return { find: vi.fn().mockResolvedValue([]) };
          default:
            return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
        }
      },
    });

    const response = await request(app)
      .get('/starbase-api/projects')
      .expect(200);

    expect(permissionService.getKnownProjectIdsForUser).toHaveBeenCalledWith('user-1', null);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceId: deniedProjectId,
    }));
    expect(response.body).toEqual([
      expect.objectContaining({
        id: projectId,
        name: 'Visible Project',
      }),
    ]);
  });

  it('creates a project through project.projects.create', async () => {
    const projectInsert = vi.fn().mockResolvedValue(undefined);
    const assignmentUpsert = vi.fn().mockResolvedValue(undefined);
    const insertBuilder = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      orIgnore: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const transaction = vi.fn(async (callback: any) => callback({
      getRepository: (entity: any) => {
        if (entity?.name === 'Project') {
          return { insert: projectInsert };
        }
        if (entity?.name === 'RbacRoleAssignment') {
          return { upsert: assignmentUpsert };
        }
        return { createQueryBuilder: vi.fn().mockReturnValue(insertBuilder) };
      },
    }));
    (getDataSource as unknown as Mock).mockResolvedValue({
      transaction,
    });

    const response = await request(app)
      .post('/starbase-api/projects')
      .send({ name: ' Created Project ' })
      .expect(200);

    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:create', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'platform',
    }));
    expect(projectInsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Created Project',
      ownerId: 'user-1',
    }));
    expect(assignmentUpsert).toHaveBeenCalledWith([
      expect.objectContaining({
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'project',
        scopeId: response.body.id,
        source: 'legacy',
      }),
    ], expect.objectContaining({ conflictPaths: ['id'] }));
    expect(permissionService.syncLegacyRoleAssignments).not.toHaveBeenCalled();
  });

  it('denies project creation before transaction when project.projects.create is missing', async () => {
    const transaction = vi.fn();
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission !== 'project:create');
    (getDataSource as unknown as Mock).mockResolvedValue({ transaction });

    const response = await request(app)
      .post('/starbase-api/projects')
      .send({ name: 'Denied Project' });

    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('renames a project through project.projects.update', async () => {
    const projectRepo = {
      findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: null }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if ((entity as any)?.name === 'Project') return projectRepo;
        return {};
      },
    });

    const response = await request(app)
      .patch(`/starbase-api/projects/${projectId}`)
      .send({ name: 'Renamed Project' });

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:settings:manage', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(projectRepo.update).toHaveBeenCalledWith({ id: projectId }, { name: 'Renamed Project' });
    expect(response.body).toEqual({ id: projectId, name: 'Renamed Project' });
  });

  it('denies project rename before handler work when project.projects.update is missing', async () => {
    const projectRepo = {
      findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: null }),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) => permission !== 'project:settings:manage');
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if ((entity as any)?.name === 'Project') return projectRepo;
        return {};
      },
    });

    const response = await request(app)
      .patch(`/starbase-api/projects/${projectId}`)
      .send({ name: 'Denied Project' });

    expect(response.status).toBe(403);
    expect(projectRepo.update).not.toHaveBeenCalled();
  });

  it('deletes a project through project.projects.delete', async () => {
    const projectRepo = {
      findOne: vi.fn().mockResolvedValue({ id: projectId, tenantId: null }),
    };
    const assignmentDelete = vi.fn().mockResolvedValue(undefined);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if ((entity as any)?.name === 'Project') return projectRepo;
        if ((entity as any)?.name === 'RbacRoleAssignment') return { delete: assignmentDelete };
        return {};
      },
    });

    const response = await request(app)
      .delete(`/starbase-api/projects/${projectId}`);

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:delete', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(CascadeDeleteService.deleteProject).toHaveBeenCalledWith(projectId);
    expect(assignmentDelete).toHaveBeenCalledWith({
      source: 'legacy',
      scopeType: 'project',
      scopeId: projectId,
    });
    expect(permissionService.syncLegacyRoleAssignments).not.toHaveBeenCalled();
  });

  it('previews latest engine import definitions for project creation', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'Engine') {
          return { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }) };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    const response = await request(app)
      .post('/starbase-api/projects/import-preview')
      .send({ engineId: 'engine-1' })
      .expect(200);

    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:deploy:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(routeMocks.previewLatestEngineImport).toHaveBeenCalledWith('user-1', 'engine-1', null);
    expect(response.body).toMatchObject({
      engineId: 'engine-1',
      allowed: true,
      targetAction: 'create_import_target',
      counts: { bpmn: 1, dmn: 1 },
      files: [
        { name: 'Order.bpmn', type: 'bpmn' },
        { name: 'Risk.dmn', type: 'dmn' },
      ],
    });
  });

  it('manages project deployment targets through project-scoped permissions', async () => {
    const listResponse = await request(app)
      .get(`/starbase-api/projects/${projectId}/deployment-targets?status=all`);

    expect(listResponse.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:deployment-targets:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(routeMocks.listProjectEngineTargets).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      status: 'all',
      tenantId: null,
    }));

    const createResponse = await request(app)
      .post(`/starbase-api/projects/${projectId}/deployment-targets`)
      .send({
        engineId: 'engine-1',
        allowManualDeploy: true,
        allowCiDeploy: true,
      });

    expect(createResponse.status).toBe(201);
    expect(routeMocks.createProjectEngineTarget).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      engineId: 'engine-1',
      source: 'manual',
      allowManualDeploy: true,
      allowCiDeploy: true,
      createdById: 'user-1',
      tenantId: null,
    }));

    const syncResponse = await request(app)
      .post(`/starbase-api/projects/${projectId}/deployment-targets/sync-legacy`)
      .send({});

    expect(syncResponse.status).toBe(200);
    expect(routeMocks.syncLegacyProjectEngineTargets).toHaveBeenCalledWith(projectId, null);

    const updateResponse = await request(app)
      .put(`/starbase-api/projects/${projectId}/deployment-targets/target-1`)
      .send({ allowApiDeploy: true });

    expect(updateResponse.status).toBe(200);
    expect(routeMocks.getProjectEngineTarget).toHaveBeenCalledWith('target-1', null);
    expect(routeMocks.updateProjectEngineTarget).toHaveBeenCalledWith('target-1', expect.objectContaining({
      allowApiDeploy: true,
      tenantId: null,
    }));

    const deleteResponse = await request(app)
      .delete(`/starbase-api/projects/${projectId}/deployment-targets/target-1`);

    expect(deleteResponse.status).toBe(204);
    expect(routeMocks.archiveProjectEngineTarget).toHaveBeenCalledWith('target-1', null);
  });

  it('denies project deployment target reads before service calls when scoped permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission !== 'project:deployment-targets:view'
    );

    const response = await request(app)
      .get(`/starbase-api/projects/${projectId}/deployment-targets`);

    expect(response.status).toBe(403);
    expect(routeMocks.listProjectEngineTargets).not.toHaveBeenCalled();
  });

  it('rejects project deployment target updates when the target belongs to another project', async () => {
    routeMocks.getProjectEngineTarget.mockResolvedValueOnce({
      id: 'target-1',
      projectId: '00000000-0000-4000-8000-000000000099',
    });

    const response = await request(app)
      .put(`/starbase-api/projects/${projectId}/deployment-targets/target-1`)
      .send({ allowManualDeploy: false });

    expect(response.status).toBe(404);
    expect(routeMocks.updateProjectEngineTarget).not.toHaveBeenCalled();
  });

  it('annotates project engine access with manual deployment eligibility', async () => {
    const deniedEligibility = {
      allowed: false,
      decision: 'deny',
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [
        {
          id: 'engine.permission.deploy',
          allowed: false,
          reason: 'User lacks engine deploy permission',
          remediation: 'Assign an engine role or grant engine:deploy on this engine.',
        },
      ],
      reasons: ['User lacks engine deploy permission'],
    };
    routeMocks.evaluateDeploymentEligibility.mockResolvedValue(deniedEligibility);
    routeMocks.evaluateDeploymentEligibilityModes.mockResolvedValue({
      manual: deniedEligibility,
      ci: { ...deniedEligibility, mode: 'ci' },
    });

    mockEngineAccessDataSource();

    const response = await request(app)
      .get('/starbase-api/projects/project-1/engine-access')
      .expect(200);

    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: 'project-1',
    }));
    expect(routeMocks.evaluateDeploymentEligibilityModes).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: null,
      projectId: 'project-1',
      engineId: 'engine-1',
      modes: ['manual', 'ci'],
    });
    expect(response.body.accessedEngines[0]).toMatchObject({
      engineId: 'engine-1',
      manualDeployAllowed: false,
      manualDeployDeniedReasons: ['User lacks engine deploy permission'],
      ciDeployAllowed: false,
      ciDeployDeniedReasons: ['User lacks engine deploy permission'],
      deploymentEligibility: {
        manual: {
          allowed: false,
          reasons: ['User lacks engine deploy permission'],
        },
        ci: {
          allowed: false,
          reasons: ['User lacks engine deploy permission'],
        },
      },
    });
    expect(response.body.accessedEngines[0].deploymentEligibility.diagnosticsVisible).toBe(false);
    expect(response.body.accessedEngines[0].deploymentEligibility.manual).not.toHaveProperty('checks');
    expect(response.body.accessedEngines[0].deploymentEligibility.ci).not.toHaveProperty('checks');
  });

  it('includes active deployment target metadata in project engine access reads', async () => {
    mockEngineAccessDataSource([
      {
        id: 'target-1',
        engineId: 'engine-1',
        status: 'active',
        source: 'manual',
        sourceRef: null,
        allowManualDeploy: true,
        allowCiDeploy: true,
        allowApiDeploy: false,
        allowImport: true,
        lastSeenAt: 1710000100,
        createdAt: 1710000000,
        updatedAt: 1710000200,
      },
    ]);

    const response = await request(app)
      .get('/starbase-api/projects/project-1/engine-access')
      .expect(200);

    expect(response.body.accessedEngines[0].deploymentTarget).toEqual({
      id: 'target-1',
      status: 'active',
      source: 'manual',
      sourceRef: null,
      allowManualDeploy: true,
      allowCiDeploy: true,
      allowApiDeploy: false,
      allowImport: true,
      lastSeenAt: 1710000100,
      createdAt: 1710000000,
      updatedAt: 1710000200,
    });
  });

  it('includes deployment eligibility check diagnostics for diagnostic permission holders', async () => {
    routeMocks.currentUser = { userId: 'user-1', permissions: ['platform:authz:check'] };
    const deniedEligibility = {
      allowed: false,
      decision: 'deny',
      mode: 'manual',
      projectId: 'project-1',
      engineId: 'engine-1',
      checks: [
        {
          id: 'policy.engine',
          allowed: false,
          reason: 'Engine policy denied manual deployment: policy:release-freeze',
          remediation: 'Review the engine authorization policies that apply to this deployment.',
        },
      ],
      reasons: ['Engine policy denied manual deployment: policy:release-freeze'],
    };
    routeMocks.evaluateDeploymentEligibility.mockResolvedValue(deniedEligibility);
    routeMocks.evaluateDeploymentEligibilityModes.mockResolvedValue({
      manual: deniedEligibility,
      ci: { ...deniedEligibility, mode: 'ci' },
    });
    mockEngineAccessDataSource();

    const response = await request(app)
      .get('/starbase-api/projects/project-1/engine-access')
      .expect(200);

    expect(response.body.accessedEngines[0].deploymentEligibility).toMatchObject({
      diagnosticsVisible: true,
      manual: {
        allowed: false,
        checks: [
          {
            id: 'policy.engine',
            allowed: false,
            remediation: 'Review the engine authorization policies that apply to this deployment.',
          },
        ],
      },
      ci: {
        allowed: false,
        checks: [
          {
            id: 'policy.engine',
            allowed: false,
          },
        ],
      },
    });
  });

  it('scopes evaluated deployment-diagnostic permission checks to the request tenant', async () => {
    routeMocks.tenantId = 'tenant-a';
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'project:files:view' || permission === 'platform:authz:check'
    );
    mockEngineAccessDataSource();

    await request(app)
      .get('/starbase-api/projects/project-1/engine-access')
      .expect(200);

    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'platform:authz:check',
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-a', resourceType: 'platform', resourceId: 'platform' }),
    );
  });
});
