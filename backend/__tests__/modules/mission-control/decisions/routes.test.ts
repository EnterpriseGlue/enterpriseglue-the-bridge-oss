import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import decisionsRouter from '../../../../src/modules/mission-control/decisions/routes.js';

vi.mock('@shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@shared/middleware/activeEngineAuth.js', () => ({
  requireActiveEngineReadOrWrite: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../../../src/modules/mission-control/decisions/service.js', () => ({
  listDecisionDefinitions: vi.fn().mockResolvedValue([]),
  getDecisionDefinitionById: vi.fn().mockResolvedValue({ id: 'd1', key: 'decision1' }),
  listHistoricDecisionInstances: vi.fn().mockResolvedValue([]),
  evaluateDecision: vi.fn().mockResolvedValue([{ result: 'approved' }]),
}));

describe('mission-control decisions routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(decisionsRouter);
    vi.clearAllMocks();
  });

  it.skip('lists decision definitions', async () => {
    const response = await request(app).get('/mission-control-api/decisions/definitions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it.skip('evaluates decision', async () => {
    const response = await request(app)
      .post('/mission-control-api/decisions/evaluate')
      .send({ decisionDefinitionKey: 'decision1', variables: { amount: 10 } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ result: 'approved' }]);
  });
});
