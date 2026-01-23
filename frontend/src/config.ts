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

  // Validate required configuration
  if (!apiBaseUrl && environment === 'production') {
    console.warn('⚠️  VITE_API_BASE_URL not set - using relative URLs');
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
