import type { EnterpriseBackendPlugin } from '@enterpriseglue/enterprise-plugin-api/backend';

const noopPlugin: EnterpriseBackendPlugin = {};

function isMissingEnterprisePlugin(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND') {
    return true;
  }

  const message = (error as { message?: string } | null)?.message ?? '';
  return (
    message.includes('@enterpriseglue/enterprise-backend') &&
    (
      message.includes('Cannot find module') ||
      message.includes('Cannot resolve module') ||
      message.includes('Failed to load url')
    )
  );
}

function assertValidPluginShape(plugin: Record<string, unknown>): void {
  const optionalHookNames: Array<keyof EnterpriseBackendPlugin> = [
    'registerRoutes',
    'migrateEnterpriseDatabase',
  ];

  const invalidHooks = optionalHookNames.filter((hookName) => {
    const hook = plugin[hookName as string];
    return hook !== undefined && typeof hook !== 'function';
  });

  if (invalidHooks.length > 0) {
    throw new Error(
      `[Enterprise] Invalid backend plugin export: ${invalidHooks.join(', ')} must be function(s) when provided`
    );
  }
}

export const __enterpriseBackendPluginTestUtils = {
  isMissingEnterprisePlugin,
  assertValidPluginShape,
};

async function dynamicImport(specifier: string): Promise<any> {
  return import(specifier);
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
      assertValidPluginShape(plugin as Record<string, unknown>);
      console.log('[Enterprise] Backend plugin loaded');
      return plugin as EnterpriseBackendPlugin;
    }

    return noopPlugin;
  } catch (error) {
    if (isMissingEnterprisePlugin(error)) {
      // Plugin package not installed (expected OSS mode).
      return noopPlugin;
    }

    console.error('[Enterprise] Backend plugin failed to load:', error);
    throw error;
  }
}
