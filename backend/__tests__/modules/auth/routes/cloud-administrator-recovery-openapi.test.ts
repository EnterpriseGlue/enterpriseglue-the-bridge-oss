import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

describe('Cloud administrator recovery contract', () => {
  const generateOpenApi = useOpenApiFixture();

  it('documents the mounted recovery routes, company policy conflict and MFA capability', () => {
    const recoverySession = '/api/auth/recovery/session';
    const loginPolicy = '/api/t/{tenantSlug}/tenant/login-policy';
    const recoveryPolicy = loginPolicy + '/recover';
    const capabilityPaths = ['/api/tenancy/capabilities', '/api/workloads/tenancy/capabilities'];
    const expected = [
      ['POST', recoverySession], ['POST', recoveryPolicy], ['PUT', loginPolicy],
      ...capabilityPaths.map(path => ['GET', path]),
    ];
    const files = [
      'packages/backend-host/src/modules/auth/routes/login.ts',
      'packages/backend-host/src/modules/tenancy/routes/tenants.ts',
    ].map(filePath => ({
      filePath,
      content: readFileSync(new URL(`../../../../../${filePath}`, import.meta.url), 'utf8'),
    }));
    const { routes } = scanBackendAuthzRoutes(files);
    const { paths, components } = generateOpenApi();
    for (const [method, path] of expected) {
      expect(routes.some(route => route.method === method && route.normalizedRoute === path)).toBe(true);
      expect(paths[path]?.[method.toLowerCase()]).toBeDefined();
    }

    const session = paths[recoverySession].post;
    expect(session.requestBody).toMatchObject({
      required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } },
    });
    expect(session.responses).toMatchObject({ '204': {}, '401': {}, '403': {} });
    expect(session.responses['204'].content).toBeUndefined();
    expect(paths[recoveryPolicy].post.responses).toMatchObject({ '200': {}, '401': {}, '403': {}, '404': {} });
    expect(paths[loginPolicy].put.responses).toMatchObject({ '200': {}, '409': {} });
    for (const path of capabilityPaths) {
      const schema = paths[path].get.responses['200'].content['application/json'].schema;
      expect(schema.properties.cloudPlatformAdminMfaRequired).toEqual({ type: 'boolean' });
      expect(schema.required).not.toContain('cloudPlatformAdminMfaRequired');
    }
    expect(components.schemas.TenancyCapabilities.properties.cloudPlatformAdminMfaRequired).toEqual({ type: 'boolean' });
  });
});
