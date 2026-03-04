/**
 * Typed compatibility fixture for the current plugin-api contract.
 *
 * This file is compiled with `tsc --noEmit --strict` in CI to verify that
 * plugins conforming to the contract still compile after any type changes.
 *
 * Keep aligned with:
 * - ../src/frontend.d.ts
 * - ../src/backend.d.ts
 */

import type {
  EnterpriseFrontendPlugin,
  FrontendPluginContext,
  ComponentOverride,
  FeatureOverride,
  EnterpriseRoute,
  EnterpriseNavItem,
  EnterpriseMenuItem,
} from '@enterpriseglue/enterprise-plugin-api/frontend';

import type {
  EnterpriseBackendPlugin,
  EnterpriseBackendContext,
  ConnectionPool,
} from '@enterpriseglue/enterprise-plugin-api/backend';

// ---------------------------------------------------------------------------
// Frontend plugin fixture (consumer simulation)
// ---------------------------------------------------------------------------

const routes: EnterpriseRoute[] = [{ path: '/enterprise' }];
const tenantRoutes: EnterpriseRoute[] = [{ path: '/t/:tenantSlug/enterprise' }];
const navItems: EnterpriseNavItem[] = [{ id: 'enterprise-nav', label: 'Enterprise', path: '/enterprise' }];
const menuItems: EnterpriseMenuItem[] = [{ id: 'enterprise-menu', label: 'Enterprise' }];
const componentOverrides: ComponentOverride[] = [{ name: 'engines-page', component: () => null }];
const featureOverrides: FeatureOverride[] = [{ flag: 'multiTenant', enabled: true }];

export const frontendPluginFixture: EnterpriseFrontendPlugin = {
  routes,
  tenantRoutes,
  navItems,
  menuItems,
  componentOverrides,
  featureOverrides,
  init(context: FrontendPluginContext) {
    // Verify all context properties are accessible at the type level
    void context.api.client.get;
    void context.api.client.post;
    void context.api.client.put;
    void context.api.client.patch;
    void context.api.client.delete;
    void context.api.client.getBlob;
    void context.api.errors.ApiError;
    void context.api.errors.parseApiError;
    void context.api.errors.getUiErrorMessage;
    void context.api.errors.getErrorMessageFromResponse;
    void context.components.PageHeader;
    void context.components.PageLayout;
    void context.components.PAGE_GRADIENTS;
    void context.components.ConfirmModal;
    void context.components.InviteMemberModal;
    void context.hooks.useAuth;
    void context.hooks.useModal;
    void context.hooks.useToast;
  },
};

// ---------------------------------------------------------------------------
// Backend plugin fixture (consumer simulation)
// ---------------------------------------------------------------------------

export const backendPluginFixture: EnterpriseBackendPlugin = {
  registerRoutes: async (_app: unknown, _ctx: EnterpriseBackendContext) => {},
  migrateEnterpriseDatabase: async (_ctx: EnterpriseBackendContext) => {},
};

// ---------------------------------------------------------------------------
// Backend context fixture (host simulation)
// ---------------------------------------------------------------------------

const connectionPool: ConnectionPool = {
  async query() {
    return { rows: [], rowCount: 0 };
  },
  async close() {
    return;
  },
  getNativePool() {
    return {};
  },
};

export const backendContextFixture: EnterpriseBackendContext = {
  connectionPool,
  config: {},
};
