import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import processInstancesRouter from '../../../../../packages/backend-host/src/modules/mission-control/process-instances/routes.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  listProcessInstances,
  getProcessInstance,
  getProcessInstanceVariables,
  deleteProcessInstance,
  modifyProcessInstanceVariables,
} from '../../../../../packages/backend-host/src/modules/mission-control/process-instances/service.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    INSTANCE_DELETE: 'engine:instance:delete',
    VARIABLES_EDIT: 'engine:variables:edit',
    MEMBERS_MANAGE: 'engine:members:manage',
  },
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    MEMBERS_MANAGE: 'project:members:manage',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(false),
    getVisibleRuntimeResources: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/process-instances/service.js', () => ({
  listProcessInstances: vi.fn().mockResolvedValue([]),
  getProcessInstance: vi.fn().mockResolvedValue({ id: 'pi1', processDefinitionId: 'pd1' }),
  deleteProcessInstance: vi.fn().mockResolvedValue(undefined),
  getProcessInstanceVariables: vi.fn().mockResolvedValue({}),
  modifyProcessInstanceVariables: vi.fn().mockResolvedValue(undefined),
  getActivityInstances: vi.fn().mockResolvedValue([]),
}));

describe('mission-control process-instances routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(processInstancesRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn(async ({ where }: any) => ({
              id: String(where?.id || 'engine-1'),
              tenantId: null,
            })),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });

    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (permission: string) =>
      permission.startsWith('engine:')
    );
  });

  it('lists process instances', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listProcessInstances).toHaveBeenCalledWith('engine-1', {
      processDefinitionKey: undefined,
      active: false,
      suspended: false,
    });
  });

  it('returns process instance detail', async () => {
    (getProcessInstance as unknown as Mock).mockResolvedValueOnce({ id: 'pi1', processDefinitionId: 'pd1', definitionId: 'payments:1:abc', adapterDiagnostic: 'retained' });
    const response = await request(app)
      .get('/mission-control-api/process-instances/pi1')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'pi1', processDefinitionId: 'pd1', definitionId: 'payments:1:abc', adapterDiagnostic: 'retained' });
    expect(getProcessInstance).toHaveBeenCalledWith('engine-1', 'pi1');
  });

  it('adds sanitized action decisions to an explicitly requested process-instance detail', async () => {
    (getProcessInstance as unknown as Mock).mockResolvedValueOnce({ id: 'pi1', processDefinitionKey: 'payments' });

    const response = await request(app)
      .get('/mission-control-api/process-instances/pi1')
      .query({ engineId: 'engine-1', includeActionDecisions: 'true' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'pi1',
      processDefinitionKey: 'payments',
      runtimeActionDecisions: {
        suspension: { allowed: true },
        retry: { allowed: true },
        terminate: { allowed: true },
        migration: { allowed: true },
        modify: { allowed: true },
        variablesUpdate: { allowed: true },
      },
    });
  });

  it('serializes process variables through the shared passthrough contract', async () => {
    (getProcessInstanceVariables as unknown as Mock).mockResolvedValueOnce({
      approvalReason: {
        value: 'Need manager sign-off',
        type: 'String',
        valueInfo: { serializationDataFormat: 'application/json' },
        adapterDiagnostic: { retained: true },
      },
    });

    const response = await request(app)
      .get('/mission-control-api/process-instances/pi1/variables')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      approvalReason: expect.objectContaining({
        type: 'String', value: 'Need manager sign-off', adapterDiagnostic: { retained: true },
      }),
    });
    expect(getProcessInstanceVariables).toHaveBeenCalledWith('engine-1', 'pi1');
  });

  it('deletes process instances through delete permission', async () => {
    const response = await request(app)
      .delete('/mission-control-api/process-instances/pi1')
      .query({ engineId: 'engine-1', deleteReason: 'cleanup' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:delete', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(deleteProcessInstance).toHaveBeenCalledWith('engine-1', 'pi1', {
      skipCustomListeners: false,
      skipIoMappings: false,
      deleteReason: 'cleanup',
    });
  });

  it('updates process instance variables through variable edit permission', async () => {
    const response = await request(app)
      .post('/mission-control-api/process-instances/pi1/variables')
      .send({ engineId: 'engine-1', modifications: { variables: { amount: { value: 12 } } } });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:variables:edit', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(modifyProcessInstanceVariables).toHaveBeenCalledWith('engine-1', 'pi1', {
      variables: { amount: { value: 12 } },
    });
  });

  it('denies process instance reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listProcessInstances).not.toHaveBeenCalled();
  });

  it('queries only authorized process definition keys for a resource-aware engine', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'engine-1',
              tenantId: null,
              runtimeAccessScope: 'resource_aware',
            }),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      { resourceKey: 'invoice-process' },
      { resourceKey: 'payment-process' },
    ]);
    (listProcessInstances as unknown as Mock).mockImplementation(async (_engineId, query) => [{
      id: `${query.processDefinitionKey}-instance`,
      processDefinitionKey: query.processDefinitionKey,
    }]);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { id: 'invoice-process-instance', processDefinitionKey: 'invoice-process' },
      { id: 'payment-process-instance', processDefinitionKey: 'payment-process' },
    ]);
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      engineId: 'engine-1',
      resourceKind: 'process_definition',
      permission: 'engine:instance:view',
    }));
    expect(listProcessInstances).toHaveBeenCalledTimes(2);
    expect(listProcessInstances).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      processDefinitionKey: 'invoice-process',
      maxResults: 100,
    }));
    expect(listProcessInstances).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      processDefinitionKey: 'payment-process',
      maxResults: 100,
    }));
  });

  it('adds sanitized action decisions only when requested for visible runtime rows', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockImplementation(async ({ permission }: { permission: string }) => {
      if (permission === 'engine:instance:delete') return [];
      return [{ resourceKey: 'payments' }];
    });
    (listProcessInstances as unknown as Mock).mockResolvedValueOnce([
      { id: 'instance-payments', processDefinitionKey: 'payments' },
    ]);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-1', includeActionDecisions: 'true' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'instance-payments',
        processDefinitionKey: 'payments',
        runtimeActionDecisions: {
          suspension: { allowed: true },
          retry: { allowed: true },
          terminate: { allowed: false, reason: 'Action unavailable for this runtime resource' },
          migration: { allowed: true },
        },
      },
    ]);
    expect(permissionService.getVisibleRuntimeResources).toHaveBeenCalledWith(expect.objectContaining({
      permission: 'engine:process:modify',
      resourceKind: 'process_definition',
      limit: 5_000,
    }));
  });

  it('drops process instances outside the authorized definition key even when the engine ignores the query filter', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);
    (listProcessInstances as unknown as Mock).mockResolvedValueOnce([
      { id: 'instance-allowed', processDefinitionKey: 'payments' },
      { id: 'instance-forbidden', processDefinitionKey: 'benefits' },
    ]);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'instance-allowed', processDefinitionKey: 'payments' }]);
  });

  it('rejects oversized process-instance collection requests for resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'invoice-process' }]);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-1', maxResults: 101 });

    expect(response.status).toBe(403);
    expect(listProcessInstances).not.toHaveBeenCalled();
  });

  it('denies resource-aware collections with no visible process definitions', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn().mockResolvedValue({
              id: 'engine-1',
              tenantId: null,
              runtimeAccessScope: 'resource_aware',
            }),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([]);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listProcessInstances).not.toHaveBeenCalled();
  });
});
