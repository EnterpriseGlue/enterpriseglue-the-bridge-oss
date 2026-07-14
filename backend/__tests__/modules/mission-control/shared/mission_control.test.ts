import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import missionControlRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/mission_control.js';
import { errorHandler } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Engine } from '@enterpriseglue/shared/infrastructure/persistence/entities/Engine.js';
import { RuntimeResource } from '@enterpriseglue/shared/infrastructure/persistence/entities/RuntimeResource.js';
import { permissionService } from '@enterpriseglue/shared/services/platform-admin/permissions.js';
import { camundaGet } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import {
  getActiveActivityCounts,
  listProcessDefinitions,
  listProcessInstancesDetailed,
  getProcessInstanceById,
  getProcessInstanceVariableHistory,
  getProcessInstanceExecutionDetails,
  previewProcessInstanceCount,
  suspendProcessInstanceById,
  listHistoricProcessInstances,
} from '../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js';

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('@enterpriseglue/shared/services/bpmn-engine-client.js', () => ({
  camundaGet: vi.fn(),
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
    app.use(errorHandler);
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

  it('fails closed for resource-aware process-instance preview counts because aggregate responses cannot be post-filtered', async () => {
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
    const response = await request(app)
      .post('/mission-control-api/process-instances/preview-count')
      .send({ engineId: 'engine-77', active: true });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Resource-aware process-instance preview counts are not supported');
    expect(previewProcessInstanceCount).not.toHaveBeenCalled();
  });

  it('bounds compatibility process-definition and instance collections for resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-77', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const [definitions, instances] = await Promise.all([
      request(app).get('/mission-control-api/process-definitions').query({ engineId: 'engine-77', maxResults: 25 }),
      request(app).get('/mission-control-api/process-instances').query({ engineId: 'engine-77', maxResults: 25 }),
    ]);

    expect(definitions.status).toBe(200);
    expect(instances.status).toBe(200);
    expect(listProcessDefinitions).toHaveBeenCalledWith('engine-77', expect.objectContaining({ maxResults: 25 }));
    expect(listProcessInstancesDetailed).toHaveBeenCalledWith('engine-77', expect.objectContaining({ processDefinitionKey: 'payments', maxResults: 25 }));
  });

  it('returns action decisions from the production compatibility process-instance route only when requested', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-77', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockImplementation(async ({ permission }: { permission: string }) =>
      permission === 'engine:instance:delete' ? [] : [{ resourceKey: 'payments' }]
    );
    vi.mocked(listProcessInstancesDetailed).mockResolvedValueOnce([
      { id: 'instance-payments', processDefinitionKey: 'payments' },
    ] as any);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-77', includeActionDecisions: 'true' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'instance-payments',
        runtimeActionDecisions: {
          suspension: { allowed: true },
          retry: { allowed: true },
          terminate: { allowed: false, reason: 'Action unavailable for this runtime resource' },
        },
      }),
    ]);
  });

  it('preserves the fail-closed status for oversized compatibility collections', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-77', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/process-definitions')
      .query({ engineId: 'engine-77', maxResults: 101 });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: 'runtime_filter_not_supported',
      error: 'Resource-aware runtime queries require maxResults between 1 and 100',
    });
    expect(listProcessDefinitions).not.toHaveBeenCalled();
  });

  it('drops compatibility process-instance rows outside the authorized definition key', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-77', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);
    vi.mocked(listProcessInstancesDetailed).mockResolvedValueOnce([
      { id: 'instance-allowed', processDefinitionKey: 'payments' },
      { id: 'instance-forbidden', processDefinitionKey: 'benefits' },
    ] as any);

    const response = await request(app)
      .get('/mission-control-api/process-instances')
      .query({ engineId: 'engine-77' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'instance-allowed', processDefinitionKey: 'payments' }]);
  });

  it('allows incidents only when their live process-instance lineage resolves to an authorized runtime resource', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Engine) return { findOne: vi.fn().mockResolvedValue({ id: 'central-engine', tenantId: null, runtimeAccessScope: 'resource_aware' }) };
        if (entity === RuntimeResource) return { findOne: vi.fn().mockResolvedValue({ id: 'resource-payments', tenantId: null }) };
        return { findOne: vi.fn().mockResolvedValue(null) };
      },
    });
    (camundaGet as unknown as Mock).mockResolvedValue({ id: 'instance-1', definitionKey: 'payments-order' });
    (permissionService.hasPermission as unknown as Mock).mockImplementation(async (_permission: string, context: any) =>
      context.resourceType === 'engine_runtime_resource' && context.resourceId === 'resource-payments'
    );
    const incidents = [{ id: 'incident-1', incidentType: 'failedJob' }];
    const { listProcessInstanceIncidents } = await import('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js');
    vi.mocked(listProcessInstanceIncidents).mockResolvedValueOnce(incidents as any);

    const response = await request(app)
      .get('/mission-control-api/process-instances/instance-1/incidents')
      .query({ engineId: 'central-engine' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(incidents);
    expect(camundaGet).toHaveBeenCalledWith('central-engine', '/process-instance/instance-1');
    expect(permissionService.hasPermission).toHaveBeenCalledWith('engine:instance:view', expect.objectContaining({
      resourceType: 'engine_runtime_resource', resourceId: 'resource-payments',
    }));
  });

  it('adds requested action decisions to compatibility process-instance details', async () => {
    vi.mocked(getProcessInstanceById).mockResolvedValueOnce({ id: 'instance-1', processDefinitionKey: 'payments' } as any);

    const response = await request(app)
      .get('/mission-control-api/process-instances/instance-1')
      .query({ engineId: 'engine-77', includeActionDecisions: 'true' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'instance-1',
      runtimeActionDecisions: {
        suspension: { allowed: true },
        retry: { allowed: true },
        terminate: { allowed: true },
        modify: { allowed: true },
        variablesUpdate: { allowed: true },
      },
    });
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

  it('bounds historic process-instance collections for resource-aware engines', async () => {
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => entity === Engine
        ? { findOne: vi.fn().mockResolvedValue({ id: 'engine-77', tenantId: null, runtimeAccessScope: 'resource_aware' }) }
        : { findOne: vi.fn().mockResolvedValue(null) },
    });
    (permissionService.hasPermission as unknown as Mock).mockResolvedValue(false);
    (permissionService.getVisibleRuntimeResources as unknown as Mock).mockResolvedValue([{ resourceKey: 'payments' }]);

    const response = await request(app)
      .get('/mission-control-api/history/process-instances')
      .query({ engineId: 'engine-77', maxResults: 25 });

    expect(response.status).toBe(200);
    expect(listHistoricProcessInstances).toHaveBeenCalledWith('engine-77', expect.objectContaining({
      processDefinitionKey: 'payments', maxResults: 25,
    }));
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
