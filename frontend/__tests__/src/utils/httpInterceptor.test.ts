import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interceptedFetch, getAuthHeaders } from '@src/utils/httpInterceptor';
import { USER_KEY } from '@src/constants/storageKeys';
import { getTenancyCapabilities } from '@src/services/tenancy';

vi.mock('@src/services/tenancy', () => ({
  getTenancyCapabilities: vi.fn(() => ({ mode: 'single' })),
}));

// Test fixture tokens — not real secrets (CWE-547)
const TEST_REFRESHED_TOKEN = `test-refreshed-${Date.now()}`;

vi.mock('@src/shared/api/apiErrorUtils', () => ({
  getErrorMessageFromResponse: vi.fn().mockResolvedValue('Error message'),
}));

describe('httpInterceptor', () => {
  let originalLocation: Location;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getTenancyCapabilities).mockReturnValue({ mode: 'single' } as ReturnType<typeof getTenancyCapabilities>);
    originalLocation = window.location;
    delete (window as any).location;
    window.location = {
      pathname: '/dashboard',
      origin: 'http://localhost',
      href: 'http://localhost/dashboard',
    } as any;
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  describe('getAuthHeaders', () => {
    it('rereads the app cookie after refresh instead of reusing caller headers', async () => {
      const cookie = vi.spyOn(document, 'cookie', 'get').mockReturnValue('XSRF-TOKEN=before');
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockImplementationOnce(async () => { cookie.mockReturnValue('XSRF-TOKEN=after'); return new Response('{}'); })
        .mockResolvedValueOnce(new Response('{}'));
      await interceptedFetch('/api/data', { method: 'POST', headers: { 'X-XSRF-TOKEN': 'stale', 'Custom-Header': 'preserved' } });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-XSRF-TOKEN')).toBe('before');
      const retry = new Headers(fetchMock.mock.calls[2][1]?.headers);
      expect(retry.get('X-XSRF-TOKEN')).toBe('after');
      expect(retry.get('Custom-Header')).toBe('preserved');
    });
    it('does not invent a tenant hint on unprefixed pooled pages', () => {
      vi.mocked(getTenancyCapabilities).mockReturnValue({ mode: 'pooled' } as ReturnType<typeof getTenancyCapabilities>);
      expect(getAuthHeaders()['X-Tenant-Slug']).toBeUndefined();
      window.location.pathname = '/t/alpha/dashboard';
      expect(getAuthHeaders()['X-Tenant-Slug']).toBe('alpha');
    });
    it('returns basic headers when no auth', () => {
      const headers = getAuthHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Authorization).toBeUndefined();
    });

    it('includes X-Tenant-Slug header with default tenant', () => {
      const headers = getAuthHeaders();
      expect(headers['X-Tenant-Slug']).toBe('default');
    });

    it('includes tenant slug from pathname', () => {
      window.location.pathname = '/t/acme/dashboard';
      const headers = getAuthHeaders();
      expect(headers['X-Tenant-Slug']).toBe('acme');
    });

    it('ignores response token headers and reads the cookie at dispatch', async () => {
      const cookie = vi.spyOn(document, 'cookie', 'get').mockReturnValue('XSRF-TOKEN=from-cookie');
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { headers: { 'X-XSRF-TOKEN': 'from-header' } }));
      await interceptedFetch('/api/test');
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-XSRF-TOKEN')).toBe('from-cookie');
      cookie.mockReturnValue('');
      await interceptedFetch('/api/test');
      expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has('X-XSRF-TOKEN')).toBe(false);
    });

    it('handles URL-encoded tenant slugs', () => {
      window.location.pathname = '/t/my%20company/dashboard';
      const headers = getAuthHeaders();
      expect(headers['X-Tenant-Slug']).toBe('my company');
    });
  });

  describe('interceptedFetch', () => {
    it('uses the canonical tenant API route for identity-provider administration', async () => {
      window.location.pathname = '/t/alpha/admin/settings';
      const response = new Response(JSON.stringify([]), { status: 200 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      await interceptedFetch('/api/identity/providers/tenant-sso/test-connection');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/t/alpha/identity/providers/tenant-sso/test-connection',
        expect.objectContaining({ credentials: 'include', redirect: 'error' }),
      );
    });

    it('uses the canonical tenant API route for write-only identity-provider secrets', async () => {
      window.location.pathname = '/t/alpha/admin/settings';
      const response = new Response(JSON.stringify({}), { status: 201 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      await interceptedFetch('/api/identity/provider-secrets', { method: 'POST' });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/t/alpha/identity/provider-secrets',
        expect.objectContaining({ method: 'POST', credentials: 'include' }),
      );
    });

    it.each(['','/test'])('routes tenant SSO connection requests through the native tenant API: %s',async suffix=>{
      vi.mocked(getTenancyCapabilities).mockReturnValue({mode:'pooled'} as ReturnType<typeof getTenancyCapabilities>);
      window.location.pathname='/t/alpha/admin/settings/identity-providers';
      const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200}));
      await interceptedFetch(`/api/identity/sso-connection${suffix}`);
      expect(fetch).toHaveBeenCalledWith(`/api/t/alpha/identity/sso-connection${suffix}`,expect.objectContaining({credentials:'include'}));
    });
    it('keeps proxy approval platform-scoped and preserves verified-host tenant routing',async()=>{
      vi.mocked(getTenancyCapabilities).mockReturnValue({mode:'pooled'} as ReturnType<typeof getTenancyCapabilities>);
      const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200}));
      window.location.pathname='/t/alpha/admin/settings/identity-providers';
      await interceptedFetch('/api/identity/sso-proxy-catalogue');expect(fetch.mock.calls[0][0]).toBe('/api/identity/sso-proxy-catalogue');
      window.location.pathname='/admin/settings/identity-providers';
      await interceptedFetch('/api/identity/sso-connection');expect(fetch.mock.calls[1][0]).toBe('/api/identity/sso-connection');
    });

    it('passes through successful requests', async () => {
      const response = new Response(JSON.stringify({ data: 'test' }), { status: 200 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const result = await interceptedFetch('/api/data');

      expect(result.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith('/api/data', expect.objectContaining({ credentials: 'include' }));
    });

    it('does not intercept auth endpoints', async () => {
      const response = new Response(null, { status: 401 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const result = await interceptedFetch('/api/auth/login');

      expect(result.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not intercept on public routes', async () => {
      window.location.pathname = '/login';
      const response = new Response(null, { status: 401 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const result = await interceptedFetch('/api/data');

      expect(result.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['/signup', '/signup/'])(
      'keeps signup route %s public when a request returns 401',
      async (path) => {
        window.location.pathname = path;
        const response = new Response(null, { status: 401 });
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

        const result = await interceptedFetch('/api/auth/me');

        expect(result.status).toBe(401);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(window.location.href).toBe('http://localhost/dashboard');
      },
    );

    it('does not treat a protected route with a public-looking prefix as public', async () => {
      window.location.pathname = '/login-history';
      const first401 = new Response(null, { status: 401 });
      const refreshFail = new Response(null, { status: 401 });
      const fetchMock = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(first401)
        .mockResolvedValueOnce(refreshFail);

      await interceptedFetch('/api/data');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(window.location.href).toBe('/t/default/login');
    });

    it.each(['/reset-password', '/t/acme/reset-password'])(
      'refreshes an expired session on protected password-reset route %s',
      async (path) => {
        window.location.pathname = path;
        const fetchMock = vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(new Response(null, { status: 401 }))
          .mockResolvedValueOnce(new Response('{}', { status: 200 }))
          .mockResolvedValueOnce(new Response('{}', { status: 200 }));

        const result = await interceptedFetch('/api/data');

        expect(result.status).toBe(200);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
          '/api/data',
          '/api/auth/refresh',
          '/api/data',
        ]);
      },
    );

    it('does not intercept on tenant public routes', async () => {
      window.location.pathname = '/t/acme/login';
      const response = new Response(null, { status: 401 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const result = await interceptedFetch('/api/data');
      
      expect(result.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    describe('token refresh on 401', () => {
      it('keeps pooled hostname routing through refresh and retry', async () => {
        vi.mocked(getTenancyCapabilities).mockReturnValue({ mode: 'pooled' } as ReturnType<typeof getTenancyCapabilities>);
        const fetchMock = vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(new Response(null, { status: 401 }))
          .mockResolvedValueOnce(new Response('{}', { status: 200 }))
          .mockResolvedValueOnce(new Response('{}', { status: 200 }));

        const result = await interceptedFetch('/engines-api/engines', { headers: getAuthHeaders() });

        expect(result.status).toBe(200);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
          '/engines-api/engines', '/api/auth/refresh', '/engines-api/engines',
        ]);
        for (const [, init] of fetchMock.mock.calls) {
          expect(new Headers(init?.headers).has('X-Tenant-Slug')).toBe(false);
          expect(init?.credentials).toBe('include');
        }
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });

      it('keeps the current pooled hostname login route after refresh rejection', async () => {
        vi.mocked(getTenancyCapabilities).mockReturnValue({ mode: 'pooled' } as ReturnType<typeof getTenancyCapabilities>);
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 401 }));

        await interceptedFetch('/api/data');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).has('X-Tenant-Slug')).toBe(false);
        expect(window.location.href).toBe('/login');
      });

      it('refreshes token and retries request', async () => {
        window.location.pathname = '/t/alpha/dashboard';
        const first401 = new Response(null, { status: 401 });
        const refreshSuccess = new Response(JSON.stringify({ expiresIn: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
        const retrySuccess = new Response(JSON.stringify({ data: 'success' }), { status: 200 });

        const fetchMock = vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(first401)
          .mockResolvedValueOnce(refreshSuccess)
          .mockResolvedValueOnce(retrySuccess);

        const result = await interceptedFetch('/api/data');

        expect(result.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/refresh');
        expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('x-tenant-slug')).toBe('alpha');
        expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('x-tenant-slug')).toBe('alpha');
      });

      it('redirects to login on failed refresh', async () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: 'user-1' }));
        const first401 = new Response(null, { status: 401 });
        const refreshFail = new Response(null, { status: 401 });
        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(first401)
          .mockResolvedValueOnce(refreshFail);

        await interceptedFetch('/api/data');

        expect(localStorage.getItem(USER_KEY)).toBeNull();
        expect(window.location.href).toBe('/t/default/login');
      });

      it('redirects to tenant login when on tenant route', async () => {
        window.location.pathname = '/t/acme/dashboard';
        const response = new Response(null, { status: 401 });
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

        await interceptedFetch('/api/data');

        expect(window.location.href).toBe('/t/acme/login');
      });

      it('handles refresh token failure', async () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: 'user-1' }));

        const first401 = new Response(null, { status: 401 });
        const refreshFail = new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });

        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(first401)
          .mockResolvedValueOnce(refreshFail);

        await interceptedFetch('/api/data');

        expect(localStorage.getItem(USER_KEY)).toBeNull();
        expect(window.location.href).toBe('/t/default/login');
      });

      it('preserves auth state on refresh network error', async () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: 'user-1' }));

        const first401 = new Response(null, { status: 401 });
        const initialHref = window.location.href;

        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(first401)
          .mockRejectedValueOnce(new Error('Network error'));

        await interceptedFetch('/api/data');

        expect(localStorage.getItem(USER_KEY)).toBe(JSON.stringify({ id: 'user-1' }));
        expect(window.location.href).toBe(initialHref);
      });

      it('does not redirect if already on login page', async () => {
        window.location.pathname = '/login';
        window.location.href = 'http://localhost/login';

        const first401 = new Response(null, { status: 401 });
        const refreshFail = new Response(null, { status: 401 });

        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(first401)
          .mockResolvedValueOnce(refreshFail);

        // Change pathname to simulate being on login
        window.location.pathname = '/login';

        await interceptedFetch('/api/data');

        // Should not change href since already on login
        expect(window.location.href).toBe('http://localhost/login');
      });
    });

    describe('concurrent requests during refresh', () => {
      it('queues requests while refresh is in progress', async () => {
        // Track per-URL call counts to return correct responses regardless
        // of microtask ordering (Vitest v4 schedules differently from v2).
        const calls: string[] = [];
        const callCounts: Record<string, number> = {};
        const fetchMock = vi.spyOn(globalThis, 'fetch')
          .mockImplementation((url: string | URL | Request) => {
            const urlStr = String(url);
            calls.push(urlStr);
            callCounts[urlStr] = (callCounts[urlStr] || 0) + 1;
            const count = callCounts[urlStr];

            if (urlStr.includes('/auth/refresh')) {
              return Promise.resolve(new Response(JSON.stringify({ accessToken: TEST_REFRESHED_TOKEN }), { status: 200 }));
            }
            // First call per data URL → 401, second call → 200
            if (count === 1) {
              return Promise.resolve(new Response(null, { status: 401 }));
            }
            return Promise.resolve(new Response(JSON.stringify({ data: urlStr }), { status: 200 }));
          });

        // Start two requests concurrently
        const [result1, result2] = await Promise.all([
          interceptedFetch('/api/data1'),
          interceptedFetch('/api/data2'),
        ]);

        expect(result1.status).toBe(200);
        expect(result2.status).toBe(200);
        // Two original requests, one shared refresh, two retries.
        expect(fetchMock).toHaveBeenCalledTimes(5);
      });
    });

    it('passes through request options', async () => {
      const response = new Response(null, { status: 200 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const options: RequestInit = {
        method: 'POST',
        headers: { 'Custom-Header': 'value' },
        body: JSON.stringify({ test: 'data' }),
      };

      await interceptedFetch('/api/test', options);

      expect(fetchMock).toHaveBeenCalledWith('/api/test', expect.objectContaining({ method: options.method, body: options.body, credentials: 'include' }));
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Custom-Header')).toBe('value');
    });
  });
});
