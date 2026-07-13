import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import externalTasksRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/external-tasks.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  completeTask,
  fetchAndLockTasks,
  listExternalTasks,
  unlockTask,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/external-tasks-service.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/permissions.js', () => ({
  EnginePermissions: {
    INSTANCE_VIEW: 'engine:instance:view',
    PROCESS_MODIFY: 'engine:process:modify',
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

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/external-tasks-service.js', () => ({
  fetchAndLockTasks: vi.fn().mockResolvedValue([{ id: 'external-task-1' }]),
  listExternalTasks: vi.fn().mockResolvedValue([{ id: 'external-task-1' }]),
  completeTask: vi.fn().mockResolvedValue(undefined),
  failTask: vi.fn().mockResolvedValue(undefined),
  bpmnErrorTask: vi.fn().mockResolvedValue(undefined),
  extendTaskLock: vi.fn().mockResolvedValue(undefined),
  unlockTask: vi.fn().mockResolvedValue(undefined),
}));

describe('mission-control external task routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(externalTasksRouter);
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

  it('lists external tasks', async () => {
    const response = await request(app)
      .get('/mission-control-api/external-tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'external-task-1' }]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listExternalTasks).toHaveBeenCalledWith('engine-1', {});
  });

  it('fetches and locks external tasks through process modify permission', async () => {
    const requestBody = {
      engineId: 'engine-1',
      workerId: 'worker-1',
      topics: [{ topicName: 'topic-a', lockDuration: 1000 }],
    };

    const response = await request(app)
      .post('/mission-control-api/external-tasks/fetchAndLock')
      .send(requestBody);

    expect(response.status).toBe(200);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(fetchAndLockTasks).toHaveBeenCalledWith('engine-1', {
      workerId: 'worker-1',
      topics: [{ topicName: 'topic-a', lockDuration: 1000 }],
    });
  });

  it('limits external task queries to authorized process definition keys on resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : {},
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/external-tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(listExternalTasks).toHaveBeenCalledWith('engine-1', { processDefinitionKey: 'payments', maxResults: 100 });
  });

  it('completes external tasks through process modify permission', async () => {
    const response = await request(app)
      .post('/mission-control-api/external-tasks/external-task-1/complete')
      .send({ engineId: 'engine-1', workerId: 'worker-1' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(completeTask).toHaveBeenCalledWith('engine-1', 'external-task-1', { workerId: 'worker-1' });
  });

  it('unlocks external tasks through process modify permission', async () => {
    const response = await request(app)
      .post('/mission-control-api/external-tasks/external-task-1/unlock')
      .send({ engineId: 'engine-1' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(unlockTask).toHaveBeenCalledWith('engine-1', 'external-task-1');
  });

  it('denies external task reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/external-tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listExternalTasks).not.toHaveBeenCalled();
  });
});
