import { describe, expect, it } from 'vitest';
import {
  __enterpriseBackendPluginTestUtils,
  loadEnterpriseBackendPlugin,
} from '../../../packages/backend-host/src/enterprise/loadEnterpriseBackendPlugin.js';

describe('loadEnterpriseBackendPlugin validation helpers', () => {
  it('detects missing module errors by code', () => {
    expect(
      __enterpriseBackendPluginTestUtils.isMissingEnterprisePlugin({
        code: 'ERR_MODULE_NOT_FOUND',
      })
    ).toBe(true);
  });

  it('detects missing module errors by message', () => {
    expect(
      __enterpriseBackendPluginTestUtils.isMissingEnterprisePlugin({
        message: 'Cannot find module @enterpriseglue/enterprise-backend',
      })
    ).toBe(true);
  });

  it('rejects invalid plugin hook shapes', () => {
    expect(() => {
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        registerRoutes: 'not-a-function',
      });
    }).toThrow('registerRoutes');
  });

  it('accepts valid optional hooks', () => {
    expect(() => {
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        registerRoutes: async () => undefined,
        authzRoutes: [{
          method: 'GET',
          path: '/api/enterprise/settings',
          actionId: 'platform.settings.read',
          resourceResolver: 'platform.self',
          additionalChecks: ['enterprise-feature-enabled'],
          openApiOperationId: 'getEnterpriseSettings',
        }],
        migrateEnterpriseDatabase: async () => undefined,
        getNotificationTenantResolver: async () => ({
          resolve: () => ({ userId: 'user-1', tenantId: 'tenant-1' }),
        }),
      });
    }).not.toThrow();
  });

  it('rejects invalid backend route authz manifest shapes', () => {
    expect(() => {
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        authzRoutes: 'not-an-array',
      });
    }).toThrow('authzRoutes');
  });

  it('rejects backend route authz manifests with unknown action ids', () => {
    const unknownActionId = ['platform', 'settings', 'unknown'].join('.');

    expect(() => {
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        authzRoutes: [{
          method: 'GET',
          path: '/api/enterprise/settings',
          actionId: unknownActionId,
          resourceResolver: 'platform.self',
        }],
      });
    }).toThrow('unknown action id');
  });

  it('rejects backend route authz manifests with mismatched resource resolvers', () => {
    expect(() => {
      __enterpriseBackendPluginTestUtils.assertValidPluginShape({
        authzRoutes: [{
          method: 'GET',
          path: '/api/enterprise/project/:projectId',
          actionId: 'project.files.read',
          resourceResolver: 'platform.self',
        }],
      });
    }).toThrow('requires project');
  });

  it('builds OpenAPI authz metadata from backend route authz manifests', () => {
    const metadata = __enterpriseBackendPluginTestUtils.buildEnterpriseBackendRouteOpenApiAuthzMetadata([
      {
        method: 'GET',
        path: '/api/enterprise/settings',
        actionId: 'platform.settings.read',
        resourceResolver: 'platform.self',
        additionalChecks: ['enterprise-feature-enabled'],
        openApiOperationId: 'getEnterpriseSettings',
      },
      {
        method: 'POST',
        path: '/api/enterprise/internal-sync',
        actionId: 'platform.settings.manage',
        resourceResolver: 'platform.self',
        openApi: false,
      },
    ]);

    expect(metadata).toEqual([
      {
        method: 'GET',
        path: '/api/enterprise/settings',
        actionId: 'platform.settings.read',
        openApiOperationId: 'getEnterpriseSettings',
        extension: {
          actionId: 'platform.settings.read',
          permission: 'platform:settings:manage',
          resourceResolver: 'platform.self',
          additionalChecks: ['enterprise-feature-enabled'],
          risk: 'medium',
          audit: false,
          uiBehavior: 'hide',
        },
      },
    ]);
  });

  it('finds declared backend route authz entries using Express or OpenAPI path style', () => {
    const route = __enterpriseBackendPluginTestUtils.findEnterpriseBackendRouteAuthz([
      {
        method: 'GET',
        path: '/api/enterprise/projects/:projectId/settings',
        actionId: 'project.projects.update',
        resourceResolver: 'project.byId',
      },
    ], 'GET', '/api/enterprise/projects/{projectId}/settings');

    expect(route.actionId).toBe('project.projects.update');
    expect(route.resourceResolver).toBe('project.byId');
  });

  it('rejects declared backend route action lookup when the route is not declared', () => {
    expect(() => {
      __enterpriseBackendPluginTestUtils.findEnterpriseBackendRouteAuthz([
        {
          method: 'GET',
          path: '/api/enterprise/settings',
          actionId: 'platform.settings.read',
          resourceResolver: 'platform.self',
        },
      ], 'POST', '/api/enterprise/settings');
    }).toThrow('has no entry');
  });

  it('returns a valid plugin (noop in OSS, real in EE)', async () => {
    const plugin = await loadEnterpriseBackendPlugin();

    // In OSS mode the hooks are undefined (noop); in EE mode they are functions.
    // Both shapes are valid – assert no broken exports.
    if (plugin.registerRoutes !== undefined) {
      expect(typeof plugin.registerRoutes).toBe('function');
    }
    if (plugin.migrateEnterpriseDatabase !== undefined) {
      expect(typeof plugin.migrateEnterpriseDatabase).toBe('function');
    }
    if (plugin.getNotificationTenantResolver !== undefined) {
      expect(typeof plugin.getNotificationTenantResolver).toBe('function');
    }
  });
});
