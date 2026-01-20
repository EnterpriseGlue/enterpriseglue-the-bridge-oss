import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn().mockResolvedValue({
    getRepository: vi.fn(),
    initialize: vi.fn(),
  }),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@shared/middleware/tenant.js', () => ({
  tenantMiddleware: (_req: any, _res: any, next: any) => next(),
  resolveTenantContext: () => (_req: any, _res: any, next: any) => next(),
  requireTenantRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@shared/config/index.js', () => ({
  config: {
    nodeEnv: 'test',
    port: 8787,
    multiTenant: false,
  },
}));

describe('app', () => {
  it('responds to health endpoint', async () => {
    const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
