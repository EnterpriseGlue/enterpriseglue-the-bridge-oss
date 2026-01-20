import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import processesRouter from '../../../../src/modules/mission-control/processes/routes.js';

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/middleware/activeEngineAuth.js', () => ({
  requireActiveEngineReadOrWrite: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../../../src/modules/mission-control/processes/service.js', () => ({
  listProcessDefinitions: vi.fn().mockResolvedValue([]),
  getProcessDefinitionById: vi.fn().mockResolvedValue({ id: 'pd1', key: 'process1' }),
  getProcessDefinitionXml: vi.fn().mockResolvedValue({ xml: '<bpmn/>' }),
  startProcessInstance: vi.fn().mockResolvedValue({ id: 'pi1' }),
}));

describe('mission-control processes routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(processesRouter);
    vi.clearAllMocks();
  });

  it.skip('lists process definitions', async () => {
    const response = await request(app).get('/mission-control-api/processes/definitions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it.skip('returns process definition details', async () => {
    const response = await request(app).get('/mission-control-api/processes/definitions/pd1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: 'pd1', key: 'process1' });
  });
});
