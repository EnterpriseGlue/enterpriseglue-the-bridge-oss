import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@src/config';
import { apiFetch } from '@src/utils/apiFetch';
import { initializeTenancyCapabilities } from '@src/services/tenancy';

describe('application XSRF cookie forwarding', () => {
  beforeEach(() => {
    config.apiBaseUrl = '';
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('XSRF-TOKEN=app%2Btoken');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });
  afterEach(() => { config.apiBaseUrl = ''; vi.restoreAllMocks(); });
  it('adds the URL-decoded application cookie to the one token header', async () => {
    await apiFetch('/api/data', { method: 'POST', headers: { 'X-XSRF-TOKEN': 'stale', 'X-Request-Id': 'request-1' } });
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    const headers = new Headers(options.headers);
    expect(headers.get('X-XSRF-TOKEN')).toBe('app+token');
    expect(headers.get('X-Request-Id')).toBe('request-1');
    expect(headers.has('X-CSRF-Token')).toBe(false);
    expect(options.credentials).toBe('include');
    expect(options.redirect).toBe('error');
  });
  it('reads rotated cookies for each request and removes stale caller headers when absent', async () => {
    const cookie = vi.spyOn(document, 'cookie', 'get');
    for (const value of ['first', 'second', '']) {
      cookie.mockReturnValue(value ? `XSRF-TOKEN=${value}` : '');
      await apiFetch('/api/data', { headers: { 'X-XSRF-TOKEN': 'stale' } });
      const calls = vi.mocked(fetch).mock.calls;
      expect(new Headers(calls[calls.length - 1][1]?.headers).get('X-XSRF-TOKEN')).toBe(value || null);
    }
  });
  it('includes application token on the initial capabilities request', async () => {
    await initializeTenancyCapabilities();
    expect(fetch).toHaveBeenCalledWith('/api/tenancy/capabilities', expect.objectContaining({ credentials: 'include', redirect: 'error' }));
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('X-XSRF-TOKEN')).toBe('app+token');
  });
  it('permits only the explicitly configured API origin', async () => {
    config.apiBaseUrl = 'https://api.example.test';
    await apiFetch('https://api.example.test/api/data');
    for (const url of ['/api/data', '//untrusted.example/api/data', 'https://untrusted.example/api/data', 'https://user:password@api.example.test/api/data']) {
      expect(() => apiFetch(url)).toThrow('configured API origin');
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['XSRF-TOKEN=%0D%0Ainjected', 'XSRF-TOKEN=%ZZ', 'XSRF-TOKEN=a; XSRF-TOKEN=b', `XSRF-TOKEN=${'a'.repeat(8193)}`])('rejects ambiguous or invalid cookie values without sending them (%#)', (cookie) => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue(cookie);
    expect(() => apiFetch('/api/data')).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
