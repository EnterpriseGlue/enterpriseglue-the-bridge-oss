/**
 * Extension Slot Components
 *
 * These components render EE extensions or fallback content.
 * In OSS: renders fallback (usually null)
 * In EE: renders registered component from extension registry
 */

import React from 'react';
import {
  getComponentOverride,
  getHeaderSlotsByPosition,
  getNavItemsBySection,
  extensions,
  type NavExtension,
  type MenuExtension,
  type HeaderSlot,
} from './extensionRegistry';
import { AuthContext } from '../contexts/AuthContext';
import { evaluateActionSnapshot, type ActionResource } from '../shared/auth/guards';
import { ADMIN_NAV_PLATFORM_PERMISSIONS } from '../shared/auth/permissions';
import type { CurrentUserPermissions } from '../shared/types/auth';

// =============================================================================
// ExtensionSlot - Renders a named component slot
// =============================================================================

interface ExtensionSlotProps {
  /** Name of the component slot (e.g., 'tenant-picker') */
  name: string;
  /** Fallback content when no component is registered */
  fallback?: React.ReactNode;
  /** Props to pass to the registered component */
  props?: Record<string, unknown>;
}

/**
 * Renders a registered component or fallback
 *
 * Usage in OSS:
 * ```tsx
 * <ExtensionSlot name="tenant-picker" />
 * // Renders nothing in OSS, TenantPicker in EE
 * ```
 */
export function ExtensionSlot({
  name,
  fallback = null,
  props = {}
}: ExtensionSlotProps): React.ReactElement | null {
  const Component = getComponentOverride(name);

  if (!Component) {
    return <>{fallback}</>;
  }

  return <Component {...props} />;
}

// =============================================================================
// HeaderSlots - Renders all header slots for a position
// =============================================================================

interface HeaderSlotsProps {
  /** Position of slots to render */
  position: 'left' | 'center' | 'right';
  /** Additional className for the container */
  className?: string;
}

/**
 * Renders all header slots registered for a position
 *
 * Usage:
 * ```tsx
 * <header>
 *   <HeaderSlots position="left" />
 *   <HeaderSlots position="center" />  // TenantPicker in EE
 *   <HeaderSlots position="right" />
 * </header>
 * ```
 */
export function HeaderSlots({ position, className }: HeaderSlotsProps): React.ReactElement | null {
  const slots = getHeaderSlotsByPosition(position);

  if (slots.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      {slots.map(slot => (
        <slot.component key={slot.id} />
      ))}
    </div>
  );
}

export interface ExtensionPermissionChecks {
  permissions: CurrentUserPermissions | null;
  hasPlatformPermission: (permission: string) => boolean;
  hasAnyPlatformPermission: (permissions: string[]) => boolean;
  hasAnyEnginePermission: (permissions: string[]) => boolean;
}

function useExtensionPermissionChecks(): ExtensionPermissionChecks {
  const auth = React.useContext(AuthContext);
  return {
    permissions: auth?.permissions ?? null,
    hasPlatformPermission: auth?.hasPlatformPermission ?? (() => false),
    hasAnyPlatformPermission: auth?.hasAnyPlatformPermission ?? (() => false),
    hasAnyEnginePermission: auth?.hasAnyEnginePermission ?? (() => false),
  };
}

function hasAnyProjectPermissionAcrossProjects(
  snapshot: CurrentUserPermissions | null,
  permissions: string[]
): boolean {
  return Boolean(snapshot?.projects?.some((project) =>
    permissions.some((permission) => project.permissions.includes(permission))
  ));
}

function extensionRequiredPermissions(
  item: Pick<NavExtension | MenuExtension, 'requiredPermission' | 'requiredPermissions'>
): string[] {
  return [
    ...(item.requiredPermission ? [item.requiredPermission] : []),
    ...(Array.isArray(item.requiredPermissions) ? item.requiredPermissions : []),
  ].filter(Boolean);
}

function hasExtensionPermission(permission: string, checks: ExtensionPermissionChecks): boolean {
  if (permission.startsWith('platform:')) {
    return checks.hasPlatformPermission(permission);
  }
  if (permission.startsWith('engine:')) {
    return checks.hasAnyEnginePermission([permission]);
  }
  if (permission.startsWith('project:')) {
    return hasAnyProjectPermissionAcrossProjects(checks.permissions, [permission]);
  }
  return checks.hasPlatformPermission(permission) ||
    checks.hasAnyEnginePermission([permission]) ||
    hasAnyProjectPermissionAcrossProjects(checks.permissions, [permission]);
}

