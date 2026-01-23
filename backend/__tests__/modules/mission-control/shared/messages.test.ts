import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import messagesRouter from '../../../../src/modules/mission-control/shared/messages.js';

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

vi.mock('../../../../src/modules/mission-control/shared/messages-service.js', () => ({
  sendMessage: vi.fn().mockResolvedValue([{ id: 'i1', processInstanceId: 'pi1' }]),
  sendSignal: vi.fn().mockResolvedValue(undefined),
}));

describe('mission-control messages routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(messagesRouter);
    vi.clearAllMocks();
  });

  it('correlates message', async () => {
    const response = await request(app)
      .post('/mission-control-api/messages')
      .send({ messageName: 'TestMessage', businessKey: 'test-key' });

    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
  });

  it('delivers signal', async () => {
    const response = await request(app)
      .post('/mission-control-api/signals')
      .send({ name: 'TestSignal' });

    expect(response.status).toBe(204);
  });
});
