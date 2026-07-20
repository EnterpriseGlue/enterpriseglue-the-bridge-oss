import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { requireAction, requireCompositeAction, requireInvitationCreateAction, requireRuntimeCollectionAction, requireRuntimeDefinitionAction, requireRuntimeDeploymentAction, requireRuntimeMigrationAction, requireRuntimeProcessInstanceSelectionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { EnvironmentTag } from '@enterpriseglue/shared/infrastructure/persistence/entities/EnvironmentTag.js';
import { File } from '@enterpriseglue/shared/infrastructure/persistence/entities/File.js';
import { Folder } from '@enterpriseglue/shared/infrastructure/persistence/entities/Folder.js';
import { GitDeployment } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitDeployment.js';
import { GitLock } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitLock.js';
import { GitRepository } from '@enterpriseglue/shared/infrastructure/persistence/entities/GitRepository.js';
import { Project } from '@enterpriseglue/shared/infrastructure/persistence/entities/Project.js';
import { SavedFilter } from '@enterpriseglue/shared/infrastructure/persistence/entities/SavedFilter.js';
import { Version } from '@enterpriseglue/shared/infrastructure/persistence/entities/Version.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { engineAccessService } from '@enterpriseglue/shared/services/platform-admin/EngineAccessService.js';
import { deploymentEligibilityService } from '@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js';
import { policyService } from '@enterpriseglue/shared/services/platform-admin/PolicyService.js';

const { updateBpmnEngineRequestContext } = vi.hoisted(() => ({ updateBpmnEngineRequestContext: vi.fn() }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    MEMBERS_MANAGE: 'project:members:manage',
  },
  EnginePermissions: {
    MEMBERS_MANAGE: 'engine:members:manage',
    DEPLOY_VIEW: 'engine:deploy:view',
    INSTANCE_VIEW: 'engine:instance:view',
    PROJECT_ACCESS_APPROVE: 'engine:project-access:approve',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
    getKnownEngineIdsForUser: vi.fn().mockResolvedValue([]),
    getKnownProjectIdsForUser: vi.fn().mockResolvedValue([]),
    getVisibleRuntimeResources: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EngineAccessService.js', () => ({
  engineAccessService: {
    grantAccess: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/DeploymentEligibilityService.js', () => ({
  deploymentEligibilityService: {
    evaluate: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PolicyService.js', () => ({
  policyService: {
    evaluateGate: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' }),
  },
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-request-context.js', () => ({
  updateBpmnEngineRequestContext,
}));

const { camundaGet } = vi.hoisted(() => ({ camundaGet: vi.fn() }));
vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({ camundaGet }));

describe('requireRuntimeCollectionAction', () => {
  it('rejects an unauthenticated runtime collection request before resolving any resource', async () => {
    const next = vi.fn();

    await requireRuntimeCollectionAction('mission-control.process-definitions.read', { resourceKind: 'process_definition' })(
      { query: {} } as any,
      {} as any,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message: 'Authentication required' }));
  });
});

