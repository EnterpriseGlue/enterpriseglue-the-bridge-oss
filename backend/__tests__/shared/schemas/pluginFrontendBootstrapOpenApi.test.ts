import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { useOpenApiFixture } from '../../../test/utils/openapi-fixture.js';

describe('frontend plugin bootstrap OpenAPI', () => {
  const generateOpenApi = useOpenApiFixture();
  const source = {
    filePath: 'packages/backend-host/src/plugins/pluginRuntime.ts',
    content: readFileSync(new URL('../../../../packages/backend-host/src/plugins/pluginRuntime.ts', import.meta.url), 'utf8'),
  };
  const routes = scanBackendAuthzRoutes([source]).routes.filter(({ route }) => route.endsWith('/frontend'));

  it('discovers both v1 bootstrap variants from runtime registrations', () => {
    expect(routes.map(({ route }) => route)).toEqual([
      '/api/plugins/v1/frontend',
      '/t/:tenantSlug/api/plugins/v1/frontend',
    ]);
  });

  it.each(routes)('documents registered $route with its existing auth boundary', ({ normalizedRoute, method, authenticated }) => {
    const document = generateOpenApi();
    const operation = document.paths[normalizedRoute]?.[method.toLowerCase()];
    expect(operation, normalizedRoute).toBeDefined();
    expect(operation['x-enterpriseglue-authz-exemption']).toMatchObject({
      kind: authenticated ? 'auth-only' : 'public',
      owner: 'plugin-platform',
    });
    expect(operation.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/PluginFrontendBootstrap',
    });
    expect(operation.responses['200'].headers['Cache-Control'].schema.enum).toEqual(['no-store']);
  });

  it('describes the v1 payload, plugin entry metadata and optional availability', () => {
    const schema = generateOpenApi().components.schemas.PluginFrontendBootstrap;
    expect(schema.required).toEqual(['apiVersion', 'revision', 'plugins', 'issues']);
    expect(schema.properties.apiVersion.enum).toEqual(['frontend-bootstrap.plugin.enterpriseglue.io/v1']);
    expect(schema.properties.revision).toMatchObject({ type: 'integer', minimum: 0 });
    const plugin = schema.properties.plugins.items;
    expect(plugin.required).toEqual(['pluginId', 'version', 'displayName', 'manifest', 'entryUrl']);
    expect(plugin.properties.manifest.properties.apiVersion.enum).toEqual(['plugin.enterpriseglue.io/v1']);
    expect(plugin.properties.contributionAvailability).toBeDefined();
    expect(schema.properties.issues.items.required).toEqual(['code']);
  });

  it('documents tenant resolution and authentication failures without requiring admin permissions', () => {
    const document = generateOpenApi();
    const root = document.paths['/api/plugins/v1/frontend'].get;
    const tenant = document.paths['/t/{tenantSlug}/api/plugins/v1/frontend'].get;
    expect(root.security).toEqual([]);
    expect(tenant.security).toEqual([{ BearerAuth: [] }, { AccessTokenCookie: [] }]);
    expect(document.components.securitySchemes.AccessTokenCookie).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'accessToken' });
    expect(root.parameters ?? []).toEqual([]);
    expect(tenant.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tenantSlug', in: 'path', required: true }),
    ]));
    for (const status of ['401', '403', '404']) expect(tenant.responses[status]).toBeDefined();
    expect(root['x-enterpriseglue-authz']).toBeUndefined();
    expect(tenant['x-enterpriseglue-authz']).toBeUndefined();
    expect(document.paths['/api/plugin-platform/v1/plugins'].get['x-enterpriseglue-authz'].actionId).toBe('platform.settings.read');
  });
});
