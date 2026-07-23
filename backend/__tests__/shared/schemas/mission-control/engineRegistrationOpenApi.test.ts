import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';

describe('engine registration OpenAPI contracts', () => {
  it('publishes one connection-mode enum across manual, external, and config registration', () => {
    const document = generateOpenApi();
    const schemas = document.components?.schemas;

    expect(schemas?.EngineConnectionMode).toEqual({
      type: 'string',
      enum: ['direct', 'customer_sidecar'],
    });
    for (const schemaName of [
      'CreateEngineRequest',
      'ExternalEngineRegistrationRequest',
      'ConfigEngineRegistration',
    ]) {
      expect(schemas?.[schemaName]?.properties?.connectionMode).toMatchObject({
        type: 'string',
        enum: ['direct', 'customer_sidecar'],
      });
    }
    expect(schemas?.UpdateEngineRequest?.required).toBeUndefined();
  });

  it('documents sanitized transport diagnostics and endpoint-policy errors on every registration path', () => {
    const document = generateOpenApi();
    const schemas = document.components?.schemas;
    const paths = document.paths;

    expect(schemas?.EngineTransportDiagnostics?.properties).toMatchObject({
      connectionMode: { type: 'string', enum: ['direct', 'customer_sidecar'] },
      endpointAuthentication: { type: 'string' },
      downstreamAuthentication: { type: 'string' },
    });
    expect(schemas?.EngineTransportDiagnostics?.properties).not.toHaveProperty('baseUrl');
    expect(schemas?.EngineTransportDiagnostics?.properties).not.toHaveProperty('credentials');
    expect(schemas?.EndpointAuthenticationPolicyError?.properties).toMatchObject({
      error: {
        type: 'string',
        enum: [
          'Credentialless endpoint authentication is allowed only for customer-sidecar engines',
          'Credentialless customer-sidecar endpoints are disabled by platform policy',
        ],
      },
      code: { type: 'string', enum: ['VALIDATION_ERROR'] },
    });

    for (const [path, method] of [
      ['/engines-api/engines', 'post'],
      ['/engines-api/engines/{id}', 'put'],
      ['/engines-api/external/engines', 'post'],
    ] as const) {
      expect(paths?.[path]?.[method]?.responses?.['400']?.content?.['application/json']?.schema)
        .toEqual(schemas?.EndpointAuthenticationPolicyError);
    }
  });

  it('publishes canonical engine tenancy, mapping, diagnostics, and batch contracts', () => {
    const schemas = generateOpenApi().components?.schemas;

    expect(schemas?.EngineTenancyMode).toEqual({
      type: 'string',
      enum: ['dedicated', 'shared'],
    });
    expect(schemas?.EngineTenantMappingStrategy).toEqual({
      type: 'string',
      enum: ['engine_tenant_id', 'deployment_target', 'explicit'],
    });
    expect(schemas?.EngineTenancyConfiguration?.oneOf).toHaveLength(2);
    expect(schemas?.EngineTenancyConfiguration?.oneOf).toEqual(expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({ mode: { type: 'string', enum: ['dedicated'] } }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({ mode: { type: 'string', enum: ['shared'] } }),
      }),
    ]));
    expect(schemas?.EngineTenancyDiagnostics?.properties).toHaveProperty('resolutionStatus');
    expect(schemas?.EngineTenantMapping?.properties).not.toHaveProperty('credentials');
    expect(schemas?.ExternalEngineTenantMappingsUpsertRequest?.properties).toMatchObject({
      expectedMappingVersion: { type: 'integer', minimum: 0 },
      atomic: { type: 'boolean', default: true, enum: [true] },
    });
    expect(schemas?.ExternalEngineTenantMappingsUpsertResponse?.properties).toHaveProperty('diagnostics');
  });
});
