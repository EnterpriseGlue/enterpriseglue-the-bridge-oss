import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import batchesRouter from '../../../../src/modules/mission-control/batches/routes.js';
import { getDataSource } from '../../../../src/shared/db/data-source.js';
import { Batch } from '../../../../src/shared/db/entities/Batch.js';

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

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('../../../../src/modules/mission-control/batches/service.js', () => ({
  processRetries: vi.fn().mockResolvedValue(undefined),
  fetchBatchInfo: vi.fn().mockResolvedValue({ id: 'b1', type: 'delete' }),
  fetchBatchStatistics: vi.fn().mockResolvedValue({ remainingJobs: 0, completedJobs: 10, failedJobs: 0 }),
  fetchJobsByDefinitionIds: vi.fn().mockResolvedValue([]),
  fetchJobStacktrace: vi.fn().mockResolvedValue(null),
  deleteBatch: vi.fn().mockResolvedValue(undefined),
  suspendProcessInstancesBatch: vi.fn().mockResolvedValue({ id: 'camunda-b1' }),
  deleteProcessInstancesBatch: vi.fn().mockResolvedValue({ id: 'camunda-b1' }),
  setBatchSuspended: vi.fn().mockResolvedValue(undefined),
}));

describe('mission-control batches routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(batchesRouter);
    vi.clearAllMocks();
  });

  it('creates delete batch and returns batch id', async () => {
    const batchRepo = { insert: vi.fn().mockResolvedValue(undefined) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Batch) return batchRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .post('/mission-control-api/batches/process-instances/delete')
      .send({ processInstanceIds: ['p1'] });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ type: 'DELETE_INSTANCES' });
    expect(batchRepo.insert).toHaveBeenCalled();
  });
});
