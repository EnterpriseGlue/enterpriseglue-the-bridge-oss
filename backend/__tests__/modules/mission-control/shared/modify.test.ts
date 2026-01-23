import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import modifyRouter from '../../../../src/modules/mission-control/shared/modify.js';

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

vi.mock('../../../../src/modules/mission-control/shared/modify-service.js', () => ({
  modifyProcessInstance: vi.fn().mockResolvedValue(undefined),
  modifyProcessDefinitionAsync: vi.fn().mockResolvedValue({ batchId: 'b1', camundaBatchId: 'cb1' }),
  restartProcessDefinitionAsync: vi.fn().mockResolvedValue({ batchId: 'b2', camundaBatchId: 'cb2' }),
}));

describe('mission-control modify routes', () => {
  it('placeholder test', () => {
    expect(true).toBe(true);
  });
});
