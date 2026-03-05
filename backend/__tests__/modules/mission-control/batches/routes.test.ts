import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import batchesRouter from '../../../../../packages/backend-host/src/modules/mission-control/batches/routes.js';
import { getDataSource } from '@enterpriseglue/shared/db/data-source.js';
import { Batch } from '@enterpriseglue/shared/db/entities/Batch.js';
import { markBatchPollerViewer } from '../../../../../packages/backend-host/src/poller/batchPoller.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/engineAuth.js', () => ({
  requireEngineReadOrWrite: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
  requireEngineDeployer: () => (req: any, _res: any, next: any) => {
    req.engineId = 'engine-1';
    next();
  },
}));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
}));

vi.mock('../../../../../packages/backend-host/src/modules/mission-control/batches/service.js', () => ({
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

vi.mock('../../../../../packages/backend-host/src/poller/batchPoller.js', () => ({
  markBatchPollerViewer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@enterpriseglue/shared/services/pii/PiiRedactionService.js', () => ({
  piiRedactionService: {
    redactPayload: vi.fn().mockImplementation(async (_req: any, payload: any) => payload),
  },
}));

describe('mission-control batches routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
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

  it('marks the batch poller viewer on list fetch', async () => {
    const batchRepo = { find: vi.fn().mockResolvedValue([]) };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Batch) return batchRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .get('/mission-control-api/batches?engineId=engine-1');

    expect(response.status).toBe(200);
    expect(markBatchPollerViewer as unknown as Mock).toHaveBeenCalled();
  });

  it('marks the batch poller viewer on detail fetch', async () => {
    const batchRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: 'batch-1',
        engineId: 'engine-1',
        status: 'RUNNING',
        camundaBatchId: null,
        metadata: null,
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    (getDataSource as unknown as Mock).mockResolvedValue({
      getRepository: (entity: unknown) => {
        if (entity === Batch) return batchRepo;
        throw new Error('Unexpected repository');
      },
    });

    const response = await request(app)
      .get('/mission-control-api/batches/batch-1?engineId=engine-1');

    expect(response.status).toBe(200);
    expect(markBatchPollerViewer as unknown as Mock).toHaveBeenCalled();
  });
});
