import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

const readSource = (path: string) => readFileSync(new URL(`../../../../../${path}`, import.meta.url), 'utf8');
const filePath = 'packages/backend-host/src/modules/platform-admin/routes/authz/config-bundles.ts';
const content = readSource(filePath);
const loggedRoutes = scanBackendAuthzRoutes([{ filePath, content }]).routes.filter(({ line }) =>
  content.split('\n')[line - 1]?.includes('logConfigBundleResponse(')
);

describe('config bundle logging route contract', () => {
  const generateOpenApi = useOpenApiFixture();

  it('keeps both logged operations mounted at the platform authorization routes', () => {
    const authzRouter = readSource('packages/backend-host/src/modules/platform-admin/routes/authz.ts');
    const mounts = readSource('packages/backend-host/src/routes/index.ts');
    expect(authzRouter).toContain('registerConfigBundleRoutes(router, { requireConfigBundleAccess, requireTargetTransferAccess })');
    expect(authzRouter).toContain('return requireApiClientAction(ApiClientScopes.CONFIG_BUNDLE_MANAGE, actionId)');
    expect(authzRouter).toContain('return requirePlatformAction(actionId)');
    expect(mounts).toContain('app.use(authzRoute)');
    expect(mounts).not.toContain('router.use(authzRoute)');
    expect(loggedRoutes.map(({ method, route }) => [method, route])).toEqual([
      ['POST', '/api/authz/config-bundles/preview'],
      ['POST', '/api/authz/config-bundles/apply'],
    ]);
  });

  it.each(loggedRoutes)('retains the request and response contracts for $method $route', ({
    method, normalizedRoute, registeredActionIds,
  }) => {
    const operation = generateOpenApi().paths[normalizedRoute]?.[method.toLowerCase()];
    expect(operation).toBeDefined();
    expect(operation['x-enterpriseglue-authz']).toMatchObject({
      actionId: registeredActionIds[0],
      resourceResolver: 'platform.self',
    });

    const input = operation.requestBody.content['application/json'].schema;
    expect(input.properties).toMatchObject({
      bundle: expect.any(Object),
      files: { type: 'object' },
    });
    const response = (status: number) => operation.responses[status].content['application/json'].schema;
    if (normalizedRoute.endsWith('/preview')) {
      expect(input.required).toEqual(['bundle', 'files']);
      expect(response(200).required).toEqual(['valid', 'errors', 'counts']);
      expect(response(422)).toEqual(response(200));
    } else {
      expect(input.required).toContain('expectedPreviewHash');
      expect(response(200).required).toEqual(expect.arrayContaining(['canonicalHash', 'changes', 'reconciliation']));
      expect(response(202)).toEqual(response(200));
      expect(operation.responses).toHaveProperty('409');
      expect(operation.responses).toHaveProperty('422');
    }
  });
});
