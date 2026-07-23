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
      expect(paths?.[path]?.[method]?.responses?.['400']?.content?.['application/json']?.schema?.anyOf)
        .toEqual(expect.arrayContaining([
          schemas?.EndpointAuthenticationPolicyError,
          schemas?.EngineTenancyErrorResponse,
        ]));
    }
  });

  it('publishes canonical engine tenancy, mapping, diagnostics, and batch contracts', () => {
    const document = generateOpenApi();
    const schemas = document.components?.schemas;

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
    expect(schemas?.EngineTenancyErrorCode?.enum).toContain('ENGINE_TENANCY_TRANSITION_REQUIRED');
    expect(schemas?.EngineTenancyErrorCode?.enum).toEqual(expect.arrayContaining([
      'ENGINE_TENANCY_PREVIEW_STALE',
      'ENGINE_TENANCY_PREVIEW_EXPIRED',
      'ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED',
    ]));
    expect(schemas?.EngineTenancyErrorResponse?.properties).not.toHaveProperty('details');
    expect(schemas?.EngineTenantMapping?.properties).not.toHaveProperty('credentials');
    expect(schemas?.EngineTenancyTransitionPreviewResponse?.properties).toMatchObject({
      effects: expect.any(Object),
      requiredAcknowledgements: expect.any(Object),
      previewHash: expect.any(Object),
      previewExpiresAt: expect.any(Object),
    });
    expect(schemas?.EngineTenancyTransitionApplyRequest?.required).toEqual(expect.arrayContaining([
      'tenancy',
      'previewHash',
      'previewExpiresAt',
      'acknowledgements',
    ]));
    expect(schemas?.EngineTenancyClassificationReport?.properties).toHaveProperty('rows');
    for (const schemaName of [
      'CreateEngineRequest',
      'UpdateEngineRequest',
      'ExternalEngineRegistrationRequest',
    ]) {
      expect(schemas?.[schemaName]?.properties).toHaveProperty('tenancy');
    }
    expect(schemas?.ExternalEngineTenantMappingsUpsertRequest?.properties).toMatchObject({
      expectedMappingVersion: { type: 'integer', minimum: 0 },
      atomic: { type: 'boolean', default: true, enum: [true] },
    });
    expect(schemas?.ExternalEngineTenantMappingsUpsertResponse?.properties).toHaveProperty('diagnostics');

    const paths = generateOpenApi().paths;
    for (const [path, method] of [
      ['/engines-api/engines', 'post'],
      ['/engines-api/engines/{id}', 'put'],
      ['/engines-api/external/engines', 'post'],
    ] as const) {
      expect(paths?.[path]?.[method]?.responses?.['403']).toBeDefined();
    }
    expect(paths?.['/engines-api/engines/{id}']?.put?.responses?.['409']).toBeDefined();
    expect(paths?.['/engines-api/external/engines']?.post?.responses?.['409']).toBeDefined();

    expect(document.paths?.['/engines-api/engines/{id}/tenancy/diagnostics']?.get?.responses?.['200'])
      .toBeDefined();
    expect(document.paths?.['/engines-api/engines/tenancy/classification-report']?.get?.responses?.['200'])
      .toBeDefined();
    expect(document.paths?.['/engines-api/engines/{id}/tenancy/preview']?.post?.requestBody)
      .toBeDefined();
    expect(document.paths?.['/engines-api/engines/{id}/tenancy/apply']?.post?.responses?.['409'])
      .toBeDefined();
    expect(document.paths?.['/engines-api/engines/{id}/tenant-mappings']?.get?.responses?.['200'])
      .toBeDefined();
    expect(document.paths?.['/engines-api/engines/{id}/tenant-mappings']?.put?.requestBody)
      .toBeDefined();
    expect(document.paths?.['/engines-api/external/engines/{externalId}/tenant-mappings']?.put?.responses?.['409'])
      .toBeDefined();
  });
});
