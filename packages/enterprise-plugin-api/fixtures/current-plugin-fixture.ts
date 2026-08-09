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
  EnterpriseBackendRouteAuthz,
  ConnectionPool,
  EnterpriseDatabaseContext,
} from '@enterpriseglue/enterprise-plugin-api/backend';

// ---------------------------------------------------------------------------
// Frontend plugin fixture (consumer simulation)
// ---------------------------------------------------------------------------

const routes: EnterpriseRoute[] = [{
  path: '/enterprise',
  authz: {
    actionId: 'platform.settings.read',
    actionResourceType: 'platform',
    backendRoutes: [{ method: 'GET', path: '/api/admin/settings', actionId: 'platform.settings.read' }],
  },
}];
const tenantRoutes: EnterpriseRoute[] = [{
  path: '/t/:tenantSlug/enterprise',
  handle: {
    enterpriseglueAuthz: {
      actionId: 'platform.settings.read',
      actionResourceType: 'platform',
    },
  },
}];
const navItems: EnterpriseNavItem[] = [{
  id: 'enterprise-nav',
  label: 'Enterprise',
  path: '/enterprise',
  actionId: 'platform.settings.read',
  actionResourceType: 'platform',
  requiredPermission: 'platform:settings:manage',
}];
const menuItems: EnterpriseMenuItem[] = [{
  id: 'enterprise-menu',
  label: 'Enterprise',
  actionIds: ['platform.authz.roles.read', 'platform.settings.read'],
  actionResourceType: 'platform',
  requiredPermissions: ['platform:authz:roles:view', 'platform:settings:manage'],
}];
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

const backendAuthzRoutes: EnterpriseBackendRouteAuthz[] = [{
  method: 'GET',
  path: '/api/enterprise/settings',
  actionId: 'platform.settings.read',
  resourceResolver: 'platform.self',
  additionalChecks: ['enterprise-feature-enabled'],
  openApiOperationId: 'getEnterpriseSettings',
}];

export const backendPluginFixture: EnterpriseBackendPlugin = {
  registerRoutes: async (_app: unknown, _ctx: EnterpriseBackendContext) => {
    const guard = _ctx.authz.requireAction('platform.settings.read', {
      resourceResolver: 'platform.self',
    });
    const compositeGuard = _ctx.authz.requireCompositeAction('project-engine-target.deploy.use', {
      mode: 'manual',
      projectIdFrom: 'body',
      engineIdFrom: 'body',
    });
    const declaredGuard = _ctx.authz.requireDeclaredAction(backendAuthzRoutes, 'GET', '/api/enterprise/settings', {
      resourceIdFrom: 'params',
    });
    const openApiAuthz = _ctx.authz.buildOpenApiAuthzMetadata(backendAuthzRoutes);
    void guard;
    void compositeGuard;
    void declaredGuard;
    void openApiAuthz[0]?.extension;
  },
  authzRoutes: backendAuthzRoutes,
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

const database: EnterpriseDatabaseContext = {
  kind: 'typeorm',
  databaseType: 'postgres',
  async getDataSource<TDataSource = unknown>() {
    return {} as TDataSource;
  },
  async transaction(work) {
    return work({});
  },
};

export const backendContextFixture: EnterpriseBackendContext = {
  database,
  connectionPool,
  config: {},
  authz: {
    requireAction() {
      return () => undefined;
    },
    requireCompositeAction() {
      return () => undefined;
    },
    requireDeclaredAction() {
      return () => undefined;
    },
    buildOpenApiAuthzMetadata() {
      return [];
    },
  },
};
