import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

describe('documentation subscriber identity OpenAPI', () => {
  const generateOpenApi = useOpenApiFixture();

  it('matches the mounted route, gateway authentication and no-store response', () => {
    const filePath = 'packages/backend-host/src/modules/auth/routes/documentation.ts';
    const content = readFileSync(new URL(`../../../../../${filePath}`, import.meta.url), 'utf8');
    const { routes } = scanBackendAuthzRoutes([{ filePath, content }]);
    const path = '/api/auth/documentation/subscriber';
    expect(routes.some(route => route.method === 'GET' && route.normalizedRoute === path)).toBe(true);

    const operation = generateOpenApi().paths[path].get;
    expect(operation.security).toEqual([{ BearerAuth: [] }]);
    expect(operation.description).toContain('active documentation session');
    expect(operation.parameters).toContainEqual(expect.objectContaining({
      name: 'x-enterpriseglue-documentation-key', in: 'header', required: true,
    }));
    expect(operation.responses['200'].headers['Cache-Control'].schema.enum).toEqual(['no-store']);
    const schema = operation.responses['200'].content['application/json'].schema;
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ['email', 'verified'],
      properties: { email: { type: 'string', format: 'email' }, verified: { enum: [true] } },
    });
    expect(operation.responses).toMatchObject({ '401': {}, '403': {}, '404': {}, '429': {} });
  });
});