function hasRequiredExtensionPermissions(
  item: Pick<NavExtension | MenuExtension, 'requiredPermission' | 'requiredPermissions'>,
  checks: ExtensionPermissionChecks
): boolean {
  const permissions = extensionRequiredPermissions(item);
  if (permissions.length === 0) return true;
  return permissions.some((permission) => hasExtensionPermission(permission, checks));
}

function extensionActionIds(
  item: Pick<NavExtension | MenuExtension, 'actionId' | 'actionIds'>
): string[] {
  return [
    ...(item.actionId ? [item.actionId] : []),
    ...(Array.isArray(item.actionIds) ? item.actionIds : []),
  ].filter(Boolean);
}

function extensionActionResource(
  item: Pick<NavExtension | MenuExtension, 'actionResourceType' | 'actionResourceId'>
): ActionResource {
  return {
    type: item.actionResourceType ?? 'platform',
    id: item.actionResourceId ?? null,
  };
}

function hasRequiredExtensionActions(
  item: Pick<NavExtension | MenuExtension, 'actionId' | 'actionIds' | 'actionResourceType' | 'actionResourceId'>,
  checks: ExtensionPermissionChecks
): boolean {
  const actionIds = extensionActionIds(item);
  if (actionIds.length === 0) return true;
  const resource = extensionActionResource(item);
  return actionIds.some((actionId) => evaluateActionSnapshot(checks.permissions, actionId, resource).allowed);
}

// =============================================================================
// ExtensionNavItems - Renders extension nav items for a section
// =============================================================================

interface ExtensionNavItemsProps {
  /** Section to filter nav items */
  section?: NavExtension['section'];
  /** Optional explicit nav item list. Defaults to registered items in section. */
  items?: NavExtension[];
  /** Render function for each nav item */
  renderItem: (item: NavExtension) => React.ReactNode;
  /** @deprecated Extension visibility is permission-driven; this value is ignored. */
  capabilities?: unknown;
  /** Tenant-admin status for tenant-scoped items */
  isTenantAdmin?: boolean;
  /** Whether multi-tenant is enabled (for filtering tenantOnly items) */
  multiTenantEnabled?: boolean;
}

export function useFilteredExtensionNavItems({
  section,
  items,
  capabilities: _capabilities,
  isTenantAdmin,
  multiTenantEnabled = false,
}: Omit<ExtensionNavItemsProps, 'renderItem'>): NavExtension[] {
  const permissionChecks = useExtensionPermissionChecks();
  const candidateItems = items ?? getNavItemsBySection(section);
  const hasAdminRoutePermission = permissionChecks.hasAnyPlatformPermission(ADMIN_NAV_PLATFORM_PERMISSIONS);
  const hasTenantAdminAccess = Boolean(isTenantAdmin);

  return candidateItems.filter(item => {
    if (item.tenantOnly && !multiTenantEnabled) {
      return false;
    }

    if (!hasRequiredExtensionPermissions(item, permissionChecks)) {
      return false;
    }
    if (!hasRequiredExtensionActions(item, permissionChecks)) {
      return false;
    }
    if (item.requiresTenantAdmin && !hasTenantAdminAccess && !hasAdminRoutePermission) {
      return false;
    }

    if (item.requiredRole === 'admin' && !hasAdminRoutePermission) {
      return false;
    }
    if (item.requiredRole === 'tenant_admin' && !hasTenantAdminAccess && !hasAdminRoutePermission) {
      return false;
    }

    return true;
  });
}

/**
 * Renders extension nav items for a specific section
 *
 * Usage:
 * ```tsx
 * <ExtensionNavItems
 *   section="admin"
 *   renderItem={(item) => (
 *     <NavLink to={item.path}>
 *       {item.icon && <item.icon size={16} />}
 *       {item.label}
 *     </NavLink>
 *   )}
 * />
 * ```
 */
