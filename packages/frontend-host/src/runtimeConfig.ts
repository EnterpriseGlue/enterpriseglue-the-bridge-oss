/**
 * Runtime configuration loader.
 *
 * The backend API base URL is normally baked in at build time via
 * `VITE_API_BASE_URL`, which Vite inlines into the bundle and thereby couples a
 * built artifact to a single environment. This module lets a deployment supply
 * that value *after* the build: point `VITE_RUNTIME_CONFIG_URL` at a JSON
 * document served alongside the app (e.g. `/config.json`) and the app fetches it
 * at startup, reading `apiBaseUrl` from the response.
 *
 * The build-time knob is a *pointer* (the URL to fetch), not the value itself.
 * The path is the same across environments — only the file's contents differ —
 * so one artifact can be promoted through tst -> acc -> prd without a rebuild.
 * ("Build once, deploy everywhere".)
 *
 * Behaviour:
 * - `VITE_RUNTIME_CONFIG_URL` unset       -> feature off, build-time defaults only.
 * - fetch + parse + validate OK           -> recognised fields applied over defaults.
 * - failure (cross-origin URL / network / non-OK / bad JSON / wrong shape /
 *   — when required — no usable `apiBaseUrl`):
 *     - `VITE_RUNTIME_CONFIG_REQUIRED === 'true'` -> throw {@link RuntimeConfigError}.
 *     - otherwise                                 -> warn and fall back to the
 *       build-time configuration.
 *
 * Security note: `assertSafeRequestUrl` in the HTTP interceptor derives its
 * allowed request origin from `config.apiBaseUrl`. Because this loader runs
 * before the first API request, a runtime-provided base URL feeds that
 * allow-list. The trust boundary therefore moves from build time to whoever
 * serves the config document. To keep that boundary on the app itself, the
 * config URL is confined to the application's own origin: a cross-origin
 * `VITE_RUNTIME_CONFIG_URL` is rejected *before any request is made* (see
 * {@link assertSameOriginConfigUrl}), so a foreign host can never dictate the
 * API base URL. This matches — and now enforces — the intended same-origin
 * deployment model, where the document is published next to the app itself.
 */

import { applyRuntimeConfig, config } from './config';
import type { TrustedSystemFrontendModuleDescriptorV1 } from '@enterpriseglue/enterprise-plugin-api/frontend';

/**
 * Shape of the runtime configuration document.
 *
 * `apiBaseUrl` is the first supported field. The object is intentionally open so
 * that deployments can carry additional environment-specific values through the
 * same channel later without reworking the loader.
 */
export interface RuntimeConfig {
  apiBaseUrl?: string;
  required?: boolean;
  systemFrontendModules?: unknown;
  [key: string]: unknown;
}

let systemFrontendModules: TrustedSystemFrontendModuleDescriptorV1[] = [];

export function getConfiguredSystemFrontendModules(): readonly TrustedSystemFrontendModuleDescriptorV1[] {
  return systemFrontendModules.map((descriptor) => ({ ...descriptor }));
}

