import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, ApiError } from '@src/shared/api/client';
import * as interceptor from '@src/utils/httpInterceptor';

vi.mock('@src/utils/httpInterceptor', () => ({
  interceptedFetch: vi.fn(),
  getAuthHeaders: vi.fn().mockReturnValue({ 'Content-Type': 'application/json', 'Authorization': 'Bearer token' }),
}));

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ApiError', () => {
    it('creates error with status and message', () => {
      const error = new ApiError(404, 'Not Found', 'Resource not found');
      expect(error.status).toBe(404);
      expect(error.statusText).toBe('Not Found');
      expect(error.message).toBe('Resource not found');
      expect(error.name).toBe('ApiError');
    });
  });

  describe('get', () => {
    it('makes GET requests with JSON response', async () => {
      const mockResponse = new Response(JSON.stringify({ data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.get('/api/test');
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({ headers: expect.any(Headers) })
      );
      expect(result).toEqual({ data: 'test' });
    });

    it('makes GET requests with query parameters', async () => {
      const mockResponse = new Response(JSON.stringify({ data: 'filtered' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await apiClient.get('/api/test', { id: '123', active: true });
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/test?id=123&active=true',
        expect.any(Object)
      );
    });

    it('filters out null and undefined params', async () => {
      const mockResponse = new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await apiClient.get('/api/test', { id: '123', nullValue: null, undefinedValue: undefined });
      
      const callUrl = vi.mocked(interceptor.interceptedFetch).mock.calls[0][0];
      expect(callUrl).toBe('/api/test?id=123');
    });

    it('handles text responses', async () => {
      const mockResponse = new Response('plain text', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.get('/api/text');
      expect(result).toBe('plain text');
    });

    it('handles 204 no content', async () => {
      const mockResponse = new Response(null, { status: 204 });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.get('/api/empty');
      expect(result).toBeUndefined();
    });

    it('throws ApiError on non-ok response', async () => {
      const mockResponse = new Response('Not Found', { status: 404, statusText: 'Not Found' });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await expect(apiClient.get('/api/missing')).rejects.toThrow(ApiError);
      await expect(apiClient.get('/api/missing')).rejects.toThrow('Not Found');
    });

    it('handles error response with no body', async () => {
      const mockResponse = new Response(null, { status: 500, statusText: 'Internal Server Error' });
      Object.defineProperty(mockResponse, 'text', {
        value: vi.fn().mockRejectedValue(new Error('Cannot read body')),
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await expect(apiClient.get('/api/error')).rejects.toThrow('HTTP 500: Internal Server Error');
    });

    it('merges custom headers with auth headers', async () => {
      const mockResponse = new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await apiClient.get('/api/test', undefined, { headers: { 'X-Custom': 'value' } });
      
      const callOptions = vi.mocked(interceptor.interceptedFetch).mock.calls[0][1];
      const headers = callOptions?.headers as Headers;
      expect(headers.get('X-Custom')).toBe('value');
      expect(headers.get('Authorization')).toBe('Bearer token');
    });
  });

  describe('post', () => {
    it('makes POST requests with body', async () => {
      const mockResponse = new Response(JSON.stringify({ id: '1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.post('/api/create', { name: 'test' });
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        })
      );
      expect(result).toEqual({ id: '1' });
    });

    it('makes POST requests without body', async () => {
      const mockResponse = new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await apiClient.post('/api/action');
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/action',
        expect.objectContaining({
          method: 'POST',
          body: undefined,
        })
      );
    });
  });

  describe('put', () => {
    it('makes PUT requests with body', async () => {
      const mockResponse = new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.put('/api/update/1', { name: 'updated' });
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/update/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ name: 'updated' }),
        })
      );
      expect(result).toEqual({ updated: true });
    });

    it('makes PUT requests without body', async () => {
      const mockResponse = new Response(null, { status: 204 });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await apiClient.put('/api/reset');
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/reset',
        expect.objectContaining({
          method: 'PUT',
          body: undefined,
        })
      );
    });
  });

  describe('patch', () => {
    it('makes PATCH requests with body', async () => {
      const mockResponse = new Response(JSON.stringify({ patched: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.patch('/api/partial/1', { status: 'active' });
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/partial/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'active' }),
        })
      );
      expect(result).toEqual({ patched: true });
    });
  });

  describe('delete', () => {
    it('makes DELETE requests', async () => {
      const mockResponse = new Response(null, { status: 204 });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.delete('/api/delete/1');
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/delete/1',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(result).toBeUndefined();
    });

    it('handles DELETE with response body', async () => {
      const mockResponse = new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.delete('/api/delete/1');
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('getBlob', () => {
    it('gets blob responses', async () => {
      const blob = new Blob(['content'], { type: 'application/pdf' });
      const mockResponse = new Response(blob, { status: 200 });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      const result = await apiClient.getBlob('/api/download');
      
      expect(result).toBeDefined();
      expect(result.size).toBeGreaterThan(0);
      expect(typeof result.type).toBe('string');
    });

    it('gets blob with query parameters', async () => {
      const blob = new Blob(['filtered content'], { type: 'application/pdf' });
      const mockResponse = new Response(blob, { status: 200 });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await apiClient.getBlob('/api/download', { format: 'pdf', id: '123' });
      
      expect(interceptor.interceptedFetch).toHaveBeenCalledWith(
        '/api/download?format=pdf&id=123',
        expect.any(Object)
      );
    });

    it('filters out null and undefined params in getBlob', async () => {
      const blob = new Blob(['content'], { type: 'application/pdf' });
      const mockResponse = new Response(blob, { status: 200 });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await apiClient.getBlob('/api/download', { id: '123', nullValue: null, undefinedValue: undefined });
      
      const callUrl = vi.mocked(interceptor.interceptedFetch).mock.calls[0][0];
      expect(callUrl).toBe('/api/download?id=123');
    });

    it('throws ApiError on blob request failure', async () => {
      const mockResponse = new Response('Not Found', { status: 404, statusText: 'Not Found' });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await expect(apiClient.getBlob('/api/missing')).rejects.toThrow(ApiError);
    });

    it('handles blob error response with no body', async () => {
      const mockResponse = new Response(null, { status: 500, statusText: 'Internal Server Error' });
      Object.defineProperty(mockResponse, 'text', {
        value: vi.fn().mockRejectedValue(new Error('Cannot read body')),
      });
      vi.mocked(interceptor.interceptedFetch).mockResolvedValue(mockResponse);

      await expect(apiClient.getBlob('/api/error')).rejects.toThrow('HTTP 500: Internal Server Error');
    });
  });
});
