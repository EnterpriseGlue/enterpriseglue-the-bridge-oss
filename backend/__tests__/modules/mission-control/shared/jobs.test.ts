import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jobsRouter from '../../../../src/modules/mission-control/shared/jobs.js';

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

vi.mock('../../../../src/modules/mission-control/shared/jobs-service.js', () => ({
  listJobs: vi.fn().mockResolvedValue([{ id: 'j1', dueDate: '2024-01-01' }]),
  getJobById: vi.fn().mockResolvedValue({ id: 'j1', dueDate: '2024-01-01' }),
  executeJobById: vi.fn().mockResolvedValue(undefined),
  setJobRetriesById: vi.fn().mockResolvedValue(undefined),
  setJobSuspensionStateById: vi.fn().mockResolvedValue(undefined),
  listJobDefinitions: vi.fn().mockResolvedValue([{ id: 'jd1', activityId: 'task1' }]),
  setJobDefinitionRetriesById: vi.fn().mockResolvedValue(undefined),
  setJobDefinitionSuspensionStateById: vi.fn().mockResolvedValue(undefined),
}));

describe('mission-control jobs routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(jobsRouter);
    vi.clearAllMocks();
  });

  it('lists jobs', async () => {
    const response = await request(app).get('/mission-control-api/jobs');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('gets job by id', async () => {
    const response = await request(app).get('/mission-control-api/jobs/j1');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('j1');
  });

  it('executes job', async () => {
    const response = await request(app).post('/mission-control-api/jobs/j1/execute');

    expect(response.status).toBe(204);
  });
});
