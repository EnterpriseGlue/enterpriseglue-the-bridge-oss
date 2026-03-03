/**
 * Base API client with error handling and type safety
 * Now with automatic token refresh on 401 errors
 */

import { interceptedFetch, getAuthHeaders } from '../../utils/httpInterceptor';

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(
      response.status,
      response.statusText,
      text || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }

  return response.text() as Promise<T>;
}

function mergeHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(getAuthHeaders())
  if (extra) {
    const next = new Headers(extra)
    next.forEach((value, key) => headers.set(key, value))
  }
  return headers
}

export const apiClient = {
  async getBlob(url: string, params?: Record<string, any>, options?: RequestInit): Promise<Blob> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
    }
    const fullUrl = params ? `${url}?${searchParams}` : url;
    const response = await interceptedFetch(fullUrl, {
      ...options,
      headers: mergeHeaders(options?.headers),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ApiError(
        response.status,
        response.statusText,
        text || `HTTP ${response.status}: ${response.statusText}`
      );
    }
    return response.blob();
  },
  async get<T>(url: string, params?: Record<string, any>, options?: RequestInit): Promise<T> {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
    }
    const fullUrl = params ? `${url}?${searchParams}` : url;
    const response = await interceptedFetch(fullUrl, {
      ...options,
      headers: mergeHeaders(options?.headers),
    });
    return handleResponse<T>(response);
  },

  async post<T>(url: string, body?: any, options?: RequestInit): Promise<T> {
    const response = await interceptedFetch(url, {
      ...options,
      method: 'POST',
      headers: mergeHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async put<T>(url: string, body?: any, options?: RequestInit): Promise<T> {
    const response = await interceptedFetch(url, {
      ...options,
      method: 'PUT',
      headers: mergeHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(url: string, body?: any, options?: RequestInit): Promise<T> {
    const response = await interceptedFetch(url, {
      ...options,
      method: 'PATCH',
      headers: mergeHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T = void>(url: string, options?: RequestInit): Promise<T> {
    const response = await interceptedFetch(url, {
      ...options,
      method: 'DELETE',
      headers: mergeHeaders(options?.headers),
    });
    return handleResponse<T>(response);
  },
};
