import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

vi.mock('@shared/db/data-source.js', () => ({
  getDataSource: vi.fn(),
  initializeDatabase: vi.fn(),
}));

vi.mock('@shared/middleware/tenant.js', () => ({
  tenantMiddleware: (_req: any, _res: any, next: any) => next(),
  resolveTenantContext: () => (_req: any, _res: any, next: any) => next(),
}));

describe('app', () => {
  it.skip('responds to health endpoint', async () => {
    const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
