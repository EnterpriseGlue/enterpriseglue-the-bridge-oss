import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import historyExtendedRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/history-extended.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { piiRedactionService } from '@enterpriseglue/shared/services/pii/PiiRedactionService.js';
import {
  listHistoricTasks,
  listHistoricVariables,
  listHistoricDecisionInputs,
  listUserOperations,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/history-extended-service.js';

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

vi.mock('@enterpriseglue/shared/services/pii/PiiRedactionService.js', () => ({
  piiRedactionService: {
    redactPayload: vi.fn().mockImplementation(async (_req: any, payload: any) => payload),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/history-extended-service.js', () => ({
  listHistoricTasks: vi.fn().mockResolvedValue([{ id: 'task-1' }]),
  listHistoricVariables: vi.fn().mockResolvedValue([{ id: 'var-1', value: 'secret' }]),
  listHistoricDecisions: vi.fn().mockResolvedValue([{ id: 'decision-1' }]),
  listHistoricDecisionInputs: vi.fn().mockResolvedValue([{ id: 'input-1', value: 'secret' }]),
  listHistoricDecisionOutputs: vi.fn().mockResolvedValue([{ id: 'output-1', value: 'secret' }]),
  listUserOperations: vi.fn().mockResolvedValue([{ id: 'op-1', property: 'assignee' }]),
}));

describe('mission-control extended history routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(historyExtendedRouter);
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

  it('reads historic tasks through history task action permission', async () => {
    const response = await request(app)
      .get('/mission-control-api/history/tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'task-1' }]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-1',
    }));
    expect(listHistoricTasks).toHaveBeenCalledWith('engine-1', {});
  });

  it('queries historic tasks only for authorized process definition keys on resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-1', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/history/tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(listHistoricTasks).toHaveBeenCalledWith('engine-1', { processDefinitionKey: 'payments' });
  });

  it('redacts historic variables after action authorization', async () => {
    const response = await request(app)
      .get('/mission-control-api/history/variables')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'var-1', value: 'secret' }]);
    expect(listHistoricVariables).toHaveBeenCalledWith('engine-1', {});
    expect(piiRedactionService.redactPayload).toHaveBeenCalledWith(expect.anything(), [{ id: 'var-1', value: 'secret' }], 'history');
  });

  it('reads historic decision inputs through decision input action permission', async () => {
    const response = await request(app)
      .get('/mission-control-api/history/decisions/decision-1/inputs')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'input-1', value: 'secret' }]);
    expect(listHistoricDecisionInputs).toHaveBeenCalledWith('engine-1', 'decision-1');
  });

  it('reads user operations through history user-operation action permission', async () => {
    const response = await request(app)
      .get('/mission-control-api/history/user-operations')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'op-1', property: 'assignee' }]);
    expect(listUserOperations).toHaveBeenCalledWith('engine-1', {});
  });

  it('denies historic tasks when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/history/tasks')
      .query({ engineId: 'engine-1' });

    expect(response.status).toBe(403);
    expect(listHistoricTasks).not.toHaveBeenCalled();
  });
});
