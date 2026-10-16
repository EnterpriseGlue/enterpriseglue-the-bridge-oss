import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../packages/backend-host/src/app.js';
import { config } from '@enterpriseglue/shared/config/index.js';
import { rotateXsrfToken, clearXsrfToken } from '../../packages/backend-host/src/utils/xsrf.js';

const getConfigBootstrapStatus = vi.hoisted(() => vi.fn<() => {
  mode: string;
  status: string;
  hash: string | null;
  message: string | null;
  reconciliation: string;
  secretPreflight: string;
  issueCode: string | null;
}>(() => ({
  mode: 'disabled', status: 'disabled', hash: null, message: null, reconciliation: 'not_run', secretPreflight: 'not_required', issueCode: null,
})));
const getConfigBootstrapMetrics = vi.hoisted(() => vi.fn(() => 'enterpriseglue_config_bootstrap_ready 1\n'));
const getEngineTenancyMetrics = vi.hoisted(() => vi.fn(async () => 'enterpriseglue_engine_tenancy_metrics_collection_success 1\n'));
const getLoginExperienceMetrics = vi.hoisted(() => vi.fn(() => 'enterpriseglue_login_experience_total{method="oidc",event="selected"} 1\n'));

vi.mock('../../packages/backend-host/src/services/configBundleBootstrap.js', () => ({ getConfigBootstrapStatus, getConfigBootstrapMetrics }));
vi.mock('../../packages/backend-host/src/services/engineTenancyMetrics.js', () => ({ getEngineTenancyMetrics }));
vi.mock('../../packages/backend-host/src/services/loginExperienceMetrics.js', () => ({ getLoginExperienceMetrics }));

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
    frontendUrl: 'https://app.example.test',

    jwtSecret: 'test-only-application-csrf-secret-00000000',
  },
}));

describe('app', () => {
  afterEach(() => { config.xsrfCookieDomain = undefined; });

  const fixture = () => {
    const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });
    app.post('/xsrf-protected-test', (_req, res) => res.sendStatus(204));
    return app;
  };

  it('issues one readable signed cookie and requires its explicit header and original session', async () => {
    const app = fixture();
    const issued = await request(app).get('/api/csrf-token').set('Cookie', 'accessToken=session-a');
    expect(issued.status).toBe(200);
    const token = issued.headers['x-xsrf-token'];
    expect(token).toBe(issued.body.csrfToken);
    const cookies = issued.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(1);
    const xsrfCookie = cookies[0];
    expect(xsrfCookie).toMatch(/^XSRF-TOKEN=/);
    expect(xsrfCookie).not.toContain('HttpOnly');
    expect(xsrfCookie).not.toContain('Domain=');
    expect(xsrfCookie).toContain('Path=/');
    expect(xsrfCookie).toContain('SameSite=Lax');
    const cookie = `accessToken=session-a; ${xsrfCookie.split(';')[0]}`;
    const send = () => request(app).post('/xsrf-protected-test').set('Cookie', cookie);
    expect((await send().set('X-XSRF-TOKEN', token)).status).toBe(204);
    expect((await send().set('X-CSRF-Token', token)).status).toBe(403);
    expect((await send()).status).toBe(403); // An automatic cookie alone is insufficient.
    expect((await send().set('X-XSRF-TOKEN', 'wrong-token')).status).toBe(403);
    expect((await request(app).post('/xsrf-protected-test').set('Cookie', 'accessToken=session-a').set('X-XSRF-TOKEN', token)).status).toBe(403);
    expect((await request(app).post('/xsrf-protected-test').set('Cookie', cookie.replace('session-a', 'session-b')).set('X-XSRF-TOKEN', token)).status).toBe(403);
    const forged = `${token[0] === 'a' ? 'b' : 'a'}${token.slice(1)}`;
    expect((await request(app).post('/xsrf-protected-test').set('Cookie', `accessToken=session-a; XSRF-TOKEN=${forged}`).set('X-XSRF-TOKEN', forged)).status).toBe(403);
    expect((await send().set('Cookie', `${cookie}; XSRF-TOKEN=${token}`).set('X-XSRF-TOKEN', token)).status).toBe(403);
  });

  it('rotates against the outgoing session immediately and clears the same cookie scope on logout', async () => {
    config.xsrfCookieDomain = 'example.test';
    const app = fixture();
    app.post('/api/auth/login', (req, res) => {
      res.cookie('accessToken', 'access-b', { httpOnly: true });
      res.cookie('refreshToken', 'refresh-b', { httpOnly: true });
      rotateXsrfToken(req, res, 'refresh-b');
      res.sendStatus(204);
    });
    app.post('/api/auth/refresh', (req, res) => {
      rotateXsrfToken(req, res, req.cookies.refreshToken);
      res.sendStatus(204);
    });
    app.post('/api/auth/logout', (_req, res) => { clearXsrfToken(res); res.sendStatus(204); });
    const before = await request(app).get('/api/csrf-token').set('Cookie', 'accessToken=access-a; refreshToken=refresh-a');
    const after = await request(app).post('/api/auth/login').set('Cookie', `accessToken=access-a; refreshToken=refresh-a; XSRF-TOKEN=${before.body.csrfToken}`);
    const token = after.headers['x-xsrf-token'];
    expect(token).toBeTruthy();
    expect(token).not.toBe(before.body.csrfToken);
    const issuedCookies = after.headers['set-cookie'] as unknown as string[];
    expect(issuedCookies.filter((c: string) => c.startsWith('XSRF-TOKEN='))).toHaveLength(1);
    expect(issuedCookies.find((c: string) => c.startsWith('XSRF-TOKEN='))).toContain('Domain=example.test');
    const session = 'accessToken=access-b; refreshToken=refresh-b';
    const send = (proof: string) => request(app).post('/xsrf-protected-test').set('Cookie', `${session}; XSRF-TOKEN=${proof}`).set('X-XSRF-TOKEN', proof);
    expect((await send(token)).status).toBe(204);
    expect((await send(before.body.csrfToken)).status).toBe(403);
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', `${session}; XSRF-TOKEN=${token}`);
    const rotated = refresh.headers['x-xsrf-token'];
    expect(rotated).not.toBe(token);
    expect((await request(app).post('/xsrf-protected-test').set('Cookie', `${session}; XSRF-TOKEN=${rotated}`).set('X-XSRF-TOKEN', token)).status).toBe(403);
    expect((await send(rotated)).status).toBe(204);
    const logout = await request(app).post('/api/auth/logout').set('Cookie', `${session}; XSRF-TOKEN=${rotated}`).set('X-XSRF-TOKEN', rotated);
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie'][0]).toContain('XSRF-TOKEN=; Domain=example.test; Path=/; Expires=Thu, 01 Jan 1970');
  });

  it('allows credentialed preflight for the single XSRF header', async () => {
    const response = await request(fixture()).options('/xsrf-protected-test')
      .set('Origin', 'https://app.example.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-xsrf-token,content-type');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.test');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toContain('x-xsrf-token');
  });

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

  it('exposes bounded Prometheus bootstrap and aggregate tenancy metrics without identifiers', async () => {
    const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toBe([
      'enterpriseglue_config_bootstrap_ready 1',
      'enterpriseglue_engine_tenancy_metrics_collection_success 1',
      'enterpriseglue_login_experience_total{method="oidc",event="selected"} 1',
      '',
    ].join('\n'));
  });
});
