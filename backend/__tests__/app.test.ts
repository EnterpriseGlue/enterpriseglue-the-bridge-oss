import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../packages/backend-host/src/app.js';

const getConfigBootstrapStatus = vi.hoisted(() => vi.fn(() => ({
  mode: 'disabled', status: 'disabled', hash: null, message: null, reconciliation: 'not_run', secretPreflight: 'not_required', issueCode: null,
})));
const getConfigBootstrapMetrics = vi.hoisted(() => vi.fn(() => 'enterpriseglue_config_bootstrap_ready 1\n'));

vi.mock('../../packages/backend-host/src/services/configBundleBootstrap.js', () => ({ getConfigBootstrapStatus, getConfigBootstrapMetrics }));

vi.mock('@enterpriseglue/shared/db/data-source.js', () => ({
  getDataSource: vi.fn().mockResolvedValue({
    getRepository: vi.fn(),
    initialize: vi.fn(),
  }),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@enterpriseglue/shared/middleware/tenant.js', () => ({
  tenantMiddleware: (_req: any, _res: any, next: any) => next(),
  resolveTenantContext: () => (_req: any, _res: any, next: any) => next(),
  requireTenantRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('@enterpriseglue/shared/config/index.js', () => ({
  shouldUseSecureCookies: () => false,
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
    expect(response.body).toEqual({
      status: 'ok',
      configBootstrap: { mode: 'disabled', status: 'disabled', hash: null, message: null, reconciliation: 'not_run', secretPreflight: 'not_required', issueCode: null },
    });
  });

  it('responds to readiness endpoint when configuration bootstrap is healthy', async () => {
    const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });
    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      configBootstrap: { mode: 'disabled', status: 'disabled', hash: null, message: null, reconciliation: 'not_run', secretPreflight: 'not_required', issueCode: null },
    });
  });

  it('keeps readiness closed when required identity reconciliation did not complete', async () => {
    getConfigBootstrapStatus.mockReturnValueOnce({
      mode: 'apply', status: 'failed', hash: 'bundle-hash', message: 'Configuration bundle identity reconciliation failed', reconciliation: 'pending', secretPreflight: 'passed', issueCode: 'identity_reconciliation_failed',
    });
    const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });
    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      configBootstrap: {
        mode: 'apply', status: 'failed', hash: 'bundle-hash', message: 'Configuration bundle identity reconciliation failed', reconciliation: 'pending', secretPreflight: 'passed', issueCode: 'identity_reconciliation_failed',
      },
    });
  });

  it('exposes bounded Prometheus bootstrap metrics without JSON status details', async () => {
    const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toBe('enterpriseglue_config_bootstrap_ready 1\n');
  });
});
