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

// =============================================================================
// Extension Types
// =============================================================================

export type CapabilityRequirement =
  | 'canViewAdminMenu'
  | 'canAccessAdminRoutes'
  | 'canManageUsers'
  | 'canViewAuditLogs'
  | 'canManagePlatformSettings'
  | 'canViewMissionControl'
  | 'canManageTenants'
  | 'canManagePlatformEmail'
  | 'canManageSsoProviders'
  | 'canManagePlatformBranding'
  | 'canManageTenantDomains'
  | 'canManageTenantUsers'
  | 'canManageTenantBranding'
  | 'canManageTenantEmailTemplates'
  | 'canViewTenantAudit'
  | 'canManageTenantSso'
  | 'canManageProject'
  | 'canManageEngine'
  | 'canInviteProjectMembers'
  | 'canInviteEngineMembers';

/**
 * Sidebar navigation item extension
 */
export interface NavExtension {
  id: string;
  label: string;
  icon?: ComponentType<{ size?: number }>;
  path: string;
  order?: number;
  /** Capability required to show this item. */
  requiredCapability?: CapabilityRequirement;
  /** Whether tenant admin access is required (platform admins also allowed). */
  requiresTenantAdmin?: boolean;
  /** @deprecated Use requiredCapability/requiresTenantAdmin instead. */
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
  /** Capability required to show this item. */
  requiredCapability?: CapabilityRequirement;
  /** Whether tenant admin access is required (platform admins also allowed). */
  requiresTenantAdmin?: boolean;
  /** @deprecated Use requiredCapability/requiresTenantAdmin instead. */
  requiredRole?: 'admin' | 'tenant_admin' | 'member';
}

/**
 * Feature flag override from EE plugin
 *
 * @deprecated Legacy singular enterprise-plugin bridge only. Native plugins
 * must use additive, manifest-declared contributions and host capabilities.
 */
export interface FeatureOverride {
  flag: string;
  enabled: boolean;
}

/**
 * Component override (replace OSS component with EE version)
 *
 * @deprecated Legacy singular enterprise-plugin bridge only. Native plugins
 * must use typed additive slots from `@enterpriseglue/plugin-sdk`.
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
  rootRoutes: RouteObject[];
  
  /** Routes for tenant layout (/t/:tenantSlug) */
  tenantRoutes: RouteObject[];
  
  /** Sidebar navigation items */
  navItems: NavExtension[];
  
  /** Header/dropdown menu items */
  menuItems: MenuExtension[];
  
  /** Header component slots */
  headerSlots: HeaderSlot[];
  
  /** @deprecated Legacy singular enterprise-plugin bridge only. */
  featureOverrides: FeatureOverride[];
  
  /** @deprecated Legacy singular enterprise-plugin bridge only. */
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

/**
 * Stable owner used by the temporary singular enterprise-plugin bridge.
 *
 * Native v2 plugins use the neutral plugin runtime. This owner-aware bridge
 * exists so the legacy package can be replaced or removed atomically while
 * consumers migrate.
 */
export const LEGACY_ENTERPRISE_PLUGIN_OWNER =
  'io.enterpriseglue.legacy-enterprise';

// =============================================================================
// Registration Functions (called by EE plugin)
// =============================================================================

/**
 * Register a root-level route (mounted at /)
 */
export function registerRootRoute(route: RouteObject): void {
  extensions.rootRoutes.push(route);
}

/**
 * Register a tenant-scoped route (mounted at /t/:tenantSlug)
 */
export function registerTenantRoute(route: RouteObject): void {
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
 *
 * @deprecated Legacy enterprise integration only. Native plugins cannot
 * replace host feature flags.
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
 *
 * @deprecated Legacy enterprise integration only. Native plugins must
 * contribute through typed additive slots.
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
  rootRoutes?: RouteObject[];
  tenantRoutes?: RouteObject[];
  navItems?: NavExtension[];
  menuItems?: MenuExtension[];
  headerSlots?: HeaderSlot[];
  /** @deprecated Legacy singular enterprise-plugin bridge only. */
  featureOverrides?: FeatureOverride[];
  /** @deprecated Legacy singular enterprise-plugin bridge only. */
  componentOverrides?: Array<{ name: string; component: ComponentType<Record<string, unknown>> }>;
}

const pluginExtensionsByOwner = new Map<string, PluginExtensions>();
const ownerIdPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function copyPluginExtensions(plugin: PluginExtensions): PluginExtensions {
  return {
    rootRoutes: [...(plugin.rootRoutes ?? [])],
    tenantRoutes: [...(plugin.tenantRoutes ?? [])],
    navItems: [...(plugin.navItems ?? [])],
    menuItems: [...(plugin.menuItems ?? [])],
    headerSlots: [...(plugin.headerSlots ?? [])],
    featureOverrides: [...(plugin.featureOverrides ?? [])],
    componentOverrides: [...(plugin.componentOverrides ?? [])],
  };
}

