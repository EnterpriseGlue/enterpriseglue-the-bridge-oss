import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import missionControlRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/mission_control.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import {
  getActiveActivityCounts,
  getProcessInstanceVariableHistory,
  getProcessInstanceExecutionDetails,
  previewProcessInstanceCount,
  suspendProcessInstanceById,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js';

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
    getVisibleRuntimeResources: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@enterpriseglue/shared/services/pii/PiiRedactionService.js', () => ({
  piiRedactionService: {
    redactPayload: vi.fn(async (_req: any, payload: any) => payload),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js', () => ({
  listProcessDefinitions: vi.fn().mockResolvedValue([]),
  getProcessDefinitionById: vi.fn().mockResolvedValue({}),
  getProcessDefinitionXmlById: vi.fn().mockResolvedValue({ bpmn20Xml: '' }),
  resolveProcessDefinition: vi.fn().mockResolvedValue({}),
  getActiveActivityCounts: vi.fn().mockResolvedValue({}),
  getActivityCountsByState: vi.fn().mockResolvedValue({}),
  previewProcessInstanceCount: vi.fn().mockResolvedValue({ count: 0 }),
  listProcessInstancesDetailed: vi.fn().mockResolvedValue([]),
  getProcessInstanceById: vi.fn().mockResolvedValue({}),
  getProcessInstanceVariables: vi.fn().mockResolvedValue({}),
  listProcessInstanceActivityHistory: vi.fn().mockResolvedValue([]),
  getProcessInstanceExecutionDetails: vi.fn().mockResolvedValue({
    activityInstanceId: 'act-inst-1',
    executionId: 'exec-1',
    taskId: 'task-1',
    variables: [{ id: 'var-1', name: 'approvalReason', type: 'String', value: 'Need manager sign-off' }],
    tasks: [],
    decisions: [],
    userOperations: [],
  }),
  listProcessInstanceJobs: vi.fn().mockResolvedValue([]),
  getHistoricProcessInstanceById: vi.fn().mockResolvedValue({}),
  listHistoricProcessInstances: vi.fn().mockResolvedValue([]),
  getProcessInstanceVariableHistory: vi.fn().mockResolvedValue([]),
  listHistoricVariableInstances: vi.fn().mockResolvedValue([]),
  listProcessInstanceIncidents: vi.fn().mockResolvedValue([]),
  suspendProcessInstanceById: vi.fn().mockResolvedValue(undefined),
  activateProcessInstanceById: vi.fn().mockResolvedValue(undefined),
  deleteProcessInstanceById: vi.fn().mockResolvedValue(undefined),
  listFailedExternalTasks: vi.fn().mockResolvedValue([]),
  retryProcessInstanceFailures: vi.fn().mockResolvedValue(undefined),
}));

describe('mission-control shared mission_control routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(missionControlRouter);
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

  it('reads process-definition active activity counts through process-definition action permission', async () => {
    vi.mocked(getActiveActivityCounts).mockResolvedValueOnce({ approve: 2 } as any);

    const response = await request(app)
      .get('/mission-control-api/process-definitions/pd-1/active-activity-counts')
      .query({ engineId: 'engine-77' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ approve: 2 });
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      userId: 'user-1',
      resourceType: 'engine',
      resourceId: 'engine-77',
    }));
    expect(getActiveActivityCounts).toHaveBeenCalledWith('engine-77', 'pd-1');
  });

  it('sums preview counts only across authorized process definitions on resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-77', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([
      { resourceKey: 'payments' },
      { resourceKey: 'invoices' },
    ]);
    vi.mocked(previewProcessInstanceCount).mockImplementation(async (_engineId, body: any) => ({
      count: body.processDefinitionKey === 'payments' ? 4 : 1,
    }));

    const response = await request(app)
      .post('/mission-control-api/process-instances/preview-count')
      .send({ engineId: 'engine-77', active: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 5 });
    expect(previewProcessInstanceCount).toHaveBeenCalledTimes(2);
    expect(previewProcessInstanceCount).toHaveBeenCalledWith('engine-77', expect.objectContaining({ processDefinitionKey: 'payments' }));
    expect(previewProcessInstanceCount).toHaveBeenCalledWith('engine-77', expect.objectContaining({ processDefinitionKey: 'invoices' }));
    expect(previewProcessInstanceCount).not.toHaveBeenCalledWith('engine-77', expect.not.objectContaining({ processDefinitionKey: expect.any(String) }));
  });

  it('returns variable history for a process instance variable and allows engineId in query', async () => {
    vi.mocked(getProcessInstanceVariableHistory).mockResolvedValueOnce([
      {
        id: 'detail-1',
        variableInstanceId: 'var-1',
        variableName: 'amount',
        value: 100,
        type: 'Integer',
        time: '2026-03-08T10:00:00.000Z',
        activityInstanceId: 'act-1',
        executionId: 'exec-1',
        taskId: null,
        revision: 2,
        serializerName: null,
      },
    ] as any);

    const response = await request(app)
      .get('/mission-control-api/process-instances/pi-1/variable-history?variableInstanceId=var-1&engineId=engine-77');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'detail-1',
        variableInstanceId: 'var-1',
        variableName: 'amount',
      }),
    ]);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-77',
    }));
    expect(getProcessInstanceVariableHistory).toHaveBeenCalledWith('engine-77', 'pi-1', 'var-1');
  });

  it('rejects requests without variableInstanceId', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-instances/pi-1/variable-history?engineId=engine-77');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid query parameters' });
    expect(getProcessInstanceVariableHistory).not.toHaveBeenCalled();
  });

  it('returns lazy execution details for a process instance activity instance', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-instances/pi1/execution-details')
      .query({ engineId: 'engine-77', activityInstanceId: 'act-inst-1', executionId: 'exec-1', taskId: 'task-1' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      activityInstanceId: 'act-inst-1',
      executionId: 'exec-1',
      taskId: 'task-1',
      variables: [{ id: 'var-1', name: 'approvalReason' }],
    });
    expect(getProcessInstanceExecutionDetails).toHaveBeenCalledWith('engine-77', 'pi1', {
      activityInstanceId: 'act-inst-1',
      executionId: 'exec-1',
      taskId: 'task-1',
    });
  });

  it('updates process instance suspension through process modify permission', async () => {
    const response = await request(app)
      .put('/mission-control-api/process-instances/pi-1/suspend')
      .send({ engineId: 'engine-77' });

    expect(response.status).toBe(204);
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:process:modify', expect.objectContaining({
      resourceType: 'engine',
      resourceId: 'engine-77',
    }));
    expect(suspendProcessInstanceById).toHaveBeenCalledWith('engine-77', 'pi-1');
  });

  it('denies shared process instance reads when instance view permission is missing', async () => {
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);

    const response = await request(app)
      .get('/mission-control-api/process-instances/pi-1/variable-history')
      .query({ engineId: 'engine-77', variableInstanceId: 'var-1' });

    expect(response.status).toBe(403);
    expect(getProcessInstanceVariableHistory).not.toHaveBeenCalled();
  });
});
