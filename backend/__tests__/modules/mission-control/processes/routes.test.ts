import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import processesRouter from '../../../../../packages/backend-host/src/modules/mission-control/processes/routes.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EngineDeploymentArtifact } from '@enterpriseglue/shared/db/entities/EngineDeploymentArtifact.js';
import { EngineDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/EngineDeployment.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { FileCommitVersion } from '@enterpriseglue/shared/db/entities/FileCommitVersion.js';
import { projectMemberService } from '@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  listProcessDefinitions,
  getProcessDefinition,
  getProcessDefinitionStatistics,
  startProcessInstance,
} from '../../../../../packages/backend-host/src/modules/mission-control/processes/service.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: req.get('x-test-user') || 'user-1' };
    req.tenant = { tenantId: 'tenant-a' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ProjectMemberService.js', () => ({
  projectMemberService: {
    hasAccess: vi.fn().mockResolvedValue(true),
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    DEPLOY_VIEW: 'engine:deploy:view',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
    PROCESS_START: 'engine:process:start',
    MEMBERS_MANAGE: 'engine:members:manage',
  },
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    FILES_VIEW: 'project:files:view',
    FILES_EDIT: 'project:files:edit',
    MEMBERS_MANAGE: 'project:members:manage',
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
    getVisibleRuntimeResources: vi.fn().mockResolvedValue([]),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
    getKnownEngineIdsForUser: vi.fn().mockResolvedValue([]),
    syncLegacyRoleAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/processes/service.js', () => ({
  listProcessDefinitions: vi.fn().mockResolvedValue([]),
  getProcessDefinition: vi.fn().mockResolvedValue({ id: 'pd1', key: 'process1', version: 1 }),
  getProcessDefinitionXml: vi.fn().mockResolvedValue({ id: 'pd1', bpmn20Xml: '<bpmn/>' }),
  getProcessDefinitionStatistics: vi.fn().mockResolvedValue({}),
  startProcessInstance: vi.fn().mockResolvedValue({ id: 'pi1' }),
}));