/** Thrown when a *required* runtime configuration cannot be loaded. */
export class RuntimeConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'RuntimeConfigError';
    // Assign `cause` explicitly rather than via the two-arg Error constructor,
    // which requires a newer lib target than this package compiles against.
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Read a string env var defensively; returns '' when unset or unreadable. */
function readEnv(key: string): string {
  try {
    const value = import.meta.env?.[key];
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

/** Describe a value's runtime shape without dumping its contents. */
function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(length ${value.length})`;
  return typeof value;
}

/**
 * Validate and return a runtime API base URL.
 *
 * The HTTP interceptor appends API paths to this value and derives its request
 * allow-list from the URL origin. Accept only absolute HTTP(S) URLs without
 * credentials, query parameters, or fragments so startup fails predictably
 * instead of letting every later API request fail.
 */
function validateApiBaseUrl(value: string, sourceUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new RuntimeConfigError(
      `Runtime config at ${sourceUrl} has an invalid "apiBaseUrl": expected an absolute HTTP(S) URL.`,
      { cause: error },
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new RuntimeConfigError(
      `Runtime config at ${sourceUrl} has an invalid "apiBaseUrl" protocol ` +
        `(${parsed.protocol}); only http: and https: are supported.`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new RuntimeConfigError(
      `Runtime config at ${sourceUrl} must not include credentials in "apiBaseUrl".`,
    );
  }
  if (parsed.search || parsed.hash) {
    throw new RuntimeConfigError(
      `Runtime config at ${sourceUrl} must not include a query string or fragment in "apiBaseUrl".`,
    );
  }

  return trimmed;
}

/**
 * Reject a configured URL that does not resolve same-origin as the application.
 *
 * The runtime document dictates `apiBaseUrl`, which in turn seeds the request
 * allow-list in {@link import('./utils/httpInterceptor').assertSafeRequestUrl}.
 * A cross-origin config URL would therefore hand that trust boundary to a foreign
 * host — the exact thing the same-origin deployment model exists to prevent. So
 * we confine the document to the app's own origin and refuse anything else
 * *before* a request is issued, rather than fetching first and trusting later.
 *
 * The URL is resolved against `document`'s location, so relative pointers such as
 * `/config.json` (the intended form) pass, an absolute URL naming the app's own
 * origin passes, and anything else — a foreign host, a protocol-relative
 * `//host/…`, or an `http:` document under an `https:` app — is rejected.
 *
 * Returns normally when `url` is same-origin (the caller then fetches the
 * original string unchanged, preserving relative-URL semantics); throws
 * {@link RuntimeConfigError} on a malformed or cross-origin URL.
 *
 * Scope: this confines only *where the config document is fetched from* — the
 * `VITE_RUNTIME_CONFIG_URL` endpoint. It does **not** constrain the `apiBaseUrl`
 * value the document returns, which may legitimately name a different origin
 * (e.g. an `https://api.<app-domain>` subdomain serving the API). That is the
 * whole point of runtime config: a trusted, same-origin document declares which
 * — possibly foreign — origin the API lives on, and that value then seeds the
 * request allow-list in {@link import('./utils/httpInterceptor').assertSafeRequestUrl}.
 * Note the returned `apiBaseUrl` must be an absolute URL *with a scheme*
 * (`https://api.example`, not `api.example`): the interceptor derives the
 * allowed origin via `new URL(apiBaseUrl)`, which rejects a scheme-less value.
 */
function assertSameOriginConfigUrl(url: string): void {
  const appOrigin = window.location.origin;

  let resolved: URL;
  try {
    resolved = new URL(url, window.location.href);
  } catch (error) {
    throw new RuntimeConfigError(
      `Runtime config URL "${url}" is not a valid URL.`,
      { cause: error },
    );
  }

  if (resolved.origin !== appOrigin) {
    throw new RuntimeConfigError(
      `Runtime config URL "${url}" resolves to a cross-origin location ` +
        `(${resolved.origin}); the configuration document must be served ` +
        `same-origin as the application (${appOrigin}). It seeds the API ` +
        `request allow-list, so a foreign origin is refused before any fetch.`,
    );
  }
}

/**
 * Fetch, parse and validate the runtime configuration document.
 *
 * Throws {@link RuntimeConfigError} on any transport, parse or shape problem.
 * A present-but-empty `apiBaseUrl` is a valid string (same-origin intent) and is
 * left for {@link applyRuntimeConfig} to treat as "no override"; only a
 * non-string `apiBaseUrl` is rejected here as malformed.
 */
async function fetchRuntimeConfig(url: string): Promise<RuntimeConfig> {
  // Fail closed on a cross-origin config URL before issuing any request: the
  // document it returns dictates the API base URL, so it must come from our own
  // origin, never a foreign host.
  assertSameOriginConfigUrl(url);

  let response: Response;
  try {
    // `cache: 'no-store'`: a redeploy that changes the config document must take
    // effect immediately and never be served from a stale HTTP cache — otherwise
    // "change the endpoint without rebuilding" quietly breaks behind the cache.
    response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new RuntimeConfigError(`Could not fetch runtime config from ${url}.`, {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new RuntimeConfigError(
      `Runtime config request to ${url} returned HTTP ${response.status}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    throw new RuntimeConfigError(`Runtime config at ${url} is not valid JSON.`, {
      cause: error,
    });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RuntimeConfigError(
      `Runtime config at ${url} must be a JSON object, but received ${describeShape(parsed)}.`,
    );
  }

  const record = parsed as Record<string, unknown>;
  if (
    record.apiBaseUrl !== undefined &&
    typeof record.apiBaseUrl !== 'string'
  ) {
    throw new RuntimeConfigError(
      `Runtime config at ${url} has an invalid "apiBaseUrl": expected a string, ` +
        `but received ${describeShape(record.apiBaseUrl)}.`,
    );
  }
  if (record.required !== undefined && typeof record.required !== 'boolean') {
    throw new RuntimeConfigError(
      `Runtime config at ${url} has an invalid "required": expected a boolean, ` +
        `but received ${describeShape(record.required)}.`,
    );
  }
  if (record.systemFrontendModules !== undefined && !Array.isArray(record.systemFrontendModules)) {
    throw new RuntimeConfigError(
      `Runtime config at ${url} has an invalid "systemFrontendModules": expected an array, but received ${describeShape(record.systemFrontendModules)}.`,
    );
  }

  return record as RuntimeConfig;
}

/**
 * Load runtime configuration (when configured) and apply it over the build-time
 * defaults. Call exactly once, before any API request is issued — i.e. at the
 * very top of the application bootstrap.
 *
 * Resolves normally when the feature is off or when a non-required load fails
 * (falling back to build-time config). Rejects with {@link RuntimeConfigError}
 * only when `VITE_RUNTIME_CONFIG_REQUIRED === 'true'` and the config cannot be
 * loaded or yields no usable `apiBaseUrl`.
 */
export async function initRuntimeConfig(): Promise<void> {
  systemFrontendModules = [];
  const url = readEnv('VITE_RUNTIME_CONFIG_URL');
  if (!url) return; // Off unless a config URL is provided — no behaviour change.

  let required = readEnv('VITE_RUNTIME_CONFIG_REQUIRED') === 'true';

  try {
    const runtime = await fetchRuntimeConfig(url);
    // A build-time requirement cannot be weakened by the runtime document, but
    // the standard Docker image can opt into fail-closed startup at deployment
    // time through the document generated by nginx-entrypoint.sh.
    required = required || runtime.required === true;
    const apiBaseUrl =
      typeof runtime.apiBaseUrl === 'string'
        ? validateApiBaseUrl(runtime.apiBaseUrl, url)
        : '';

    if (!apiBaseUrl && required) {
      throw new RuntimeConfigError(
        `Runtime config at ${url} loaded but did not provide a usable "apiBaseUrl".`,
      );
    }

    const parsedSystemFrontendModules = parseSystemFrontendModules(runtime.systemFrontendModules, url);
    applyRuntimeConfig({ apiBaseUrl });
    systemFrontendModules = parsedSystemFrontendModules;

    if (config.environment === 'development') {
      console.log(
        `✅ Runtime configuration loaded from ${url}` +
          (apiBaseUrl ? ` (apiBaseUrl: ${apiBaseUrl})` : ' (no apiBaseUrl override)'),
      );
    }
  } catch (error) {
    if (required) {
      throw error instanceof RuntimeConfigError
        ? error
        : new RuntimeConfigError(`Runtime config load failed for ${url}.`, {
            cause: error,
          });
    }
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[enterpriseglue] Runtime configuration could not be loaded (${reason}). ` +
        `Falling back to build-time configuration (VITE_API_BASE_URL / same-origin). ` +
        `Set VITE_RUNTIME_CONFIG_REQUIRED=true to treat this as a fatal error instead.`,
    );
  }
}

function parseSystemFrontendModules(value: unknown, sourceUrl: string): TrustedSystemFrontendModuleDescriptorV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) throw new RuntimeConfigError(`Runtime config at ${sourceUrl} has invalid system frontend modules.`);
  return value.map((item, index) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') throw new RuntimeConfigError(`Runtime config at ${sourceUrl} has an invalid system frontend module at index ${index}.`);
    const record = item as Record<string, unknown>;
    if (typeof record.ownerId !== 'string' || typeof record.entryPath !== 'string' || typeof record.integrity !== 'string' || (record.required !== undefined && typeof record.required !== 'boolean')) throw new RuntimeConfigError(`Runtime config at ${sourceUrl} has an invalid system frontend module at index ${index}.`);
    return { ownerId: record.ownerId, entryPath: record.entryPath, integrity: record.integrity as `sha256-${string}`, ...(record.required === true ? { required: true } : {}) };
  });
}
