import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

describe('Microsoft Cloud mailbox proof contract', () => {
  const generateOpenApi = useOpenApiFixture();

  it('documents the three neutral browser routes, proof outcomes and the closed return path', () => {
    const filePath = 'packages/backend-host/src/modules/auth/routes/identity-oidc.ts';
    const content = readFileSync(new URL(`../../../../../${filePath}`, import.meta.url), 'utf8');
    const prefix = '/api/auth/cloud-signup/microsoft/email';
    const routes = scanBackendAuthzRoutes([{ filePath, content }]).routes.filter(route => route.normalizedRoute.startsWith(prefix + '/'));
    expect(routes).toHaveLength(3);
    expect(routes.map(route => [route.method, route.normalizedRoute])).toEqual(expect.arrayContaining([
      ['POST', `${prefix}/request`], ['GET', `${prefix}/verify`], ['POST', `${prefix}/complete`],
    ]));
    const { paths } = generateOpenApi();
    for (const route of routes) {
      expect(paths[route.normalizedRoute]?.[route.method.toLowerCase()]).toBeDefined();
    }
    const request = paths[`${prefix}/request`].post;
    expect(request.requestBody.content['application/json'].schema).toMatchObject({
      required: ['email'], additionalProperties: false, properties: { email: { type: 'string', format: 'email', maxLength: 320 } },
    });
    const complete = paths[`${prefix}/complete`].post.responses;
    expect(complete).toMatchObject({ '200': {}, '401': {}, '403': {}, '404': {}, '409': {} });
    expect(complete['200'].content['application/json'].schema.properties.destination.enum)
      .toEqual(['/cloud/onboarding', '/login', '/documentation/access']);
  });
});
