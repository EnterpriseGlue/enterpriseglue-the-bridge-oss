import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import missionControlRouter from '../../../../../packages/backend-host/src/modules/mission-control/shared/mission_control.js';
import { getProcessInstanceVariableHistory } from '../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/engineAuth.js', () => ({
  requireEngineReadOrWrite: () => (req: any, _res: any, next: any) => {
    req.engineId = req.query.engineId || 'engine-1';
    next();
  },
}));

vi.mock('@enterpriseglue/shared/services/pii/PiiRedactionService.js', () => ({
  piiRedactionService: {
    redactPayload: vi.fn(async (_req: any, payload: any) => payload),
  },
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/shared/mission-control-service.js', () => ({
  listProcessDefinitions: vi.fn().mockResolvedValue([]),
  getProcessDefinitionById: vi.fn().mockResolvedValue(null),
  getProcessDefinitionXmlById: vi.fn().mockResolvedValue(null),
  resolveProcessDefinition: vi.fn().mockResolvedValue(null),
  getActiveActivityCounts: vi.fn().mockResolvedValue({}),
  getActivityCountsByState: vi.fn().mockResolvedValue({}),
  previewProcessInstanceCount: vi.fn().mockResolvedValue({ count: 0 }),
  listProcessInstancesDetailed: vi.fn().mockResolvedValue([]),
  getProcessInstanceById: vi.fn().mockResolvedValue(null),
  getProcessInstanceVariables: vi.fn().mockResolvedValue({}),
  listProcessInstanceActivityHistory: vi.fn().mockResolvedValue([]),
  listProcessInstanceJobs: vi.fn().mockResolvedValue([]),
  getHistoricProcessInstanceById: vi.fn().mockResolvedValue(null),
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
    expect(getProcessInstanceVariableHistory).toHaveBeenCalledWith('engine-77', 'pi-1', 'var-1');
  });

  it('rejects requests without variableInstanceId', async () => {
    const response = await request(app)
      .get('/mission-control-api/process-instances/pi-1/variable-history?engineId=engine-77');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid query parameters' });
    expect(getProcessInstanceVariableHistory).not.toHaveBeenCalled();
  });
});
