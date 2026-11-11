import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

describe('Cloud email signup route contract', () => {
  const generateOpenApi = useOpenApiFixture();
  const routes = scanBackendAuthzRoutes([{
    filePath: 'packages/backend-host/src/modules/auth/routes/cloud-email-passkey.ts',
    content: readFileSync(new URL('../../../../../packages/backend-host/src/modules/auth/routes/cloud-email-passkey.ts', import.meta.url), 'utf8'),
  }]).routes;

  it('documents all email and passkey routes on their neutral application mount', () => {
    const mounts = readFileSync(new URL('../../../../../packages/backend-host/src/routes/index.ts', import.meta.url), 'utf8');
    expect(mounts).toContain('app.use(cloudEmailPasskeyRoute)');
    expect(routes).toHaveLength(10);
    const { paths } = generateOpenApi();
    for (const route of routes) {
      expect(paths[route.normalizedRoute]?.[route.method.toLowerCase()]).toBeDefined();
    }
    const enrollment = routes.filter(route => route.normalizedRoute.startsWith('/api/auth/cloud-passkey/register/'));
    expect(enrollment).toHaveLength(2);
    for (const route of enrollment) {
      expect(route.authenticated).toBe(true);
      expect(paths[route.normalizedRoute].post.security).toEqual([{ BearerAuth: [] }, { AccessTokenCookie: [] }]);
    }
  });

  it('documents the widget configuration, request token and proof completion responses', () => {
    const { paths } = generateOpenApi();
    const prefix = '/api/auth/cloud-signup/email';
    const challenge = paths[`${prefix}/challenge`].get.responses['200'].content['application/json'].schema;
    expect(challenge).toMatchObject({ required: ['siteKey'], additionalProperties: false, properties: {
      siteKey: { type: 'string', nullable: true, maxLength: 255 },
    } });
    const request = paths[`${prefix}/request`].post.requestBody.content['application/json'].schema;
    expect(request).toMatchObject({ required: ['email'], additionalProperties: false, properties: {
      turnstileToken: { type: 'string', minLength: 1, maxLength: 2048 },
    } });
    expect(paths[`${prefix}/complete`].post.responses).toMatchObject({ '200': {}, '201': {}, '401': {}, '403': {}, '404': {} });
  });
});
