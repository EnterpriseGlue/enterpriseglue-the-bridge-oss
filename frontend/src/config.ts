/**
 * Frontend configuration with validation
 * Validates environment variables and provides type-safe access
 */

interface Config {
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
