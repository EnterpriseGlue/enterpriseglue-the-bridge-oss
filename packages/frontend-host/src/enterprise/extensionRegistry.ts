/**
 * Extension Registry for OSS/EE Plugin Architecture
 *
 * This registry allows the EE plugin to register UI components, routes, and features
 * without requiring any EE-specific code in the OSS codebase.
 *
 * OSS defines extension points (slots) → EE fills them at runtime
 */

import type { RouteObject } from 'react-router-dom';
import type { ComponentType, ReactNode } from 'react';
import type { AuthzResourceType } from '@enterpriseglue/shared/authz/permission-actions.js';

export type ExtensionAuthzBackendRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ExtensionAuthzBackendRoute {
  method: ExtensionAuthzBackendRouteMethod;
  path: string;
  actionId?: string;
}

export interface ExtensionRouteAuthzMetadata {
  /** Action id required to enter this extension route. */
  actionId?: string;
  /** Any matching action allows route entry. */
  actionIds?: string[];
  /** Resource type used for action evaluation. Defaults to the action resource type. */
  actionResourceType?: AuthzResourceType;
  /** Optional static resource id used for action evaluation. */
  actionResourceId?: string | null;
  /** Optional backend/OpenAPI manifest rows the extension route depends on. */
  backendRoutes?: ExtensionAuthzBackendRoute[];
}

export type ExtensionRouteHandle = Record<string, unknown> & {
  enterpriseglueAuthz?: ExtensionRouteAuthzMetadata;
};

export type EnterpriseExtensionRoute = RouteObject & {
  authz?: ExtensionRouteAuthzMetadata;
  handle?: ExtensionRouteHandle;
  children?: EnterpriseExtensionRoute[];
};

// =============================================================================
// Extension Types
// =============================================================================

/**
 * Sidebar navigation item extension
 */
export interface NavExtension {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  path: string;
  order?: number;
  /** Action id required to show this item. Prefer action ids for route/menu parity. */
  actionId?: string;
  /** Any matching action allows the item. */
  actionIds?: string[];
  /** Resource type used for action evaluation. Defaults to platform for admin/menu items. */
  actionResourceType?: AuthzResourceType;
  /** Optional resource id used for action evaluation. */
  actionResourceId?: string | null;
  /** Permission required to show this item. Use permission ids, not legacy capability flags. */
  requiredPermission?: string;
  /** Any matching permission allows the item. */
  requiredPermissions?: string[];
  /** Whether tenant admin access is required (platform admins also allowed). */
  requiresTenantAdmin?: boolean;
  /** @deprecated Use requiredPermission/requiredPermissions/requiresTenantAdmin instead. */
  requiredRole?: 'admin' | 'tenant_admin' | 'member';
  /** Section determines where the nav item appears:
   * - 'main': Main navigation area
   * - 'admin': Platform admin menu (requires admin role)
   * - 'tenant-admin': Tenant admin menu (requires tenant_admin role)
   * - 'settings': Settings area
   * - 'tenant': Tenant-specific area
   */
  section?: 'main' | 'admin' | 'tenant-admin' | 'settings' | 'tenant';
  /** If true, only show when multi-tenant is enabled */
  tenantOnly?: boolean;
}

/**
 * Header component slot
 */
export interface HeaderSlot {
  id: string;
  component: ComponentType<Record<string, unknown>>;
  position: 'left' | 'center' | 'right';
  order?: number;
}

/**
 * Dropdown menu item extension
 */
export interface MenuExtension {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  onClick?: () => void;
  href?: string;
  divider?: boolean;
  order?: number;
  /** Action id required to show this item. Prefer action ids for route/menu parity. */
  actionId?: string;
  /** Any matching action allows the item. */
  actionIds?: string[];
  /** Resource type used for action evaluation. Defaults to platform for admin/menu items. */
  actionResourceType?: AuthzResourceType;
  /** Optional resource id used for action evaluation. */
  actionResourceId?: string | null;
  /** Permission required to show this item. Use permission ids, not legacy capability flags. */
  requiredPermission?: string;
  /** Any matching permission allows the item. */
  requiredPermissions?: string[];
  /** Whether tenant admin access is required (platform admins also allowed). */
  requiresTenantAdmin?: boolean;
  /** @deprecated Use requiredPermission/requiredPermissions/requiresTenantAdmin instead. */
  requiredRole?: 'admin' | 'tenant_admin' | 'member';
}

/**
 * Feature flag override from EE plugin
 */
export interface FeatureOverride {
  flag: string;
  enabled: boolean;
}

/**
 * Component override (replace OSS component with EE version)
 */
export interface ComponentOverride {
  name: string;
  component: ComponentType<Record<string, unknown>>;
}

// =============================================================================
// Extension Registry
// =============================================================================

export interface ExtensionRegistry {
  /** Routes for root layout (/) */
  rootRoutes: EnterpriseExtensionRoute[];

  /** Routes for tenant layout (/t/:tenantSlug) */
  tenantRoutes: EnterpriseExtensionRoute[];

  /** Sidebar navigation items */
  navItems: NavExtension[];

  /** Header/dropdown menu items */
  menuItems: MenuExtension[];

  /** Header component slots */
  headerSlots: HeaderSlot[];

