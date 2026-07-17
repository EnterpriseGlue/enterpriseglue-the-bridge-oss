import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import tasksRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/tasks.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  claimTaskById,
  completeTaskById,
  getTaskCountByQuery,
  getTaskVariablesById,
  listTasks,
  updateTaskVariablesById,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/tasks-service.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/rateLimiter.js', () => ({
  missionControlLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    PROCESS_MODIFY: 'engine:process:modify',
    VARIABLES_EDIT: 'engine:variables:edit',
  },
  PlatformPermissions: {
    USER_MANAGE: 'platform:user:manage',
    USERS_CREATE: 'platform:users:create',
  },
  ProjectPermissions: {
    MEMBERS_MANAGE: 'project:members:manage',
  },
  permissionService: {
    hasPermission: vi.fn().mockResolvedValue(true),
    getVisibleRuntimeResources: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/tasks-service.js', () => ({
  listTasks: vi.fn().mockResolvedValue([{ id: 't1', name: 'Task 1' }]),
  getTaskById: vi.fn().mockResolvedValue({ id: 't1', name: 'Task 1' }),
  getTaskCountByQuery: vi.fn().mockResolvedValue({ count: 5 }),
  claimTaskById: vi.fn().mockResolvedValue(undefined),
  unclaimTaskById: vi.fn().mockResolvedValue(undefined),
  setTaskAssigneeById: vi.fn().mockResolvedValue(undefined),
  completeTaskById: vi.fn().mockResolvedValue({}),
  getTaskVariablesById: vi.fn().mockResolvedValue({ var1: { value: 'test', type: 'String' } }),
  updateTaskVariablesById: vi.fn().mockResolvedValue({}),
  getTaskFormById: vi.fn().mockResolvedValue({ key: 'form1' }),
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn(),
}));

describe('mission-control tasks routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(tasksRouter);
    app.use(errorHandler);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null }),
          };
        }
        return {};
      },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(true);
  });

  it('lists tasks', async () => {
    const response = await request(app)
      .get('/mission-control-api/tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listTasks).toHaveBeenCalledWith('engine-1', {});
  });

  it('gets task count', async () => {
    const response = await request(app)
      .get('/mission-control-api/tasks/count')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(5);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(getTaskCountByQuery).toHaveBeenCalledWith('engine-1', {});
  });

  it('fails closed for task counts on resource-aware engines because count rows cannot be post-filtered', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : {},
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      { resourceKey: 'payments' },
      { resourceKey: 'invoices' },
    ]);
    const response = await request(app)
      .get('/mission-control-api/tasks/count')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Resource-aware task counts are not supported');
    expect(getTaskCountByQuery).not.toHaveBeenCalled();
  });

  it('queries only authorized process definition keys on resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : {},
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(listTasks).toHaveBeenCalledWith('engine-1', { processDefinitionKey: 'payments', maxResults: 100, withoutTenantId: true });
  });

  it('drops task rows whose resolved definition lineage is outside the authorized key', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : {},
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);
    (listTasks as unknown as Mock).mockResolvedValueOnce([
      { id: 'task-allowed', processDefinitionId: 'definition-payments' },
      { id: 'task-forbidden', processDefinitionId: 'definition-benefits' },
    ]);
    (camundaGet as unknown as Mock).mockImplementation(async (_engineId: string, path: string) => (
      path.endsWith('definition-payments') ? { key: 'payments' } : { key: 'benefits' }
    ));

    const response = await request(app)
      .get('/mission-control-api/tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'task-allowed', processDefinitionId: 'definition-payments' }]);
  });

  it('rejects oversized task collection requests for resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : {},
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/tasks')
      .query({ engineId: 'engine-1', maxResults: 101 });

    expect(response.status).toBe(403);
    expect(listTasks).not.toHaveBeenCalled();
  });

  it('gets task by id', async () => {
    const response = await request(app)
      .get('/mission-control-api/tasks/t1')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('t1');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
  });

  it('gets task variables', async () => {
    const response = await request(app)
      .get('/mission-control-api/tasks/t1/variables')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(getTaskVariablesById).toHaveBeenCalledWith('engine-1', 't1');
  });

  it('updates task variables through the variables edit action', async () => {
    const response = await request(app)
      .put('/mission-control-api/tasks/t1/variables')
      .send({ engineId: 'engine-1', modifications: { var1: { value: 'updated' } } });

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:variables:edit', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(updateTaskVariablesById).toHaveBeenCalledWith('engine-1', 't1', {
      modifications: { var1: { value: 'updated' } },
    });
  });

  it('claims tasks through the assignment action', async () => {
    const response = await request(app)
      .post('/mission-control-api/tasks/t1/claim')
      .send({ engineId: 'engine-1', userId: 'user-2' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(claimTaskById).toHaveBeenCalledWith('engine-1', 't1', { userId: 'user-2' });
  });

  it('completes tasks through the task completion action', async () => {
    const response = await request(app)
      .post('/mission-control-api/tasks/t1/complete')
      .send({ engineId: 'engine-1', withVariablesInReturn: true });

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(completeTaskById).toHaveBeenCalledWith('engine-1', 't1', { withVariablesInReturn: true });
  });

  it('denies task reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listTasks).not.toHaveBeenCalled();
  });
});
