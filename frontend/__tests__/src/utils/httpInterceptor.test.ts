import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { interceptedFetch, getAuthHeaders } from '@src/utils/httpInterceptor';
import { USER_KEY } from '@src/constants/storageKeys';

vi.mock('@src/shared/api/apiErrorUtils', () => ({
  getErrorMessageFromResponse: vi.fn().mockResolvedValue('Error message'),
}));

describe('httpInterceptor', () => {
  let originalLocation: Location;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    originalLocation = window.location;
    delete (window as any).location;
    window.location = {
      pathname: '/dashboard',
      origin: 'http://localhost',
      href: 'http://localhost/dashboard',
    } as any;
    document.cookie = '';
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  describe('getAuthHeaders', () => {
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

    it('includes CSRF token after intercepted request', async () => {
      const response = new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'X-CSRF-Token': 'csrf-token-123' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      await interceptedFetch('/api/test');

      const headers = getAuthHeaders();
      expect(headers['X-CSRF-Token']).toBe('csrf-token-123');
    });

    it('handles URL-encoded tenant slugs', () => {
      window.location.pathname = '/t/my%20company/dashboard';
      const headers = getAuthHeaders();
      expect(headers['X-Tenant-Slug']).toBe('my company');
    });
  });

  describe('interceptedFetch', () => {
    it('passes through successful requests', async () => {
      const response = new Response(JSON.stringify({ data: 'test' }), { status: 200 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const result = await interceptedFetch('/api/data');

      expect(result.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith('/api/data', { credentials: 'include' });
    });

    it('extracts CSRF token from response headers', async () => {
      const response = new Response(null, {
        status: 200,
        headers: { 'X-CSRF-Token': 'new-csrf' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      await interceptedFetch('/api/test');

      const headers = getAuthHeaders();
      expect(headers['X-CSRF-Token']).toBe('new-csrf');
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

    it('does not intercept on tenant public routes', async () => {
      window.location.pathname = '/t/acme/login';
      const response = new Response(null, { status: 401 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

      const result = await interceptedFetch('/api/data');
      
      expect(result.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    describe('token refresh on 401', () => {
      it('refreshes token and retries request', async () => {
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

      it('handles refresh network error', async () => {
        localStorage.setItem(USER_KEY, JSON.stringify({ id: 'user-1' }));

        const first401 = new Response(null, { status: 401 });

        vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(first401)
          .mockRejectedValueOnce(new Error('Network error'));

        await interceptedFetch('/api/data');

        expect(localStorage.getItem(USER_KEY)).toBeNull();
        expect(window.location.href).toBe('/t/default/login');
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

        const first401 = new Response(null, { status: 401 });
        const second401 = new Response(null, { status: 401 });
        const refreshSuccess = new Response(JSON.stringify({ accessToken: 'new-token' }), { status: 200 });
        const retry1 = new Response(JSON.stringify({ data: 'req1' }), { status: 200 });
        const retry2 = new Response(JSON.stringify({ data: 'req2' }), { status: 200 });

        const fetchMock = vi.spyOn(globalThis, 'fetch')
          .mockResolvedValueOnce(first401)
          .mockResolvedValueOnce(second401)
          .mockResolvedValueOnce(refreshSuccess)
          .mockResolvedValueOnce(retry1)
          .mockResolvedValueOnce(retry2);

        // Start two requests concurrently
        const [result1, result2] = await Promise.all([
          interceptedFetch('/api/data1'),
          interceptedFetch('/api/data2'),
        ]);

        expect(result1.status).toBe(200);
        expect(result2.status).toBe(200);
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

      expect(fetchMock).toHaveBeenCalledWith('/api/test', { ...options, credentials: 'include' });
    });
  });
});
