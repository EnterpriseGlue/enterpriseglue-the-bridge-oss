import type { EnterpriseBackendPlugin } from '@enterpriseglue/enterprise-plugin-api/backend';

const noopPlugin: EnterpriseBackendPlugin = {};

async function dynamicImport(specifier: string): Promise<any> {
  const importer = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
  return importer(specifier);
}

/**
 * Load the enterprise backend plugin if available.
 * 
 * Auto-detection: No ENTERPRISE_ENABLED flag needed.
 * - OSS repo: Plugin package doesn't exist → Returns noop plugin (OSS mode)
 * - EE repo: Plugin package exists → Loads and returns plugin
 * 
 * Feature flags: Individual features can be controlled via env vars.
 * - MULTI_TENANT=true/false → Enable/disable multi-tenant mode
 * - (Add more feature flags as needed)
 */
export async function loadEnterpriseBackendPlugin(): Promise<EnterpriseBackendPlugin> {
  try {
    const mod = await dynamicImport('@enterpriseglue/enterprise-backend');
    const plugin = mod?.default ?? mod?.enterpriseBackendPlugin ?? mod?.plugin ?? mod;

    if (plugin && typeof plugin === 'object') {
      console.log('[Enterprise] Backend plugin loaded');
      return plugin as EnterpriseBackendPlugin;
    }

    return noopPlugin;
  } catch {
    // Plugin not available (OSS mode) - this is expected in OSS repo
    return noopPlugin;
  }
}
