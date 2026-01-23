import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import migrationRouter from '../../../../src/modules/mission-control/migration/routes.js';

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
  requireEngineReadOrWrite: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
}));

vi.mock('../../../../src/modules/mission-control/migration/service.js', () => ({
  generateMigrationPlan: vi.fn().mockResolvedValue({ instructions: [] }),
  validateMigrationPlan: vi.fn().mockResolvedValue({ instructionReports: [] }),
  executeMigration: vi.fn().mockResolvedValue(undefined),
  executeMigrationAsync: vi.fn().mockResolvedValue({ batchId: 'b1' }),
}));

describe('mission-control migration routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(migrationRouter);
    vi.clearAllMocks();
  });

  it('generates migration plan', async () => {
    const response = await request(app)
      .post('/mission-control-api/migration/generate')
      .send({ sourceProcessDefinitionId: 'p1', targetProcessDefinitionId: 'p2' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ instructions: [] });
  });

  it('executes migration async', async () => {
    const response = await request(app)
      .post('/mission-control-api/migration/execute-async')
      .send({ processInstanceIds: ['pi1'] });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ batchId: 'b1' });
  });
});
