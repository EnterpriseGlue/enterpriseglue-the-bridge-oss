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
  type HeaderSlot,
} from './extensionRegistry';
import type { User } from '../shared/types/auth';

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

// =============================================================================
// ExtensionNavItems - Renders extension nav items for a section
// =============================================================================

interface ExtensionNavItemsProps {
  /** Section to filter nav items */
  section: NavExtension['section'];
  /** Render function for each nav item */
  renderItem: (item: NavExtension) => React.ReactNode;
  /** Current user capabilities for filtering */
  capabilities?: User['capabilities'];
  /** Tenant-admin status for tenant-scoped items */
  isTenantAdmin?: boolean;
  /** Whether multi-tenant is enabled (for filtering tenantOnly items) */
  multiTenantEnabled?: boolean;
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
  renderItem,
  capabilities,
  isTenantAdmin,
  multiTenantEnabled = false,
}: ExtensionNavItemsProps): React.ReactElement | null {
  const items = getNavItemsBySection(section);
  const canAccessAdminRoutes = Boolean(capabilities?.canAccessAdminRoutes);
  const hasTenantAdminAccess = Boolean(isTenantAdmin);
  const hasCapability = (capability?: NavExtension['requiredCapability']) =>
    !capability || Boolean(capabilities?.[capability]);
  
  // Filter items based on role and tenant requirements
  const filteredItems = items.filter(item => {
    // Check tenant-only items
    if (item.tenantOnly && !multiTenantEnabled) {
      return false;
    }
    
    // Check capability requirements
    if (item.requiredCapability && !hasCapability(item.requiredCapability)) {
      return false;
    }
    if (item.requiresTenantAdmin && !hasTenantAdminAccess && !canAccessAdminRoutes) {
      return false;
    }

    // Check role requirements (deprecated)
    if (item.requiredRole === 'admin' && !canAccessAdminRoutes) {
      return false;
    }
    if (item.requiredRole === 'tenant_admin' && !hasTenantAdminAccess && !canAccessAdminRoutes) {
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
// ExtensionMenuItems - Renders extension menu items
// =============================================================================

interface ExtensionMenuItemsProps {
  /** Render function for each menu item */
  renderItem: (item: typeof extensions.menuItems[0]) => React.ReactNode;
  /** Current user capabilities for filtering */
  capabilities?: User['capabilities'];
  /** Tenant-admin status for tenant-scoped items */
  isTenantAdmin?: boolean;
}

/**
 * Renders extension menu items (for dropdowns, etc.)
 */
export function ExtensionMenuItems({ 
  renderItem,
  capabilities,
  isTenantAdmin,
}: ExtensionMenuItemsProps): React.ReactElement | null {
  const items = extensions.menuItems;
  const canAccessAdminRoutes = Boolean(capabilities?.canAccessAdminRoutes);
  const hasTenantAdminAccess = Boolean(isTenantAdmin);
  const hasCapability = (capability?: (typeof extensions.menuItems)[number]['requiredCapability']) =>
    !capability || Boolean(capabilities?.[capability]);
  
  // Filter items based on capability
  const filteredItems = items.filter(item => {
    if (item.requiredCapability && !hasCapability(item.requiredCapability)) {
      return false;
    }
    if (item.requiresTenantAdmin && !hasTenantAdminAccess && !canAccessAdminRoutes) {
      return false;
    }

    // Role requirements (deprecated)
    if (item.requiredRole === 'admin' && !canAccessAdminRoutes) {
      return false;
    }
    if (item.requiredRole === 'tenant_admin' && !hasTenantAdminAccess && !canAccessAdminRoutes) {
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
