import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { existsSync } from 'fs';
import enginesRouter from '../../../../../packages/backend-host/src/modules/mission-control/engines/routes.js';
import { engineService, projectEngineTargetService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { engineMetadataReconciliationService } from '@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js';
import { runtimeResourceInventoryService } from '@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';

const apiClientAuthMock = vi.hoisted(() => ({
  authenticateToken: vi.fn(),
}));
const permissionServiceMock = vi.hoisted(() => ({
  hasPermission: vi.fn().mockResolvedValue(false),
  getKnownEngineIdsForUser: vi.fn().mockResolvedValue(['e1']),
  syncLegacyRoleAssignments: vi.fn().mockResolvedValue({ scannedProjects: 0, scannedEngines: 1, upserted: 1, removed: 0 }),
}));
const platformSettingsServiceMock = vi.hoisted(() => ({
  get: vi.fn().mockResolvedValue({ engineOnboardingMode: 'manual_allowed' }),
}));
const policyServiceMock = vi.hoisted(() => ({
  evaluateGate: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' }),
}));
const fetchMock = vi.hoisted(() => vi.fn());
const secretResolverMock = vi.hoisted(() => ({
  normalizeForStorage: vi.fn((value: string | null | undefined) => value ? `v2:test:${Buffer.from(value).toString('base64')}` : null),
  resolveStored: vi.fn((value: string | null | undefined) => value?.startsWith('v2:test:') ? Buffer.from(value.slice('v2:test:'.length), 'base64').toString() : value || null),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('undici', () => ({
  fetch: fetchMock,
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/SecretResolver.js', () => ({
  secretResolver: secretResolverMock,
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    req.tenant = { tenantId: null };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/ApiClientService.js', () => ({
  ApiClientScopes: {
    ENGINE_REGISTER: 'engine:register',
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  apiClientService: {
    authenticateToken: apiClientAuthMock.authenticateToken,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    ENGINE_EDIT: 'engine:edit',
    ENGINE_DELETE: 'engine:delete',
    SECRETS_VIEW: 'engine:secrets:view',
    SECRETS_MANAGE: 'engine:secrets:manage',
    MEMBERS_MANAGE: 'engine:members:manage',
    MEMBERS_VIEW: 'engine:members:view',
    PROJECT_ACCESS_VIEW: 'engine:project-access:view',
    INSTANCE_VIEW: 'engine:instance:view',
  },
  ExternalEngineSystemPermissions: {
    ENGINE_REGISTRATION_MANAGE: 'external-engine-system:engine-registration:manage',
    PROJECT_TARGETS_MANAGE: 'external-engine-system:project-targets:manage',
  },
  permissionService: {
    hasPermission: permissionServiceMock.hasPermission,
    getKnownEngineIdsForUser: permissionServiceMock.getKnownEngineIdsForUser,
    syncLegacyRoleAssignments: permissionServiceMock.syncLegacyRoleAssignments,
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/PolicyService.js', () => ({
  policyService: policyServiceMock,
}));

vi.mock('@enterpriseglue/shared/middleware/platformAuth.js', () => ({
  isPlatformAdmin: () => true,
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
  engineRegistrationLimiter: (_req: any, _res: any, next: any) => next(),
  reconciliationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  ApiClientScopes: {
    ENGINE_REGISTER: 'engine:register',
    DEPLOYMENT_EXECUTE: 'deployment:execute',
  },
  engineService: {
    listEngines: vi.fn().mockResolvedValue([]),
    getEngine: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1' }),
    hasEngineAccess: vi.fn().mockResolvedValue(true),
    getUserEngines: vi.fn().mockResolvedValue([
      { engine: { id: 'e1', name: 'Engine 1' }, role: 'admin' },
    ]),
    getEngineRole: vi.fn().mockResolvedValue('owner'),
    createEngineWithGovernanceAssignments: vi.fn(async (engine: unknown, dataSource: any) => {
      await dataSource.getRepository({ name: 'Engine' }).insert(engine);
    }),
  },
  engineSetService: {
    materializeEngineSetsForEngine: vi.fn().mockResolvedValue(undefined),
  },
  platformSettingsService: platformSettingsServiceMock,
  projectEngineTargetService: {
    listTargets: vi.fn().mockResolvedValue([]),
    createTarget: vi.fn(),
    getTarget: vi.fn(),
    archiveTarget: vi.fn(),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/EngineMetadataReconciliationService.js', () => ({
  engineMetadataReconciliationService: {
    reconcileEngine: vi.fn().mockResolvedValue({
      created: 0,
      updated: 0,
      deactivated: 0,
      materializedSets: 0,
      deployments: { created: 0, updated: 0, artifactsCreated: 0 },
    }),
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/RuntimeResourceInventoryService.js', () => ({
  runtimeResourceInventoryService: {
    materializeForEngine: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@enterpriseglue/shared/constants/roles.js', () => ({
  ENGINE_VIEW_ROLES: ['owner', 'delegate', 'operator', 'viewer'],
  ENGINE_MANAGE_ROLES: ['owner', 'delegate'],
  MANAGE_ROLES: ['owner', 'delegate'],
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
  config: {
    nodeEnv: 'test',
    frontendUrl: 'http://localhost:5173',
  },
}));

describe('mission-control engines routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(enginesRouter);
    app.use(errorHandler);
    vi.clearAllMocks();
    apiClientAuthMock.authenticateToken.mockReset();
    permissionServiceMock.hasPermission.mockReset();
    permissionServiceMock.getKnownEngineIdsForUser.mockReset();
    permissionServiceMock.syncLegacyRoleAssignments.mockReset();
    platformSettingsServiceMock.get.mockReset();
    policyServiceMock.evaluateGate.mockReset();
    secretResolverMock.normalizeForStorage.mockReset();
    secretResolverMock.resolveStored.mockReset();
    (engineService as any).listEngines.mockReset();
    (engineService as any).getEngine.mockReset();
    (engineService as any).hasEngineAccess.mockReset();
    (engineService as any).getUserEngines.mockReset();
    (engineService as any).getEngineRole.mockReset();
    (engineService as any).createEngineWithGovernanceAssignments.mockReset();
    (projectEngineTargetService as any).listTargets.mockReset();
    (projectEngineTargetService as any).createTarget.mockReset();
    (projectEngineTargetService as any).getTarget.mockReset();
    (projectEngineTargetService as any).archiveTarget.mockReset();
    (engineMetadataReconciliationService as any).reconcileEngine.mockReset();
    (runtimeResourceInventoryService as any).materializeForEngine.mockReset();
    (getDataSource as any).mockReset();
    (existsSync as any).mockReset();

    apiClientAuthMock.authenticateToken.mockResolvedValue(null);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view' ||
      permission === 'platform:engine:create' ||
      permission === 'platform:engine-registration:manage'
    );
    permissionServiceMock.getKnownEngineIdsForUser.mockResolvedValue(['e1']);
    permissionServiceMock.syncLegacyRoleAssignments.mockResolvedValue({ scannedProjects: 0, scannedEngines: 1, upserted: 1, removed: 0 });
    platformSettingsServiceMock.get.mockResolvedValue({ engineOnboardingMode: 'manual_allowed' });
    policyServiceMock.evaluateGate.mockResolvedValue({ decision: 'allow', reason: 'no-policy-deny' });
    secretResolverMock.normalizeForStorage.mockImplementation((value: string | null | undefined) => value ? `v2:test:${Buffer.from(value).toString('base64')}` : null);
    secretResolverMock.resolveStored.mockImplementation((value: string | null | undefined) => value?.startsWith('v2:test:') ? Buffer.from(value.slice('v2:test:'.length), 'base64').toString() : value || null);
    (engineService as any).listEngines.mockResolvedValue([]);
    (engineService as any).getEngine.mockResolvedValue({ id: 'e1', name: 'Engine 1' });
    (engineService as any).getUserEngines.mockResolvedValue([{ engine: { id: 'e1', name: 'Engine 1' }, role: 'admin' }]);
    (projectEngineTargetService as any).listTargets.mockResolvedValue([]);
    (projectEngineTargetService as any).createTarget.mockResolvedValue({ id: 'target-1' });
    (projectEngineTargetService as any).getTarget.mockResolvedValue({
      id: 'target-1',
      projectId: 'project-1',
      engineId: 'e1',
      status: 'active',
      source: 'external',
      sourceRef: 'external_engine_system:system-1:project_engine_target:project-1:e1',
      allowManualDeploy: true,
      allowCiDeploy: false,
      allowApiDeploy: false,
      allowImport: true,
    });
    (projectEngineTargetService as any).archiveTarget.mockResolvedValue(true);
    (engineService as any).createEngineWithGovernanceAssignments.mockImplementation(async (engine: unknown, dataSource: any) => {
      await dataSource.getRepository({ name: 'Engine' }).insert(engine);
    });
    (engineMetadataReconciliationService as any).reconcileEngine.mockResolvedValue({
      created: 0,
      updated: 0,
      deactivated: 0,
      materializedSets: 0,
      deployments: { created: 0, updated: 0, artifactsCreated: 0 },
    });
    (runtimeResourceInventoryService as any).materializeForEngine.mockResolvedValue([]);
    (existsSync as any).mockReturnValue(false);
    fetchMock.mockReset();
    (engineService as any).hasEngineAccess.mockResolvedValue(true);
    (engineService as any).getEngineRole.mockResolvedValue('owner');
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Engine 1', username: 'engine-user', passwordEnc: 'secret' }]),
        findOne: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null, name: 'Engine 1', username: 'engine-user', passwordEnc: 'secret' }),
        findOneBy: vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1', username: 'engine-user', passwordEnc: 'secret' }),
      }),
    });
  });

  it('returns list of engines', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);

    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'e1',
        name: 'Engine 1',
        myRole: 'owner',
        governance: { accountableOwnerId: null, delegateId: null },
        username: null,
        passwordEnc: null,
        capabilities: expect.objectContaining({
          type: 'camunda7',
          compatibilityProfile: 'camunda7-rest',
          supportLevel: 'compatible',
        }),
      }),
    ]);
  });

  it('normalizes PostgreSQL bigint timestamps in an authorization-filtered inventory response', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([{ id: 'e1', name: 'Engine 1', createdAt: '1700000000000', updatedAt: '1700000000001' }]),
      }),
    });

    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      id: 'e1',
      createdAt: 1700000000000,
      updatedAt: 1700000000001,
    });
  });

  it('keeps Mission Control list authorization identical for direct and customer-sidecar engines', async () => {
    permissionServiceMock.getKnownEngineIdsForUser.mockResolvedValue(['engine-direct', 'engine-sidecar']);
    (engineService as any).getEngineRole.mockResolvedValue(null);
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([
          {
            id: 'engine-direct', name: 'Direct engine', type: 'operaton',
            connectionMode: 'direct', runtimeAccessScope: 'engine_wide',
          },
          {
            id: 'engine-sidecar', name: 'Sidecar engine', type: 'operaton',
            connectionMode: 'customer_sidecar', runtimeAccessScope: 'engine_wide',
          },
        ]),
      }),
    });

    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body.map((engine: any) => ({
      id: engine.id,
      connectionMode: engine.connectionMode,
      myRole: engine.myRole,
      capabilities: engine.capabilities,
    }))).toEqual([
      expect.objectContaining({
        id: 'engine-direct', connectionMode: 'direct', myRole: null,
        capabilities: expect.objectContaining({ compatibilityProfile: 'camunda7-rest' }),
      }),
      expect.objectContaining({
        id: 'engine-sidecar', connectionMode: 'customer_sidecar', myRole: null,
        capabilities: expect.objectContaining({ compatibilityProfile: 'camunda7-rest' }),
      }),
    ]);
    expect(response.body[1].capabilities).toEqual(response.body[0].capabilities);
  });

  it('lists evaluator-visible engines for a custom-role user without inventing a legacy role string', async () => {
    permissionServiceMock.getKnownEngineIdsForUser.mockResolvedValue(['custom-engine']);
    permissionServiceMock.hasPermission.mockImplementation(async (_permission: string, context: { resourceId?: string }) =>
      context.resourceId === 'custom-engine'
    );
    (engineService as any).getEngineRole.mockResolvedValue(null);
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        find: vi.fn().mockResolvedValue([{ id: 'custom-engine', name: 'Custom role engine', runtimeAccessScope: 'engine_wide' }]),
        findOne: vi.fn().mockResolvedValue({ id: 'custom-engine', tenantId: null, name: 'Custom role engine' }),
      }),
    });

    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ id: 'custom-engine', name: 'Custom role engine', myRole: null }),
    ]);
    expect(permissionServiceMock.getKnownEngineIdsForUser).toHaveBeenCalledWith('user-1', null);
    expect(engineService.getEngineRole).toHaveBeenCalledWith('user-1', 'custom-engine', null);
  });

  it('returns engine credential state but never the stored secret through scoped engine secret view permission', async () => {
    (engineService as any).getUserEngines.mockResolvedValueOnce([
      { engine: { id: 'e1', name: 'Engine 1', username: 'engine-user', passwordEnc: 'secret' }, role: 'operator' },
    ]);
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view' || permission === 'engine:secrets:view'
    );

    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      id: 'e1',
      username: 'engine-user',
      passwordEnc: null,
      hasCredential: true,
    });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:secrets:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('redacts engine list secret fields when user has edit without secret view', async () => {
    (engineService as any).getUserEngines.mockResolvedValueOnce([
      { engine: { id: 'e1', name: 'Engine 1', username: 'engine-user', passwordEnc: 'secret' }, role: 'operator' },
    ]);
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view' || permission === 'engine:edit'
    );

    const response = await request(app).get('/engines-api/engines');

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      id: 'e1',
      username: null,
      passwordEnc: null,
    });
  });

  it('returns engine detail when user has access', async () => {
    const response = await request(app).get('/engines-api/engines/e1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'e1', name: 'Engine 1' });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('lists only tenant-visible sanitized runtime inventory for an authorized engine viewer', async () => {
    const resourceRepo = {
      find: vi.fn().mockResolvedValue([
        {
          id: 'resource-payments', tenantId: null, engineId: 'e1', resourceKind: 'process_definition', resourceKey: 'payments', runtimeTenantId: '',
          engineResourceId: null, deploymentId: null, projectId: null, fileId: null, version: 1, labelsJson: '{}', lineageJson: '{}', source: 'engine_discovery',
          sourceRef: null, observedAt: 1, isActive: true, createdAt: 1, updatedAt: 1,
        },
        { id: 'resource-foreign', tenantId: 'tenant-b', engineId: 'e1', resourceKind: 'decision_definition', resourceKey: 'foreign', isActive: true, lineageJson: '{}' },
      ]),
    };
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: unknown) => entity === RuntimeResource
        ? resourceRepo
        : entity === Engine
          ? { findOne: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null }) }
          : { findOne: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null }) },
    });

    const response = await request(app).get('/engines-api/engines/e1/runtime-resources?resourceKind=process_definition');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([expect.objectContaining({ id: 'resource-payments', resourceKey: 'payments' })]);
    expect(resourceRepo.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ engineId: 'e1', resourceKind: 'process_definition', isActive: true }),
    }));
  });

  it('reconciles one engine runtime inventory through engine edit authorization', async () => {
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'engine:edit'
    );
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null }) }
        : { findOne: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null }) },
    });
    (engineMetadataReconciliationService as any).reconcileEngine.mockResolvedValue({
      created: 1, updated: 2, deactivated: 0, materializedSets: 1,
      deployments: { created: 1, updated: 0, artifactsCreated: 2 },
    });

    const response = await request(app).post('/engines-api/engines/e1/runtime-resources/reconcile');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ created: 1, deployments: { artifactsCreated: 2 } });
    expect(engineMetadataReconciliationService.reconcileEngine).toHaveBeenCalledWith('e1', null);
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:edit', expect.objectContaining({
      resourceType: 'engine', resourceId: 'e1',
    }));
  });

  it('returns engine credential state but never the stored secret in engine detail', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    (engineService as any).getEngineRole.mockResolvedValue(null);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view' || permission === 'engine:secrets:view'
    );

    const response = await request(app).get('/engines-api/engines/e1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'e1',
      username: 'engine-user',
      passwordEnc: null,
      hasCredential: true,
    });
  });

  it('lists project-engine deployment targets through scoped engine project access view permission', async () => {
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'engine:project-access:view'
    );
    (projectEngineTargetService as any).listTargets.mockResolvedValue([
      {
        id: 'target-1',
        projectId: 'project-1',
        projectName: 'Payments App',
        engineId: 'e1',
        engineName: 'Engine 1',
        engineBaseUrl: null,
        status: 'active',
        source: 'legacy',
        sourceRef: null,
        ownershipMode: 'manual',
        sourceHash: null,
        lastAppliedAt: null,
        driftStatus: null,
        externalSystemId: null,
        externalProjectId: null,
        externalEngineId: null,
        externalTargetId: null,
        allowManualDeploy: true,
        allowCiDeploy: false,
        allowApiDeploy: true,
        allowImport: true,
        environment: null,
        tenantId: null,
        createdById: null,
        approvedById: null,
        approvalStatus: 'not_required',
        approvedAt: null,
        policyTags: [],
        diagnostics: null,
        lastSeenAt: 1,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    const response = await request(app).get('/engines-api/engines/e1/project-targets');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'target-1',
        projectName: 'Payments App',
        allowManualDeploy: true,
        allowApiDeploy: true,
      }),
    ]);
    expect(projectEngineTargetService.listTargets).toHaveBeenCalledWith({
      engineId: 'e1',
      status: 'all',
      tenantId: null,
    });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:project-access:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('rejects project-engine deployment target reads without engine project access view permission', async () => {
    permissionServiceMock.hasPermission.mockResolvedValue(false);

    const response = await request(app).get('/engines-api/engines/e1/project-targets');

    expect(response.status).toBe(403);
    expect(projectEngineTargetService.listTargets).not.toHaveBeenCalled();
  });

  it('allows engine updates from scoped engine edit permission without legacy manage role', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn()
      .mockResolvedValueOnce({ id: 'e1', name: 'Engine 1' })
      .mockResolvedValueOnce({ id: 'e1', name: 'Updated Engine' });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ name: 'Updated Engine' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({ name: 'Updated Engine' }));
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:edit', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('rejects engine authentication updates without secret management permission', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({ id: 'e1', name: 'Engine 1', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ passwordEnc: 'new-secret' });

    expect(response.status).toBe(403);
    expect(String(response.body.error || '')).toContain('Engine secret management permission is required');
    expect(update).not.toHaveBeenCalled();
  });

  it('allows engine authentication updates from scoped engine secret management permission', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:secrets:manage');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn()
      .mockResolvedValueOnce({ id: 'e1', name: 'Engine 1', tenantId: null })
      .mockResolvedValueOnce({ id: 'e1', name: 'Engine 1', passwordEnc: 'new-secret', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ passwordEnc: 'new-secret' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      passwordEnc: 'v2:test:bmV3LXNlY3JldA==',
    }));
    expect(secretResolverMock.normalizeForStorage).toHaveBeenCalledWith('new-secret');
  });

  it('rejects manual updates to externally managed engine registration fields', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'External Engine',
      registrationSource: 'external_api',
      externalId: 'cluster-a/prod',
      tenantId: null,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ baseUrl: 'https://manual.example.com/engine-rest' });

    expect(response.status).toBe(400);
    expect(String(response.body.error || '')).toContain('Externally managed engine fields are read-only: baseUrl');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects manual ingestion-control updates to externally managed engines', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({ id: 'e1', registrationSource: 'external_api', managementMode: 'external_managed', tenantId: null, fieldOwnershipJson: '{}' });
    (getDataSource as any).mockResolvedValue({ getRepository: () => ({ findOne, findOneBy, update }) });

    const response = await request(app).put('/engines-api/engines/e1').send({ metadataDiscoveryEnabled: false });

    expect(response.status).toBe(400);
    expect(String(response.body.error || '')).toContain('metadataDiscoveryEnabled');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects manual updates to config-locked engine fields', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Config Engine',
      registrationSource: 'config',
      ownershipMode: 'config_locked',
      tenantId: null,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({ findOne, findOneBy, update }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ name: 'Changed locally' });

    expect(response.status).toBe(403);
    expect(String(response.body.error || '')).toContain('Configuration-managed engine fields are read-only: name');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects manual ingestion-control updates to config-locked engines', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({ id: 'e1', registrationSource: 'config', ownershipMode: 'config_locked', tenantId: null });
    (getDataSource as any).mockResolvedValue({ getRepository: () => ({ findOne, findOneBy, update }) });

    const response = await request(app).put('/engines-api/engines/e1').send({ metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false });

    expect(response.status).toBe(403);
    expect(String(response.body.error || '')).toContain('metadataDiscoveryEnabled');
    expect(update).not.toHaveBeenCalled();
  });

  it('marks config-warn engine updates as manual drift', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn()
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'Config Engine',
        registrationSource: 'config',
        ownershipMode: 'config_warn',
        tenantId: null,
      })
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'Changed locally',
        registrationSource: 'config',
        ownershipMode: 'config_warn',
        driftStatus: 'manual_override',
        tenantId: null,
      });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({ findOne, findOneBy, update }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ name: 'Changed locally' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      name: 'Changed locally',
      driftStatus: 'manual_override',
    }));
  });

  it('allows manual updates to hybrid engines when field ownership is manual', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn()
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'Hybrid Engine',
        registrationSource: 'external_api',
        managementMode: 'hybrid',
        fieldOwnershipJson: JSON.stringify({ connection: 'manual', auth: 'external', labels: 'external' }),
        externalId: 'cluster-a/prod',
        tenantId: null,
      })
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'Hybrid Engine',
        baseUrl: 'https://manual.example.com/engine-rest',
        registrationSource: 'external_api',
        managementMode: 'hybrid',
        fieldOwnershipJson: JSON.stringify({ connection: 'manual', auth: 'external', labels: 'external' }),
        externalId: 'cluster-a/prod',
        tenantId: null,
      });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ baseUrl: 'https://manual.example.com/engine-rest' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      baseUrl: 'https://manual.example.com/engine-rest',
    }));
  });

  it('allows local display updates on externally managed engines without clearing omitted environment tags', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn()
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'External Engine',
        registrationSource: 'external_api',
        externalId: 'cluster-a/prod',
        environmentTagId: 'env-prod',
        tenantId: null,
      })
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'Display Name',
        registrationSource: 'external_api',
        externalId: 'cluster-a/prod',
        environmentTagId: 'env-prod',
        tenantId: null,
      });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ name: 'Display Name' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      name: 'Display Name',
      environmentTagId: undefined,
    }));
  });

  it('rejects manual engine registration when onboarding mode is external-only', async () => {
    platformSettingsServiceMock.get.mockResolvedValue({ engineOnboardingMode: 'external_only' });
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Manual engine', baseUrl: 'https://engine.example.com/engine-rest' });

    expect(response.status).toBe(403);
    expect(String(response.body.error || '')).toContain('Manual engine registration is disabled');
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects manual-owned engine updates when onboarding mode is external-only', async () => {
    platformSettingsServiceMock.get.mockResolvedValue({ engineOnboardingMode: 'external_only' });
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Manual Engine',
      registrationSource: 'user',
      tenantId: null,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ name: 'Updated Manual Engine' });

    expect(response.status).toBe(403);
    expect(String(response.body.error || '')).toContain('Manual engine updates are disabled');
    expect(update).not.toHaveBeenCalled();
  });

  it('allows local display updates on externally managed engines when onboarding mode is external-only', async () => {
    platformSettingsServiceMock.get.mockResolvedValue({ engineOnboardingMode: 'external_only' });
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const update = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn()
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'External Engine',
        registrationSource: 'external_api',
        externalId: 'cluster-a/prod',
        tenantId: null,
      })
      .mockResolvedValueOnce({
        id: 'e1',
        name: 'Display Name',
        registrationSource: 'external_api',
        externalId: 'cluster-a/prod',
        tenantId: null,
      });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ name: 'Display Name' });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      name: 'Display Name',
    }));
  });

  it('rejects manual engine deletion when onboarding mode is external-only', async () => {
    platformSettingsServiceMock.get.mockResolvedValue({ engineOnboardingMode: 'external_only' });
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:delete');
    const engineDelete = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Manual Engine',
      registrationSource: 'user',
      tenantId: null,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        delete: engineDelete,
      }),
    });

    const response = await request(app).delete('/engines-api/engines/e1');

    expect(response.status).toBe(403);
    expect(String(response.body.error || '')).toContain('Manual engine deletion is disabled');
    expect(engineDelete).not.toHaveBeenCalled();
  });

  it('prunes every scoped canonical assignment when a manual engine is deleted', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:delete');
    const engineDelete = vi.fn().mockResolvedValue({ affected: 1 });
    const registrationDelete = vi.fn().mockResolvedValue(undefined);
    const materializationDelete = vi.fn().mockResolvedValue(undefined);
    const assignmentDelete = vi.fn().mockResolvedValue(undefined);
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Manual Engine',
      registrationSource: 'user',
      lifecycleStatus: 'active',
      tenantId: null,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineRegistration') return { delete: registrationDelete };
        if (entity?.name === 'EngineSetMaterialization') return { delete: materializationDelete };
        if (entity?.name === 'RbacRoleAssignment') return { delete: assignmentDelete };
        return { findOne, findOneBy, delete: engineDelete };
      },
    });

    await request(app).delete('/engines-api/engines/e1').expect(204);

    expect(engineDelete).toHaveBeenCalledWith({ id: 'e1' });
    expect(assignmentDelete).toHaveBeenCalledWith({
      scopeType: 'engine',
      scopeId: 'e1',
    });
    expect(permissionServiceMock.syncLegacyRoleAssignments).not.toHaveBeenCalled();
  });

  it('rejects manual deletion of externally registered engines', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:delete');
    const engineDelete = vi.fn().mockResolvedValue({});
    const registrationDelete = vi.fn().mockResolvedValue({});
    const materializationDelete = vi.fn().mockResolvedValue({});
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'External Engine',
      registrationSource: 'external_api',
      lifecycleStatus: 'active',
      tenantId: null,
    });
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineRegistration') return { delete: registrationDelete };
        if (entity?.name === 'EngineSetMaterialization') return { delete: materializationDelete };
        return {
          findOne,
          findOneBy,
          delete: engineDelete,
        };
      },
    });

    const response = await request(app).delete('/engines-api/engines/e1');

    expect(response.status).toBe(409);
    expect(String(response.body.error || '')).toContain('Externally registered engines cannot be deleted');
    expect(engineDelete).not.toHaveBeenCalled();
    expect(registrationDelete).not.toHaveBeenCalled();
    expect(materializationDelete).not.toHaveBeenCalled();
  });

  it('rejects manual deletion of decommissioned engines', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:delete');
    const engineDelete = vi.fn().mockResolvedValue({});
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Decommissioned Engine',
      registrationSource: 'user',
      lifecycleStatus: 'decommissioned',
      tenantId: null,
    });
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne,
        findOneBy,
        delete: engineDelete,
      }),
    });

    const response = await request(app).delete('/engines-api/engines/e1');

    expect(response.status).toBe(409);
    expect(String(response.body.error || '')).toContain('Decommissioned engines cannot be deleted');
    expect(engineDelete).not.toHaveBeenCalled();
  });

  it('rejects connection tests for decommissioned engines', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const healthInsert = vi.fn().mockResolvedValue({});
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Decommissioned Engine',
      baseUrl: 'https://engine.example.com/engine-rest',
      lifecycleStatus: 'decommissioned',
      tenantId: null,
    });
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'EngineHealth') return { insert: healthInsert };
        return { findOne, findOneBy };
      },
    });

    const response = await request(app).post('/engines-api/engines/e1/test');

    expect(response.status).toBe(400);
    expect(String(response.body.error || '')).toContain('Cannot test a decommissioned engine');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(healthInsert).not.toHaveBeenCalled();
  });

  it('rejects connection tests for disabled engines', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const healthInsert = vi.fn().mockResolvedValue({});
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Disabled Engine',
      baseUrl: 'https://engine.example.com/engine-rest',
      lifecycleStatus: 'disabled',
      tenantId: null,
    });
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'EngineHealth') return { insert: healthInsert };
        return { findOne, findOneBy };
      },
    });

    const response = await request(app).post('/engines-api/engines/e1/test');

    expect(response.status).toBe(400);
    expect(String(response.body.error || '')).toContain('Cannot test a disabled engine');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(healthInsert).not.toHaveBeenCalled();
  });

  it('runs credentialless customer-sidecar health checks through the shared connection resolver', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const healthInsert = vi.fn().mockResolvedValue({});
    const engineUpdate = vi.fn().mockResolvedValue({});
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Customer sidecar',
      baseUrl: 'https://sidecar.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'none',
      username: null,
      passwordEnc: null,
      oauthTokenUrl: null,
      oauthScopes: null,
      oauthAudience: null,
      lifecycleStatus: 'active',
      tenantId: null,
    });
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'EngineHealth') return { insert: healthInsert };
        return { findOne, findOneBy, update: engineUpdate };
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({ version: '8.7.0' }),
    });

    const response = await request(app).post('/engines-api/engines/e1/test');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'connected',
      version: '8.7.0',
      transport: {
        connectionMode: 'customer_sidecar',
        upstreamHop: 'enterpriseglue_to_sidecar',
        endpointAuthentication: 'none',
        downstreamAuthentication: 'customer_managed',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://sidecar.example.com/engine-rest/version', expect.objectContaining({
      method: 'GET',
      headers: expect.not.objectContaining({ Authorization: expect.anything() }),
    }));
  });

  it('reports a failed connection test as the EnterpriseGlue-to-sidecar hop without disclosing downstream credentials', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const healthInsert = vi.fn().mockResolvedValue({});
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Customer sidecar',
      baseUrl: 'https://sidecar.example.com/engine-rest',
      connectionMode: 'customer_sidecar',
      authType: 'none',
      username: null,
      passwordEnc: 'downstream-secret-must-not-leak',
      oauthTokenUrl: null,
      oauthScopes: null,
      oauthAudience: null,
      lifecycleStatus: 'active',
      tenantId: null,
    });
    const findOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'EngineHealth') return { insert: healthInsert };
        return { findOne, findOneBy };
      },
    });
    fetchMock.mockRejectedValueOnce(new Error('TLS handshake failed: downstream-secret-must-not-leak'));

    const response = await request(app).post('/engines-api/engines/e1/test');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'disconnected',
      message: 'Failed to connect to EnterpriseGlue -> customer sidecar endpoint',
      transport: {
        connectionMode: 'customer_sidecar',
        upstreamHop: 'enterpriseglue_to_sidecar',
        downstreamAuthentication: 'customer_managed',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('downstream-secret-must-not-leak');
    expect(healthInsert).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Failed to connect to EnterpriseGlue -> customer sidecar endpoint',
    }));
  });

  it('lists saved filters only for engines authorized by the action resolver', async () => {
    const engineFind = vi.fn().mockResolvedValue([
      { id: 'e1', tenantId: null },
      { id: 'e2', tenantId: null },
    ]);
    const filterFind = vi.fn().mockResolvedValue([
      {
        id: 'filter-1',
        engineId: 'e1',
        name: 'Open incidents',
        defKeys: '["payment-process"]',
        active: true,
        incidents: true,
        completed: false,
        canceled: false,
        version: null,
        createdAt: 1,
      },
    ]);
    permissionServiceMock.getKnownEngineIdsForUser.mockResolvedValue(['e1', 'e2']);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string, context: { resourceId?: string }) =>
      permission === 'engine:instance:view' && context.resourceId === 'e1'
    );
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => entity?.name === 'SavedFilter'
        ? { find: filterFind }
        : { find: engineFind },
    });

    const response = await request(app).get('/engines-api/saved-filters');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'filter-1',
        engineId: 'e1',
        defKeys: ['payment-process'],
        version: null,
      }),
    ]);
    expect(filterFind).toHaveBeenCalledWith({
      where: { engineId: expect.anything() },
    });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'e1',
    }));
  });

  it('creates saved filters only after resolving the target engine action', async () => {
    const engineFindOne = vi.fn().mockResolvedValue({ id: 'e1', tenantId: null });
    const filterInsert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => entity?.name === 'SavedFilter'
        ? { insert: filterInsert }
        : { findOne: engineFindOne },
    });

    const response = await request(app)
      .post('/engines-api/saved-filters')
      .send({
        name: 'Open incidents',
        engineId: 'e1',
        defKeys: ['payment-process'],
        active: true,
        incidents: true,
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Open incidents',
      engineId: 'e1',
      defKeys: ['payment-process'],
      active: true,
      incidents: true,
    });
    expect(engineFindOne).toHaveBeenCalledWith({
      where: { id: 'e1' },
      select: ['id', 'tenantId'],
    });
    expect(filterInsert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'e1',
      defKeys: '["payment-process"]',
    }));
  });

  it('rejects localhost engine URLs when running in Docker', async () => {
    (existsSync as any).mockReturnValue(true);

    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Docker local engine', baseUrl: 'http://localhost:8080/engine-rest', type: 'operaton' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ field: 'baseUrl' });
    expect(String(response.body.error || '')).toContain('host.docker.internal:8080/engine-rest');
  });

  it('accepts ION, Operaton, and Camunda 7 engine types', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    for (const type of ['ion', 'operaton', 'camunda7']) {
      const response = await request(app)
        .post('/engines-api/engines')
        .send({ name: `${type} engine`, baseUrl: `https://${type}.example.com/engine-rest`, type });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ type });
    }

    expect(insert).toHaveBeenCalledTimes(3);
    expect((engineService as any).createEngineWithGovernanceAssignments).toHaveBeenCalledTimes(3);
    expect((engineService as any).createEngineWithGovernanceAssignments).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'user-1', delegateId: null }),
      expect.any(Object),
    );
    expect(permissionServiceMock.syncLegacyRoleAssignments).not.toHaveBeenCalled();
  });

  it('defaults distributed engines to engine-wide access without runtime inventory reconciliation', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({ getRepository: () => ({ insert }) });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Distributed engine', baseUrl: 'https://distributed.example.com/engine-rest' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      runtimeAccessScope: 'engine_wide',
      tenancyMode: 'dedicated',
      tenantId: 'tenant-default',
      tenantResolutionStatus: 'ready',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      runtimeAccessScope: 'engine_wide',
      tenancyMode: 'dedicated',
      tenantId: 'tenant-default',
      tenantResolutionStatus: 'ready',
    }));
    expect(engineMetadataReconciliationService.reconcileEngine).toHaveBeenCalledWith(expect.any(String), 'tenant-default', {
      runtimeMetadataDiscoveryEnabled: false,
      deploymentDiscoveryEnabled: true,
    });
  });

  it('creates explicit shared engines only with resource-aware access and fail-closed mapping state', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({ getRepository: () => ({ insert }) });

    const rejected = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Unsafe shared engine',
        baseUrl: 'https://central.example.com/engine-rest',
        tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
      });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({
      code: 'ENGINE_SHARED_REQUIRES_RESOURCE_AWARE',
      field: 'tenancy',
    });
    expect(insert).not.toHaveBeenCalled();

    const created = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Central shared engine',
        baseUrl: 'https://central.example.com/engine-rest',
        runtimeAccessScope: 'resource_aware',
        tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      tenancyMode: 'shared',
      tenantId: null,
      tenantMappingStrategy: 'engine_tenant_id',
      tenantMappingVersion: 0,
      tenantResolutionStatus: 'incomplete',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenancyMode: 'shared',
      tenantId: null,
      tenantMappingStrategy: 'engine_tenant_id',
      tenantResolutionStatus: 'incomplete',
    }));
  });

  it('requires authorized resolution for explicit tenant references', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({ getRepository: () => ({ insert }) });

    const forbidden = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Cross-tenant engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        tenancy: { mode: 'dedicated', tenantRef: { type: 'id', id: 'tenant-other' } },
      });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({
      code: 'ENGINE_TENANT_REFERENCE_FORBIDDEN',
      field: 'tenancy',
    });

    app.locals.engineTenantReferenceResolver = {
      resolve: vi.fn().mockResolvedValue({
        tenantId: 'tenant-enterprise',
        tenantKey: 'team-a',
        authorized: true,
      }),
    };
    const created = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Resolved engine',
        baseUrl: 'https://resolved.example.com/engine-rest',
        tenancy: { mode: 'dedicated', tenantRef: { type: 'key', key: 'team-a' } },
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      tenancyMode: 'dedicated',
      tenantId: 'tenant-enterprise',
      tenantResolutionStatus: 'ready',
    });
  });

  it('rejects credentialless authentication for a direct engine endpoint', async () => {
    const response = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Direct credentialless engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        connectionMode: 'direct',
        authType: 'none',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Credentialless endpoint authentication is allowed only for customer-sidecar engines',
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a credentialless customer sidecar when platform policy is disabled', async () => {
    const response = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Credentialless sidecar',
        baseUrl: 'https://sidecar.example.com/engine-rest',
        connectionMode: 'customer_sidecar',
        authType: 'none',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Credentialless customer-sidecar endpoints are disabled by platform policy',
      code: 'VALIDATION_ERROR',
    });
  });

  it('persists a credentialless customer sidecar when platform policy permits it', async () => {
    platformSettingsServiceMock.get.mockResolvedValue({
      engineOnboardingMode: 'manual_allowed',
      credentiallessCustomerSidecarsEnabled: true,
    });
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({ insert }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Credentialless sidecar',
        baseUrl: 'https://sidecar.example.com/engine-rest',
        connectionMode: 'customer_sidecar',
        authType: 'none',
      });

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      connectionMode: 'customer_sidecar',
      authType: 'none',
    }));
  });

  it('defaults newly registered engines to ION and persists the requested runtime access scope', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Default engine',
        baseUrl: 'https://ion.example.com/engine-rest',
        runtimeAccessScope: 'resource_aware',
        deploymentIntegration: 'direct_engine',
        deploymentDiscoveryEnabled: false,
        reconciliationIntervalSeconds: 900,
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'ion', runtimeAccessScope: 'resource_aware', deploymentIntegration: 'direct_engine', deploymentDiscoveryEnabled: false, reconciliationIntervalSeconds: 900 });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: 'ion', runtimeAccessScope: 'resource_aware', deploymentIntegration: 'direct_engine', deploymentDiscoveryEnabled: false, reconciliationIntervalSeconds: 900 }));
  });

  it('rejects changing a resource-aware engine to engine-wide while runtime assignments exist', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) => permission === 'engine:edit');
    const getCount = vi.fn().mockResolvedValue(1);
    const queryBuilder = {
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getCount,
    };
    const update = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null }),
        findOneBy: vi.fn().mockResolvedValue({
          id: 'e1',
          name: 'Central Engine',
          registrationSource: 'user',
          runtimeAccessScope: 'resource_aware',
          tenantId: null,
        }),
        createQueryBuilder: vi.fn(() => queryBuilder),
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({ runtimeAccessScope: 'engine_wide' });

    expect(response.status).toBe(400);
    expect(String(response.body.error || '')).toContain('Remove or move runtime-resource role assignments');
    expect(update).not.toHaveBeenCalled();
  });

  it('accepts OAuth2 client credentials engine auth metadata', async () => {
    const clientSecret = 'engine-oauth-secret-sentinel';
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'Keycloak engine',
        baseUrl: 'https://ion.example.com/engine-rest',
        type: 'ion',
        authType: 'oauth2-client-credentials',
        username: 'enterpriseglue',
        passwordEnc: clientSecret,
        oauthTokenUrl: 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token',
        oauthScopes: 'engine-rest',
        oauthAudience: 'ion-engine',
      });

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      authType: 'oauth2-client-credentials',
      passwordEnc: `v2:test:${Buffer.from(clientSecret).toString('base64')}`,
      oauthTokenUrl: 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token',
      oauthScopes: 'engine-rest',
      oauthAudience: 'ion-engine',
    }));
    expect(response.body).toMatchObject({ passwordEnc: null, hasCredential: true });
    expect(JSON.stringify(response.body)).not.toContain(clientSecret);
    expect(JSON.stringify(insert.mock.calls)).not.toContain(clientSecret);
  });

  it('stores external engine metadata on normal registration', async () => {
    const insert = vi.fn().mockResolvedValue({});
    const registrationInsert = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue(null);
    const registrationFindOne = vi.fn().mockResolvedValue(null);
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => entity?.name === 'ExternalEngineRegistration' ? ({
        findOne: registrationFindOne,
        insert: registrationInsert,
      }) : ({
        findOne,
        insert,
      }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({
        name: 'External-tagged engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        externalId: 'cluster-a/prod',
        labels: { environment: 'prod', region: 'eu' },
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      externalId: 'cluster-a/prod',
      labels: { environment: 'prod', region: 'eu' },
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'cluster-a/prod',
      labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }),
      registrationSource: 'user',
      lifecycleStatus: 'active',
      lastExternalSyncAt: null,
    }));
    expect(registrationInsert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: expect.any(String),
      externalId: 'cluster-a/prod',
      labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }),
      registrationSource: 'user',
      lifecycleStatus: 'active',
      lastExternalSyncAt: null,
    }));
    expect(runtimeResourceInventoryService.materializeForEngine).toHaveBeenCalledWith(expect.any(String), 'tenant-default');
  });

  it('upserts engines through the external registration API', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    const insert = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const registrationInsert = vi.fn().mockResolvedValue({});
    const registrationUpdate = vi.fn().mockResolvedValue({});
    const findOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'e1', externalId: 'cluster-a/prod' });
    const registrationFindOne = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'registration-1', engineId: 'e1', externalId: 'cluster-a/prod' })
      .mockResolvedValueOnce({ id: 'registration-1', engineId: 'e1', externalId: 'cluster-a/prod' });
    const findOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      name: 'Updated external engine',
      baseUrl: 'https://engine.example.com/engine-rest',
      type: 'ion',
      authType: 'none',
      username: null,
      passwordEnc: null,
      version: null,
      externalId: 'cluster-a/prod',
      labelsJson: JSON.stringify({ environment: 'prod' }),
      registrationSource: 'external_api',
      externalUpdatedAt: 123,
      active: false,
      createdAt: 1,
      updatedAt: 2,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => entity?.name === 'ExternalEngineRegistration' ? ({
        findOne: registrationFindOne,
        insert: registrationInsert,
        update: registrationUpdate,
      }) : ({
        findOne,
        findOneBy,
        insert,
        update,
      }),
    });

    const createResponse = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'External engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        externalId: 'cluster-a/prod',
        labels: { environment: 'prod' },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.created).toBe(true);
    expect(createResponse.body.diagnostics).toEqual({
      tenancyWarnings: ['ENGINE_TENANCY_DEFAULTED_TO_DEDICATED'],
    });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('platform:engine-registration:manage', expect.objectContaining({
      principalType: 'api_client',
      principalId: 'client-1',
      resourceType: 'platform',
    }));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'cluster-a/prod',
      registrationSource: 'external_api',
      managementMode: 'external_managed',
      fieldOwnershipJson: expect.stringContaining('connection'),
      lifecycleStatus: 'active',
      lastExternalSyncAt: expect.any(Number),
      ownerId: 'user-1',
    }));
    expect((engineService as any).createEngineWithGovernanceAssignments).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'user-1', delegateId: null, registrationSource: 'external_api' }),
      expect.any(Object),
    );
    expect(registrationInsert).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'cluster-a/prod',
      registrationSource: 'external_api',
      apiClientId: 'client-1',
      managementMode: 'external_managed',
      fieldOwnershipJson: expect.stringContaining('connection'),
      lifecycleStatus: 'active',
      lastExternalSyncAt: expect.any(Number),
    }));

    const updateResponse = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'Updated external engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        externalId: 'cluster-a/prod',
        labels: { environment: 'prod' },
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.created).toBe(false);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      externalId: 'cluster-a/prod',
      registrationSource: 'external_api',
      lifecycleStatus: 'active',
      lastExternalSyncAt: expect.any(Number),
    }));
    expect(registrationUpdate).toHaveBeenCalledWith({ id: 'registration-1' }, expect.objectContaining({
      engineId: 'e1',
      externalId: 'cluster-a/prod',
      registrationSource: 'external_api',
      apiClientId: 'client-1',
      lifecycleStatus: 'active',
      lastExternalSyncAt: expect.any(Number),
    }));
    expect(runtimeResourceInventoryService.materializeForEngine).toHaveBeenLastCalledWith('e1', 'tenant-default');
  });

  it('rejects silent topology changes during normal engine updates', async () => {
    (engineService as any).hasEngineAccess.mockResolvedValue(false);
    permissionServiceMock.hasPermission.mockResolvedValue(true);
    const update = vi.fn().mockResolvedValue({});
    const existing = {
      id: 'e1',
      name: 'Dedicated engine',
      registrationSource: 'user',
      runtimeAccessScope: 'resource_aware',
      tenancyMode: 'dedicated',
      tenantId: 'tenant-default',
      tenantMappingStrategy: null,
      tenantMappingVersion: 0,
      tenantResolutionStatus: 'ready',
    };
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        findOne: vi.fn().mockResolvedValue(existing),
        findOneBy: vi.fn().mockResolvedValue(existing),
        update,
      }),
    });

    const response = await request(app)
      .put('/engines-api/engines/e1')
      .send({
        tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
        runtimeAccessScope: 'resource_aware',
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'ENGINE_TENANCY_TRANSITION_REQUIRED',
      field: 'tenancy',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('stores external system and hybrid field ownership during external registration', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    const insert = vi.fn().mockResolvedValue({});
    const registrationInsert = vi.fn().mockResolvedValue({});
    const registrationFindOne = vi.fn().mockResolvedValue(null);
    const engineFindOne = vi.fn().mockResolvedValue(null);
    const systemFindOne = vi.fn().mockResolvedValue({
      id: 'system-1',
      tenantId: null,
      key: 'cmdb',
      name: 'CMDB',
      defaultManagementMode: 'hybrid',
      defaultFieldOwnershipJson: JSON.stringify({ connection: 'manual', auth: 'external', labels: 'external' }),
      isActive: true,
    });
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineRegistration') {
          return {
            findOne: registrationFindOne,
            insert: registrationInsert,
          };
        }
        if (entity?.name === 'ExternalEngineSystem') {
          return {
            findOne: systemFindOne,
          };
        }
        return {
          findOne: engineFindOne,
          insert,
        };
      },
    });

    const response = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'External engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        externalId: 'cluster-a/prod',
        externalSystemId: 'system-1',
        labels: { environment: 'prod' },
        capabilities: { operations: ['engine.read'], supportLevel: 'compatible' },
      });

    expect(response.status).toBe(201);
    expect(systemFindOne).toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      externalSystemId: 'system-1',
      managementMode: 'hybrid',
      fieldOwnershipJson: expect.stringContaining('"connection":"manual"'),
      driftStatus: 'in_sync',
      lifecycleStatus: 'active',
      capabilitiesJson: expect.stringContaining('engine.read'),
      capabilityStatus: 'mismatch',
    }));
    expect(registrationInsert).toHaveBeenCalledWith(expect.objectContaining({
      externalSystemId: 'system-1',
      managementMode: 'hybrid',
      fieldOwnershipJson: expect.stringContaining('"connection":"manual"'),
      driftStatus: 'in_sync',
      lifecycleStatus: 'active',
      capabilitiesJson: expect.stringContaining('engine.read'),
      capabilityStatus: 'mismatch',
    }));
  });

  it('externally provisions explicit shared engines without the compatibility warning', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    const insert = vi.fn().mockResolvedValue({});
    const registrationInsert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => entity?.name === 'ExternalEngineRegistration'
        ? { findOne: vi.fn().mockResolvedValue(null), insert: registrationInsert }
        : { findOne: vi.fn().mockResolvedValue(null), insert },
    });

    const response = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'Central external engine',
        baseUrl: 'https://central.example.com/engine-rest',
        externalId: 'cluster/central',
        runtimeAccessScope: 'resource_aware',
        tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      });

    expect(response.status).toBe(201);
    expect(response.body.diagnostics).toEqual({ tenancyWarnings: [] });
    expect(response.body.engine).toMatchObject({
      tenancyMode: 'shared',
      tenantId: null,
      tenantMappingStrategy: 'explicit',
      tenantResolutionStatus: 'incomplete',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      tenancyMode: 'shared',
      tenantId: null,
      tenantMappingStrategy: 'explicit',
      tenantResolutionStatus: 'incomplete',
    }));
  });

  it('preserves manual-owned fields and marks drift during hybrid external upsert', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    const update = vi.fn().mockResolvedValue({});
    const registrationUpdate = vi.fn().mockResolvedValue({});
    const existingEngine = {
      id: 'e1',
      name: 'Manual display name',
      baseUrl: 'https://manual.example.com/engine-rest',
      type: 'ion',
      authType: 'none',
      username: null,
      passwordEnc: null,
      oauthTokenUrl: null,
      oauthScopes: null,
      oauthAudience: null,
      version: null,
      externalId: 'cluster-a/prod',
      labelsJson: JSON.stringify({ environment: 'prod' }),
      registrationSource: 'external_api',
      externalSystemId: 'system-1',
      managementMode: 'hybrid',
      fieldOwnershipJson: JSON.stringify({ connection: 'manual', display: 'manual', auth: 'external', labels: 'external' }),
      driftStatus: 'in_sync',
      lifecycleStatus: 'active',
      lastExternalSyncAt: 1000,
      externalUpdatedAt: 1000,
      active: true,
      createdAt: 1,
      updatedAt: 2,
    };
    const engineFindOne = vi.fn().mockResolvedValue(existingEngine);
    const engineFindOneBy = vi.fn().mockResolvedValue({
      ...existingEngine,
      driftStatus: 'manual_override',
      lastExternalSyncAt: 2000,
      externalUpdatedAt: 2000,
      updatedAt: 2000,
    });
    const registrationFindOne = vi.fn()
      .mockResolvedValueOnce({ id: 'registration-1', engineId: 'e1', externalId: 'cluster-a/prod' })
      .mockResolvedValueOnce({ id: 'registration-1', engineId: 'e1', externalId: 'cluster-a/prod' });

    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineRegistration') {
          return {
            findOne: registrationFindOne,
            update: registrationUpdate,
          };
        }
        if (entity?.name === 'AuditLog') return { insert: vi.fn().mockResolvedValue({}) };
        return {
          findOne: engineFindOne,
          findOneBy: engineFindOneBy,
          update,
        };
      },
    });

    const response = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'External display name',
        baseUrl: 'https://external.example.com/engine-rest',
        externalId: 'cluster-a/prod',
        fieldOwnership: { connection: 'manual', display: 'manual', auth: 'external', labels: 'external' },
        labels: { environment: 'prod', region: 'eu' },
      });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.not.objectContaining({
      name: 'External display name',
      baseUrl: 'https://external.example.com/engine-rest',
    }));
    expect(update).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      driftStatus: 'manual_override',
      lifecycleStatus: 'active',
      lastExternalSyncAt: expect.any(Number),
      labelsJson: JSON.stringify({ environment: 'prod', region: 'eu' }),
    }));
    expect(registrationUpdate).toHaveBeenCalledWith({ id: 'registration-1' }, expect.objectContaining({
      driftStatus: 'manual_override',
      lifecycleStatus: 'active',
      lastExternalSyncAt: expect.any(Number),
    }));
  });

  it('decommissions external engines without deleting inventory', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    const engineUpdate = vi.fn().mockResolvedValue({});
    const registrationUpdate = vi.fn().mockResolvedValue({});
    const materializationDelete = vi.fn().mockResolvedValue({});
    const auditInsert = vi.fn().mockResolvedValue({});
    const registrationFindOne = vi.fn().mockResolvedValue({
      id: 'registration-1',
      engineId: 'e1',
      externalId: 'cluster-a/prod',
      apiClientId: 'client-old',
    });
    const engineFindOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      externalId: 'cluster-a/prod',
      externalSystemId: 'system-1',
      registrationSource: 'external_api',
    });

    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineRegistration') {
          return {
            findOne: registrationFindOne,
            update: registrationUpdate,
          };
        }
        if (entity?.name === 'EngineSetMaterialization') {
          return { delete: materializationDelete };
        }
        if (entity?.name === 'AuditLog') {
          return { insert: auditInsert };
        }
        return {
          findOneBy: engineFindOneBy,
          update: engineUpdate,
        };
      },
    });

    const response = await request(app)
      .post('/engines-api/external/engines/decommission')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        externalId: 'cluster-a/prod',
        externalSystemId: 'system-1',
        reason: 'Removed from external inventory',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decommissioned: true,
      engineId: 'e1',
      externalId: 'cluster-a/prod',
      lifecycleStatus: 'decommissioned',
    });
    expect(engineUpdate).toHaveBeenCalledWith({ id: 'e1' }, expect.objectContaining({
      lifecycleStatus: 'decommissioned',
      driftStatus: 'decommissioned',
      lastExternalSyncAt: expect.any(Number),
    }));
    expect(registrationUpdate).toHaveBeenCalledWith({ id: 'registration-1' }, expect.objectContaining({
      apiClientId: 'client-1',
      lifecycleStatus: 'decommissioned',
      driftStatus: 'decommissioned',
      lastExternalSyncAt: expect.any(Number),
    }));
    expect(materializationDelete).toHaveBeenCalledWith({ engineId: 'e1' });
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'engine.external_registration.decommission',
      resourceId: 'e1',
      details: expect.stringContaining('Removed from external inventory'),
    }));
  });

  it('optionally tests connection during external engine registration', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ version: '8.7.0' }),
    });
    const engineInsert = vi.fn().mockResolvedValue({});
    const engineUpdate = vi.fn().mockResolvedValue({});
    const healthInsert = vi.fn().mockResolvedValue({});
    const auditInsert = vi.fn().mockResolvedValue({});
    const findOne = vi.fn().mockResolvedValue(null);
    const registrationInsert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'EngineHealth') return { insert: healthInsert };
        if (entity?.name === 'AuditLog') return { insert: auditInsert };
        if (entity?.name === 'ExternalEngineRegistration') return {
          findOne: vi.fn().mockResolvedValue(null),
          insert: registrationInsert,
        };
        return {
          findOne,
          insert: engineInsert,
          update: engineUpdate,
        };
      },
    });

    const response = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'External engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        externalId: 'cluster-a/prod',
        testConnection: true,
      });

    expect(response.status).toBe(201);
    expect(response.body.health).toMatchObject({ status: 'connected', version: '8.7.0' });
    expect(response.body.engine.version).toBe('8.7.0');
    expect(fetchMock).toHaveBeenCalledWith('https://engine.example.com/engine-rest/version', expect.objectContaining({ method: 'GET' }));
    expect(healthInsert).toHaveBeenCalledWith(expect.objectContaining({
      engineId: expect.any(String),
      status: 'connected',
    }));
    expect(engineUpdate).toHaveBeenCalledWith({ id: expect.any(String) }, expect.objectContaining({ version: '8.7.0' }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'engine.external_registration.create',
      details: expect.stringContaining('connectionTest'),
    }));
  });

  it('requires an API client bearer token for external engine registration', async () => {
    const response = await request(app)
      .post('/engines-api/external/engines')
      .send({
        name: 'External engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        externalId: 'cluster-a/prod',
      });

    expect({ status: response.status, body: response.body }).toEqual({
      status: 401,
      body: { error: 'API client bearer token required', code: 'UNAUTHORIZED' },
    });
    expect(apiClientAuthMock.authenticateToken).not.toHaveBeenCalled();
  });

  it('denies external engine registration when the API client lacks the action permission', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    permissionServiceMock.hasPermission.mockResolvedValue(false);

    const response = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'External engine',
        baseUrl: 'https://engine.example.com/engine-rest',
        externalId: 'cluster-a/prod',
      });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'API client is not authorized for action: engine.external-registration.upsert',
    });
  });

  it('registers project-engine targets through the external registration API', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'external-engine-system:project-targets:manage'
    );
    const registrationFindOne = vi.fn().mockResolvedValue({
      id: 'registration-1',
      engineId: 'e1',
      externalId: 'cluster-a/prod',
      externalSystemId: 'system-1',
    });
    const systemFindOne = vi.fn().mockResolvedValue({
      id: 'system-1',
      tenantId: null,
      isActive: true,
    });
    const engineFindOneBy = vi.fn().mockResolvedValue({
      id: 'e1',
      tenantId: null,
      externalSystemId: 'system-1',
      lifecycleStatus: 'active',
    });
    const auditInsert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineRegistration') return { findOne: registrationFindOne };
        if (entity?.name === 'ExternalEngineSystem') return { findOne: systemFindOne };
        if (entity?.name === 'AuditLog') return { insert: auditInsert };
        return {
          findOneBy: engineFindOneBy,
          findOne: vi.fn().mockResolvedValue(null),
        };
      },
    });
    (projectEngineTargetService as any).listTargets.mockResolvedValue([]);
    (projectEngineTargetService as any).createTarget.mockResolvedValue({ id: 'target-1' });
    (projectEngineTargetService as any).getTarget.mockResolvedValue({
      id: 'target-1',
      projectId: 'project-1',
      engineId: 'e1',
      status: 'active',
      source: 'external',
      sourceRef: 'external_engine_system:system-1:project_engine_target:target-ext-1',
      externalSystemId: 'system-1',
      externalProjectId: 'cmdb-project-1',
      externalEngineId: 'cluster-a/prod',
      externalTargetId: 'target-ext-1',
      allowManualDeploy: true,
      allowCiDeploy: true,
      allowApiDeploy: true,
      allowImport: false,
      approvalStatus: 'approved',
      policyTags: ['prod', 'regulated'],
      diagnostics: { owner: 'cmdb', confidence: 'high' },
    });

    const response = await request(app)
      .post('/engines-api/external/project-engine-targets')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        externalSystemId: 'system-1',
        projectId: 'project-1',
        externalProjectId: 'cmdb-project-1',
        externalEngineId: 'cluster-a/prod',
        externalTargetId: 'target-ext-1',
        approvalStatus: 'approved',
        policyTags: ['regulated', 'prod'],
        diagnostics: { owner: 'cmdb', confidence: 'high' },
        allowCiDeploy: true,
        allowApiDeploy: true,
        allowImport: false,
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ created: true, target: { id: 'target-1', source: 'external' } });
    expect(permissionServiceMock.hasPermission).toHaveBeenCalledWith('external-engine-system:project-targets:manage', expect.objectContaining({
      principalType: 'api_client',
      principalId: 'client-1',
      resourceType: 'external_engine_system',
      resourceId: 'system-1',
    }));
    expect(projectEngineTargetService.createTarget).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      engineId: 'e1',
      source: 'external',
      sourceRef: 'external_engine_system:system-1:project_engine_target:target-ext-1',
      externalSystemId: 'system-1',
      externalProjectId: 'cmdb-project-1',
      externalEngineId: 'cluster-a/prod',
      externalTargetId: 'target-ext-1',
      allowManualDeploy: true,
      allowCiDeploy: true,
      allowApiDeploy: true,
      allowImport: false,
      approvalStatus: 'approved',
      policyTags: ['regulated', 'prod'],
      diagnostics: { owner: 'cmdb', confidence: 'high' },
      createdById: 'user-1',
      approvedById: 'user-1',
      allowSourceOwnedMutation: true,
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project_engine_target.external_registration.create',
      resourceId: 'target-1',
      details: expect.stringContaining('target-ext-1'),
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('cmdb-project-1'),
    }));
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.stringContaining('regulated'),
    }));
  });

  it('rejects external target registration when a manual target already owns the project-engine pair', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'external-engine-system:project-targets:manage'
    );
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineSystem') return { findOne: vi.fn().mockResolvedValue({ id: 'system-1', tenantId: null, isActive: true }) };
        if (entity?.name === 'ExternalEngineRegistration') return {
          findOne: vi.fn().mockResolvedValue({ id: 'registration-1', engineId: 'e1', externalSystemId: 'system-1' }),
        };
        return {
          findOneBy: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null, externalSystemId: 'system-1', lifecycleStatus: 'active' }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      },
    });
    (projectEngineTargetService as any).listTargets.mockResolvedValue([
      {
        id: 'target-manual',
        projectId: 'project-1',
        engineId: 'e1',
        source: 'manual',
        sourceRef: null,
      },
    ]);

    const response = await request(app)
      .post('/engines-api/external/project-engine-targets')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        externalSystemId: 'system-1',
        projectId: 'project-1',
        externalEngineId: 'cluster-a/prod',
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: 'Project-engine target is already managed by another source',
    });
    expect(projectEngineTargetService.createTarget).not.toHaveBeenCalled();
  });

  it('decommissions project-engine targets through the owning external system', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'external-engine-system:project-targets:manage'
    );
    const auditInsert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: (entity: any) => {
        if (entity?.name === 'ExternalEngineSystem') return { findOne: vi.fn().mockResolvedValue({ id: 'system-1', tenantId: null, isActive: true }) };
        if (entity?.name === 'ExternalEngineRegistration') return {
          findOne: vi.fn().mockResolvedValue({ id: 'registration-1', engineId: 'e1', externalSystemId: 'system-1' }),
        };
        if (entity?.name === 'AuditLog') return { insert: auditInsert };
        return {
          findOneBy: vi.fn().mockResolvedValue({ id: 'e1', tenantId: null, externalSystemId: 'system-1', lifecycleStatus: 'active' }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      },
    });
    (projectEngineTargetService as any).listTargets.mockResolvedValue([
      {
        id: 'target-1',
        projectId: 'project-1',
        engineId: 'e1',
        source: 'external',
        sourceRef: 'external_engine_system:system-1:project_engine_target:project-1:e1',
      },
    ]);

    const response = await request(app)
      .post('/engines-api/external/project-engine-targets/decommission')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        externalSystemId: 'system-1',
        projectId: 'project-1',
        externalEngineId: 'cluster-a/prod',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ archived: true, targetId: 'target-1' });
    expect(projectEngineTargetService.archiveTarget).toHaveBeenCalledWith('target-1', null, true);
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'project_engine_target.external_registration.decommission',
      resourceId: 'target-1',
    }));
  });

  it('rejects SSRF-risk external registration URLs', async () => {
    apiClientAuthMock.authenticateToken.mockResolvedValue({
      id: 'client-1',
      name: 'Registration client',
      tokenPrefix: 'egac_client',
      scopes: ['engine:register'],
      isActive: true,
      createdById: 'user-1',
      lastUsedAt: null,
      revokedAt: null,
      createdAt: 1,
      updatedAt: 1,
      authenticatedAt: 2,
    });

    const metadataResponse = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'Metadata engine',
        baseUrl: 'http://169.254.169.254/latest/meta-data',
        externalId: 'metadata-target',
      });

    expect(metadataResponse.status).toBe(400);
    expect(metadataResponse.body).toMatchObject({ error: 'Validation failed' });
    expect(metadataResponse.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'baseUrl' }),
    ]));

    const credentialsResponse = await request(app)
      .post('/engines-api/external/engines')
      .set('Authorization', 'Bearer egac_client-1_secret')
      .send({
        name: 'Credential URL engine',
        baseUrl: 'https://user:pass@engine.example.com/engine-rest',
        externalId: 'credential-target',
      });

    expect(credentialsResponse.status).toBe(400);
    expect(credentialsResponse.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'baseUrl' }),
    ]));
  });

  it('rejects unsupported engine type values', async () => {
    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Unsupported engine', baseUrl: 'https://engine.example.com/engine-rest', type: 'camunda8' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Validation failed' });
    expect(response.body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'type' }),
    ]));
  });
});
