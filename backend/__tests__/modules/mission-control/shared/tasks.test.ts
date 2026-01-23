import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import tasksRouter from '../../../../src/modules/mission-control/shared/tasks.js';

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

vi.mock('../../../../src/modules/mission-control/shared/tasks-service.js', () => ({
  listTasks: vi.fn().mockResolvedValue([{ id: 't1', name: 'Task 1' }]),
  getTaskById: vi.fn().mockResolvedValue({ id: 't1', name: 'Task 1' }),
  getTaskCountByQuery: vi.fn().mockResolvedValue({ count: 5 }),
  claimTaskById: vi.fn().mockResolvedValue(undefined),
  unclaimTaskById: vi.fn().mockResolvedValue(undefined),
  setTaskAssigneeById: vi.fn().mockResolvedValue(undefined),
  completeTaskById: vi.fn().mockResolvedValue({}),
  getTaskVariablesById: vi.fn().mockResolvedValue({ var1: { value: 'test' } }),
  updateTaskVariablesById: vi.fn().mockResolvedValue({}),
  getTaskFormById: vi.fn().mockResolvedValue({ key: 'form1' }),
}));

describe('mission-control tasks routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(tasksRouter);
    vi.clearAllMocks();
  });

  it('lists tasks', async () => {
    const response = await request(app).get('/mission-control-api/tasks');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('gets task count', async () => {
    const response = await request(app).get('/mission-control-api/tasks/count');

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(5);
  });

  it('gets task by id', async () => {
    const response = await request(app).get('/mission-control-api/tasks/t1');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('t1');
  });

  it('gets task variables', async () => {
    const response = await request(app).get('/mission-control-api/tasks/t1/variables');

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
  });
});
