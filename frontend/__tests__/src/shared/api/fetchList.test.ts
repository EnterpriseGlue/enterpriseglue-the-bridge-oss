import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchList } from '@src/shared/api/fetchList';
import * as interceptor from '@src/utils/httpInterceptor';

vi.mock('@src/utils/httpInterceptor', () => ({
  interceptedFetch: vi.fn(),
  getAuthHeaders: vi.fn().mockReturnValue({ 'Content-Type': 'application/json' }),
}));

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchList', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('returns the array payload for a well-formed list response', async () => {
    vi.mocked(interceptor.interceptedFetch).mockResolvedValue(jsonResponse([{ id: 1 }, { id: 2 }]));
    const result = await fetchList<{ id: number }>('/api/things');
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('coerces a non-array payload to [] and logs the endpoint as context', async () => {
    vi.mocked(interceptor.interceptedFetch).mockResolvedValue(jsonResponse({ error: 'Unauthorized' }));
    const result = await fetchList('/api/things');
    expect(result).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const message = consoleError.mock.calls[0].join(' ');
    expect(message).toContain('/api/things');
    expect(message).toContain('Unauthorized');
  });

  it('uses an explicit context label when provided', async () => {
    vi.mocked(interceptor.interceptedFetch).mockResolvedValue(jsonResponse('nope'));
    await fetchList('/api/things', undefined, undefined, 'listThings');
    expect(consoleError.mock.calls[0].join(' ')).toContain('listThings');
  });

  it('forwards query params and request options to the underlying GET', async () => {
    vi.mocked(interceptor.interceptedFetch).mockResolvedValue(jsonResponse([]));
    await fetchList('/api/things', { q: 'x' }, { credentials: 'include' });
    expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
      '/api/things?q=x',
      expect.objectContaining({ credentials: 'include', headers: expect.any(Headers) }),
    );
  });
});
