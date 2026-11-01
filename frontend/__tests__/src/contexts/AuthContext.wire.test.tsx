import React from 'react';
import { createServer } from 'node:http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, passthrough } from 'msw';
import { expect, it, vi } from 'vitest';
import { server as mockServer } from '@test/mocks/server';
import { AuthProvider } from '@src/contexts/AuthContext';
import { useAuth } from '@src/shared/hooks/useAuth';
import { config } from '@src/config';
import { USER_KEY } from '@src/constants/storageKeys';

vi.mock('@src/shared/hooks/useActivityMonitor', () => ({ useActivityMonitor: vi.fn() }));

const user = {
  id: 'wire-user', email: 'wire-user@example.test', platformRole: 'user',
  isActive: true, isEmailVerified: true, mustResetPassword: false, createdAt: 1,
  session: { principal: { type: 'user', id: 'wire-user' }, tenant: { id: null } },
};

// Exercise the real provider -> service -> API client -> interceptor -> HTTP
// composition. The owned loopback server supplies synthetic session responses.
it.each([
  { path: '/dashboard', status: 401, replayStatus: 200, authenticated: true, meReads: 2, refreshes: 1 },
  { path: '/dashboard', status: 401, replayStatus: 401, authenticated: false, meReads: 2, refreshes: 1 },
  { path: '/login', status: 401, replayStatus: 200, authenticated: true, meReads: 2, refreshes: 1 },
  { path: '/login', status: 401, replayStatus: 401, authenticated: false, meReads: 2, refreshes: 1 },
  { path: '/t/alpha/login', status: 401, replayStatus: 200, authenticated: true, meReads: 2, refreshes: 1 },
  { path: '/t/alpha/login', nextPath: '/t/beta/login', status: 401, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
  { path: '/t/alpha/login', nextPath: '/t/beta/login', status: 200, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
  { path: '/t/alpha/login', nextPath: '/t/beta/login', switchOn: 'refresh', status: 401, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 1 },
  { path: '/dashboard', status: 401, refreshStatus: 401, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 1 },
  { path: '/dashboard', status: 401, refreshStatus: 503, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 1 },
  { path: '/login', status: 401, refreshStatus: 401, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 1 },
  { path: '/login', status: 401, refreshStatus: 503, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 1 },
  { path: '/dashboard', status: 200, brokenJson: true, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
  { path: '/login', status: 200, brokenJson: true, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
  { path: '/dashboard', status: 403, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
  { path: '/login', status: 403, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
  { path: '/dashboard', status: 503, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
  { path: '/login', status: 503, replayStatus: 200, authenticated: false, meReads: 1, refreshes: 0 },
])('bounds bootstrap refresh for %j', async scenario => {
  const requests: Array<{ path: string; method: string; tenant: string | undefined }> = [];
  let meReads = 0;
  const tenantId = scenario.path.startsWith('/t/alpha/') ? 'tenant-alpha' : null;
  const currentUser = { ...user, session: { ...user.session, tenant: { id: tenantId } } };
  const fixture = createServer((req, res) => {
    requests.push({ path: req.url || '', method: req.method || '', tenant: req.headers['x-tenant-slug'] as string | undefined });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/auth/me') {
      meReads += 1;
      if (meReads === 1 && scenario.nextPath && scenario.switchOn !== 'refresh') window.history.replaceState({}, '', scenario.nextPath);
      res.statusCode = meReads === 1 ? scenario.status : scenario.replayStatus;
      res.end(scenario.brokenJson ? '{' : JSON.stringify(res.statusCode === 200 ? currentUser : { error: 'Synthetic session failure' }));
    } else if (req.url === '/api/auth/refresh') {
      if (scenario.nextPath && scenario.switchOn === 'refresh') window.history.replaceState({}, '', scenario.nextPath);
      res.statusCode = scenario.refreshStatus ?? 200;
      res.end(JSON.stringify({ expiresIn: 3600 }));
    } else if (req.url === '/api/authz/me/permissions') {
      res.end(JSON.stringify({
        userId: user.id, tenantId, platform: ['platform:dashboard:view'],
        projects: [], engines: [], authorizationVersion: 'wire-v1', generatedAt: 1,
      }));
    } else {
      res.statusCode = 500; res.end(JSON.stringify({ error: 'Unexpected fixture route' }));
    }
  });
  fixture.requestTimeout = 5000;
  const previousBase = config.apiBaseUrl;
  const previousPath = window.location.pathname;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let unmount: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve);
    });
    const address = fixture.address();
    if (!address || typeof address === 'string') throw new Error('Owned loopback address unavailable');
    expect(address.address).toBe('127.0.0.1');
    config.apiBaseUrl = `http://127.0.0.1:${address.port}`;
    mockServer.use(http.all(`${config.apiBaseUrl}/*`, () => passthrough()));
    window.history.replaceState({}, '', scenario.path);
    localStorage.removeItem(USER_KEY);
    const hook = renderHook(() => useAuth(), { wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}><AuthProvider>{children}</AuthProvider></QueryClientProvider>
    ) });
    unmount = hook.unmount;
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(requests.filter(row => row.path === '/api/auth/refresh')).toHaveLength(scenario.refreshes);
    expect(meReads).toBe(scenario.meReads);
    expect(hook.result.current.isAuthenticated).toBe(scenario.authenticated);
    expect(requests.filter(row => row.path === '/api/authz/me/permissions')).toHaveLength(scenario.authenticated ? 1 : 0);
    expect(requests.every(row => row.method === (row.path === '/api/auth/refresh' ? 'POST' : 'GET'))).toBe(true);
    expect(requests.every(row => row.tenant === (tenantId ? 'alpha' : 'default'))).toBe(true);
  } finally {
    unmount?.(); queryClient.clear();
    fixture.closeAllConnections();
    await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve()));
    config.apiBaseUrl = previousBase;
    window.history.replaceState({}, '', previousPath);
    localStorage.removeItem(USER_KEY);
  }
}, 15_000);
