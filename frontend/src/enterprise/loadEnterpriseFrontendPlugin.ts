import type { EnterpriseFrontendPlugin } from '@enterpriseglue/enterprise-plugin-api/frontend';
import { 
  registerComponentOverride, 
  registerFeatureOverride,
  registerNavItem,
  markInitialized,
} from './extensionRegistry';

const emptyPlugin: EnterpriseFrontendPlugin = { routes: [], tenantRoutes: [], navItems: [], menuItems: [] };

async function dynamicImport(specifier: string): Promise<any> {
  const importer = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
  return importer(specifier);
}

let cached: Promise<EnterpriseFrontendPlugin> | null = null;

/**
 * Load the enterprise frontend plugin if available.
 * 
 * Auto-detection: Plugin is loaded if @enterpriseglue/enterprise-frontend exists.
 * - OSS repo: Package doesn't exist → Returns empty plugin (OSS mode)
 * - EE repo: Package exists → Always loads, features controlled internally
 * 
 * Feature flags are handled by the EE plugin itself (e.g., MULTI_TENANT).
 */
export async function loadEnterpriseFrontendPlugin(): Promise<EnterpriseFrontendPlugin> {
  try {
    const mod = await dynamicImport('@enterpriseglue/enterprise-frontend');
    const plugin = mod?.default ?? mod?.enterpriseFrontendPlugin ?? mod?.plugin ?? mod;

    if (plugin && typeof plugin === 'object') {
      // Register component overrides with extension registry
      if (Array.isArray(plugin.componentOverrides)) {
        for (const override of plugin.componentOverrides) {
          if (override?.name && override?.component) {
            registerComponentOverride(override.name, override.component);
          }
        }
      }

      // Register feature overrides from plugin
      // The plugin already handles feature flag checking internally
      if (Array.isArray(plugin.featureOverrides)) {
        for (const override of plugin.featureOverrides) {
          if (override?.flag !== undefined) {
            registerFeatureOverride(override);
          }
        }
      }

      // Register nav items from plugin
      // These appear in the sidebar/header menus
      if (Array.isArray(plugin.navItems)) {
        for (const item of plugin.navItems) {
          if (item?.id && item?.path) {
            registerNavItem(item);
          }
        }
      }

      // Mark registry as initialized
      markInitialized();

      console.log('[Enterprise] Frontend plugin loaded');

      return {
        routes: Array.isArray(plugin.routes) ? plugin.routes : [],
        tenantRoutes: Array.isArray(plugin.tenantRoutes) ? plugin.tenantRoutes : [],
        navItems: Array.isArray(plugin.navItems) ? plugin.navItems : [],
        menuItems: Array.isArray(plugin.menuItems) ? plugin.menuItems : [],
      };
    }

    return emptyPlugin;
  } catch {
    // Plugin not available (OSS mode) - expected in OSS repo
    return emptyPlugin;
  }
}

export function getEnterpriseFrontendPlugin(): Promise<EnterpriseFrontendPlugin> {
  if (!cached) {
    cached = loadEnterpriseFrontendPlugin();
  }
  return cached;
}
