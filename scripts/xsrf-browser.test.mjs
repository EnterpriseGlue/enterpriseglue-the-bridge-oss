import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from '@playwright/test';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const viteRequire = createRequire(frontendRequire.resolve('vite'));
const { build } = viteRequire('esbuild');

async function listen(server, hostname) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://${hostname}:${server.address().port}`;
}

test('browser echoes one app-issued cookie and rereads it after login, refresh and session rotation', { timeout: 60_000 }, async (t) => {
  Object.assign(process.env, {
    NODE_ENV: 'test', EG_LOAD_ENV_IN_TESTS: 'false', DATABASE_TYPE: 'postgres',
    POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '5432', POSTGRES_USER: 'xsrf_test',
    POSTGRES_PASSWORD: 'xsrf_test', POSTGRES_DATABASE: 'xsrf_test', POSTGRES_SCHEMA: 'main',
    JWT_SECRET: 'browser-test-only-jwt-secret-000000000000000000000',
    ADMIN_PASSWORD: 'browser-test-only-password',
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    EG_XSRF_COOKIE_DOMAIN: 'xsrf.test', FRONTEND_URL: 'http://app.xsrf.test',
  });
  const { config } = await import('../packages/shared/dist/config/index.js');
  const intervals = [];
  const originalSetInterval = globalThis.setInterval;
  const tracker = t.mock.method(globalThis, 'setInterval', (...args) => {
    const handle = originalSetInterval(...args); intervals.push(handle); return handle;
  });
  t.after(() => { for (const handle of intervals) clearInterval(handle); });
  let createApp;
  try { ({ createApp } = await import('../packages/backend-host/dist/app.js')); }
  finally { tracker.mock.restore(); }
  const { rotateXsrfToken, clearXsrfToken } = await import('../packages/backend-host/dist/utils/xsrf.js');
  const bundle = await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    stdin: { contents: `
      import { initRuntimeConfig } from './packages/frontend-host/src/runtimeConfig.ts';
      import { apiClient } from './packages/frontend-host/src/shared/api/client.ts';
      import { initializeTenancyCapabilities } from './packages/frontend-host/src/services/tenancy.ts';
      window.apiClient = apiClient;
      window.ready = initRuntimeConfig().then(() => initializeTenancyCapabilities());
    `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_RUNTIME_CONFIG_URL: '/config.json' }), 'process.env.NODE_ENV': '"test"' },
    logLevel: 'silent',
  });
  let apiOrigin = '';
  let redirectReached = false;
  const frontend = createServer((req, res) => {
    if (req.url === '/token-sink') { redirectReached = true; res.end('unexpected redirect'); return; }
    if (req.url === '/client.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === '/config.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ apiBaseUrl: apiOrigin })); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Application XSRF transport</title><script type="module" src="/client.js"></script>');
  });
  const frontendOrigin = await listen(frontend, 'app.xsrf.test');
  t.after(() => { frontend.closeAllConnections(); frontend.close(); });
  config.frontendUrl = frontendOrigin;
  const observed = [];
  let expireNextRequest = false;
  let refreshCount = 0;
  const app = createApp({ registerRoutes: false, includeDocs: false, includeRateLimiting: false });
  // Observation precedes CORS so the real browser's preflight is included.
  const backend = createServer((req, res) => {
    observed.push({ method: req.method, path: req.url, token: req.headers['x-xsrf-token'], cookie: req.headers.cookie, preflight: req.headers['access-control-request-headers'], legacy: req.headers['x-csrf-token'] });
    app(req, res);
  });
  apiOrigin = await listen(backend, 'api.xsrf.test');
  t.after(() => { backend.closeAllConnections(); backend.close(); });
  app.get('/api/tenancy/capabilities', (_req, res) => res.json({ mode: 'single' }));
  // These fixture endpoints exercise production token issuance/middleware without database access.
  const issueSession = (req, res, refreshToken) => {
    res.cookie('accessToken', 'test-access', { httpOnly: true, path: '/', sameSite: 'lax' });
    res.cookie('refreshToken', refreshToken, { httpOnly: true, path: '/', sameSite: 'lax' });
    rotateXsrfToken(req, res, refreshToken);
  };
  app.post('/api/auth/login', (req, res) => { issueSession(req, res, 'session-a'); res.json({ loggedIn: true }); });
  app.post('/api/auth/refresh', (req, res) => {
    refreshCount++;
    rotateXsrfToken(req, res, req.cookies.refreshToken);
    res.json({ refreshed: true });
  });
  app.post('/api/protected-test', (_req, res) => {
    if (expireNextRequest) { expireNextRequest = false; res.sendStatus(401); return; }
    res.json({ accepted: true });
  });
  app.post('/api/replace-session', (req, res) => { issueSession(req, res, 'session-b'); res.json({ replaced: true }); });
  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('accessToken', { path: '/' }); res.clearCookie('refreshToken', { path: '/' }); clearXsrfToken(res); res.sendStatus(204);
  });
  app.get('/api/redirect-test', (_req, res) => res.redirect(`${frontendOrigin}/token-sink`));
  const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP *.xsrf.test 127.0.0.1', '--no-proxy-server'] });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(frontendOrigin);
  await page.evaluate(() => window.ready);
  const cookieValue = () => page.evaluate(() => decodeURIComponent(document.cookie.split('; ').find((cookie) => cookie.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length) ?? ''));
  const anonymous = await cookieValue();
  assert.ok(anonymous);
  const post = () => page.evaluate(() => window.apiClient.post('/api/protected-test', {}));
  await page.evaluate(() => window.apiClient.post('/api/auth/login', {}));
  const loggedIn = await cookieValue();
  assert.notEqual(loggedIn, anonymous);
  const cookies = await context.cookies(apiOrigin);
  assert.deepEqual(cookies.map((cookie) => cookie.name).sort(), ['XSRF-TOKEN', 'accessToken', 'refreshToken'].sort());
  assert.equal(cookies.find((cookie) => cookie.name === 'XSRF-TOKEN').httpOnly, false);
  assert.ok(cookies.filter((cookie) => ['accessToken', 'refreshToken'].includes(cookie.name)).every((cookie) => cookie.httpOnly));
  assert.equal(await page.evaluate(() => /(?:accessToken|refreshToken)=/.test(document.cookie)), false);
  assert.deepEqual(await post(), { accepted: true });
  assert.equal(observed.at(-1).token, loggedIn);
  assert.ok(observed.at(-1).cookie.includes(`XSRF-TOKEN=${loggedIn}`));
  // Cookie-only, wrong header, and a matching cookie/header with a forged signature all fail.
  const rawPost = (token) => page.evaluate(async ({ apiOrigin, token }) => (await fetch(`${apiOrigin}/api/protected-test`, {
    method: 'POST', credentials: 'include', headers: token === null ? {} : { 'X-XSRF-TOKEN': token },
  })).status, { apiOrigin, token });
  assert.equal(await rawPost(null), 403);
  assert.equal(await rawPost('wrong-token'), 403);
  const forged = `${loggedIn[0] === 'a' ? 'b' : 'a'}${loggedIn.slice(1)}`;
  await context.addCookies([{ name: 'XSRF-TOKEN', value: forged, domain: '.xsrf.test', path: '/' }]);
  assert.equal(await rawPost(forged), 403);
  await context.addCookies([{ name: 'XSRF-TOKEN', value: loggedIn, domain: '.xsrf.test', path: '/' }]);
  expireNextRequest = true;
  assert.deepEqual(await post(), { accepted: true });
  const refreshed = await cookieValue();
  assert.notEqual(refreshed, loggedIn);
  assert.equal(refreshCount, 1);
  assert.equal(observed.at(-1).token, refreshed);
  assert.equal(await rawPost(loggedIn), 403);
  await page.evaluate(() => window.apiClient.post('/api/replace-session', {}));
  const newSession = await cookieValue();
  assert.notEqual(newSession, refreshed);
  await context.addCookies([{ name: 'XSRF-TOKEN', value: refreshed, domain: '.xsrf.test', path: '/' }]);
  assert.equal(await rawPost(refreshed), 403); // Even matching copies cannot cross sessions.
  await context.addCookies([{ name: 'XSRF-TOKEN', value: newSession, domain: '.xsrf.test', path: '/' }]);
  assert.deepEqual(await post(), { accepted: true });
  assert.equal(await page.evaluate(async () => {
    try { await window.apiClient.get('/api/redirect-test'); return false; } catch { return true; }
  }), true);
  assert.equal(redirectReached, false);
  await context.clearCookies({ name: 'XSRF-TOKEN' });
  assert.equal(await rawPost(newSession), 403);
  await page.evaluate(() => window.apiClient.get('/api/csrf-token'));
  assert.deepEqual(await post(), { accepted: true });
  await page.evaluate(() => window.apiClient.post('/api/auth/logout', {}));
  assert.equal(await cookieValue(), '');
  assert.ok(observed.some((req) => req.method === 'OPTIONS' && req.preflight?.includes('x-xsrf-token')));
  assert.ok(observed.every((req) => !req.legacy && !req.preflight?.includes('x-csrf-token')));
  assert.deepEqual(errors, []);
});
