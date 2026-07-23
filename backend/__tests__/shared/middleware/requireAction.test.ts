import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { AUTHZ_RESOURCE_RESOLVERS } from '@enterpriseglue/shared/authz/permission-actions.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getRuntimeResourceActionDecision, requireAction, requireCompositeAction, requireInvitationCreateAction, requireRuntimeCollectionAction, requireRuntimeDefinitionAction, requireRuntimeDeploymentAction, requireRuntimeMigrationAction, requireRuntimeProcessInstanceSelectionAction } from '@enterpriseglue/shared/middleware/requireAction.js';
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

describe('getRuntimeResourceActionDecision', () => {
  it('allows a broad engine grant without resolving runtime inventory', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    await expect(getRuntimeResourceActionDecision({
      actionId: 'engine.runtime.process-definitions.read', userId: 'user-1', tenantId: null,
      engineId: 'engine-1', resourceKind: 'process_definition', resourceKeys: ['payments'],
    })).resolves.toEqual({ allowed: true });
    expect(getDataSource).not.toHaveBeenCalled();
    vi.resetAllMocks();
  });

  it('fails closed when no resolved runtime resource key is supplied', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    await expect(getRuntimeResourceActionDecision({
      actionId: 'engine.runtime.process-definitions.read', userId: 'user-1', tenantId: null,
      engineId: 'engine-1', resourceKind: 'process_definition', resourceKeys: [],
    })).resolves.toEqual({ allowed: false, reason: 'Action decision unavailable for this runtime resource' });
    expect(getDataSource).not.toHaveBeenCalled();
    vi.clearAllMocks();
  });

  it('denies a resolved runtime resource without its specific permission', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ id: 'resource-1', tenantId: null }) }) });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await expect(getRuntimeResourceActionDecision({
      actionId: 'engine.runtime.process-definitions.read', userId: 'user-1', tenantId: null,
      engineId: 'engine-1', resourceKind: 'process_definition', resourceKeys: ['payments'],
    })).resolves.toEqual({ allowed: false, reason: 'Action unavailable for this runtime resource' });
    vi.clearAllMocks();
  });

  it('allows when every resolved runtime resource grants the action', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ id: 'resource-1', tenantId: null }) }) });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(getRuntimeResourceActionDecision({
      actionId: 'engine.runtime.process-definitions.read', userId: 'user-1', tenantId: null,
      engineId: 'engine-1', resourceKind: 'process_definition', resourceKeys: ['payments'],
    })).resolves.toEqual({ allowed: true });
    vi.clearAllMocks();
  });

  it('fails closed when a resolved runtime resource is absent from inventory', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => ({ findOne: vi.fn().mockResolvedValue(null) }) });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    await expect(getRuntimeResourceActionDecision({
      actionId: 'engine.runtime.process-definitions.read', userId: 'user-1', tenantId: null,
      engineId: 'engine-1', resourceKind: 'process_definition', resourceKeys: ['payments'],
    })).resolves.toEqual({ allowed: false, reason: 'Action decision unavailable for this runtime resource' });
    vi.clearAllMocks();
  });

  it('fails closed when runtime decision dependencies fail unexpectedly', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (getDataSource as unknown as Mock).mockRejectedValueOnce(new Error('inventory unavailable'));

    await expect(getRuntimeResourceActionDecision({
      actionId: 'engine.runtime.process-definitions.read', userId: 'user-1', tenantId: null,
      engineId: 'engine-1', resourceKind: 'process_definition', resourceKeys: ['payments'],
    })).resolves.toEqual({ allowed: false, reason: 'Action decision unavailable for this runtime resource' });
    vi.clearAllMocks();
  });
});

