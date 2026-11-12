import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

describe('Cloud organization request host contract', () => {
  const generateOpenApi = useOpenApiFixture();

  it('documents the exact release-controller notification and requester-claim routes', () => {
    const filePath = 'packages/backend-host/src/modules/tenancy/routes/tenants.ts';
    const content = readFileSync(new URL(`../../../../../${filePath}`, import.meta.url), 'utf8');
    const { routes } = scanBackendAuthzRoutes([{ filePath, content }]);
    const notification = '/api/workloads/cloud/organization-notifications';
    const identity = '/api/platform/cloud-identity';
    const { paths, components } = generateOpenApi();
    for (const path of [notification, identity]) {
      expect(routes.some(route => route.method === 'POST' && route.normalizedRoute === path)).toBe(true);
      expect(paths[path]?.post).toBeDefined();
    }

    const transport = paths[notification].post;
    expect(transport.security).toEqual([{ ReleaseControllerBearer: [] }]);
    expect(components.securitySchemes.ReleaseControllerBearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(transport.parameters).toContainEqual(expect.objectContaining({
      name: 'x-enterpriseglue-release-id', in: 'header', required: true,
    }));
    expect(transport.requestBody.required).toBe(true);
    const schema = transport.requestBody.content['application/json'].schema;
    const variants = schema.oneOf ?? schema.anyOf;
    expect(variants).toHaveLength(2);
    expect(variants.some((variant: { required?: string[] }) => variant.required?.includes('reason'))).toBe(true);
    expect(variants.every((variant: { additionalProperties?: boolean }) => variant.additionalProperties === false)).toBe(true);
    expect(transport.responses).toMatchObject({ '204': {}, '400': {}, '401': {}, '404': {}, '409': {}, '503': {} });

    const claim = paths[identity].post;
    expect(claim.description).toContain('platform.tenants.self_create');
    const requestSchema = claim.requestBody.content['application/json'].schema;
    expect(requestSchema.properties.includeRequester).toMatchObject({ type: 'boolean', enum: [true] });
    expect(requestSchema.required).not.toContain('includeRequester');
  });
});
