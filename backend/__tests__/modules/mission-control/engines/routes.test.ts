import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { existsSync } from 'fs';
import enginesRouter from '../../../../../packages/backend-host/src/modules/mission-control/engines/routes.js';
import { engineService, projectEngineTargetService } from '@enterpriseglue/shared/services/platform-admin/index.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
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
const fetchMock = vi.hoisted(() => vi.fn());
const secretResolverMock = vi.hoisted(() => ({
  normalizeForStorage: vi.fn((value: string | null | undefined) => value ? `v2:test:${value}` : null),
  resolveStored: vi.fn((value: string | null | undefined) => value?.startsWith('v2:test:') ? value.slice('v2:test:'.length) : value || null),
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

vi.mock('@enterpriseglue/shared/middleware/platformAuth.js', () => ({
  isPlatformAdmin: () => true,
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  engineLimiter: (_req: any, _res: any, next: any) => next(),
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
  },
  platformSettingsService: platformSettingsServiceMock,
  projectEngineTargetService: {
    listTargets: vi.fn().mockResolvedValue([]),
    createTarget: vi.fn(),
    getTarget: vi.fn(),
    archiveTarget: vi.fn(),
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
    permissionServiceMock.hasPermission.mockImplementation(async (permission: string) =>
      permission === 'engine:instance:view' ||
      permission === 'platform:engine:create' ||
      permission === 'platform:engine-registration:manage'
    );
    permissionServiceMock.getKnownEngineIdsForUser.mockResolvedValue(['e1']);
    permissionServiceMock.syncLegacyRoleAssignments.mockResolvedValue({ scannedProjects: 0, scannedEngines: 1, upserted: 1, removed: 0 });
    platformSettingsServiceMock.get.mockResolvedValue({ engineOnboardingMode: 'manual_allowed' });
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
        status: 'active',
        source: 'legacy',
        allowManualDeploy: true,
        allowCiDeploy: false,
        allowApiDeploy: true,
        allowImport: true,
        environment: null,
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
      passwordEnc: 'v2:test:new-secret',
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
  });

  it('defaults newly registered engines to ION when type is omitted', async () => {
    const insert = vi.fn().mockResolvedValue({});
    (getDataSource as any).mockResolvedValue({
      getRepository: () => ({
        insert,
      }),
    });

    const response = await request(app)
      .post('/engines-api/engines')
      .send({ name: 'Default engine', baseUrl: 'https://ion.example.com/engine-rest' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'ion' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ type: 'ion' }));
  });

  it('accepts OAuth2 client credentials engine auth metadata', async () => {
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
        passwordEnc: 'client-secret',
        oauthTokenUrl: 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token',
        oauthScopes: 'engine-rest',
        oauthAudience: 'ion-engine',
      });

    expect(response.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      authType: 'oauth2-client-credentials',
      passwordEnc: 'v2:test:client-secret',
      oauthTokenUrl: 'https://keycloak.example.com/realms/acme/protocol/openid-connect/token',
      oauthScopes: 'engine-rest',
      oauthAudience: 'ion-engine',
    }));
    expect(response.body).toMatchObject({ passwordEnc: null, hasCredential: true });
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

    expect(response.status).toBe(401);
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