describe('requireRuntimeCollectionAction', () => {
  it('rejects an unauthenticated runtime collection request before resolving any resource', async () => {
    const next = vi.fn();

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(
      { query: {} } as any,
      {} as any,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message: 'Authentication required' }));
  });

  it('requires an engine identifier before evaluating runtime collection access', async () => {
    const next = vi.fn();

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(
      { user: { userId: 'user-1' }, query: {} } as any,
      {} as any,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'engineId is required' }));
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('hides missing runtime-collection engines before permission evaluation', async () => {
    const next = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ findOne: vi.fn().mockResolvedValue(null) }),
    });

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(
      { user: { userId: 'user-1' }, query: { engineId: 'missing-engine' } } as any,
      {} as any,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, message: expect.stringContaining('Engine not found') }));
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('allows an engine-wide runtime collection grant and attaches its authorization context', async () => {
    const next = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' }) }),
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    const req: any = {
      user: { userId: 'user-1' },
      tenant: { tenantId: 'tenant-default' },
      query: { engineId: 'engine-1' },
    };

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.authzResource).toEqual({ type: 'engine', id: 'engine-1' });
    expect(req.runtimeAccessScope).toBe('engine_wide');
  });

  it('does not let a broad engine grant bypass shared-engine resource filtering', async () => {
    const next = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({
          id: 'engine-1',
          tenantId: null,
          tenancyMode: 'shared',
          runtimeAccessScope: 'resource_aware',
        }),
      }),
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([]);

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(
      { user: { userId: 'user-1' }, tenant: { tenantId: 'tenant-a' }, query: { engineId: 'engine-1' } } as any,
      {} as any,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 403,
      message: 'No authorized runtime resources are available for this engine',
    }));
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1',
      tenantId: 'tenant-a',
    }));
  });

  it('narrows a broad shared-engine grant to resolved visible resource scopes', async () => {
    const next = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({
          id: 'engine-1',
          tenantId: null,
          tenancyMode: 'shared',
          runtimeAccessScope: 'resource_aware',
        }),
      }),
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      { id: 'resource-1', resourceKey: 'payments', runtimeTenantId: 'runtime-a' },
    ]);
    const req: any = {
      user: { userId: 'user-1' },
      tenant: { tenantId: 'tenant-a' },
      query: { engineId: 'engine-1' },
    };

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(
      req,
      {} as any,
      next,
    );

    expect(next).toHaveBeenCalledWith();
    expect(req.authorizedRuntimeResourceKeys).toEqual(['payments']);
    expect(req.authorizedRuntimeResourceScopes).toEqual([
      { resourceKey: 'payments', runtimeTenantId: 'runtime-a' },
    ]);
  });

  it('denies resource-aware runtime collections with no visible resources', async () => {
    const next = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' }) }),
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([]);

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(
      {
        user: { userId: 'user-1' },
        tenant: { tenantId: 'tenant-default' },
        query: { engineId: 'engine-1' },
      } as any,
      {} as any,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, message: 'No authorized runtime resources are available for this engine' }));
  });

  it('attaches only visible resource-aware runtime scopes', async () => {
    const next = vi.fn();
    (getDataSource as unknown as Mock).mockResolvedValue({ getRepository: () => ({ findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' }) }) });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments', runtimeTenantId: 'tenant-a' }]);
    const req: any = {
      user: { userId: 'user-1' },
      tenant: { tenantId: 'tenant-default' },
      query: { engineId: 'engine-1' },
    };

    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.authorizedRuntimeResourceKeys).toEqual(['payments']);
    expect(req.authorizedRuntimeResourceScopes).toEqual([{ resourceKey: 'payments', runtimeTenantId: 'tenant-a' }]);
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
  let environmentTagFindOne: ReturnType<typeof vi.fn>;
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
      if (req.get('x-test-without-tenant') !== 'true') {
        req.tenant = {
          tenantId: req.query.tenantId ? String(req.query.tenantId) : 'tenant-default',
        };
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
    app.get('/engines/:engineId', requireAction('engine.inventory.read', {
      resourceResolver: 'engine.byId', resourceIdFrom: 'params',
    }), (req: any, res) => res.json({ resource: req.authzResource }));
    app.post('/migration-engines/:engineId', requireAction('engine.inventory.update', {
      resourceResolver: 'engine.byId',
      resourceIdFrom: 'params',
      acceptedPermissions: ['engine:edit' as any],
      unownedEngineMigrationPermission: 'platform:engine-registration:manage' as any,
    }), (req: any, res) => res.json({
      resource: req.authzResource,
      permissionContext: req.permissionContext,
    }));
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
    app.get('/runtime-jobs-default-reference/:id', requireRuntimeDefinitionAction('engine.runtime.jobs.read', {
      resourceKind: 'process_definition',
      definitionPath: 'job',
      definitionReferenceField: 'processDefinitionId',
    }), (req: any, res) => {
      res.json({ resource: req.authzResource, engineId: req.engineId });
    });
    app.get('/runtime-definitions-custom/:definitionId', requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
      resourceKind: 'process_definition',
      definitionPath: 'process-definition',
      definitionIdKey: 'definitionId',
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
    app.get('/runtime-process-deployments/:deploymentId', requireRuntimeDeploymentAction('engine.runtime.process-definitions.read', {
      resourceKinds: ['process_definition'],
    }), (req: any, res) => {
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
    app.post('/deploy-optional', requireCompositeAction('project.deploy.create', {
      kind: 'deployment',
      projectIdFrom: 'body',
      engineIdFrom: 'body',
      optionalWhenMissingEngineId: true,
    }), (_req, res) => res.json({ optional: true }));
    app.post('/deploy-no-context', requireCompositeAction('project.deploy.create', {
      kind: 'deployment',
      projectIdFrom: 'body',
      engineIdFrom: 'body',
      attachDeployContext: false,
    }), (req: any, res) => res.json({ composite: req.authzComposite, deployContext: req.deployContext }));
    app.post('/invitations', requireInvitationCreateAction(), (req: any, res) => {
      res.json({
        actionId: req.authzAction?.actionId,
        resource: req.authzResource,
        target: req.authzInvitationTarget,
      });
    });
    app.use(errorHandler);
    vi.clearAllMocks();
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockReset().mockResolvedValue([]);
    (policyService.evaluateGate as unknown as Mock).mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' });

    projectFindOne = vi.fn().mockResolvedValue({ id: projectId, tenantId: null });
    projectFind = vi.fn().mockResolvedValue([{ id: projectId, tenantId: null }]);
    engineFind = vi.fn().mockResolvedValue([{
      id: engineId,
      tenantId: 'tenant-default',
      tenancyMode: 'dedicated',
    }]);
    engineFindOne = vi.fn().mockResolvedValue({
      id: engineId,
      tenantId: 'tenant-default',
      tenancyMode: 'dedicated',
      name: 'Engine One',
      environmentTagId: null,
    });
    environmentTagFindOne = vi.fn().mockResolvedValue(null);
    fileFindOne = vi.fn().mockResolvedValue({ id: fileId, projectId });
    folderFindOne = vi.fn().mockResolvedValue({ id: folderId, projectId });
    gitRepositoryFindOne = vi.fn().mockResolvedValue({ id: gitRepositoryId, projectId });
    gitDeploymentFindOne = vi.fn().mockResolvedValue({ id: gitDeploymentId, projectId });
    gitLockFindOne = vi.fn().mockResolvedValue({ id: gitLockId, fileId });
    savedFilterFindOne = vi.fn().mockResolvedValue({ id: savedFilterId, engineId });
    versionFindOne = vi.fn().mockResolvedValue({ id: versionId, fileId });
    runtimeResourceFindOne = vi.fn().mockResolvedValue({ id: 'runtime-resource-1', tenantId: null });
    runtimeResourceFind = vi.fn().mockResolvedValue([{ id: 'runtime-resource-1', tenantId: null, resourceKey: 'payments' }]);
    camundaGet.mockReset().mockResolvedValue({ id: 'definition-1', key: 'payments', tenantId: null });

    (permissionService.hasPermission as unknown as Mock).mockReset().mockImplementation(
      async (permission: string) =>
        permission === 'project:files:view' ||
        permission === 'engine:instance:view'
    );
    (permissionService.getKnownEngineIdsForUser as unknown as Mock).mockReset().mockResolvedValue([engineId]);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockReset().mockResolvedValue([projectId]);
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Project) return { findOne: projectFindOne, find: projectFind };
        if (entity === Engine) return { find: engineFind, findOne: engineFindOne, findOneBy: engineFindOne };
        if (entity === EnvironmentTag) return { findOneBy: environmentTagFindOne };
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
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const response = await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/process-definition/definition-1');
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({ engineId, resourceKey: 'payments', resourceKind: 'process_definition' }),
      ]),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('ignores a client-supplied definition key and authorizes the key resolved live from the engine', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'definition-1', key: 'payments', tenantId: null });

    const response = await request(app)
      .get(`/runtime-definitions/definition-1?engineId=${engineId}&key=hr-untrusted`);

    expect(response.status).toBe(200);
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({ resourceKey: 'payments', runtimeTenantId: '' }),
      ]),
    }));
    expect(runtimeResourceFindOne).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({ resourceKey: 'hr-untrusted' }),
      ]),
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
      where: expect.arrayContaining([
        expect.objectContaining({ resourceKey: 'payments', runtimeTenantId: 'runtime-tenant-a', tenantResolutionStatus: 'resolved' }),
      ]),
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine', resourceId: engineId, tenantId: 'tenant-a',
    }));
  });

  it('authorizes engine-wide runtime access without resolving runtime inventory', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).not.toHaveBeenCalled();
    expect(runtimeResourceFindOne).not.toHaveBeenCalled();
    expect(response.body.resource).toEqual({ type: 'engine', id: engineId });
  });

  it('denies an uninventoried shared definition before any engine transport despite a broad grant', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFindOne.mockResolvedValue(null);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app)
      .get(`/runtime-definitions/definition-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
    expect(runtimeResourceFindOne).not.toHaveBeenCalled();
  });

  it('allows a broad shared definition only through its resolved same-tenant inventory row', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFindOne.mockResolvedValue({
      id: 'runtime-resource-1',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: 'runtime-a',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{
      id: 'runtime-resource-1',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: 'runtime-a',
    }]);

    const response = await request(app)
      .get(`/runtime-definitions/definition-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(200);
    expect(camundaGet).not.toHaveBeenCalled();
    expect(response.body.resource).toEqual({
      type: 'engine_runtime_resource',
      id: 'runtime-resource-1',
    });
  });

  it('resolves a shared definition through explicit inventory without an active tenant', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFindOne.mockResolvedValue({
      id: 'runtime-resource-1',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: 'runtime-a',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{
      id: 'runtime-resource-1',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: 'runtime-a',
    }]);

    const response = await request(app)
      .get(`/runtime-definitions/definition-1?engineId=${engineId}`)
      .set('x-test-without-tenant', 'true');

    expect(response.status).toBe(200);
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        engineId,
        engineResourceId: 'definition-1',
        tenantResolutionStatus: 'resolved',
      }),
    }));
  });

  it('authorizes an older shared definition ID through visible key and runtime-tenant lineage', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFindOne.mockResolvedValue(null);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{
      id: 'runtime-resource-1',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: 'runtime-a',
    }]);
    camundaGet.mockResolvedValue({
      id: 'definition-v1',
      key: 'payments',
      tenantId: 'runtime-a',
    });

    const response = await request(app)
      .get(`/runtime-definitions/definition-v1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledTimes(1);
    expect(response.body.resource).toEqual({
      type: 'engine_runtime_resource',
      id: 'runtime-resource-1',
    });
  });

  it('authorizes one exact shared definition key without engine discovery transport', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      {
        id: 'runtime-resource-1',
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
        resourceKey: 'payments',
        runtimeTenantId: 'runtime-a',
      },
      {
        id: 'runtime-resource-duplicate',
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
        resourceKey: 'payments',
        runtimeTenantId: 'runtime-a',
      },
    ]);

    const response = await request(app)
      .get(`/runtime-definitions-by-key/payments?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(200);
    expect(camundaGet).not.toHaveBeenCalled();
    expect(response.body.resource).toEqual({
      type: 'engine_runtime_resource',
      id: 'runtime-resource-1',
    });

    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{
      id: 'runtime-resource-no-tenant',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: undefined,
    }]);
    expect((await request(app)
      .get(`/runtime-definitions-by-key/payments?engineId=${engineId}&tenantId=tenant-a`)).status).toBe(200);
  });

  it('denies missing or runtime-tenant-ambiguous shared definition keys', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      {
        id: 'runtime-resource-other',
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
        resourceKey: 'other',
        runtimeTenantId: 'runtime-a',
      },
    ]);
    expect((await request(app)
      .get(`/runtime-definitions-by-key/payments?engineId=${engineId}&tenantId=tenant-a`)).status).toBe(403);

    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      {
        id: 'runtime-resource-a',
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
        resourceKey: 'payments',
        runtimeTenantId: 'runtime-a',
      },
      {
        id: 'runtime-resource-b',
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
        resourceKey: 'payments',
        runtimeTenantId: 'runtime-b',
      },
    ]);
    expect((await request(app)
      .get(`/runtime-definitions-by-key/payments?engineId=${engineId}&tenantId=tenant-a`)).status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('fails closed when a historical shared definition has no stable authorization key', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFindOne.mockResolvedValue({
      id: 'stale-direct-row',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'stale',
      runtimeTenantId: '',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      {
        id: 'runtime-resource-other',
        tenantId: 'tenant-a',
        tenantResolutionStatus: 'resolved',
        resourceKey: 'other',
        runtimeTenantId: undefined,
      },
    ]);
    camundaGet.mockResolvedValue({ id: 'definition-v1', key: 42, tenantId: null });

    const response = await request(app)
      .get(`/runtime-definitions/definition-v1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
    expect(camundaGet).toHaveBeenCalledTimes(1);
  });

  it('authorizes historical shared no-tenant lineage without treating null as an enterprise tenant', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFindOne.mockResolvedValue(null);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{
      id: 'runtime-resource-no-tenant',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: undefined,
    }]);
    camundaGet.mockResolvedValue({
      id: 'definition-v1',
      key: 'payments',
      tenantId: null,
    });

    const response = await request(app)
      .get(`/runtime-definitions/definition-v1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(200);
    expect(response.body.resource.id).toBe('runtime-resource-no-tenant');
  });

  it('quarantines an unresolved shared definition before any engine transport', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFindOne.mockResolvedValue({
      id: 'runtime-resource-1',
      tenantId: null,
      tenantResolutionStatus: 'unmapped',
      resourceKey: 'payments',
      runtimeTenantId: 'runtime-a',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app)
      .get(`/runtime-definitions/definition-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
  });

  it('denies engine-wide runtime definitions without a broad grant', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    expect((await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`)).status).toBe(403);
  });

  it('resolves a deployment only through active inventoried runtime resources', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
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
      where: expect.arrayContaining([
        expect.objectContaining({ engineId, deploymentId: 'deployment-1', isActive: true }),
      ]),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-payments' });
    expect(response.body.resourceKeys).toEqual(['payments', 'payments-risk']);
  });

  it('does not let one runtime-resource grant authorize a sibling in the same deployment', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    runtimeResourceFind.mockResolvedValue([
      { id: 'runtime-resource-payments', tenantId: null, resourceKey: 'payments' },
      { id: 'runtime-resource-risk', tenantId: null, resourceKey: 'payments-risk' },
    ]);
    (permissionService.hasPermission as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const response = await request(app).get(`/runtime-deployments/deployment-1?engineId=${engineId}`);

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).toHaveBeenLastCalledWith(
      'engine:instance:view',
      expect.objectContaining({ resourceType: 'engine_runtime_resource', resourceId: 'runtime-resource-risk' }),
    );
  });

  it('narrows deployment inventory queries when the action has one resource kind', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    runtimeResourceFind.mockResolvedValue([{ id: 'runtime-resource-1', tenantId: null, resourceKey: 'payments' }]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const response = await request(app).get(`/runtime-process-deployments/deployment-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(runtimeResourceFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({ resourceKind: 'process_definition' }),
      ]),
    }));
  });

  it('fails closed when a resource-aware deployment is absent from inventory', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    runtimeResourceFind.mockResolvedValue([]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get(`/runtime-deployments/deployment-missing?engineId=${engineId}`);

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
  });

  it('retains the engine-wide deployment fast path without inventory lookups', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app).get(`/runtime-deployments/deployment-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(runtimeResourceFind).not.toHaveBeenCalled();
    expect(response.body.resource).toEqual({ type: 'engine', id: engineId });
  });

  it('denies engine-wide runtime deployments without a broad grant', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    expect((await request(app).get(`/runtime-deployments/deployment-1?engineId=${engineId}`)).status).toBe(403);
  });

  it('rejects inventoried runtime deployments without resource-specific permission', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    runtimeResourceFind.mockResolvedValue([{ id: 'runtime-resource-1', tenantId: null, resourceKey: 'payments' }]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    const response = await request(app).get(`/runtime-deployments/deployment-1?engineId=${engineId}`);

    expect(response.status).toBe(403);
  });

  it('resolves a key-based definition before authorizing it', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue([{ id: 'definition-2', key: 'payments', tenantId: null }]);

    const response = await request(app).get(`/runtime-definitions-by-key/payments?engineId=${engineId}&version=2`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/process-definition', { key: 'payments', version: 2 });
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('uses the latest runtime definition version when none is requested', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue([{ id: 'definition-latest', key: 'payments', tenantId: null }]);

    const response = await request(app).get(`/runtime-definitions-by-key/payments?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/process-definition', { key: 'payments', latestVersion: true });
  });

  it('rejects non-positive runtime definition versions on the resource-aware path', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).get(`/runtime-definitions-by-key/payments?engineId=${engineId}&version=0`);

    expect(response.status).toBe(400);
  });

  it('fails closed for missing, unresolvable, uninventoried, and ungranted runtime definitions', async () => {
    engineFindOne.mockReset().mockResolvedValue(null);
    expect((await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`)).status).toBe(404);

    engineFindOne.mockReset().mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValue(false);
    camundaGet.mockReset().mockResolvedValue({ id: 'definition-1', tenantId: null });
    expect((await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`)).status).toBe(403);

    camundaGet.mockReset().mockResolvedValue({ id: 'definition-1', key: 'payments', tenantId: null });
    runtimeResourceFindOne.mockReset().mockResolvedValue(null);
    expect((await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`)).status).toBe(403);

    runtimeResourceFindOne.mockReset().mockResolvedValue({ id: 'runtime-resource-1', tenantId: null });
    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    expect((await request(app).get(`/runtime-definitions/definition-1?engineId=${engineId}`)).status).toBe(403);

    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValue(false);
    camundaGet.mockReset().mockResolvedValue([]);
    expect((await request(app).get(`/runtime-definitions-by-key/payments?engineId=${engineId}`)).status).toBe(404);
  });

  it('requires authenticated, identified, and existing engines for runtime operation guards', async () => {
    const collection = requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' });
    const selection = requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.process-instances.delete', { resourceKind: 'process_definition' });
    const deployment = requireRuntimeDeploymentAction('engine.runtime.process-definitions.read');
    const migration = requireRuntimeMigrationAction('engine.runtime.migrations.execute-async', { resourceKind: 'process_definition' });

    const anonymousNext = vi.fn();
    await selection({ body: {} } as any, {} as any, anonymousNext);
    expect(anonymousNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));

    const collectionMissingIdNext = vi.fn();
    await collection({ user: { userId: 'user-1' }, query: {} } as any, {} as any, collectionMissingIdNext);
    expect(collectionMissingIdNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'engineId is required' }));

    const selectionMissingIdNext = vi.fn();
    await selection({ user: { userId: 'user-1' }, body: {} } as any, {} as any, selectionMissingIdNext);
    expect(selectionMissingIdNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'engineId is required' }));

    const deploymentMissingEngineNext = vi.fn();
    await deployment({ user: { userId: 'user-1' }, params: {}, query: {} } as any, {} as any, deploymentMissingEngineNext);
    expect(deploymentMissingEngineNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'engineId is required' }));

    const deploymentMissingIdNext = vi.fn();
    await deployment({ user: { userId: 'user-1' }, params: {}, query: { engineId } } as any, {} as any, deploymentMissingIdNext);
    expect(deploymentMissingIdNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'deploymentId is required' }));

    const migrationMissingIdNext = vi.fn();
    await migration({ user: { userId: 'user-1' }, body: {} } as any, {} as any, migrationMissingIdNext);
    expect(migrationMissingIdNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'engineId is required' }));

    engineFindOne.mockReset().mockResolvedValue(null);
    const missingEngineNext = vi.fn();
    await migration({ user: { userId: 'user-1' }, body: { engineId } } as any, {} as any, missingEngineNext);
    expect(missingEngineNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('denies an ungranted engine-wide collection and preserves empty runtime tenant identifiers', async () => {
    engineFindOne.mockReset().mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValue(false);
    const deniedNext = vi.fn();
    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(
      {
        user: { userId: 'user-1' },
        tenant: { tenantId: 'tenant-default' },
        query: {},
        engineId,
      } as any,
      {} as any,
      deniedNext,
    );
    expect(deniedNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

    engineFindOne.mockReset().mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockReset().mockResolvedValue([{ resourceKey: 'payments' }]);
    const allowedNext = vi.fn();
    const req: any = {
      user: { userId: 'user-1' },
      tenant: { tenantId: 'tenant-default' },
      query: { engineId },
    };
    await requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' })(req, {} as any, allowedNext);
    expect(allowedNext).toHaveBeenCalledWith();
    expect(req.authorizedRuntimeResourceScopes).toEqual([{ resourceKey: 'payments', runtimeTenantId: '' }]);
  });

  it('guards every runtime middleware against anonymous, incomplete, and missing-engine requests', async () => {
    const definition = requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
      resourceKind: 'process_definition', definitionPath: 'process-definition',
    });
    const selection = requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.process-instances.delete', { resourceKind: 'process_definition' });
    const deployment = requireRuntimeDeploymentAction('engine.runtime.process-definitions.read');
    const migration = requireRuntimeMigrationAction('engine.runtime.migrations.execute-async', { resourceKind: 'process_definition' });

    const anonymousDefinitionNext = vi.fn();
    await definition({ query: {}, params: {} } as any, {} as any, anonymousDefinitionNext);
    expect(anonymousDefinitionNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));

    const missingDefinitionEngineNext = vi.fn();
    await definition({ user: { userId: 'user-1' }, query: {}, params: { id: 'definition-1' } } as any, {} as any, missingDefinitionEngineNext);
    expect(missingDefinitionEngineNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'engineId is required' }));

    const missingDefinitionIdNext = vi.fn();
    await definition({ user: { userId: 'user-1' }, query: { engineId }, params: {} } as any, {} as any, missingDefinitionIdNext);
    expect(missingDefinitionIdNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'id is required' }));

    const anonymousDeploymentNext = vi.fn();
    await deployment({ query: {}, params: {} } as any, {} as any, anonymousDeploymentNext);
    expect(anonymousDeploymentNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));

    const anonymousMigrationNext = vi.fn();
    await migration({ body: {} } as any, {} as any, anonymousMigrationNext);
    expect(anonymousMigrationNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));

    engineFindOne.mockReset().mockResolvedValue(null);
    const missingSelectionEngineNext = vi.fn();
    await selection({ user: { userId: 'user-1' }, body: { engineId, processInstanceIds: ['instance-1'] } } as any, {} as any, missingSelectionEngineNext);
    expect(missingSelectionEngineNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));

    const missingDeploymentEngineNext = vi.fn();
    await deployment({ user: { userId: 'user-1' }, query: { engineId }, params: { deploymentId: 'deployment-1' } } as any, {} as any, missingDeploymentEngineNext);
    expect(missingDeploymentEngineNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('resolves decision definitions by their live key and runtime tenant', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'decision-1', key: 'payments-risk', tenantId: 'runtime-tenant-a' });

    const response = await request(app).get(`/runtime-decisions/decision-1?engineId=${engineId}`);

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/decision-definition/decision-1');
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({
          engineId,
          resourceKind: 'decision_definition',
          resourceKey: 'payments-risk',
          runtimeTenantId: 'runtime-tenant-a',
        }),
      ]),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('resolves linked job authorization through its process definition', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
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

  it('supports custom definition identifiers and the default linked-definition path', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const custom = await request(app).get(`/runtime-definitions-custom/definition-1?engineId=${engineId}`);
    expect(custom.status).toBe(200);

    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet
      .mockReset()
      .mockResolvedValueOnce({ id: 'job-1', processDefinitionId: 'definition-1' })
      .mockResolvedValueOnce({ id: 'definition-1', key: 'payments', tenantId: null });
    const linked = await request(app).get(`/runtime-jobs-default-reference/job-1?engineId=${engineId}`);
    expect(linked.status).toBe(200);
    expect(camundaGet).toHaveBeenNthCalledWith(2, engineId, '/process-definition/definition-1');
  });

  it('reports the custom definition identifier when it is missing', async () => {
    const middleware = requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
      resourceKind: 'process_definition', definitionPath: 'process-definition', definitionIdKey: 'definitionId',
    });
    const next = vi.fn();

    await middleware({ user: { userId: 'user-1' }, query: { engineId }, params: {} } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'definitionId is required' }));

    const keyLookup = requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
      resourceKind: 'process_definition', definitionPath: 'process-definition', definitionLookup: 'key',
    });
    const keyNext = vi.fn();
    await keyLookup({ user: { userId: 'user-1' }, query: { engineId }, params: {} } as any, {} as any, keyNext);
    expect(keyNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'key is required' }));
  });

  it('rejects runtime jobs without a process-definition reference on resource-aware engines', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    camundaGet.mockResolvedValue({ id: 'job-1' });

    expect((await request(app).get(`/runtime-jobs/job-1?engineId=${engineId}`)).status).toBe(403);
  });

  it('denies a shared referenced detail before transport when no resolved resource is visible', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([]);

    const response = await request(app)
      .get(`/runtime-jobs/job-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('denies a shared referenced detail when live lineage resolves outside the visible resource set', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{
      id: 'runtime-resource-visible',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'visible',
      runtimeTenantId: '',
    }]);
    runtimeResourceFindOne.mockResolvedValue({
      id: 'runtime-resource-other',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'payments',
      runtimeTenantId: '',
    });
    camundaGet
      .mockResolvedValueOnce({ id: 'job-1', processDefinitionId: 'definition-1' })
      .mockResolvedValueOnce({ id: 'definition-1', key: 'payments', tenantId: null });

    const response = await request(app)
      .get(`/runtime-jobs/job-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
    expect(camundaGet).toHaveBeenCalledTimes(2);
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
  });

  it('requires explicit and fully authorized instances for resource-aware batch actions', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'instance-1', definitionKey: 'payments', tenantId: 'runtime-a' });

    const response = await request(app)
      .post('/runtime-instance-selection')
      .send({ engineId, processInstanceIds: ['instance-1'] });

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledWith(engineId, '/process-instance/instance-1');
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({
          engineId,
          resourceKind: 'process_definition',
          resourceKey: 'payments',
          runtimeTenantId: 'runtime-a',
        }),
      ]),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('does not let a grant on one runtime resource authorize a sibling process instance on the same engine', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    runtimeResourceFindOne
      .mockResolvedValueOnce({ id: 'runtime-resource-payments', tenantId: null })
      .mockResolvedValueOnce({ id: 'runtime-resource-risk', tenantId: null });
    (permissionService.hasPermission as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    camundaGet.mockImplementation(async (_engineId: string, path: string) => (
      path.endsWith('instance-payments')
        ? { id: 'instance-payments', definitionKey: 'payments' }
        : { id: 'instance-risk', definitionKey: 'payments-risk' }
    ));

    const response = await request(app)
      .post('/runtime-instance-selection')
      .send({ engineId, processInstanceIds: ['instance-payments', 'instance-risk'] });

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).toHaveBeenLastCalledWith(
      'engine:instance:delete',
      expect.objectContaining({ resourceType: 'engine_runtime_resource', resourceId: 'runtime-resource-risk' }),
    );
  });

  it('uses Camunda processDefinitionKey compatibility while ignoring non-string batch identifiers', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'instance-1', definitionKey: null, processDefinitionKey: 'payments' });

    const compatible = await request(app)
      .post('/runtime-instance-selection')
      .send({ engineId, processInstanceIds: ['instance-1'] });
    expect(compatible.status).toBe(200);
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({ resourceKey: 'payments' }),
      ]),
    }));

    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValue(false);
    const malformed = await request(app)
      .post('/runtime-instance-selection')
      .send({ engineId, processInstanceIds: [42] });
    expect(malformed.status).toBe(403);
    expect(camundaGet).toHaveBeenCalledTimes(1);

    camundaGet.mockReset().mockResolvedValue({ id: 'instance-invalid', definitionKey: 42 });
    const unresolved = await request(app)
      .post('/runtime-instance-selection')
      .send({ engineId, processInstanceIds: ['instance-invalid'] });
    expect(unresolved.status).toBe(403);
    expect(runtimeResourceFindOne).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated batch ids and rejects empty selections without trusting injected parameters', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    camundaGet.mockResolvedValue({ id: 'instance-1', definitionKey: 'payments' });

    const duplicate = await request(app)
      .post('/runtime-instance-selection?engineId=tenant-b-injected')
      .send({ engineId, processInstanceIds: ['instance-1', 'instance-1', 'instance-1'], resourceId: 'injected-resource' });
    expect(duplicate.status).toBe(200);
    expect(camundaGet).toHaveBeenCalledTimes(1);
    expect(permissionService.hasPermission).toHaveBeenLastCalledWith(
      'engine:instance:delete', expect.objectContaining({ resourceType: 'engine_runtime_resource', resourceId: 'runtime-resource-1' }),
    );

    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValue(false);
    camundaGet.mockClear();
    const empty = await request(app)
      .post('/runtime-instance-selection')
      .send({ engineId, processInstanceIds: ['', ' ', null, 0] });
    expect(empty.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('rejects unbounded batch selections on resource-aware engines', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).post('/runtime-instance-selection').send({ engineId });

    expect(response.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('denies batch selections on engine-wide engines without a broad grant', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    expect((await request(app).post('/runtime-instance-selection').send({ engineId, processInstanceIds: ['instance-1'] })).status).toBe(403);
  });

  it('rejects selected instances that are absent from the runtime inventory', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    camundaGet.mockResolvedValue({ id: 'instance-1', definitionKey: 'payments' });
    runtimeResourceFindOne.mockResolvedValue(null);

    const response = await request(app).post('/runtime-instance-selection').send({ engineId, processInstanceIds: ['instance-1'] });

    expect(response.status).toBe(403);
  });

  it('rejects selected instances without resource-specific permission', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    camundaGet.mockResolvedValue({ id: 'instance-1', definitionKey: 'payments' });

    const response = await request(app).post('/runtime-instance-selection').send({ engineId, processInstanceIds: ['instance-1'] });

    expect(response.status).toBe(403);
  });

  it('retains engine-wide fast paths for batch selections and migrations', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const selection = await request(app).post('/runtime-instance-selection').send({ engineId });
    expect(selection.status).toBe(200);
    expect(selection.body.resource).toEqual({ type: 'engine', id: engineId });

    const migration = await request(app).post('/runtime-migration').send({ engineId });
    expect(migration.status).toBe(200);
    expect(migration.body.resource).toEqual({ type: 'engine', id: engineId });
  });

  it('denies shared batch and migration mutations before transport when mapping access is unavailable', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([]);

    const selection = await request(app)
      .post('/runtime-instance-selection?tenantId=tenant-a')
      .send({ engineId, processInstanceIds: ['instance-1'] });
    expect(selection.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();

    const migration = await request(app)
      .post('/runtime-migration?tenantId=tenant-a')
      .send({
        engineId,
        plan: {
          sourceProcessDefinitionId: 'source-v1',
          targetProcessDefinitionId: 'target-v2',
        },
      });
    expect(migration.status).toBe(403);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('denies shared batch and migration lineage outside the visible resource set', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{
      id: 'runtime-resource-visible',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
      resourceKey: 'visible',
      runtimeTenantId: '',
    }]);
    runtimeResourceFindOne.mockResolvedValue({
      id: 'runtime-resource-other',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'resolved',
    });
    camundaGet.mockResolvedValue({ id: 'instance-1', definitionKey: 'payments' });

    const selection = await request(app)
      .post('/runtime-instance-selection?tenantId=tenant-a')
      .send({ engineId, processInstanceIds: ['instance-1'] });
    expect(selection.status).toBe(403);

    camundaGet
      .mockReset()
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' });
    const migration = await request(app)
      .post('/runtime-migration?tenantId=tenant-a')
      .send({
        engineId,
        plan: {
          sourceProcessDefinitionId: 'source-v1',
          targetProcessDefinitionId: 'target-v2',
        },
      });
    expect(migration.status).toBe(403);
  });

  it('quarantines shared deployment mutations even when a broad grant exists', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFind.mockResolvedValue([{
      id: 'runtime-resource-1',
      tenantId: null,
      tenantResolutionStatus: 'conflict',
      resourceKey: 'payments',
    }]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app)
      .get(`/runtime-deployments/deployment-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
  });

  it('rejects unresolved dedicated resource-aware deployment inventory', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: 'tenant-a',
      tenancyMode: 'dedicated',
      runtimeAccessScope: 'resource_aware',
    });
    runtimeResourceFind.mockResolvedValue([{
      id: 'runtime-resource-1',
      tenantId: 'tenant-a',
      tenantResolutionStatus: 'conflict',
      resourceKey: 'payments',
    }]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get(`/runtime-deployments/deployment-1?engineId=${engineId}&tenantId=tenant-a`);

    expect(response.status).toBe(403);
  });

  it('normalizes non-Error runtime authorization failures to safe internal errors', async () => {
    const collection = requireRuntimeCollectionAction('engine.runtime.process-definitions.read', { resourceKind: 'process_definition' });
    const definition = requireRuntimeDefinitionAction('engine.runtime.process-definitions.read', {
      resourceKind: 'process_definition', definitionPath: 'process-definition',
    });
    const selection = requireRuntimeProcessInstanceSelectionAction('engine.runtime.batches.process-instances.delete', { resourceKind: 'process_definition' });
    const deployment = requireRuntimeDeploymentAction('engine.runtime.process-definitions.read');
    const migration = requireRuntimeMigrationAction('engine.runtime.migrations.execute-async', { resourceKind: 'process_definition' });

    for (const [middleware, req, message] of [
      [collection, { user: { userId: 'user-1' }, query: { engineId } }, 'Runtime collection authorization failed'],
      [definition, { user: { userId: 'user-1' }, query: { engineId }, params: { id: 'definition-1' } }, 'Runtime definition authorization failed'],
      [selection, { user: { userId: 'user-1' }, body: { engineId } }, 'Runtime batch authorization failed'],
      [deployment, { user: { userId: 'user-1' }, query: { engineId }, params: { deploymentId: 'deployment-1' } }, 'Runtime deployment authorization failed'],
      [migration, { user: { userId: 'user-1' }, body: { engineId } }, 'Runtime migration authorization failed'],
    ] as const) {
      (getDataSource as unknown as Mock).mockRejectedValueOnce('database unavailable');
      const next = vi.fn();
      await middleware(req as any, {} as any, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, message }));
    }
  });

  it('requires both migration definitions to be authorized on resource-aware engines', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1', tenantId: 'runtime-a' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2', tenantId: 'runtime-a' });

    const response = await request(app).post('/runtime-migration').send({
      engineId,
      plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
    });

    expect(response.status).toBe(200);
    expect(camundaGet).toHaveBeenNthCalledWith(1, engineId, '/process-definition/source-v1');
    expect(camundaGet).toHaveBeenNthCalledWith(2, engineId, '/process-definition/target-v2');
    expect(runtimeResourceFindOne).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.arrayContaining([
        expect.objectContaining({ resourceKey: 'payments-v1', runtimeTenantId: 'runtime-a' }),
      ]),
    }));
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('allows selected instances that belong to the authorized migration source', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' })
      .mockResolvedValueOnce({ id: 'instance-1', definitionKey: 'payments-v1' });

    const response = await request(app).post('/runtime-migration').send({
      engineId,
      plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
      processInstanceIds: ['instance-1'],
    });

    expect(response.status).toBe(200);
  });

  it('supports legacy top-level migration definition identifiers after authorization', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' });

    const response = await request(app).post('/runtime-migration').send({
      engineId, sourceDefinitionId: 'source-v1', targetDefinitionId: 'target-v2',
    });

    expect(response.status).toBe(200);
    expect(response.body.resource).toEqual({ type: 'engine_runtime_resource', id: 'runtime-resource-1' });
  });

  it('denies engine-wide migrations without a broad grant', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    expect((await request(app).post('/runtime-migration').send({
      engineId, plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
    })).status).toBe(403);
  });

  it('rejects resource-aware migrations without both definition identifiers', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).post('/runtime-migration').send({ engineId, plan: { sourceProcessDefinitionId: 'source-v1' } });

    expect(response.status).toBe(400);
    expect(camundaGet).not.toHaveBeenCalled();
  });

  it('rejects selected instances outside the authorized migration source', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' })
      .mockResolvedValueOnce({ id: 'instance-1', definitionKey: 'unrelated' });

    const response = await request(app).post('/runtime-migration').send({
      engineId, plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' }, processInstanceIds: ['instance-1'],
    });

    expect(response.status).toBe(403);
  });

  it('rejects resource-aware migrations when either definition is absent from inventory', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' });
    runtimeResourceFindOne.mockResolvedValueOnce({ id: 'runtime-resource-1', tenantId: null }).mockResolvedValueOnce(null);

    const response = await request(app).post('/runtime-migration').send({
      engineId, plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
    });

    expect(response.status).toBe(403);
  });

  it('rejects resource-aware migrations when either definition permission is denied', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: 'payments-v1' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' });

    const response = await request(app).post('/runtime-migration').send({
      engineId, plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
    });

    expect(response.status).toBe(403);
  });

  it('rejects resource-aware migrations whose definitions have no authorization key', async () => {
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    camundaGet
      .mockResolvedValueOnce({ id: 'source-v1', key: '' })
      .mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' });

    const response = await request(app).post('/runtime-migration').send({
      engineId, plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
    });

    expect(response.status).toBe(403);
    expect(runtimeResourceFindOne).not.toHaveBeenCalled();
  });

  it('rejects non-string invitation and migration identifiers without treating them as valid input', async () => {
    expect((await request(app).post('/invitations').send({ resourceType: 42 })).status).toBe(400);

    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    const invalidPlan = await request(app).post('/runtime-migration').send({
      engineId,
      plan: 'not-an-object',
      sourceDefinitionId: 'source-v1',
      targetDefinitionId: 'target-v2',
    });
    expect(invalidPlan.status).toBe(200);

    camundaGet.mockReset().mockResolvedValueOnce({ id: 'source-v1', key: 42 }).mockResolvedValueOnce({ id: 'target-v2', key: 'payments-v2' });
    const invalidKey = await request(app).post('/runtime-migration').send({
      engineId,
      plan: { sourceProcessDefinitionId: 'source-v1', targetProcessDefinitionId: 'target-v2' },
    });
    expect(invalidKey.status).toBe(403);
  });

  it('discovers resource-aware engines when a runtime resource is visible', async () => {
    engineFind.mockResolvedValue([{ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' }]);
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' });
    (permissionService.getKnownEngineIdsForUser as unknown as Mock).mockResolvedValue([engineId]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock)
      .mockResolvedValueOnce([{ id: 'runtime-resource-1' }])
      .mockResolvedValueOnce([]);

    const response = await request(app).get('/engines');

    expect(response.status).toBe(200);
    expect(response.body.authorizedEngineIds).toEqual([engineId]);
  });

  it('hides a shared engine selector until at least one resolved runtime resource is visible', async () => {
    engineFind.mockResolvedValue([{
      id: engineId,
      tenantId: null,
      tenancyMode: 'shared',
      runtimeAccessScope: 'resource_aware',
    }]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([]);

    const hidden = await request(app).get('/engines?tenantId=tenant-a');

    expect(hidden.status).toBe(200);
    expect(hidden.body.authorizedEngineIds).toEqual([]);

    (permissionService.getVisibleRuntimeResources as unknown as Mock)
      .mockResolvedValueOnce([{ id: 'runtime-resource-1' }])
      .mockResolvedValueOnce([]);
    const visible = await request(app).get('/engines?tenantId=tenant-a');

    expect(visible.status).toBe(200);
    expect(visible.body.authorizedEngineIds).toEqual([engineId]);
  });

  it('resolves a direct engine action and attaches the canonical engine identifier', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: 'tenant-default',
      tenancyMode: 'dedicated',
    });

    const response = await request(app).get(`/engines/${engineId}`);

    expect(response.status).toBe(200);
    expect(response.body.resource).toEqual({ type: 'engine', id: engineId });
    expect(engineFindOne).toHaveBeenCalledWith({
      where: { id: engineId },
      select: ['id', 'tenantId', 'tenancyMode', 'tenantResolutionStatus'],
    });
  });

  it('conceals missing and cross-tenant engines resolved by ID', async () => {
    engineFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get('/engines/missing-engine')).status).toBe(404);

    engineFindOne.mockResolvedValueOnce({ id: engineId, tenantId: 'tenant-b' });
    expect((await request(app).get(`/engines/${engineId}?tenantId=tenant-a`)).status).toBe(403);
  });

  it('uses a platform registry permission only for a quarantined unowned-engine migration', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'dedicated',
      tenantResolutionStatus: 'migration_required',
    });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'platform:engine-registration:manage',
    );

    const response = await request(app).post(`/migration-engines/${engineId}`);

    expect(response.status).toBe(200);
    expect(response.body.resource).toEqual({ type: 'engine', id: engineId });
    expect(permissionService.hasPermission).toHaveBeenNthCalledWith(
      1,
      'engine:edit',
      expect.objectContaining({ resourceType: 'engine', resourceId: engineId }),
    );
    expect(permissionService.hasPermission).toHaveBeenNthCalledWith(
      2,
      'platform:engine-registration:manage',
      expect.objectContaining({ resourceType: 'platform' }),
    );
    expect(policyService.evaluateGate).toHaveBeenCalledWith(
      'platform:engine-registration:manage',
      expect.objectContaining({ resourceType: 'platform' }),
    );
  });

  it('supports platform-scoped unowned-engine migration without an active tenant', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'dedicated',
      tenantResolutionStatus: 'migration_required',
    });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'platform:engine-registration:manage',
    );

    const response = await request(app)
      .post(`/migration-engines/${engineId}`)
      .set('x-test-without-tenant', 'true');

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenLastCalledWith(
      'platform:engine-registration:manage',
      expect.objectContaining({ tenantId: null, resourceType: 'platform' }),
    );
  });

  it('denies an unowned-engine migration without platform registry permission', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'dedicated',
      tenantResolutionStatus: 'migration_required',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app).post(`/migration-engines/${engineId}`);

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(2);
    expect(policyService.evaluateGate).not.toHaveBeenCalled();
  });

  it('does not extend the migration permission to an unowned engine outside migration_required', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: null,
      tenancyMode: 'dedicated',
      tenantResolutionStatus: 'ready',
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);

    const response = await request(app).post(`/migration-engines/${engineId}`);

    expect(response.status).toBe(403);
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('keeps ordinary owned-engine transitions on the engine-scoped permission', async () => {
    engineFindOne.mockResolvedValue({
      id: engineId,
      tenantId: 'tenant-default',
      tenancyMode: 'dedicated',
      tenantResolutionStatus: 'ready',
    });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'engine:edit',
    );

    const response = await request(app).post(`/migration-engines/${engineId}`);

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledTimes(1);
    expect(policyService.evaluateGate).toHaveBeenCalledWith(
      'engine:edit',
      expect.objectContaining({ resourceType: 'engine', resourceId: engineId }),
    );
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
      tenantId: 'tenant-default',
      projectId,
      engineId,
      mode: 'manual',
    });
  });

  it('loads the deployment environment tag and fails closed if the eligible engine disappears', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: true, decision: 'allow', mode: 'manual', projectId, engineId, checks: [], reasons: [],
    });
    engineFindOne.mockReset().mockResolvedValue({
      id: engineId, tenantId: null, name: 'Tagged Engine', environmentTagId: 'environment-tag-1',
    });
    environmentTagFindOne.mockResolvedValue({ id: 'environment-tag-1', name: 'production' });

    const tagged = await request(app).post('/deploy').send({ projectId, engineId });
    expect(tagged.status).toBe(200);
    expect(tagged.body.deployContext).toMatchObject({ engineName: 'Tagged Engine', environmentTag: 'production' });
    expect(environmentTagFindOne).toHaveBeenCalledWith({ id: 'environment-tag-1' });

    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: true, decision: 'allow', mode: 'manual', projectId, engineId, checks: [], reasons: [],
    });
    environmentTagFindOne.mockResolvedValue({ id: 'environment-tag-1' });
    const unnamedTag = await request(app).post('/deploy').send({ projectId, engineId });
    expect(unnamedTag.status).toBe(200);
    expect(unnamedTag.body.deployContext).toMatchObject({ environmentTag: null });

    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: true, decision: 'allow', mode: 'manual', projectId, engineId, checks: [], reasons: [],
    });
    engineFindOne.mockReset().mockResolvedValue(null);
    expect((await request(app).post('/deploy').send({ projectId, engineId })).status).toBe(404);
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

  it('returns a safe default deployment denial when no reason or remediation is supplied', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: false, decision: 'deny', mode: 'manual', projectId, engineId, checks: [], reasons: [],
    });

    const response = await request(app).post('/deploy').send({ projectId, engineId });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: 'Deployment is not allowed', reasons: [], checks: [] });
    expect(response.body.hint).toBeUndefined();
  });

  it('requires both project and engine identifiers for composite deployments', async () => {
    expect((await request(app).post('/deploy').send({ projectId })).status).toBe(400);
    expect(deploymentEligibilityService.evaluate).not.toHaveBeenCalled();
  });

  it('allows an optional composite route to proceed without an engine target', async () => {
    const response = await request(app).post('/deploy-optional').send({ projectId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ optional: true });
    expect(deploymentEligibilityService.evaluate).not.toHaveBeenCalled();
  });

  it('can omit the deployment display context when the caller does not need it', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: true, decision: 'allow', mode: 'manual', projectId, engineId, checks: [], reasons: [],
    });

    const response = await request(app).post('/deploy-no-context').send({ projectId, engineId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      composite: { kind: 'deployment', actionId: 'project.deploy.create', projectId, engineId, mode: 'manual' },
    });
    expect(engineFindOne).not.toHaveBeenCalled();
  });

  it('conceals missing projects reported by deployment eligibility', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: false, decision: 'deny', mode: 'manual', projectId, engineId,
      checks: [{ id: 'project.exists', allowed: false, reason: 'Project missing' }], reasons: ['Project missing'],
    });

    expect((await request(app).post('/deploy').send({ projectId, engineId })).status).toBe(404);
  });

  it('conceals missing engines reported by deployment eligibility', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: false, decision: 'deny', mode: 'manual', projectId, engineId,
      checks: [{ id: 'engine.exists', allowed: false, reason: 'Engine missing' }], reasons: ['Engine missing'],
    });

    expect((await request(app).post('/deploy').send({ projectId, engineId })).status).toBe(404);
  });

  it('conceals a deployment engine when its access denial cannot be viewed', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock)
      .mockResolvedValueOnce({
        allowed: false, decision: 'deny', mode: 'manual', projectId, engineId,
        checks: [{ id: 'engine.permission.deploy', allowed: false, reason: 'No deploy access' }], reasons: ['No deploy access'],
      })
      .mockResolvedValueOnce({
        allowed: false, decision: 'deny', mode: 'manual', projectId, engineId,
        checks: [{ id: 'engine.permission.deploy', allowed: false, reason: 'No deploy access' }], reasons: ['No deploy access'],
      })
      .mockResolvedValueOnce({
        allowed: false, decision: 'deny', mode: 'manual', projectId, engineId,
        checks: [{ id: 'engine.permission.deploy', allowed: false, reason: 'No deploy access' }], reasons: ['No deploy access'],
      });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    expect((await request(app).post('/deploy').send({ projectId, engineId })).status).toBe(404);

    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'engine:deploy:view'
    );
    expect((await request(app).post('/deploy').send({ projectId, engineId })).status).toBe(403);

    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'engine:instance:view'
    );
    expect((await request(app).post('/deploy').send({ projectId, engineId })).status).toBe(403);
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
      tenantId: 'tenant-default',
      resourceType: 'engine',
      resourceId: engineId,
    }));
    expect(engineAccessService.grantAccess).toHaveBeenCalledWith(projectId, engineId, 'user-1', true);
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledTimes(2);
  });

  it('does not auto-grant a missing deployment target without explicit approval permission', async () => {
    (deploymentEligibilityService.evaluate as unknown as Mock).mockResolvedValueOnce({
      allowed: false, decision: 'deny', mode: 'manual', projectId, engineId,
      checks: [{ id: 'project_engine_target.active', allowed: false, reason: 'No active target' }], reasons: ['No active target'],
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    expect((await request(app).post('/deploy').send({ projectId, engineId })).status).toBe(403);
    expect(engineAccessService.grantAccess).not.toHaveBeenCalled();
    expect(deploymentEligibilityService.evaluate).toHaveBeenCalledTimes(1);
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

  it('conceals missing file, folder, and version resolver targets before permission evaluation', async () => {
    fileFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get(`/files/${fileId}`)).status).toBe(404);

    folderFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get(`/folders/${folderId}`)).status).toBe(404);

    versionFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get(`/versions/${versionId}`)).status).toBe(404);

    versionFindOne.mockResolvedValueOnce({ id: versionId, fileId });
    fileFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get(`/versions/${versionId}`)).status).toBe(404);

    expect(permissionService.hasPermission).not.toHaveBeenCalled();
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
      tenantId: 'tenant-default',
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
      { id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated' },
      { id: secondEngineId, tenantId: 'tenant-default', tenancyMode: 'dedicated' },
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
    expect(permissionService.getKnownEngineIdsForUser).toHaveBeenCalledWith('user-1', 'tenant-default');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: engineId,
    }));
  });

  it('omits missing projects from explicit project collections before checking permission', async () => {
    projectFind.mockResolvedValue([{ id: projectId, tenantId: null }]);

    const response = await request(app).get(`/projects?projectIds=${projectId},missing-project`);

    expect(response.status).toBe(200);
    expect(response.body.collection).toEqual({
      type: 'project', ids: [projectId], requestedIds: [projectId, 'missing-project'], deniedIds: [],
    });
    expect(permissionService.hasPermission).not.toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      resourceId: 'missing-project',
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
    expect(permissionService.getKnownProjectIdsForUser).toHaveBeenCalledWith('user-1', 'tenant-default');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('project:files:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'project',
      resourceId: projectId,
    }));
  });

  it('returns empty visible collections when the user has neither broad nor known access', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getKnownProjectIdsForUser as unknown as Mock).mockResolvedValue([]);
    (permissionService.getKnownEngineIdsForUser as unknown as Mock).mockResolvedValue([]);

    const projects = await request(app).get('/projects');
    const engines = await request(app).get('/engines');

    expect(projects.status).toBe(200);
    expect(projects.body.collection).toEqual({ type: 'project', ids: [], requestedIds: [], deniedIds: [] });
    expect(engines.status).toBe(200);
    expect(engines.body.collection).toEqual({ type: 'engine', ids: [], requestedIds: [], deniedIds: [] });
  });

  it('discovers all tenant-visible projects from a collection-wide grant', async () => {
    projectFind.mockResolvedValue([
      { id: projectId, tenantId: 'tenant-a' },
      { id: secondProjectId, tenantId: null },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:files:view'
    );

    const response = await request(app).get('/projects?tenantId=tenant-a');

    expect(response.status).toBe(200);
    expect(response.body.collection).toEqual({
      type: 'project',
      ids: [projectId, secondProjectId].sort(),
      requestedIds: [projectId, secondProjectId].sort(),
      deniedIds: [],
    });
    expect(projectFind).toHaveBeenNthCalledWith(1, expect.objectContaining({ select: ['id'] }));
  });

  it('supports platform-scoped project discovery without an active tenant', async () => {
    projectFind.mockResolvedValue([{ id: projectId, tenantId: null }]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'project:files:view'
    );

    const response = await request(app)
      .get('/projects')
      .set('x-test-without-tenant', 'true');

    expect(response.status).toBe(200);
    expect(response.body.collection.ids).toEqual([projectId]);
    expect(projectFind).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: undefined,
    }));
    expect(policyService.evaluateGate).toHaveBeenCalledWith(
      'project:files:view',
      expect.objectContaining({ tenantId: null }),
    );
  });

  it('discovers owned and shared engines but excludes unowned dedicated engines from a collection-wide grant', async () => {
    engineFind.mockResolvedValue([
      { id: engineId, tenantId: 'tenant-a', tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' },
      { id: secondEngineId, tenantId: null, tenancyMode: 'shared', runtimeAccessScope: 'resource_aware' },
      { id: 'unowned-dedicated', tenantId: null, tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'engine:instance:view'
    );
    (permissionService.getVisibleRuntimeResources as unknown as Mock)
      .mockResolvedValue([{ id: 'shared-resource' }]);

    const response = await request(app).get('/engines?tenantId=tenant-a');

    expect(response.status).toBe(200);
    expect(response.body.collection).toEqual({
      type: 'engine',
      ids: [engineId, secondEngineId].sort(),
      requestedIds: [engineId, secondEngineId, 'unowned-dedicated'].sort(),
      deniedIds: ['unowned-dedicated'],
    });
    expect(engineFind).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: [
        { tenantId: expect.anything() },
        { tenantId: expect.anything(), tenancyMode: 'shared' },
      ],
      select: ['id', 'tenantId', 'tenancyMode'],
    }));
  });

  it('discovers only inventoried shared engines when no tenant is active', async () => {
    engineFind.mockResolvedValue([
      { id: secondEngineId, tenantId: null, tenancyMode: 'shared', runtimeAccessScope: 'resource_aware' },
      { id: 'unowned-dedicated', tenantId: null, tenancyMode: 'dedicated', runtimeAccessScope: 'engine_wide' },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'engine:instance:view'
    );
    (permissionService.getVisibleRuntimeResources as unknown as Mock)
      .mockResolvedValue([{ id: 'shared-resource' }]);

    const response = await request(app)
      .get('/engines')
      .set('x-test-without-tenant', 'true');

    expect(response.status).toBe(200);
    expect(response.body.collection).toEqual({
      type: 'engine',
      ids: [secondEngineId],
      requestedIds: [secondEngineId, 'unowned-dedicated'].sort(),
      deniedIds: ['unowned-dedicated'],
    });
    expect(engineFind).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { tenantId: expect.anything(), tenancyMode: 'shared' },
    }));
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, engineId: secondEngineId }),
    );
    expect(policyService.evaluateGate).toHaveBeenCalledWith(
      'engine:instance:view',
      expect.objectContaining({ tenantId: null, resourceType: 'engine' }),
    );
  });

  it('parses explicit engine collections and conceals missing or foreign-tenant engines', async () => {
    engineFind.mockResolvedValue([
      { id: engineId, tenantId: 'tenant-a', runtimeAccessScope: 'engine_wide' },
      { id: secondEngineId, tenantId: 'tenant-b', runtimeAccessScope: 'engine_wide' },
    ]);
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string, context: { resourceId?: string }) =>
        permission === 'engine:instance:view' && context.resourceId === engineId
    );

    const response = await request(app)
      .get('/engines?tenantId=tenant-a')
      .query({ engineIds: [engineId, `${secondEngineId},missing-engine`] });

    expect(response.status).toBe(200);
    expect(response.body.collection).toEqual({
      type: 'engine',
      ids: [engineId],
      requestedIds: [engineId, secondEngineId, 'missing-engine'],
      deniedIds: [secondEngineId],
    });
    expect(permissionService.hasPermission).not.toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceId: secondEngineId,
    }));
  });

  it('fails closed when runtime-resource discovery fails for a resource-aware engine', async () => {
    engineFind.mockResolvedValue([{ id: engineId, tenantId: 'tenant-default', tenancyMode: 'dedicated', runtimeAccessScope: 'resource_aware' }]);
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getKnownEngineIdsForUser as unknown as Mock).mockResolvedValue([engineId]);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockRejectedValue(new Error('inventory unavailable'));

    const response = await request(app).get('/engines');

    expect(response.status).toBe(200);
    expect(response.body.collection).toEqual({
      type: 'engine', ids: [], requestedIds: [engineId], deniedIds: [engineId],
    });
  });

  it('applies collection policy denials after resolving project and engine visibility', async () => {
    (policyService.evaluateGate as unknown as Mock)
      .mockResolvedValueOnce({ decision: 'deny', reason: 'project-freeze' })
      .mockResolvedValueOnce({ decision: 'deny', reason: 'engine-freeze' });

    const projects = await request(app).get('/projects');
    const engines = await request(app).get('/engines');

    expect(projects.status).toBe(403);
    expect(projects.body.error).toContain('project-freeze');
    expect(engines.status).toBe(403);
    expect(engines.body.error).toContain('engine-freeze');
  });

  it('fails closed for anonymous, malformed, and unexpected action resolution errors', async () => {
    const anonymousNext = vi.fn();
    await requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' })(
      { params: { projectId } } as any, {} as any, anonymousNext,
    );
    expect(anonymousNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));

    const missingIdNext = vi.fn();
    await requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' })(
      { user: { userId: 'user-1' }, params: {} } as any, {} as any, missingIdNext,
    );
    expect(missingIdNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'projectId is required' }));

    const unknownResolverNext = vi.fn();
    await requireAction('project.files.read', { resourceResolver: 'unknown.resolver' })(
      { user: { userId: 'user-1' }, params: {} } as any, {} as any, unknownResolverNext,
    );
    expect(unknownResolverNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));

    (getDataSource as unknown as Mock).mockRejectedValueOnce('dependency failed');
    const unexpectedNext = vi.fn();
    await requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' })(
      { user: { userId: 'user-1' }, params: { projectId } } as any, {} as any, unexpectedNext,
    );
    expect(unexpectedNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500, message: 'Authorization action check failed',
    }));
  });

  it('resolves platform actions without database lookup and fails closed for a missing direct project', async () => {
    (permissionService.hasPermission as unknown as Mock).mockReset().mockResolvedValue(true);
    const platformReq: any = { user: { userId: 'user-1' }, params: {} };
    const platformNext = vi.fn();
    await requireAction('project.files.read', { resourceResolver: 'platform.self' })(platformReq, {} as any, platformNext);
    expect(platformNext).toHaveBeenCalledWith();
    expect(platformReq.authzResource).toEqual({ type: 'platform', id: null });
    expect(getDataSource).not.toHaveBeenCalled();

    projectFindOne.mockReset().mockResolvedValue(null);
    const projectNext = vi.fn();
    await requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' })(
      { user: { userId: 'user-1' }, params: { projectId } } as any, {} as any, projectNext,
    );
    expect(projectNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('uses the first non-empty array value for route resource identifiers', async () => {
    const req: any = { user: { userId: 'user-1' }, params: { projectId: [` ${projectId} `] } };
    const next = vi.fn();

    await requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' })(req, {} as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.projectId).toBe(projectId);
    expect(req.authzResource).toEqual({ type: 'project', id: projectId });
  });

  it('rejects non-string array identifiers and supports parameter-sourced collection ids', async () => {
    const invalidNext = vi.fn();
    await requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' })(
      { user: { userId: 'user-1' }, params: { projectId: [42] } } as any, {} as any, invalidNext,
    );
    expect(invalidNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));

    const collectionReq: any = { user: { userId: 'user-1' }, params: { projectIds: [projectId] } };
    const collectionNext = vi.fn();
    await requireAction('project.projects.read', {
      resourceResolver: 'project.visibleCollection', collectionIdsFrom: 'params', collectionIdsKey: 'projectIds',
    })(collectionReq, {} as any, collectionNext);
    expect(collectionNext).toHaveBeenCalledWith();
    expect(collectionReq.authorizedProjectIds).toEqual([projectId]);

    const anySourceReq: any = { user: { userId: 'user-1' }, body: { projectIds: [projectId] } };
    const anySourceNext = vi.fn();
    await requireAction('project.projects.read', {
      resourceResolver: 'project.visibleCollection', collectionIdsFrom: 'any', collectionIdsKey: 'projectIds',
    })(anySourceReq, {} as any, anySourceNext);
    expect(anySourceNext).toHaveBeenCalledWith();
    expect(anySourceReq.authorizedProjectIds).toEqual([projectId]);
  });

  it('fails closed for a fuzzed set of absent, empty, and non-string resource identifiers', async () => {
    const malformedIdentifiers: unknown[] = [undefined, null, '', ' ', '\t', 0, false, {}, [], [null], [42], ['']];
    const middleware = requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' });
    for (const projectId of malformedIdentifiers) {
      const next = vi.fn();
      await middleware({ user: { userId: 'user-1' }, params: { projectId } } as any, {} as any, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: 'projectId is required' }));
    }
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('fails closed for a deterministic corpus of malformed and mixed-tenant resource identifiers', async () => {
    const malformedIds = ['not-a-uuid', '../other-project', '%00', '\u0000', 'a'.repeat(2_048)];
    const middleware = requireAction('project.files.read', { resourceResolver: 'project.byId', resourceIdFrom: 'params' });
    projectFindOne.mockImplementation(async ({ where }: any) => where.id === projectId ? { id: projectId, tenantId: 'tenant-a' } : null);

    for (const projectId of malformedIds) {
      const next = vi.fn();
      await middleware({ user: { userId: 'user-1' }, params: { projectId } } as any, {} as any, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    }

    const mixedTenantNext = vi.fn();
    await middleware({ user: { userId: 'user-1' }, tenant: { tenantId: 'tenant-b' }, params: { projectId } } as any, {} as any, mixedTenantNext);
    expect(mixedTenantNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

    const unexpectedParamReq: any = {
      user: { userId: 'user-1' }, params: { projectId }, query: { projectId: 'tenant-b-injected', tenantId: 'tenant-b' },
    };
    const unexpectedParamNext = vi.fn();
    await middleware(unexpectedParamReq, {} as any, unexpectedParamNext);
    expect(unexpectedParamNext).toHaveBeenCalledWith();
    expect(unexpectedParamReq.authzResource).toEqual({ type: 'project', id: projectId });
  });

  it('fails closed for route-less actions and registered resolvers without middleware support', async () => {
    const routeLessNext = vi.fn();
    await requireAction('platform.users.manage')({ user: { userId: 'user-1' } } as any, {} as any, routeLessNext);
    expect(routeLessNext).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500, message: expect.stringContaining('Authorization action has no resource resolver'),
    }));

    const unsupportedResolver = {
      id: 'test.unimplemented-resolver', resourceType: 'extension' as const, requiredParams: [],
      description: 'Test-only defensive resolver coverage.', failureMode: 'deny' as const,
    };
    AUTHZ_RESOURCE_RESOLVERS.push(unsupportedResolver);
    try {
      const unsupportedNext = vi.fn();
      await requireAction('project.files.read', { resourceResolver: unsupportedResolver.id })(
        { user: { userId: 'user-1' } } as any, {} as any, unsupportedNext,
      );
      expect(unsupportedNext).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 500, message: expect.stringContaining('Authorization resolver is not implemented for middleware'),
      }));
    } finally {
      AUTHZ_RESOURCE_RESOLVERS.pop();
    }
  });

  it('resolves an engine-scoped action from a saved filter id', async () => {
    savedFilterFindOne.mockReset().mockResolvedValue({ id: savedFilterId, engineId });
    engineFindOne.mockReset().mockResolvedValue({
      id: engineId,
      tenantId: 'tenant-default',
      tenancyMode: 'dedicated',
    });
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
      select: ['id', 'tenantId', 'tenancyMode'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: engineId,
    }));
  });

  it('conceals a saved filter whose linked engine no longer exists', async () => {
    savedFilterFindOne.mockReset().mockResolvedValue({ id: savedFilterId, engineId });
    engineFindOne.mockReset().mockResolvedValue(null);

    expect((await request(app).get(`/saved-filters/${savedFilterId}`)).status).toBe(404);
    expect(permissionService.hasPermission).not.toHaveBeenCalled();
  });

  it('conceals missing and cross-tenant saved-filter engines', async () => {
    savedFilterFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get(`/saved-filters/${savedFilterId}`)).status).toBe(404);

    savedFilterFindOne.mockResolvedValueOnce({ id: savedFilterId, engineId });
    engineFindOne.mockResolvedValueOnce({ id: engineId, tenantId: 'tenant-b' });
    expect((await request(app).get(`/saved-filters/${savedFilterId}?tenantId=tenant-a`)).status).toBe(403);
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

  it('conceals missing Git repositories before project permission evaluation', async () => {
    gitRepositoryFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get(`/git-repositories/${gitRepositoryId}`)).status).toBe(404);
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

  it('conceals missing Git deployments before project permission evaluation', async () => {
    gitDeploymentFindOne.mockResolvedValueOnce(null);
    expect((await request(app).get(`/git-deployments/${gitDeploymentId}`)).status).toBe(404);
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

  it('conceals missing locks and lock files before project permission evaluation', async () => {
    gitLockFindOne.mockResolvedValueOnce(null);
    expect((await request(app).delete(`/git-locks/${gitLockId}`)).status).toBe(404);

    gitLockFindOne.mockResolvedValueOnce({ id: gitLockId, fileId });
    fileFindOne.mockResolvedValueOnce(null);
    expect((await request(app).delete(`/git-locks/${gitLockId}`)).status).toBe(404);
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

  it('resolves platform-scoped project and shared-engine invitations without an active tenant', async () => {
    projectFindOne.mockResolvedValue({ id: projectId, tenantId: null });
    engineFindOne.mockResolvedValue({ id: engineId, tenantId: null, tenancyMode: 'shared' });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) =>
        permission === 'project:members:manage' || permission === 'engine:members:manage'
    );

    const projectResponse = await request(app)
      .post('/invitations')
      .set('x-test-without-tenant', 'true')
      .send({ resourceType: 'project', resourceId: projectId });
    const engineResponse = await request(app)
      .post('/invitations')
      .set('x-test-without-tenant', 'true')
      .send({ resourceType: 'engine', resourceId: engineId });

    expect(projectResponse.status).toBe(200);
    expect(engineResponse.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'project:members:manage',
      expect.objectContaining({ tenantId: null, resourceType: 'project' }),
    );
    expect(permissionService.hasPermission).toHaveBeenCalledWith(
      'engine:members:manage',
      expect.objectContaining({ tenantId: null, resourceType: 'engine' }),
    );
  });

  it('authorizes workspace invitations only with a platform user-management permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'platform:users:create'
    );

    const allowed = await request(app).post('/invitations').send({ resourceType: 'tenant' });

    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({
      resource: { type: 'platform', id: null },
      target: {
        resourceType: 'tenant',
        resourceId: null,
        requiredPermissions: ['platform:user:manage', 'platform:users:create'],
      },
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:user:manage', expect.objectContaining({
      resourceType: 'platform', tenantId: 'tenant-default',
    }));
    expect(permissionService.hasPermission).toHaveBeenCalledWith('platform:users:create', expect.objectContaining({
      resourceType: 'platform', tenantId: 'tenant-default',
    }));

    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    const denied = await request(app).post('/invitations').send({ resourceType: 'tenant' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toContain('Only platform admins');
  });

  it('rejects invitation targets outside the supported authorization scopes', async () => {
    expect((await request(app).post('/invitations').send({ resourceType: 'engine_set', resourceId: 'set-1' })).status).toBe(400);
  });

  it('requires an identifier for project and engine invitation targets', async () => {
    expect((await request(app).post('/invitations').send({ resourceType: 'project' })).status).toBe(400);
  });

  it('denies project invitations without member-management permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    expect((await request(app).post('/invitations').send({ resourceType: 'project', resourceId: projectId })).status).toBe(403);
  });

  it('resolves engine invitations only within the active tenant', async () => {
    engineFindOne
      .mockResolvedValueOnce({ id: engineId, tenantId: 'tenant-a' })
      .mockResolvedValueOnce({ id: engineId, tenantId: 'tenant-b' });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(
      async (permission: string) => permission === 'engine:members:manage'
    );

    const allowed = await request(app)
      .post('/invitations?tenantId=tenant-a')
      .send({ resourceType: 'engine', resourceId: engineId });
    expect(allowed.status).toBe(200);
    expect(allowed.body.target).toEqual({
      resourceType: 'engine',
      resourceId: engineId,
      requiredPermissions: ['engine:members:manage'],
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:members:manage', expect.objectContaining({
      resourceType: 'engine', resourceId: engineId, tenantId: 'tenant-a',
    }));

    const crossTenant = await request(app)
      .post('/invitations?tenantId=tenant-a')
      .send({ resourceType: 'engine', resourceId: engineId });
    expect(crossTenant.status).toBe(403);
  });

  it('conceals missing engine invitation targets', async () => {
    engineFindOne.mockResolvedValue(null);
    expect((await request(app).post('/invitations').send({ resourceType: 'engine', resourceId: engineId })).status).toBe(404);
  });

  it('denies engine invitations without engine member-management permission', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    expect((await request(app).post('/invitations').send({ resourceType: 'engine', resourceId: engineId })).status).toBe(403);
  });

  it('rejects unauthenticated invitation creation before resolving its target', async () => {
    const next = vi.fn();
    await requireInvitationCreateAction()({ body: { resourceType: 'tenant' } } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, message: 'Authentication required' }));
    expect(getDataSource).not.toHaveBeenCalled();
  });

  it('normalizes a non-error invitation permission failure to an internal authorization error', async () => {
    (permissionService.hasPermission as unknown as Mock).mockRejectedValueOnce('permission service unavailable');
    const next = vi.fn();

    await requireInvitationCreateAction()({
      user: { userId: 'user-1' }, body: { resourceType: 'tenant' },
    } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500, message: 'Invitation authorization check failed',
    }));
  });

  it('rejects invalid and unexpected composite authorization setup', async () => {
    expect(() => requireCompositeAction('project.deploy.create', { kind: 'unsupported' as any })).toThrow('Unsupported composite authorization kind');

    (deploymentEligibilityService.evaluate as unknown as Mock).mockRejectedValueOnce('eligibility unavailable');
    const next = vi.fn();
    await requireCompositeAction('project.deploy.create')({
      user: { userId: 'user-1' }, body: { projectId, engineId },
    } as any, {} as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500, message: 'Composite authorization action check failed',
    }));

    const anonymousNext = vi.fn();
    await requireCompositeAction('project.deploy.create')({ body: { projectId, engineId } } as any, {} as any, anonymousNext);
    expect(anonymousNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
