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

export interface JsonSseEvent<T> {
  data: T;
  event?: string;
  id?: string;
}

const MAX_BROWSER_SSE_EVENT_BYTES = 1024 * 1024;
const MAX_BROWSER_SSE_STREAM_BYTES = 100 * 1024 * 1024;

export async function consumeJsonSseResponse<T>(
  response: Response,
  onEvent: (event: JsonSseEvent<T>) => void,
): Promise<void> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ApiError(
      response.status,
      response.statusText,
      text || `HTTP ${response.status}: ${response.statusText}`,
    );
  }
  if (
    !/^text\/event-stream(?:\s*;|$)/i.test(
      response.headers.get('content-type') || '',
    ) ||
    !response.body
  ) {
    throw new ApiError(
      502,
      'Invalid event stream',
      'Plugin operation did not return an event stream',
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let byteCount = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteCount += next.value.byteLength;
      if (byteCount > MAX_BROWSER_SSE_STREAM_BYTES) {
        throw new ApiError(502, 'Event stream too large', 'Plugin event stream exceeded the browser safety limit');
      }
      buffer += decoder.decode(next.value, { stream: true });
      while (true) {
        const match = /(?:\r\n\r\n|\n\n|\r\r)/.exec(buffer);
        if (!match) break;
        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (new TextEncoder().encode(block).byteLength > MAX_BROWSER_SSE_EVENT_BYTES) {
          throw new ApiError(502, 'Event too large', 'Plugin event exceeded the browser safety limit');
        }
        const event = parseJsonSseBlock<T>(block);
        if (!event) continue;
        if (event.event === 'error') {
          throw new ApiError(502, 'Plugin stream invalid', 'Plugin event stream was rejected by the host');
        }
        onEvent(event);
      }
      if (new TextEncoder().encode(buffer).byteLength > MAX_BROWSER_SSE_EVENT_BYTES) {
        throw new ApiError(502, 'Event too large', 'Plugin event exceeded the browser safety limit');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length !== 0) {
      throw new ApiError(502, 'Truncated event stream', 'Plugin event stream ended mid-event');
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // The original bounded parser/callback error remains authoritative.
    }
    throw error;
  }
}

function parseJsonSseBlock<T>(block: string): JsonSseEvent<T> | undefined {
  if (block.trim().length === 0) return undefined;
  const lines = block.split(/\r\n|\r|\n/);
  if (lines.every((line) => line.startsWith(':'))) return undefined;
  const data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'data') {
      data.push(value);
    } else if (field === 'event' && /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(value)) {
      if (event !== undefined) throw new ApiError(502, 'Invalid event stream', 'Duplicate event field');
      event = value;
    } else if (field === 'id' && /^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
      if (id !== undefined) throw new ApiError(502, 'Invalid event stream', 'Duplicate event ID');
      id = value;
    } else {
      throw new ApiError(502, 'Invalid event stream', 'Unsupported event-stream field');
    }
  }
  if (data.length === 0) {
    throw new ApiError(502, 'Invalid event stream', 'Event data is required');
  }
  let payload: T;
  try {
    payload = JSON.parse(data.join('\n')) as T;
  } catch {
    throw new ApiError(502, 'Invalid event stream', 'Event data is not JSON');
  }
  return {
    data: payload,
    ...(event ? { event } : {}),
    ...(id ? { id } : {}),
  };
}

export const apiClient = {
  async streamSse<T>(
    url: string,
    body: unknown,
    onEvent: (event: JsonSseEvent<T>) => void,
    options?: RequestInit,
  ): Promise<void> {
    const response = await interceptedFetch(url, {
      ...options,
      method: options?.method ?? 'POST',
      headers: mergeHeaders({
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...Object.fromEntries(new Headers(options?.headers).entries()),
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await consumeJsonSseResponse(response, onEvent);
  },
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
  async postBlob(url: string, body?: any, options?: RequestInit): Promise<Blob> {
    const response = await interceptedFetch(url, {
      ...options,
      method: 'POST',
      headers: mergeHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
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

  async postRaw<T>(url: string, body?: BodyInit | null, options?: RequestInit): Promise<T> {
    const response = await interceptedFetch(url, {
      ...options,
      method: 'POST',
      headers: mergeHeaders(options?.headers),
      body: body ?? undefined,
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
