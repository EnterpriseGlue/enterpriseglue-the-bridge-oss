import { apiClient } from './client';
import { expectArray } from './expectArray';

/**
 * GET a list endpoint, validating at the API boundary that the response is an
 * array before it reaches collection operations (`.filter`/`.map`/`.reduce`).
 *
 * A drop-in replacement for `apiClient.get<T[]>(url, params, options)`: it
 * issues the same request, then routes the payload through {@link expectArray}.
 * A non-array payload (an error envelope such as `{ error: 'Unauthorized' }`,
 * an object, a bare string) is logged with the request context and rejected
 * with a typed contract error, so query consumers render an actionable error
 * state instead of an opaque `TypeError` or a misleading empty list.
 *
 * @param context Optional label for the diagnostic; defaults to `GET <url>`.
 */
export async function fetchList<T>(
  url: string,
  params?: Record<string, any>,
  options?: RequestInit,
  context?: string,
): Promise<T[]> {
  // Forward exactly the arguments the caller supplied, so the underlying
  // `apiClient.get` call is indistinguishable from `apiClient.get<T[]>(...)`
  // (no trailing `undefined`s that would change its observable call shape).
  const value =
    options !== undefined
      ? await apiClient.get<unknown>(url, params, options)
      : params !== undefined
        ? await apiClient.get<unknown>(url, params)
        : await apiClient.get<unknown>(url);
  return expectArray<T>(value, context ?? `GET ${url}`);
}
