import type { PiiProviderOptions } from './types.js';
import {
  fetchAdminIntegrationEndpoint,
  readAdminIntegrationJsonResponse,
} from '../platform-admin/AdminIntegrationEndpointPolicy.js';

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
  const response = await fetchAdminIntegrationEndpoint(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, { label: 'PII provider', timeoutMs });
  if (!response.ok) throw new Error(`PII provider returned HTTP ${response.status}`);
  return readAdminIntegrationJsonResponse<T>(response, 'PII provider');
}