describe('mission-control processes routes', () => {
  let app: express.Application;
  let artifactFind: ReturnType<typeof vi.fn>;
  let fileFind: ReturnType<typeof vi.fn>;
  let fileVersionFindOne: ReturnType<typeof vi.fn>;
  let fileVersionQbGetRawOne: ReturnType<typeof vi.fn>;
  let deploymentFindOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(processesRouter);
    vi.clearAllMocks();

    artifactFind = vi.fn().mockResolvedValue([]);
    fileFind = vi.fn().mockResolvedValue([]);
    fileVersionFindOne = vi.fn().mockResolvedValue(null);
    fileVersionQbGetRawOne = vi.fn().mockResolvedValue(null);
    deploymentFindOne = vi.fn().mockResolvedValue({ deployedAt: null, lineageQuality: 'complete' });

    const fileVersionRepo = {
      findOne: fileVersionFindOne,
      createQueryBuilder: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        getRawOne: fileVersionQbGetRawOne,
      }),
    };

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn(async ({ where }: any) => ({
              id: String(where?.id || 'engine-1'),
              tenantId: 'tenant-a',
              tenancyMode: 'dedicated',
            })),
          };
        }
        if (entity === EngineDeploymentArtifact) {
          return { find: artifactFind };
        }
        if (entity === EngineDeployment) {
          return { findOne: deploymentFindOne };
        }
        if (entity === File) {
          return { find: fileFind };
        }
        if (entity === FileCommitVersion) {
          return fileVersionRepo;
        }
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(true);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(true);
	    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
	      permission.startsWith('engine:') ||
	      permission === 'project:files:view' ||
	      permission === 'project:files:edit'
	    );
  });

  it('lists process definitions', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-definitions')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listProcessDefinitions).toHaveBeenCalledWith('engine-1', {
      key: undefined,
      nameLike: undefined,
      latestVersion: false,
    });
  });

  it('returns process definition details', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-definitions/pd1')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'pd1', key: 'process1', version: 1 });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(getProcessDefinition).toHaveBeenCalledWith('engine-1', 'pd1');
  });

  it('validates process definition XML and activity statistics through shared contracts', async () => {
    vi.mocked(getProcessDefinitionStatistics).mockResolvedValueOnce({ taskA: 2 });

    const [xmlResponse, statisticsResponse] = await Promise.all([
      request(app).get('/mission-control-api/process-definitions/pd1/xml').query({ engineId: 'engine-1' }),
      request(app).get('/mission-control-api/process-definitions/key/process1/statistics').query({ engineId: 'engine-1' }),
    ]);

    expect(xmlResponse.status).toBe(200);
    expect(xmlResponse.body).toEqual({ id: 'pd1', bpmn20Xml: '<bpmn/>' });
    expect(statisticsResponse.status).toBe(200);
    expect(statisticsResponse.body).toEqual({ taskA: 2 });
  });

  it('starts process instances through process start permission', async () => {
    vi.mocked(startProcessInstance).mockResolvedValueOnce({ id: 'pi1', engineExtension: { traceId: 'start-1' } });
    const response = await request(app)
      .post('/mission-control-api/process-definitions/key/invoice/start')
      .send({ engineId: 'engine-1', businessKey: 'case-1', variables: { amount: { value: 100 } } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'pi1', engineExtension: { traceId: 'start-1' } });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:start', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(startProcessInstance).toHaveBeenCalledWith('engine-1', 'invoice', {
      businessKey: 'case-1',
      variables: { amount: { value: 100 } },
    });
  });

  it('denies process definition reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/process-definitions')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listProcessDefinitions).not.toHaveBeenCalled();
  });

  it('returns disjoint process-definition subsets to users sharing a resource-aware central engine', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'central-engine', tenantId: null, tenancyMode: 'shared', runtimeAccessScope: 'resource_aware' }) };
        return { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockImplementation(async ({ userId }: { userId: string }) => (
      userId === 'payments-user'
        ? [{ resourceKey: 'payments-order', runtimeTenantId: 'finance' }]
        : [{ resourceKey: 'hr-onboard', runtimeTenantId: 'people' }]
    ));
    (listProcessDefinitions as unknown as Mock).mockResolvedValue([
      { id: 'payments:1', key: 'payments-order', version: 1, tenantId: 'finance' },
      { id: 'hr:1', key: 'hr-onboard', version: 1, tenantId: 'people' },
    ]);

    const [paymentsResponse, hrResponse] = await Promise.all([
      request(app).get('/mission-control-api/process-definitions').set('x-test-user', 'payments-user').query({ engineId: 'central-engine' }),
      request(app).get('/mission-control-api/process-definitions').set('x-test-user', 'hr-user').query({ engineId: 'central-engine' }),
    ]);

    expect(paymentsResponse.status).toBe(200);
    expect(paymentsResponse.body).toEqual([{ id: 'payments:1', key: 'payments-order', version: 1, tenantId: 'finance' }]);
    expect(hrResponse.status).toBe(200);
    expect(hrResponse.body).toEqual([{ id: 'hr:1', key: 'hr-onboard', version: 1, tenantId: 'people' }]);
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'central-engine', resourceKind: 'process_definition', permission: 'engine:instance:view', userId: 'payments-user',
    }));
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'central-engine', resourceKind: 'process_definition', permission: 'engine:instance:view', userId: 'hr-user',
    }));
    expect(listProcessDefinitions).toHaveBeenCalledWith('central-engine', {
      key: 'payments-order', nameLike: undefined, latestVersion: false, maxResults: 100, tenantIdIn: ['finance'],
    });
    expect(listProcessDefinitions).toHaveBeenCalledWith('central-engine', {
      key: 'hr-onboard', nameLike: undefined, latestVersion: false, maxResults: 100, tenantIdIn: ['people'],
    });
  });

  it('rejects oversized process-definition collection requests for resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'central-engine', tenantId: null, tenancyMode: 'shared', runtimeAccessScope: 'resource_aware' }) }
        : { find: vi.fn().mockResolvedValue([]), findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments-order' }]);

    const response = await request(app)
      .get('/mission-control-api/process-definitions')
      .query({ engineId: 'central-engine', maxResults: 101 });

    expect(response.status).toBe(403);
    expect(listProcessDefinitions).not.toHaveBeenCalled();
  });

  it('validates edit-target query params', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice' });

    expect(response.status).toBe(400);
    expect(response.body?.error).toBe('Invalid query parameters');
  });

  it('does not infer a Starbase edit target from a matching process key without deployment lineage', async () => {
    fileFind.mockResolvedValueOnce([{ id: 'file-key-match', projectId: 'project-1' }]);

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(404);
    expect(fileFind).not.toHaveBeenCalled();
  });

  it('resolves edit-target using processDefinitionId to disambiguate', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-1',
        fileId: 'file-1',
        fileGitCommitId: 'commit-1',
        engineDeploymentId: 'dep-1',
        createdAt: 1700000000000,
      },
    ]);
    fileVersionFindOne.mockResolvedValueOnce({ versionNumber: 7 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({
        engineId: 'engine-1',
        key: 'invoice',
        version: 3,
        processDefinitionId: 'invoice:3:abc123',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      canShowEditButton: true,
      projectId: 'project-1',
      fileId: 'file-1',
      commitId: 'commit-1',
      fileVersionNumber: 7,
      mappingSource: 'git-commit',
    });

    expect(artifactFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        engineId: 'engine-1',
        artifactKind: 'process',
        artifactKey: 'invoice',
        artifactVersion: 3,
        artifactId: 'invoice:3:abc123',
      }),
    }));
  });

  it('falls back to key/version lookup when processDefinitionId has no artifact match', async () => {
    artifactFind
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          projectId: 'project-1',
          fileId: 'file-1',
          fileGitCommitId: null,
          engineDeploymentId: 'dep-1',
          createdAt: 1700000000000,
        },
      ]);
    fileVersionQbGetRawOne.mockResolvedValueOnce({ versionNumber: 6 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({
        engineId: 'engine-1',
        key: 'invoice',
        version: 3,
        processDefinitionId: 'invoice:3:not-found',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projectId: 'project-1',
      fileId: 'file-1',
      fileVersionNumber: 6,
      mappingSource: 'db-timestamp',
    });

    expect(artifactFind).toHaveBeenCalledTimes(2);
    expect(artifactFind).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        artifactId: 'invoice:3:not-found',
      }),
    }));
    expect(artifactFind).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.not.objectContaining({ artifactId: expect.anything() }),
    }));
  });

  it('falls back to timestamp-based mapping when commit mapping is unavailable', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-1',
        fileId: 'file-1',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-1',
        createdAt: 1700000000000,
      },
    ]);
    fileVersionQbGetRawOne.mockResolvedValueOnce({ versionNumber: 4 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fileVersionNumber: 4,
      mappingSource: 'db-timestamp',
    });
  });

  it('falls back to latest version mapping when timestamp mapping is unavailable', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-1',
        fileId: 'file-1',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-1',
        createdAt: 1700000000000,
      },
    ]);
    fileVersionQbGetRawOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ versionNumber: 9 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      fileVersionNumber: 9,
      mappingSource: 'db-latest',
    });
  });

  it('skips inaccessible candidates and resolves the first accessible one', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-denied',
        fileId: 'file-denied',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-denied',
        createdAt: 1700000000001,
      },
      {
        projectId: 'project-allowed',
        fileId: 'file-allowed',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-allowed',
        createdAt: 1700000000000,
      },
    ]);
	    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string, context: { resourceId?: string }) => {
	      if (permission.startsWith('engine:')) return true;
	      if (permission === 'project:files:view') return context.resourceId === 'project-allowed';
	      if (permission === 'project:files:edit') return false;
	      return false;
	    });
    fileVersionQbGetRawOne
      .mockResolvedValueOnce({ versionNumber: 10 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      projectId: 'project-allowed',
      fileId: 'file-allowed',
      canEdit: false,
      fileVersionNumber: 10,
    });
  });

  it('resolves edit-target through scoped project file permissions without legacy project membership', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-scoped',
        fileId: 'file-scoped',
        fileGitCommitId: 'commit-scoped',
        engineDeploymentId: 'dep-scoped',
        createdAt: 1700000000000,
      },
    ]);
    (projectMemberService.hasAccess as unknown as Mock).mockResolvedValue(false);
    (projectMemberService.hasRole as unknown as Mock).mockResolvedValue(false);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view' || permission === 'project:files:view' || permission === 'project:files:edit'
    );
    fileVersionFindOne.mockResolvedValueOnce({ versionNumber: 12 });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      canShowEditButton: true,
      canEdit: true,
      projectId: 'project-scoped',
      fileId: 'file-scoped',
      fileVersionNumber: 12,
      mappingSource: 'git-commit',
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: 'project-scoped',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:edit', expect.objectContaining({
      userId: 'user-1',
      tenantId: 'tenant-a',
      resourceType: 'project',
      resourceId: 'project-scoped',
    }));
  });

  it('returns 404 when no accessible deployed process mapping exists', async () => {
    artifactFind.mockResolvedValueOnce([
      {
        projectId: 'project-denied',
        fileId: 'file-denied',
        fileGitCommitId: null,
        engineDeploymentId: 'dep-denied',
        createdAt: 1700000000000,
      },
    ]);
	    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
	      permission.startsWith('engine:')
	    );

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(404);
  });

  it('does not expose an edit target backed only by discovered engine lineage', async () => {
    artifactFind.mockResolvedValueOnce([{ projectId: 'project-1', fileId: 'file-1', engineDeploymentId: 'dep-1', createdAt: 1700000000000 }]);
    deploymentFindOne.mockResolvedValueOnce({ deployedAt: 1700000000000, lineageQuality: 'discovered' });

    const response = await request(app)
      .get('/mission-control-api/process-definitions/edit-target')
      .query({ engineId: 'engine-1', key: 'invoice', version: 3 });

    expect(response.status).toBe(404);
  });
});
