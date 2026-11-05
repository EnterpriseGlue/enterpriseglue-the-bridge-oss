import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { getAuthzActionDefinition, validateAuthzRouteInventory } from '@enterpriseglue/shared/authz/index.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

describe('runtime instance lookup source-to-OpenAPI parity', () => {
  const generateOpenApi = useOpenApiFixture();
  const sources = ['shared/mission_control.ts', 'process-instances/routes.ts'].map(path => ({
    filePath: `packages/backend-host/src/modules/mission-control/${path}`,
    content: readFileSync(new URL(`../../../../../packages/backend-host/src/modules/mission-control/${path}`, import.meta.url), 'utf8'),
  }));
  const reads = sources.flatMap(source => scanBackendAuthzRoutes([source]).routes)
    .filter(route => route.method === 'GET' && (route.route === '/mission-control-api/process-instances' || route.route.startsWith('/mission-control-api/process-instances/:id')));
  const mounts = readFileSync(new URL('../../../../../packages/backend-host/src/routes/index.ts', import.meta.url), 'utf8');
  const caller = readFileSync(new URL('../../../../../packages/frontend-host/src/features/mission-control/process-instance-detail/api/processInstances.ts', import.meta.url), 'utf8');

  it('discovers both guarded implementations and their production mounts', () => {
    expect(reads).toHaveLength(13); // Compatibility/modular list reads and eleven detail reads.
    expect(new Set(reads.map(route => route.normalizedRoute)).size).toBe(10);
    expect(reads.every(route => route.authenticated)).toBe(true);
    for (const source of sources) {
      expect(source.content).toContain('withProcessInstanceLookupError(requireRuntimeDefinitionAction(');
    }
    expect(mounts).toContain('router.use(missionControlRoute)');
    expect(mounts).toContain('router.use(processInstancesRoute)');
    expect(mounts).toMatch(/app\.use\('\/t\/:tenantSlug', createTenantScopedRouter\(/);
    expect(mounts).toMatch(/app\.use\(createTenantScopedRouter\(/);
  });

  it('keeps the generated operations in the strict action inventory with identical alias checks', () => {
    const document = generateOpenApi();
    expect(validateAuthzRouteInventory(document, {
      requireOpenApiForActionRoutes: true,
      requireAuthzClassificationForOpenApiOperations: true,
    }).issues).toEqual([]);
    for (const { normalizedRoute } of reads) {
      const actionId = document.paths[normalizedRoute].get['x-enterpriseglue-authz'].actionId;
      const action = getAuthzActionDefinition(actionId)!;
      const canonical = action.routes!.find(route => route.method === 'GET' && route.route === normalizedRoute)!;
      const alias = action.routes!.find(route => route.method === 'GET' && route.route === `/t/{tenantSlug}${normalizedRoute}`);
      expect(canonical, normalizedRoute).toBeDefined();
      expect(alias, normalizedRoute).toEqual({ ...canonical, route: `/t/{tenantSlug}${canonical.route}` });
    }
  });

  for (const prefix of ['', '/t/{tenantSlug}']) {
    it(`keeps each discovered ${prefix || 'compatibility'} read registered with authorization and a success contract`, () => {
      const document = generateOpenApi();
      for (const { normalizedRoute } of reads) {
        const operation = document.paths[`${prefix}${normalizedRoute}`]?.get;
        expect(operation, normalizedRoute).toBeDefined();
        expect(operation['x-enterpriseglue-authz']?.actionId, normalizedRoute).toMatch(/^engine\.runtime\./);
        expect(operation.responses['200']?.content?.['application/json']?.schema, normalizedRoute).toBeDefined();
        expect(operation.security).toEqual([{ BearerAuth: [] }, { AccessTokenCookie: [] }]);
        expect(operation.parameters).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'engineId', in: 'query', required: true }),
        ]));
        expect(operation.parameters.some((parameter: any) => parameter.name === 'id' && parameter.in === 'path' && parameter.required)).toBe(normalizedRoute.includes('{id}'));
        expect(operation.parameters.some((parameter: any) => parameter.name === 'tenantSlug' && parameter.in === 'path' && parameter.required)).toBe(Boolean(prefix));
        for (const status of [401, 403, 404, 500, 502]) {
          expect(operation.responses[String(status)].content['application/json'].schema.required).toEqual(['error', 'code']);
        }
        const validation = operation.responses['400'].content['application/json'].schema;
        expect(validation.anyOf).toHaveLength(2);
        expect(validation.anyOf[0].required).toEqual(['error', 'code']);
        expect(validation.anyOf[1].required).toEqual(['error']);
        expect(validation.anyOf[1].properties.error.enum).toEqual(['Invalid query parameters']);
        expect(validation.anyOf[1].properties.issues).toMatchObject({ type: 'array', items: {
          type: 'object', required: ['path', 'message'],
        } });
      }
    });

    it(`preserves the documented detail404 and the actual engine-selected frontend read for ${prefix || 'compatibility'}`, () => {
      const operation = generateOpenApi().paths[`${prefix}/mission-control-api/process-instances/{id}`].get;
      expect(operation['x-enterpriseglue-authz'].actionId).toBe('engine.runtime.process-instances.read');
      expect(operation.responses['404'].content['application/json'].schema.properties.code.enum).toEqual(['NOT_FOUND']);
      expect(operation.responses['403'].content['application/json'].schema.properties.code.enum).toEqual(['FORBIDDEN']);
      expect(caller).toContain('withEngineId(`/mission-control-api/process-instances/${instanceId}?includeActionDecisions=true`, engineId)');
    });
  }
});
