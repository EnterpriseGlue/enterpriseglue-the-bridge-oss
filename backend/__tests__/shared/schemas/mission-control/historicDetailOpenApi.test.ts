import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanBackendAuthzRoutes } from '@enterpriseglue/shared/authz/backend-route-scanner.js';
import { AppError, Errors } from '@enterpriseglue/shared/middleware/errorHandler.js';
import { BpmnEngineOperationError } from '@enterpriseglue/shared/services/bpmn-engine-client.js';
import { useOpenApiFixture } from '../../../../test/utils/openapi-fixture.js';

describe('historic process detail source-to-OpenAPI parity', () => {
  const generateOpenApi = useOpenApiFixture();
  const source = {
    filePath: 'packages/backend-host/src/modules/mission-control/shared/mission_control.ts',
    content: readFileSync(new URL('../../../../../packages/backend-host/src/modules/mission-control/shared/mission_control.ts', import.meta.url), 'utf8'),
  };
  const routes = scanBackendAuthzRoutes([source]).routes.filter(({ route }) => route.endsWith('/history/process-instances/:id'));
  const mounts = readFileSync(new URL('../../../../../packages/backend-host/src/routes/index.ts', import.meta.url), 'utf8');

  it('discovers the guarded handler and both actual tenant-router mounts', () => {
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: 'GET', authenticated: true });
    expect(source.content).toContain("requireHistoricProcessInstanceAction('engine.runtime.history.process-instances.read')");
    expect(mounts).toContain('router.use(missionControlRoute)');
    expect(mounts).toMatch(/app\.use\('\/t\/:tenantSlug', createTenantScopedRouter\(/);
    expect(mounts).toMatch(/app\.use\(createTenantScopedRouter\(/);
  });

  for (const prefix of ['', '/t/{tenantSlug}']) {
    it(`documents the resolved ${prefix || 'compatibility'} operation, selector and success contract`, () => {
      expect(routes).toHaveLength(1);
      const document = generateOpenApi();
      const operation = document.paths[`${prefix}${routes[0].normalizedRoute}`]?.get;
      expect(operation).toBeDefined();
      expect(operation['x-enterpriseglue-authz']).toMatchObject({ actionId: 'engine.runtime.history.process-instances.read' });
      expect(operation.security).toEqual([{ BearerAuth: [] }, { AccessTokenCookie: [] }]);
      expect(operation.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path', required: true, schema: expect.objectContaining({ type: 'string', minLength: 1 }) }),
        expect.objectContaining({ name: 'engineId', in: 'query', required: true, schema: expect.objectContaining({ type: 'string', minLength: 1 }) }),
      ]));
      expect(operation.parameters.some((parameter: any) => parameter.name === 'tenantSlug' && parameter.in === 'path' && parameter.required)).toBe(Boolean(prefix));
      const detail = operation.responses['200'].content['application/json'].schema;
      expect(detail).toMatchObject({ type: 'object', required: ['id'], properties: {
        id: { type: 'string' }, processDefinitionId: { type: 'string' }, processDefinitionKey: { type: 'string' },
        endTime: { type: 'string', nullable: true },
      } });
      expect(detail.additionalProperties).not.toBe(false);
      expect(detail.additionalProperties).toBeDefined();
      if (!prefix) expect(operation.description).toContain('verified tenant hostname');
    });

    it(`documents typed safe errors for ${prefix || 'compatibility'}`, () => {
      const operation = generateOpenApi().paths[`${prefix}${routes[0].normalizedRoute}`].get;
      const errors: Array<[number, AppError]> = [
        [400, Errors.validation('engineId is required')],
        [401, Errors.unauthorized()],
        [403, Errors.forbidden()],
        [404, Errors.notFound('Process instance')],
        [500, Errors.internal('Failed to load historic process instance')],
        [502, new BpmnEngineOperationError({ method: 'GET', path: '/history/process-instance/missing', status: 403 })],
      ];
      for (const [status, error] of errors) {
        const schema = operation.responses[String(status)].content['application/json'].schema;
        expect(schema.required).toEqual(['error', 'code']);
        expect(schema.properties.error).toMatchObject({ type: 'string' });
        expect(schema.properties.code).toMatchObject({ type: 'string' });
        if (schema.properties.code.enum) expect(schema.properties.code.enum).toContain(error.toJSON().code);
        expect(Object.keys(error.toJSON()).every((key) => key in schema.properties)).toBe(true);
      }
      expect(operation.responses['404'].content['application/json'].schema.properties.code.enum).toEqual(['NOT_FOUND']);
      expect(operation.responses['403'].content['application/json'].schema.properties.code.enum).toEqual(['FORBIDDEN']);
    });
  }
});