  /** Feature flag overrides */
  featureOverrides: FeatureOverride[];

  /** Component overrides (name → component) */
  componentOverrides: Map<string, ComponentType<Record<string, unknown>>>;

  /** Whether the registry has been initialized by EE plugin */
  initialized: boolean;
}

/**
 * Global extension registry instance
 * In OSS: remains empty (default values)
 * In EE: populated by enterprise plugin during initialization
 */
export const extensions: ExtensionRegistry = {
  rootRoutes: [],
  tenantRoutes: [],
  navItems: [],
  menuItems: [],
  headerSlots: [],
  featureOverrides: [],
  componentOverrides: new Map(),
  initialized: false,
};

// =============================================================================
// Registration Functions (called by EE plugin)
// =============================================================================

/**
 * Register a root-level route (mounted at /)
 */
export function registerRootRoute(route: EnterpriseExtensionRoute): void {
  extensions.rootRoutes.push(route);
}

/**
 * Register a tenant-scoped route (mounted at /t/:tenantSlug)
 */
export function registerTenantRoute(route: EnterpriseExtensionRoute): void {
  extensions.tenantRoutes.push(route);
}

/**
 * Register a sidebar navigation item
 */
export function registerNavItem(item: NavExtension): void {
  extensions.navItems.push(item);
  // Sort by order after adding
  extensions.navItems.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Register multiple nav items at once
 */
export function registerNavItems(items: NavExtension[]): void {
  items.forEach(item => extensions.navItems.push(item));
  extensions.navItems.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Register a header/dropdown menu item
 */
export function registerMenuItem(item: MenuExtension): void {
  extensions.menuItems.push(item);
  extensions.menuItems.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Register a header slot component
 */
export function registerHeaderSlot(slot: HeaderSlot): void {
  extensions.headerSlots.push(slot);
  extensions.headerSlots.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Register a feature flag override
 */
export function registerFeatureOverride(override: FeatureOverride): void {
  // Remove existing override for same flag if present
  const idx = extensions.featureOverrides.findIndex(o => o.flag === override.flag);
  if (idx >= 0) {
    extensions.featureOverrides.splice(idx, 1);
  }
  extensions.featureOverrides.push(override);
}

/**
 * Register a component override (replaces OSS component)
 */
export function registerComponentOverride(
  name: string,
  component: ComponentType<Record<string, unknown>>
): void {
  extensions.componentOverrides.set(name, component);
}

/**
 * Mark the registry as initialized (called after EE plugin loads)
 */
export function markInitialized(): void {
  extensions.initialized = true;
}

// =============================================================================
// Query Functions (called by OSS components)
// =============================================================================

/**
 * Get a component override by name
 * Returns undefined if no override registered (OSS shows fallback)
 */
export function getComponentOverride(
  name: string
): ComponentType<Record<string, unknown>> | undefined {
  return extensions.componentOverrides.get(name);
}

/**
 * Check if a feature is enabled (with EE override support)
 */
export function isFeatureEnabled(flag: string, defaultValue: boolean = false): boolean {
  const override = extensions.featureOverrides.find(o => o.flag === flag);
  if (override !== undefined) {
    return override.enabled;
  }
  return defaultValue;
}

/**
 * Get nav items for a specific section
 */
export function getNavItemsBySection(section: NavExtension['section']): NavExtension[] {
  return extensions.navItems.filter(item => item.section === section);
}

/**
 * Get header slots for a specific position
 */
export function getHeaderSlotsByPosition(position: HeaderSlot['position']): HeaderSlot[] {
  return extensions.headerSlots
    .filter(slot => slot.position === position)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/**
 * Check if multi-tenant mode is enabled (EE feature)
 */
export function isMultiTenantEnabled(): boolean {
  return isFeatureEnabled('multiTenant', false);
}

// =============================================================================
// Bulk Registration (for EE plugin initialization)
// =============================================================================

export interface PluginExtensions {
  rootRoutes?: EnterpriseExtensionRoute[];
  tenantRoutes?: EnterpriseExtensionRoute[];
  navItems?: NavExtension[];
  menuItems?: MenuExtension[];
  headerSlots?: HeaderSlot[];
  featureOverrides?: FeatureOverride[];
  componentOverrides?: Array<{ name: string; component: ComponentType<Record<string, unknown>> }>;
}

/**
 * Register all extensions from a plugin at once
 */
export function registerPluginExtensions(plugin: PluginExtensions): void {
  if (plugin.rootRoutes) {
    plugin.rootRoutes.forEach(r => extensions.rootRoutes.push(r));
  }
  if (plugin.tenantRoutes) {
    plugin.tenantRoutes.forEach(r => extensions.tenantRoutes.push(r));
  }
  if (plugin.navItems) {
    registerNavItems(plugin.navItems);
  }
  if (plugin.menuItems) {
    plugin.menuItems.forEach(m => registerMenuItem(m));
  }
  if (plugin.headerSlots) {
    plugin.headerSlots.forEach(s => registerHeaderSlot(s));
  }
  if (plugin.featureOverrides) {
    plugin.featureOverrides.forEach(o => registerFeatureOverride(o));
  }
  if (plugin.componentOverrides) {
    plugin.componentOverrides.forEach(c => registerComponentOverride(c.name, c.component));
  }
  markInitialized();
}
