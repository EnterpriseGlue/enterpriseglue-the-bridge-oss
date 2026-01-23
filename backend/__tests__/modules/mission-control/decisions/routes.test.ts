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

vi.mock('@shared/middleware/engineAuth.js', () => ({
  requireEngineReadOrWrite: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
}));

vi.mock('../../../../src/modules/mission-control/decisions/service.js', () => ({
  listDecisionDefinitions: vi.fn().mockResolvedValue([]),
  fetchDecisionDefinition: vi.fn().mockResolvedValue({ id: 'd1', key: 'decision1' }),
  fetchDecisionDefinitionXml: vi.fn().mockResolvedValue({ id: 'd1', dmnXml: '<definitions />' }),
  evaluateDecisionById: vi.fn().mockResolvedValue([{ result: 'approved' }]),
  evaluateDecisionByKey: vi.fn().mockResolvedValue([{ result: 'approved' }]),
}));

describe('mission-control decisions routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(decisionsRouter);
    vi.clearAllMocks();
  });

  it('lists decision definitions', async () => {
    const response = await request(app).get('/mission-control-api/decision-definitions');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('evaluates decision', async () => {
    const response = await request(app)
      .post('/mission-control-api/decision-definitions/d1/evaluate')
      .send({ variables: { amount: { value: 10, type: 'Integer' } } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ result: 'approved' }]);
  });
});
