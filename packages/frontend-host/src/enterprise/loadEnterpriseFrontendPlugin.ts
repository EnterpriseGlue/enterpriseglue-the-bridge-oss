import type { EnterpriseFrontendPlugin, FrontendPluginContext } from '@enterpriseglue/enterprise-plugin-api/frontend';
import type { ComponentType } from 'react';
import { 
  registerComponentOverride, 
  registerFeatureOverride,
  registerNavItem,
  markInitialized,
  type NavExtension,
} from './extensionRegistry';
import { apiClient, ApiError } from '../shared/api/client';
import { parseApiError, getUiErrorMessage, getErrorMessageFromResponse } from '../shared/api/apiErrorUtils';
import { PageHeader, PageLayout, PAGE_GRADIENTS } from '../shared/components/PageLayout';
import ConfirmModal from '../shared/components/ConfirmModal';
import InviteMemberModal from '../components/InviteMemberModal';
import { useAuth } from '../shared/hooks/useAuth';
import { useModal } from '../shared/hooks/useModal';
import { useToast } from '../shared/notifications/ToastProvider';

const emptyPlugin: EnterpriseFrontendPlugin = { routes: [], tenantRoutes: [], navItems: [], menuItems: [] };

type FrontendPluginModuleShape = {
  default?: unknown;
  enterpriseFrontendPlugin?: unknown;
  plugin?: unknown;
};

type FrontendPluginRuntimeShape = EnterpriseFrontendPlugin & {
  componentOverrides?: unknown[];
  featureOverrides?: unknown[];
  navItems?: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isComponentOverrideCandidate(
  value: unknown
): value is { name: string; component: ComponentType<Record<string, unknown>> } {
  if (!isRecord(value)) {
    return false;
  }

  const { name, component } = value;
  const validComponentType = typeof component === 'function' || (isRecord(component) && component !== null);
  return typeof name === 'string' && validComponentType;
}

function isFeatureOverrideCandidate(value: unknown): value is { flag: string; enabled: boolean } {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.flag === 'string' && typeof value.enabled === 'boolean';
}

function isNavItemCandidate(value: unknown): value is NavExtension {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.label === 'string'
  );
}

async function dynamicImport(specifier: string): Promise<unknown> {
  const importer = new Function('s', 'return import(s)') as (s: string) => Promise<unknown>;
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
    const imported = (mod ?? {}) as FrontendPluginModuleShape;
    const pluginCandidate = imported.default ?? imported.enterpriseFrontendPlugin ?? imported.plugin ?? mod;

    if (pluginCandidate && typeof pluginCandidate === 'object') {
      const plugin = pluginCandidate as FrontendPluginRuntimeShape;

      // Register component overrides with extension registry
      if (Array.isArray(plugin.componentOverrides)) {
        for (const override of plugin.componentOverrides) {
          if (isComponentOverrideCandidate(override)) {
            registerComponentOverride(override.name, override.component);
          }
        }
      }

      // Register feature overrides from plugin
      // The plugin already handles feature flag checking internally
      if (Array.isArray(plugin.featureOverrides)) {
        for (const override of plugin.featureOverrides) {
          if (isFeatureOverrideCandidate(override)) {
            registerFeatureOverride(override);
          }
        }
      }

      // Register nav items from plugin
      // These appear in the sidebar/header menus
      if (Array.isArray(plugin.navItems)) {
        for (const item of plugin.navItems) {
          if (isNavItemCandidate(item)) {
            registerNavItem(item);
          }
        }
      }

      // Provide shared host utilities to the plugin via dependency injection
      if (typeof plugin.init === 'function') {
        const context: FrontendPluginContext = {
          api: {
            client: apiClient,
            errors: { ApiError: ApiError as any, parseApiError, getUiErrorMessage, getErrorMessageFromResponse },
          },
          components: {
            PageHeader,
            PageLayout,
            PAGE_GRADIENTS,
            ConfirmModal,
            InviteMemberModal,
          },
          hooks: { useAuth, useModal, useToast },
        };
        plugin.init(context);
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