export function ExtensionNavItems({
  section,
  items,
  renderItem,
  capabilities,
  isTenantAdmin,
  multiTenantEnabled = false,
}: ExtensionNavItemsProps): React.ReactElement | null {
  const filteredItems = useFilteredExtensionNavItems({
    section,
    items,
    capabilities,
    isTenantAdmin,
    multiTenantEnabled,
  });

  if (filteredItems.length === 0) {
    return null;
  }

  return (
    <>
      {filteredItems.map(item => (
        <React.Fragment key={item.id}>
          {renderItem(item)}
        </React.Fragment>
      ))}
    </>
  );
}

// =============================================================================
// ExtensionMenuItems - Renders extension menu items
// =============================================================================

interface ExtensionMenuItemsProps {
  /** Render function for each menu item */
  renderItem: (item: MenuExtension) => React.ReactNode;
  /** @deprecated Extension visibility is permission-driven; this value is ignored. */
  capabilities?: unknown;
  /** Tenant-admin status for tenant-scoped items */
  isTenantAdmin?: boolean;
}

/**
 * Renders extension menu items (for dropdowns, etc.)
 */
export function ExtensionMenuItems({
  renderItem,
  capabilities: _capabilities,
  isTenantAdmin,
}: ExtensionMenuItemsProps): React.ReactElement | null {
  const permissionChecks = useExtensionPermissionChecks();
  const items = extensions.menuItems;
  const hasAdminRoutePermission = permissionChecks.hasAnyPlatformPermission(ADMIN_NAV_PLATFORM_PERMISSIONS);
  const hasTenantAdminAccess = Boolean(isTenantAdmin);

  // Filter items based on capability
  const filteredItems = items.filter(item => {
    if (!hasRequiredExtensionPermissions(item, permissionChecks)) {
      return false;
    }
    if (!hasRequiredExtensionActions(item, permissionChecks)) {
      return false;
    }
    if (item.requiresTenantAdmin && !hasTenantAdminAccess && !hasAdminRoutePermission) {
      return false;
    }

    // Role requirements (deprecated)
    if (item.requiredRole === 'admin' && !hasAdminRoutePermission) {
      return false;
    }
    if (item.requiredRole === 'tenant_admin' && !hasTenantAdminAccess && !hasAdminRoutePermission) {
      return false;
    }
    return true;
  });

  if (filteredItems.length === 0) {
    return null;
  }

  return (
    <>
      {filteredItems.map(item => (
        <React.Fragment key={item.id}>
          {renderItem(item)}
        </React.Fragment>
      ))}
    </>
  );
}

// =============================================================================
// ExtensionPage - Renders a page from extension registry or fallback
// =============================================================================

interface ExtensionPageProps {
  /** Name of the page component slot */
  name: string;
  /** Fallback content when no component is registered (e.g., "Feature not available") */
  fallback?: React.ReactNode;
  /** Props to pass to the registered component */
  props?: Record<string, unknown>;
}

/**
 * Renders a full page from extension registry or shows fallback
 * Used for EE-only pages like TenantManagement, TenantSettings, etc.
 *
 * Usage:
 * ```tsx
 * <ExtensionPage
 *   name="tenant-management-page"
 *   fallback={<div>This feature requires Enterprise Edition</div>}
 * />
 * ```
 */
export function ExtensionPage({
  name,
  fallback,
  props = {}
}: ExtensionPageProps): React.ReactElement {
  const Component = getComponentOverride(name);

  if (!Component) {
    // Default fallback for pages
    const defaultFallback = (
      <div style={{
        padding: 'var(--spacing-7)',
        textAlign: 'center',
        color: 'var(--cds-text-secondary)'
      }}>
        <h2>Feature Not Available</h2>
        <p>This feature requires Enterprise Edition.</p>
      </div>
    );
    return <>{fallback ?? defaultFallback}</>;
  }

  return <Component {...props} />;
}

// =============================================================================
// useExtensions hook - Access extension state in components
// =============================================================================

/**
 * Hook to access extension registry state
 */
export function useExtensions() {
  return {
    initialized: extensions.initialized,
    hasRoutes: extensions.rootRoutes.length > 0 || extensions.tenantRoutes.length > 0,
    hasNavItems: extensions.navItems.length > 0,
    hasMenuItems: extensions.menuItems.length > 0,
    hasHeaderSlots: extensions.headerSlots.length > 0,
  };
}
