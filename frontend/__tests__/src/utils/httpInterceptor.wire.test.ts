import { createServer } from 'node:http';
import { http, passthrough } from 'msw';
import { expect, it, vi } from 'vitest';
import { server as mockServer } from '@test/mocks/server';
import { config } from '@src/config';
import { USER_KEY } from '@src/constants/storageKeys';
import { advanceBrowserSessionRevision, BrowserSessionChangedError } from '@src/utils/browserSession';
import { getAuthHeaders, interceptedFetch } from '@src/utils/httpInterceptor';

// Native loopback HTTP exercises the real apiFetch/interceptor path. These
// fixture responses are not authenticated sessions or live provider evidence.
it.each(['current', 'replacement'] as const)('keeps native refresh/replay bound to the %s session', async mode => {
  const requests: Array<{ url: string; method?: string; body: string; xsrf?: string }> = [];
  let finishRefresh: (() => void) | undefined;
  const fixture = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      requests.push({ url: req.url || '', method: req.method, body: Buffer.concat(chunks).toString(), xsrf: req.headers['x-xsrf-token'] as string | undefined });
      if (req.url === '/api/auth/refresh') {
        finishRefresh = () => {
          if (res.writableEnded || res.destroyed) return;
          res.setHeader('content-type', 'application/json'); res.end('{}');
        };
        if (mode === 'current') finishRefresh();
      } else if (req.url === '/api/probe') {
        res.statusCode = requests.filter(row => row.url === '/api/probe').length === 1 ? 401 : 200;
        res.setHeader('content-type', 'application/json'); res.end('{}');
      } else { res.statusCode = 500; res.end(); }
    });
  });
  fixture.requestTimeout = 5000;
  const previousBase = config.apiBaseUrl;
  let request: Promise<Response | Error> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      fixture.once('error', reject);
      fixture.listen(0, '127.0.0.1', resolve);
    });
    const address = fixture.address();
    if (!address || typeof address === 'string') throw new Error('Owned loopback address unavailable');
    expect(address.address).toBe('127.0.0.1');
    config.apiBaseUrl = `http://127.0.0.1:${address.port}`;
    // Preserve strict MSW handling everywhere outside this owned origin.
    mockServer.use(http.all(`${config.apiBaseUrl}/*`, () => passthrough()));
    window.history.replaceState({}, '', '/dashboard');
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 'fixture-a' }));
    document.cookie = 'XSRF-TOKEN=fixture-token; path=/';
    const body = JSON.stringify({ operation: 'owned-wire-probe' });
    request = interceptedFetch('/api/probe', { method: 'POST', body, headers: getAuthHeaders(), signal: AbortSignal.timeout(5000) }).catch(error => error);
    if (mode === 'replacement') {
      await vi.waitFor(() => expect(finishRefresh).toBeTypeOf('function'));
      localStorage.setItem(USER_KEY, JSON.stringify({ id: 'fixture-b' }));
      advanceBrowserSessionRevision();
      finishRefresh!();
      expect(await request).toBeInstanceOf(BrowserSessionChangedError);
      expect(requests.map(row => row.url)).toEqual(['/api/probe', '/api/auth/refresh']);
      expect(JSON.parse(localStorage.getItem(USER_KEY)!)).toEqual({ id: 'fixture-b' });
    } else {
      const response = await request;
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(200);
      expect(requests.map(row => row.url)).toEqual(['/api/probe', '/api/auth/refresh', '/api/probe']);
      expect(requests.filter(row => row.url === '/api/probe').map(row => row.body)).toEqual([body, body]);
    }
    expect(requests.every(row => row.method === 'POST' && row.xsrf === 'fixture-token')).toBe(true);
  } finally {
    finishRefresh?.();
    fixture.closeAllConnections();
    await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve()));
    if (request) await request;
    config.apiBaseUrl = previousBase;
    localStorage.removeItem(USER_KEY);
    document.cookie = 'XSRF-TOKEN=; max-age=0; path=/';
  }
}, 15_000);
