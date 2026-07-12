import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import modifyRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/modify.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  modifyProcessDefinitionAsync,
  modifyProcessInstance,
  restartProcessDefinitionAsync,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/modify-service.js';

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

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/modify-service.js', () => ({
  modifyProcessInstance: vi.fn().mockResolvedValue(undefined),
  modifyProcessDefinitionAsync: vi.fn().mockResolvedValue({ batchId: 'batch-1', camundaBatchId: 'camunda-batch-1' }),
  restartProcessDefinitionAsync: vi.fn().mockResolvedValue({ batchId: 'batch-2', camundaBatchId: 'camunda-batch-2' }),
}));

describe('mission-control shared modify routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(modifyRouter);
    vi.clearAllMocks();

    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) {
          return {
            findOne: vi.fn(async ({ where }: any) => ({
              id: String(where?.id || 'engine-77'),
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

  it('modifies a process instance', async () => {
    const servicePayload = {
      instructions: [{ type: 'startBeforeActivity', activityId: 'approve' }],
    };
    const body = {
      engineId: 'engine-77',
      ...servicePayload,
    };

    const response = await request(app)
      .post('/mission-control-api/process-instances/pi-1/modify')
      .send(body);

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-77',
    }));
    expect(modifyProcessInstance).toHaveBeenCalledWith('engine-77', 'pi-1', servicePayload);
  });

  it('creates an async process definition modification batch', async () => {
    const servicePayload = {
      processInstanceIds: ['pi-1'],
      instructions: [{ type: 'cancel', activityId: 'approve' }],
    };
    const body = {
      engineId: 'engine-77',
      ...servicePayload,
    };

    const response = await request(app)
      .post('/mission-control-api/process-definitions/pd-1/modification/execute-async')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'batch-1',
      camundaBatchId: 'camunda-batch-1',
      type: 'MODIFY_INSTANCES',
    });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-77',
    }));
    expect(modifyProcessDefinitionAsync).toHaveBeenCalledWith('engine-77', 'pd-1', servicePayload);
  });

  it('creates an async process definition restart batch', async () => {
    const servicePayload = {
      processInstanceIds: ['historic-pi-1'],
      initialVariables: true,
    };
    const body = {
      engineId: 'engine-77',
      ...servicePayload,
    };

    const response = await request(app)
      .post('/mission-control-api/process-definitions/pd-1/restart/execute-async')
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: 'batch-2',
      camundaBatchId: 'camunda-batch-2',
      type: 'RESTART_INSTANCES',
    });
    expect(restartProcessDefinitionAsync).toHaveBeenCalledWith('engine-77', 'pd-1', servicePayload);
  });

  it('denies process instance modification when process modify permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .post('/mission-control-api/process-instances/pi-1/modify')
      .send({
        engineId: 'engine-77',
        instructions: [{ type: 'startBeforeActivity', activityId: 'approve' }],
      });

    expect(response.status).toBe(403);
    expect(modifyProcessInstance).not.toHaveBeenCalled();
  });
});
