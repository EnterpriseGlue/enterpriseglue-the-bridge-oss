import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import processInstancesRouter from '../../../../src/modules/mission-control/process-instances/routes.js';

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/middleware/engineAuth.js', () => ({
  requireEngineReadOrWrite: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
  requireEngineDeployer: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
}));

vi.mock('../../../../src/modules/mission-control/process-instances/service.js', () => ({
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
    app.use(express.json());
    app.use(processInstancesRouter);
    vi.clearAllMocks();
  });

  it('lists process instances', async () => {
    const response = await request(app).get('/mission-control-api/process-instances');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('returns process instance detail', async () => {
    const response = await request(app).get('/mission-control-api/process-instances/pi1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'pi1', processDefinitionId: 'pd1' });
  });
});
