import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import directRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/direct.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  deleteProcessInstancesDirect,
  suspendActivateProcessInstancesDirect,
  setJobRetriesDirect,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/direct-service.js';

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
    INSTANCE_DELETE: 'engine:instance:delete',
    INSTANCE_RETRY: 'engine:instance:retry',
    PROCESS_MODIFY: 'engine:process:modify',
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
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/direct-service.js', () => ({
  deleteProcessInstancesDirect: vi.fn().mockResolvedValue([{ id: 'i1', ok: true }]),
  suspendActivateProcessInstancesDirect: vi.fn().mockResolvedValue([{ id: 'i1', ok: true }]),
  setJobRetriesDirect: vi.fn().mockResolvedValue([{ id: 'j1', ok: true }]),
  executeMigrationDirect: vi.fn().mockResolvedValue({ success: true }),
}));

describe('mission-control direct routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(directRouter);
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

  it('deletes process instances directly', async () => {
    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/delete')
      .send({ engineId: 'engine-1', processInstanceIds: ['i1', 'i2'], deleteReason: 'test' });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeDefined();
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:delete', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(deleteProcessInstancesDirect).toHaveBeenCalledWith('engine-1', expect.objectContaining({
      processInstanceIds: ['i1', 'i2'],
      deleteReason: 'test',
    }));
  });

  it('serializes the shared per-instance direct-operation receipt', async () => {
    vi.mocked(deleteProcessInstancesDirect).mockResolvedValueOnce([
      { id: 'i1', ok: true },
      { id: 'i2', ok: false, error: 'instance is already ended' },
    ]);

    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/delete')
      .send({ engineId: 'engine-1', processInstanceIds: ['i1', 'i2'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 2,
      succeeded: ['i1'],
      failed: [{ id: 'i2', ok: false, error: 'instance is already ended' }],
    });
  });

  it('suspends process instances directly', async () => {
    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/suspend')
      .send({ engineId: 'engine-1', processInstanceIds: ['i1'] });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeDefined();
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(suspendActivateProcessInstancesDirect).toHaveBeenCalledWith('engine-1', ['i1'], true);
  });

  it('activates process instances directly', async () => {
    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/activate')
      .send({ engineId: 'engine-1', processInstanceIds: ['i1'] });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeDefined();
    expect(suspendActivateProcessInstancesDirect).toHaveBeenCalledWith('engine-1', ['i1'], false);
  });

  it('sets job retries directly through retry permission', async () => {
    const response = await request(app)
      .post('/mission-control-api/direct/jobs/retries')
      .send({ engineId: 'engine-1', processInstanceIds: ['i1'], retries: 3 });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeDefined();
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:retry', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(setJobRetriesDirect).toHaveBeenCalledWith('engine-1', {
      processInstanceIds: ['i1'],
      retries: 3,
      onlyFailed: true,
    });
  });

  it('denies direct delete when delete permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/delete')
      .send({ engineId: 'engine-1', processInstanceIds: ['i1'] });

    expect(response.status).toBe(403);
    expect(deleteProcessInstancesDirect).not.toHaveBeenCalled();
  });
});