describe('requireAction project resource resolvers', () => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const secondProjectId = '12121212-1212-4121-8121-121212121212';
  const fileId = '22222222-2222-4222-8222-222222222222';
  const folderId = '33333333-3333-4333-8333-333333333333';
  const versionId = '44444444-4444-4444-8444-444444444444';
  const engineId = '55555555-5555-4555-8555-555555555555';
  const secondEngineId = '66666666-6666-4666-8666-666666666666';
  const savedFilterId = '77777777-7777-4777-8777-777777777777';
  const gitRepositoryId = '88888888-8888-4888-8888-888888888888';
  const gitDeploymentId = '99999999-9999-4999-8999-999999999999';
  const gitLockId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  let app: express.Application;
  let projectFindOne: ReturnType<typeof vi.fn>;
  let projectFind: ReturnType<typeof vi.fn>;
  let engineFind: ReturnType<typeof vi.fn>;
  let engineFindOne: ReturnType<typeof vi.fn>;
  let fileFindOne: ReturnType<typeof vi.fn>;
  let folderFindOne: ReturnType<typeof vi.fn>;
  let gitRepositoryFindOne: ReturnType<typeof vi.fn>;
  let gitDeploymentFindOne: ReturnType<typeof vi.fn>;
  let gitLockFindOne: ReturnType<typeof vi.fn>;
  let savedFilterFindOne: ReturnType<typeof vi.fn>;
  let versionFindOne: ReturnType<typeof vi.fn>;
  let runtimeResourceFindOne: ReturnType<typeof vi.fn>;
  let runtimeResourceFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.user = { userId: 'user-1', platformRole: 'user' };
      if (req.query.tenantId) {
        req.tenant = { tenantId: String(req.query.tenantId) };
      }
      next();
    });
    app.get('/files/:fileId', requireAction('project.files.read', {
      resourceResolver: 'project.byFileId',
      resourceIdFrom: 'params',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, projectId: req.projectId, fileId: req.fileId });
    });
    app.get('/folders/:folderId', requireAction('project.files.read', {
      resourceResolver: 'project.byFolderId',
      resourceIdFrom: 'params',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, projectId: req.projectId, folderId: req.folderId });
    });
    app.get('/versions/:versionId', requireAction('project.versions.read', {
      resourceResolver: 'project.byVersionId',
      resourceIdFrom: 'params',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, projectId: req.projectId, fileId: req.fileId, versionId: req.versionId });
    });
    app.get('/engines', requireAction('engine.inventory.read', {
      resourceResolver: 'engine.visibleCollection',
    }), (req: any, res) => {
      res.json({
        resource: req.authzResource,
        collection: req.authzCollection,
        authorizedEngineIds: req.authorizedEngineIds,
      });
    });
    app.get('/projects', requireAction('project.projects.read', {
      resourceResolver: 'project.visibleCollection',
    }), (req: any, res) => {
      res.json({
        resource: req.authzResource,
        collection: req.authzCollection,
        authorizedProjectIds: req.authorizedProjectIds,
      });
    });
    app.get('/saved-filters/:id', requireAction('engine.saved-filters.read', {
      resourceResolver: 'engine.bySavedFilterId',
      resourceIdFrom: 'params',
      resourceIdKey: 'id',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId, savedFilterId: req.savedFilterId });
    });
    app.get('/git-repositories/:id', requireAction('project.git.repositories.read', {
      resourceResolver: 'project.byGitRepositoryId',
      resourceIdFrom: 'params',
      resourceIdKey: 'id',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, repositoryId: req.repositoryId, projectId: req.projectId });
    });
    app.get('/git-deployments/:id', requireAction('project.deployments.read', {
      resourceResolver: 'project.byGitDeploymentId',
      resourceIdFrom: 'params',
      resourceIdKey: 'id',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, deploymentId: req.deploymentId, projectId: req.projectId });
    });
    app.delete('/git-locks/:lockId', requireAction('project.git.locks.release', {
      resourceResolver: 'project.byGitLockId',
      resourceIdFrom: 'params',
      acceptedPermissions: ['project:settings:manage' as any],
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, lockId: req.lockId, fileId: req.fileId, projectId: req.projectId });
    });
    app.get('/sync-status/:projectId', requireAction('project.git.sync.status', {
      resourceIdFrom: 'params',
      acceptedPermissions: ['project:git:pull' as any, 'project:git:push' as any],
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, projectId: req.projectId });
    });
    app.get('/runtime-definitions/:id', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
      resourceKind: 'process_definition',
      definitionPath: 'process-definition',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId });
    });
    app.get('/runtime-definitions-by-key/:key', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
      resourceKind: 'process_definition',
      definitionPath: 'process-definition',
      definitionLookup: 'key',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId });
    });
    app.get('/runtime-decisions/:id', requireRuntimeDefinitionAction('engine.runtime.decisions.read', {
      resourceKind: 'decision_definition',
      definitionPath: 'decision-definition',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId });
    });
    app.get('/runtime-jobs/:id', requireRuntimeDefinitionAction('engine.runtime.jobs.read', {
      resourceKind: 'process_definition',
      definitionPath: 'job',
      definitionReferenceField: 'processDefinitionId',
      definitionReferencePath: 'process-definition',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId });
    });
    app.post('/runtime-instance-selection', requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.process-instances.delete', {
      resourceKind: 'process_definition',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId });
    });
    app.get('/runtime-deployments/:deploymentId', requireRuntimeDeploymentAction('engine.runtime.process-definitions.read'), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId, resourceKeys: req.authorizedRuntimeResourceKeys });
    });
    app.post('/runtime-migration', requireRuntimeMigrationAction('engine.runtime.migrations.execute-async', {
      resourceKind: 'process_definition',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId });
    });
    app.post('/deploy', requireCompositeAction('project.deploy.create', {
      kind: 'deployment',
      projectIdFrom: 'body',
      engineIdFrom: 'body',
    }), (req: any, res) => {
      res.json({
        actionId: req.authzAction?.actionId,
        resource: req.authzResource,
        composite: req.authzComposite,
        eligibility: req.deploymentEligibility,
        deployContext: req.deployContext,
      });
    });
    app.post('/invitations', requireInvitationCreateAction(), (req: any, res) => {
      res.json({
        actionId: req.authzAction?.actionId,
        resource: req.authzResource,
        target: req.authzInvitationTarget,
      });
    });
    app.use(errorHandler);
    vi.clearAllMocks();
    (policyService.evaluateGate as unknown as Mock).mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' });

    projectFindOne = vi.fn().mockResolvedValue({ id: projectId, tenantId: null });
    projectFind = vi.fn().mockResolvedValue([{ id: projectId, tenantId: null }]);
    engineFind = vi.fn().mockResolvedValue([{ id: engineId, tenantId: null }]);
    engineFindOne = vi.fn().mockResolvedValue({ id: engineId, tenantId: null, name: 'Engine One', environmentTagId: null });
    fileFindOne = vi.fn().mockResolvedValue({ id: fileId, projectId });
    folderFindOne = vi.fn().mockResolvedValue({ id: folderId, projectId });
    gitRepositoryFindOne = vi.fn().mockResolvedValue({ id: gitRepositoryId, projectId });
    gitDeploymentFindOne = vi.fn().mockResolvedValue({ id: gitDeploymentId, projectId });
    gitLockFindOne = vi.fn().mockResolvedValue({ id: gitLockId, fileId });
    savedFilterFindOne = vi.fn().mockResolvedValue({ id: savedFilterId, engineId });
    versionFindOne = vi.fn().mockResolvedValue({ id: versionId, fileId });
    runtimeResourceFindOne = vi.fn().mockResolvedValue({ id: 'runtime-resource-1', tenantId: null });
    runtimeResourceFind = vi.fn().mockResolvedValue([{ id: 'runtime-resource-1', tenantId: null, resourceKey: 'payments' }]);
    camundaGet.mockResolvedValue({ id: 'definition-1', key: 'payments', tenantId: null });

    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) =>
        permission === 'project:files:view' ||
        permission === 'engine:instance:view'
    );
    (permissionService.getKnownEngineIdsForUser as unknown as Mock).mockResolvedValue([engineId]);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([projectId]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: projectFindOne, find: projectFind };
        if (entity === Engine) return { find: engineFind, findOne: engineFindOne, findOneBy: engineFindOne };
        if (entity === EnvironmentTag) return { findOneBy: vi.fn().mockResolvedValue(null) };
        if (entity === File) return { findOne: fileFindOne };
        if (entity === Folder) return { findOne: folderFindOne };
        if (entity === GitRepository) return { findOne: gitRepositoryFindOne };
        if (entity === GitDeployment) return { findOne: gitDeploymentFindOne };
        if (entity === GitLock) return { findOne: gitLockFindOne };
        if (entity === SavedFilter) return { findOne: savedFilterFindOne };
        if (entity === Version) return { findOne: versionFindOne };
        if (entity === RuntimeResource) return { findOne: runtimeResourceFindOne, find: runtimeResourceFind };
        return {};
      },
    });
  });

  it('uses the engine definition key and inventory for resource-aware definition access', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const response = await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/process-definition/definition-1');
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ engineId, resourceKey: 'payments', resourceKind: 'process_definition' }),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('ignores a client-supplied definition key and authorizes the key resolved live from the engine', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'definition-1', key: 'payments', tenantId: null });

    const response = await request(app)
      .get(`/runtime-definitions/definition-1?engineId=${engineId}&key=hr-untrusted`);

    expect(response.status).toBe(200);
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ resourceKey: 'payments', runtimeTenantId: '' }),
    }));
    expect(runtimeResourceFindOne).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ resourceKey: 'hr-untrusted' }),
    }));
  });

  it('denies a live-resolved runtime resource from another tenant before resource permission evaluation', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-a', runtimeAccessScope: 'resource_aware' });
    runtimeResourceFindOne.mockResolvedValue({ id: 'runtime-resource-tenant-b', tenantId: 'tenant-b' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    camundaGet.mockResolvedValue({ id: 'definition-1', key: 'payments', tenantId: 'runtime-tenant-a' });

    const response = await request(app)
      .get(`/runtime-definitions/definition-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ resourceKey: 'payments', runtimeTenantId: 'runtime-tenant-a' }),
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine', resourceId: engineId, tenantId: 'tenant-a',
    }));
  });

  it('authorizes engine-wide runtime access without resolving runtime inventory', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).not.toHaveBeenCalled();
    expect(runtimeResourceFindOne).not.toHaveBeenCalled();
    expect(response.body.resource).toEqual({ type: 'engine', id: engineId });
  });

  it('resolves a deployment only through active inventoried runtime resources', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    runtimeResourceFind.mockResolvedValue([
      { id: 'runtime-resource-payments', tenantId: null, resourceKey: 'payments' },
      { id: 'runtime-resource-risk', tenantId: null, resourceKey: 'payments-risk' },
    ]);
    (permissionService.hasPermission as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const response = await request(app).get(`/runtime-deployments/deployment-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(runtimeResourceFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ engineId, deploymentId: 'deployment-1', isActive: true }),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-payments' });
    expect(response.body.resourceKeys).toEqual(['payments', 'payments-risk']);
  });

  it('fails closed when a resource-aware deployment is absent from inventory', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    runtimeResourceFind.mockResolvedValue([]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get(`/runtime-deployments/deployment-missing?engineId=${engineId}`);

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
  });

  it('retains the engine-wide deployment fast path without inventory lookups', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app).get(`/runtime-deployments/deployment-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(runtimeResourceFind).not.toHaveBeenCalled();
    expect(response.body.resource).toEqual({ type: 'engine', id: engineId });
  });

  it('resolves a key-based definition before authorizing it', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue([{ id: 'definition-2', key: 'payments', tenantId: null }]);

    const response = await request(app).get(`/runtime-definitions-by-key/payments?engineId=${engineId}&version=2`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/process-definition', { key: 'payments', version: 2 });
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('resolves decision definitions by their live key and runtime tenant', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'decision-1', key: 'payments-risk', tenantId: 'runtime-tenant-a' });

    const response = await request(app).get(`/runtime-decisions/decision-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/decision-definition/decision-1');
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        engineId,
        resourceKind: 'decision_definition',
        resourceKey: 'payments-risk',
        runtimeTenantId: 'runtime-tenant-a',
      }),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('resolves linked job authorization through its process definition', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet
      .mockResolvedValueOnce({ id: 'job-1', processDefinitionId: 'definition-1' })
      .mockResolvedValueOnce({ id: 'definition-1', key: 'payments', tenantId: null });

    const response = await request(app).get(`/runtime-jobs/job-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenNthCalledWith(1, engineId, '/job/job-1');
    expect(camundaGet).toHaveBeenNthCalledWith(2, engineId, '/process-definition/definition-1');
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('requires explicit and fully authorized instances for resource-aware batch actions', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'instance-1', definitionKey: 'payments' });

    const response = await request(app)
      .post('/runtime-instance-selection')
      .send({ engineId, processInstanceIds: ['instance-1'] });

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/process-instance/instance-1');
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        engineId,
        resourceKind: 'process_definition',
        resourceKey: 'payments',
      }),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('rejects unbounded batch selections on resource-aware engines', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).post('/runtime-instance-selection').send({ engineId });

    expect(response.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('requires both migration definitions to be authorized on resource-aware engines', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' });

    const response = await request(app).post('/runtime-migration').send({
      engineId,
      plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
    });

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenNthCalledWith(1, engineId, '/process-definition/source-v1');
    expect(camundaGet).toHaveBeenNthCalledWith(2, engineId, '/process-definition/target-v2');
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('discovers resource-aware engines when a runtime resource is visible', async () => {
    engineFind.mockResolvedValue([{ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' }]);
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, runtimeAccessScope: 'resource_aware' });
    (permissionService.getKnownEngineIdsForUser as unknown as Mock).mockResolvedValue([engineId]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock)
      .mockResolvedValueOnce([{ id: 'runtime-resource-1' }])
      .mockResolvedValueOnce([]);

    const response = await request(app).get('/engines');

    expect(response.status).toBe(200);
    expect(response.body.authorizedEngineIds).toEqual([engineId]);
  });

  it('authorizes deployment composite actions through deployment eligibility', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: true,
      decision: 'allow',
      mode: 'manual',
      projectId,
      engineId,
      checks: [],
      reasons: [],
    });

    const response = await request(app)
      .post('/deploy')
      .send({ projectId, engineId });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      actionId: 'project.deploy.create',
      resource: { type: 'project', id: projectId },
      composite: {
        kind: 'deployment',
        actionId: 'project.deploy.create',
        projectId,
        engineId,
        mode: 'manual',
      },
      deployContext: {
        projectId,
        engineId,
        projectRole: 'permission',
        engineName: 'Engine One',
      },
    });
    expect(updateBpmnEngineRequestContext).toHaveBeenCalledWith({
      actionId: 'project.deploy.create',
      projectId,
      engineId,
    });
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledWith({
      userId: 'user-1',
      tenantId: null,
      projectId,
      engineId,
      mode: 'manual',
    });
  });

  it('returns deployment eligibility reasons when a composite deployment action is denied', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: false,
      decision: 'deny',
      mode: 'manual',
      projectId,
      engineId,
      checks: [
        {
          id: 'project.permission.deploy',
          allowed: false,
          reason: 'User lacks project deploy permission',
          remediation: 'Assign project deploy permission.',
        },
      ],
      reasons: ['User lacks project deploy permission'],
    });

    const response = await request(app)
      .post('/deploy')
      .send({ projectId, engineId });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'User lacks project deploy permission',
      reasons: ['User lacks project deploy permission'],
      hint: 'Assign project deploy permission.',
    });
  });

  it('keeps deployment auto-grant when only the project-engine target is missing and approval permission exists', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock)
      .mockResolvedValueOnce({
        allowed: false,
        decision: 'deny',
        mode: 'manual',
        projectId,
        engineId,
        checks: [{ id: 'project_engine_target.active', allowed: false, reason: 'No active target' }],
        reasons: ['No active target'],
      })
      .mockResolvedValueOnce({
        allowed: true,
        decision: 'allow',
        mode: 'manual',
        projectId,
        engineId,
        checks: [{ id: 'project_engine_target.active', allowed: true, reason: 'Target exists' }],
        reasons: [],
      });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'engine:project-access:approve'
    );

    const response = await request(app)
      .post('/deploy')
      .send({ projectId, engineId });

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:project-access:approve', expect.objectContaining({
      userId: 'user-1',
      tenantId: null,
      resourceType: 'engine',
      resourceId: engineId,
    }));
    expect(engineAccessService.grantAccess).toHaveBeenCalledWith(projectId, engineId, 'user-1', true);
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledTimes(2);
  });

  it('resolves a project-scoped action from a file id', async () => {
    const response = await request(app).get(`/files/${fileId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'project', id: projectId },
      projectId,
      fileId,
    });
    expect(fileFindOne).toHaveBeenCalledWith({
      where: { id: fileId },
      select: ['id', 'projectId'],
    });
    expect(projectFindOne).toHaveBeenCalledWith({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect((permissionService.hasPermission as unknown as Mock).mock.calls.every(([, context]) => !('platformRole' in context))).toBe(true);
  });

  it('resolves a project-scoped action from a folder id', async () => {
    const response = await request(app).get(`/folders/${folderId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'project', id: projectId },
      projectId,
      folderId,
    });
    expect(folderFindOne).toHaveBeenCalledWith({
      where: { id: folderId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('resolves a project-scoped action from a version id through its file', async () => {
    const response = await request(app).get(`/versions/${versionId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'project', id: projectId },
      projectId,
      fileId,
      versionId,
    });
    expect(versionFindOne).toHaveBeenCalledWith({
      where: { id: versionId },
      select: ['id', 'fileId'],
    });
    expect(fileFindOne).toHaveBeenCalledWith({
      where: { id: fileId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('denies after resolving the project when the permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get(`/files/${fileId}`);

    expect(response.status).toBe(403);
    expect(fileFindOne).toHaveBeenCalled();
    expect(projectFindOne).toHaveBeenCalled();
    expect(permissionService.hasPermission).toHaveBeenCalled();
  });

  it('honors an explicit deny policy after the scoped RBAC grant succeeds', async () => {
    (policyService.evaluateGate as unknown as Mock).mockResolvedValueOnce({
      decision: 'deny',
      reason: 'policy:release-freeze',
    });

    const response = await request(app).get(`/files/${fileId}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('policy:release-freeze');
    expect(policyService.evaluateGate).toHaveBeenCalledWith('project:files:view', {
      userId: 'user-1',
      tenantId: null,
      resourceType: 'project',
      resourceId: projectId,
    });
  });

  it('fails closed before permission evaluation when the resolved project is outside the tenant', async () => {
    projectFindOne.mockResolvedValue({ id: projectId, tenantId: 'tenant-a' });

    const response = await request(app).get(`/files/${fileId}`).query({ tenantId: 'tenant-b' });

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('resolves an engine visible collection from known engine ids and filters denied ids', async () => {
    engineFind.mockResolvedValue([
      { id: engineId, tenantId: null },
      { id: secondEngineId, tenantId: null },
    ]);
    (permissionService.getKnownEngineIdsForUser as unknown as Mock).mockResolvedValue([engineId, secondEngineId]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string, context: { resourceId?: string }) =>
        permission === 'engine:instance:view' && context.resourceId === engineId
    );

    const response = await request(app).get('/engines');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      resource: { type: 'engine', id: null },
      authorizedEngineIds: [engineId],
      collection: {
        type: 'engine',
        ids: [engineId],
        requestedIds: [engineId, secondEngineId],
        deniedIds: [secondEngineId],
      },
    });
    expect(permissionService.getKnownEngineIdsForUser).toHaveBeenCalledWith('user-1', null);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: engineId,
    }));
  });

  it('filters a project collection through the same per-resource policy boundary as project detail routes', async () => {
    projectFind.mockResolvedValue([
      { id: projectId, tenantId: null },
      { id: secondProjectId, tenantId: null },
    ]);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([projectId, secondProjectId]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string, context: { resourceId?: string }) =>
        permission === 'project:files:view' && context.resourceId === projectId
    );

    const response = await request(app).get('/projects');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      resource: { type: 'project', id: null },
      authorizedProjectIds: [projectId],
      collection: {
        type: 'project',
        ids: [projectId],
        requestedIds: [projectId, secondProjectId],
        deniedIds: [secondProjectId],
      },
    });
    expect(permissionService.getKnownProjectIdsForUser).toHaveBeenCalledWith('user-1', null);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('resolves an engine-scoped action from a saved filter id', async () => {
    const response = await request(app).get(`/saved-filters/${savedFilterId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'engine', id: engineId },
      engineId,
      savedFilterId,
    });
    expect(savedFilterFindOne).toHaveBeenCalledWith({
      where: { id: savedFilterId },
      select: ['id', 'engineId'],
    });
    expect(engineFindOne).toHaveBeenCalledWith({
      where: { id: engineId },
      select: ['id', 'tenantId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: engineId,
    }));
  });

  it('resolves a project-scoped action from a Git repository id', async () => {
    const response = await request(app).get(`/git-repositories/${gitRepositoryId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'project', id: projectId },
      repositoryId: gitRepositoryId,
      projectId,
    });
    expect(gitRepositoryFindOne).toHaveBeenCalledWith({
      where: { id: gitRepositoryId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('resolves a project-scoped action from a Git deployment id', async () => {
    const response = await request(app).get(`/git-deployments/${gitDeploymentId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'project', id: projectId },
      deploymentId: gitDeploymentId,
      projectId,
    });
    expect(gitDeploymentFindOne).toHaveBeenCalledWith({
      where: { id: gitDeploymentId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('resolves a project-scoped action from a Git lock id', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:settings:manage'
    );

    const response = await request(app).delete(`/git-locks/${gitLockId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'project', id: projectId },
      lockId: gitLockId,
      fileId,
      projectId,
    });
    expect(gitLockFindOne).toHaveBeenCalledWith({
      where: { id: gitLockId },
      select: ['id', 'fileId'],
    });
    expect(fileFindOne).toHaveBeenCalledWith({
      where: { id: fileId },
      select: ['id', 'projectId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:settings:manage', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('allows a project action when any accepted permission matches', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:git:push'
    );

    const response = await request(app).get(`/sync-status/${projectId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      resource: { type: 'project', id: projectId },
      projectId,
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:git:pull', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:git:push', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('resolves invitation create permission from the body target resource', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:members:manage'
    );

    const response = await request(app)
      .post('/invitations')
      .send({ resourceType: 'project', resourceId: projectId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      actionId: 'invitations.create',
      resource: { type: 'project', id: projectId },
      target: {
        resourceType: 'project',
        resourceId: projectId,
        requiredPermissions: ['project:members:manage'],
      },
    });
    expect(projectFindOne).toHaveBeenCalledWith({
      where: { id: projectId },
      select: ['id', 'tenantId'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:members:manage', expect.objectContaining({
      resourceType: 'project',
      resourceId: projectId,
    }));
  });
});
