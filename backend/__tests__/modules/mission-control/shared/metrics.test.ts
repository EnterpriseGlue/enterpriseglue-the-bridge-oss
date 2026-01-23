import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import metricsRouter from '../../../../src/modules/mission-control/shared/metrics.js';

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

vi.mock('../../../../src/modules/mission-control/shared/metrics-service.js', () => ({
  listMetrics: vi.fn().mockResolvedValue([{ name: 'activity-instance-start', value: 100 }]),
  getMetric: vi.fn().mockResolvedValue({ name: 'activity-instance-start', value: 100 }),
}));

describe('mission-control metrics routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(metricsRouter);
    vi.clearAllMocks();
  });

  it('lists metrics', async () => {
    const response = await request(app).get('/mission-control-api/metrics');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it('gets specific metric by name', async () => {
    const response = await request(app).get('/mission-control-api/metrics/activity-instance-start');

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('activity-instance-start');
  });
});
