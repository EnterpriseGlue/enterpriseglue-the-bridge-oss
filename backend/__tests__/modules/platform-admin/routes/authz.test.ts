import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import authzRouter from '../../../../../packages/backend-host/src/modules/platform-admin/routes/authz.js';

vi.mock('@enterpriseglue/shared/middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'user-1', platformRole: 'admin' };
    next();
  },
}));

vi.mock('@enterpriseglue/shared/middleware/platformAuth.js', () => ({
  isPlatformAdmin: vi.fn().mockReturnValue(true),
}));

vi.mock('@enterpriseglue/shared/services/platform-admin/index.js', () => ({
  policyService: {
    evaluateAndLog: vi.fn().mockResolvedValue({ decision: 'allow', reason: 'User is admin' }),
  },
  ssoClaimsMappingService: {},
  Permission: {},
  EvaluationContext: {},
}));

describe('platform-admin authz routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.disable('x-powered-by');
    app.use(express.json());
    app.use(authzRouter);
    vi.clearAllMocks();
  });

  it('checks authorization', async () => {
    const response = await request(app)
      .post('/api/authz/check')
      .send({ action: 'read', resourceType: 'project', resourceId: 'p1' });

    expect(response.status).toBe(200);
    expect(response.body.allowed).toBeDefined();
  });
});
