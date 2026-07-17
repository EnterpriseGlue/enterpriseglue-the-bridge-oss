import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import jobsRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/jobs.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  executeJobById,
  listJobDefinitions,
  listJobs,
  setJobRetriesById,
  setJobSuspensionStateById,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/jobs-service.js';

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
    INSTANCE_RETRY: 'engine:instance:retry',
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

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/jobs-service.js', () => ({
  listJobs: vi.fn().mockResolvedValue([{ id: 'j1', dueDate: '2024-01-01' }]),
  getJobById: vi.fn().mockResolvedValue({ id: 'j1', dueDate: '2024-01-01' }),
  executeJobById: vi.fn().mockResolvedValue(undefined),
  setJobRetriesById: vi.fn().mockResolvedValue(undefined),
  setJobSuspensionStateById: vi.fn().mockResolvedValue(undefined),
  listJobDefinitions: vi.fn().mockResolvedValue([{ id: 'jd1', activityId: 'task1' }]),
  setJobDefinitionRetriesById: vi.fn().mockResolvedValue(undefined),
  setJobDefinitionSuspensionStateById: vi.fn().mockResolvedValue(undefined),
  filterRuntimeItemsByProcessDefinitionKeys: vi.fn().mockImplementation(async (_engineId: string, items: unknown[]) => items),
}));

describe('mission-control jobs routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(jobsRouter);
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

  it('lists jobs', async () => {
    const response = await request(app)
      .get('/mission-control-api/jobs')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listJobs).toHaveBeenCalledWith('engine-1', {});
  });

  it('gets job by id', async () => {
    const response = await request(app)
      .get('/mission-control-api/jobs/j1')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('j1');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
  });

  it('executes job', async () => {
    const response = await request(app)
      .post('/mission-control-api/jobs/j1/execute')
      .send({ engineId: 'engine-1' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:retry', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(executeJobById).toHaveBeenCalledWith('engine-1', 'j1');
  });

  it('rejects malformed job execution engine selectors', async () => {
    const response = await request(app)
      .post('/mission-control-api/jobs/j1/execute')
      .send({ engineId: 1 });

    expect(response.status).toBe(400);
    expect(executeJobById).not.toHaveBeenCalled();
  });

  it('updates job retries through the retry action', async () => {
    const response = await request(app)
      .put('/mission-control-api/jobs/j1/retries')
      .send({ engineId: 'engine-1', retries: 3 });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:retry', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(setJobRetriesById).toHaveBeenCalledWith('engine-1', 'j1', { retries: 3 });
  });

  it('updates job suspension through the process modify action', async () => {
    const response = await request(app)
      .put('/mission-control-api/jobs/j1/suspended')
      .send({ engineId: 'engine-1', suspended: true });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(setJobSuspensionStateById).toHaveBeenCalledWith('engine-1', 'j1', { suspended: true });
  });

  it('lists job definitions through the job-definition read action', async () => {
    const response = await request(app)
      .get('/mission-control-api/job-definitions')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listJobDefinitions).toHaveBeenCalledWith('engine-1', {});
  });

  it('pushes resource-aware job queries down to each authorized definition with a bounded page', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : {},
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/jobs')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith('engine-1', { processDefinitionKey: 'payments', maxResults: 100, withoutTenantId: true });
  });

  it('denies job reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/jobs')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listJobs).not.toHaveBeenCalled();
  });
});