function assertUniqueOwnedKeys(
  records: ReadonlyMap<string, PluginExtensions>,
): void {
  const keys = new Map<string, string>();

  const claim = (kind: string, key: string, ownerId: string) => {
    const composite = `${kind}:${key}`;
    const existingOwner = keys.get(composite);
    if (existingOwner && existingOwner !== ownerId) {
      throw new Error(
        `[Enterprise] Legacy plugin extension conflict for ${composite}: ${existingOwner} and ${ownerId}`,
      );
    }
    keys.set(composite, ownerId);
  };

  for (const [ownerId, plugin] of records) {
    for (const route of plugin.rootRoutes ?? []) {
      if (typeof route.path === 'string') claim('root-route', route.path, ownerId);
    }
    for (const route of plugin.tenantRoutes ?? []) {
      if (typeof route.path === 'string') claim('tenant-route', route.path, ownerId);
    }
    for (const item of plugin.navItems ?? []) claim('navigation', item.id, ownerId);
    for (const item of plugin.menuItems ?? []) claim('menu', item.id, ownerId);
    for (const slot of plugin.headerSlots ?? []) claim('header-slot', slot.id, ownerId);
    for (const override of plugin.featureOverrides ?? []) {
      claim('feature-override', override.flag, ownerId);
    }
    for (const override of plugin.componentOverrides ?? []) {
      claim('component-override', override.name, ownerId);
    }
  }
}

function rebuildOwnedExtensions(
  records: ReadonlyMap<string, PluginExtensions>,
): void {
  const orderedRecords = [...records.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );

  extensions.rootRoutes = orderedRecords.flatMap(
    ([, plugin]) => plugin.rootRoutes ?? [],
  );
  extensions.tenantRoutes = orderedRecords.flatMap(
    ([, plugin]) => plugin.tenantRoutes ?? [],
  );
  extensions.navItems = orderedRecords
    .flatMap(([, plugin]) => plugin.navItems ?? [])
    .sort(
      (left, right) =>
        (left.order ?? 100) - (right.order ?? 100) ||
        left.id.localeCompare(right.id),
    );
  extensions.menuItems = orderedRecords
    .flatMap(([, plugin]) => plugin.menuItems ?? [])
    .sort(
      (left, right) =>
        (left.order ?? 100) - (right.order ?? 100) ||
        left.id.localeCompare(right.id),
    );
  extensions.headerSlots = orderedRecords
    .flatMap(([, plugin]) => plugin.headerSlots ?? [])
    .sort(
      (left, right) =>
        (left.order ?? 100) - (right.order ?? 100) ||
        left.id.localeCompare(right.id),
    );
  extensions.featureOverrides = orderedRecords.flatMap(
    ([, plugin]) => plugin.featureOverrides ?? [],
  );
  extensions.componentOverrides = new Map(
    orderedRecords.flatMap(([, plugin]) =>
      (plugin.componentOverrides ?? []).map(
        ({ name, component }) => [name, component] as const,
      ),
    ),
  );
  extensions.initialized = records.size > 0;
}

/**
 * Atomically activate or replace a complete legacy plugin record.
 *
 * This compatibility API deliberately does not make legacy feature/component
 * overrides available to native v2 plugins.
 */
export function replacePluginExtensions(
  ownerId: string,
  plugin: PluginExtensions,
): void {
  if (!ownerIdPattern.test(ownerId)) {
    throw new Error(
      `[Enterprise] Legacy plugin owner must be a lowercase reverse-DNS identifier: ${ownerId}`,
    );
  }
  if (
    ownerId !== LEGACY_ENTERPRISE_PLUGIN_OWNER &&
    ((plugin.featureOverrides?.length ?? 0) > 0 ||
      (plugin.componentOverrides?.length ?? 0) > 0)
  ) {
    throw new Error(
      '[Enterprise] Feature and component overrides are restricted to the legacy enterprise-plugin bridge',
    );
  }

  const candidate = new Map(pluginExtensionsByOwner);
  candidate.set(ownerId, copyPluginExtensions(plugin));
  assertUniqueOwnedKeys(candidate);

  pluginExtensionsByOwner.clear();
  for (const [id, record] of candidate) {
    pluginExtensionsByOwner.set(id, record);
  }
  rebuildOwnedExtensions(pluginExtensionsByOwner);
}

export function unregisterPluginExtensions(ownerId: string): boolean {
  const removed = pluginExtensionsByOwner.delete(ownerId);
  if (removed) {
    rebuildOwnedExtensions(pluginExtensionsByOwner);
  }
  return removed;
}

export function listPluginExtensionOwners(): string[] {
  return [...pluginExtensionsByOwner.keys()].sort();
}

/**
 * Register all extensions from a plugin at once
 */
export function registerPluginExtensions(plugin: PluginExtensions): void {
  replacePluginExtensions(LEGACY_ENTERPRISE_PLUGIN_OWNER, plugin);
}
