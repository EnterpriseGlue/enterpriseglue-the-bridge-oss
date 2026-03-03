import { fetch } from 'undici';
import type { PiiProviderOptions } from './types.js';

export function buildAuthHeaders(options?: PiiProviderOptions): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.authHeader && options?.authToken) {
    headers[options.authHeader] = options.authToken;
  } else if (options?.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }
  return headers;
}

export async function postJson<T>(url: string, body: any, headers: Record<string, string>, timeoutMs = 5000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PII provider error: ${response.status} ${response.statusText} ${text}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  } finally {
    clearTimeout(timeout);
  }
}
