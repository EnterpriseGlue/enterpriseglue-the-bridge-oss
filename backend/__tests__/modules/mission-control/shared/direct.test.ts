import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import directRouter from '../../../../src/modules/mission-control/shared/direct.js';

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/middleware/engineAuth.js', () => ({
  requireEngineDeployer: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
}));

vi.mock('../../../../src/modules/mission-control/shared/direct-service.js', () => ({
  deleteProcessInstancesDirect: vi.fn().mockResolvedValue([{ id: 'i1', ok: true }]),
  suspendActivateProcessInstancesDirect: vi.fn().mockResolvedValue([{ id: 'i1', ok: true }]),
  setJobRetriesDirect: vi.fn().mockResolvedValue([{ id: 'j1', ok: true }]),
  executeMigrationDirect: vi.fn().mockResolvedValue({ success: true }),
}));

describe('mission-control direct routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(directRouter);
    vi.clearAllMocks();
  });

  it('deletes process instances directly', async () => {
    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/delete')
      .send({ processInstanceIds: ['i1', 'i2'], deleteReason: 'test' });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeDefined();
  });

  it('suspends process instances directly', async () => {
    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/suspend')
      .send({ processInstanceIds: ['i1'] });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeDefined();
  });

  it('activates process instances directly', async () => {
    const response = await request(app)
      .post('/mission-control-api/direct/process-instances/activate')
      .send({ processInstanceIds: ['i1'] });

    expect(response.status).toBe(200);
    expect(response.body.total).toBeDefined();
  });
});
