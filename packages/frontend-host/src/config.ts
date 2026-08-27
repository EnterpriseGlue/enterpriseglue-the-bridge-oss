/**
 * Frontend configuration with validation
 * Validates environment variables and provides type-safe access
 */

export interface Config {
  apiBaseUrl: string;
  environment: 'development' | 'production' | 'test';
  enableDevTools: boolean;
}

function loadConfig(): Config {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const environment = (import.meta.env.MODE || 'development') as Config['environment'];
  const enableDevTools = import.meta.env.DEV || false;

  // Empty API base URL is valid when frontend and backend share the same origin
  // through a reverse proxy (e.g., Nginx).
  if (!apiBaseUrl && environment === 'production') {
    console.info('ℹ️  API base URL not set - using same-origin relative API URLs');
  }

  const config: Config = {
    apiBaseUrl,
    environment,
    enableDevTools,
  };

  // Log configuration on startup (development only)
  if (environment === 'development') {
    console.log('✅ Frontend configuration loaded:');
    console.log(`  - Environment: ${config.environment}`);
    console.log(`  - API Base URL: ${config.apiBaseUrl || '(relative)'}`);
    console.log(`  - Dev Tools: ${config.enableDevTools ? 'enabled' : 'disabled'}`);
  }

  return config;
}

// Singleton config instance
export const config = loadConfig();

/**
 * Apply runtime-provided configuration on top of the build-time defaults.
 *
 * The singleton is mutated in place (rather than replaced) so that modules which
 * captured `config` by reference at import time — notably the HTTP interceptor,
 * which reads `config.apiBaseUrl` on every request — observe the override without
 * needing to re-import. Call this before the first API request is issued.
 *
 * Only recognised fields are applied; unknown keys are ignored here. An absent or
 * empty `apiBaseUrl` is treated as "no override", leaving the build-time value
 * (which may itself be empty, meaning same-origin) in place.
 */
export function applyRuntimeConfig(overrides: { apiBaseUrl?: unknown }): void {
  if (typeof overrides.apiBaseUrl === 'string') {
    const trimmed = overrides.apiBaseUrl.trim();
    if (trimmed) config.apiBaseUrl = trimmed;
  }
}
