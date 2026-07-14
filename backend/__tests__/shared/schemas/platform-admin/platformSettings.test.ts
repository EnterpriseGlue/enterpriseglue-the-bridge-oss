import { describe, expect, it } from 'vitest';
import { generateOpenApi } from '@enterpriseglue/shared/schemas/openapi.js';
import {
  EngineRuntimeAuthorizationModeSchema,
  UnsupportedEngineRuntimeAuthorizationModeErrorSchema,
  UnsupportedEngineRuntimeAuthorizationModeMessage,
} from '@enterpriseglue/shared/schemas/platform-admin/platform-settings.js';

describe('platform settings runtime authorization contracts', () => {
  it('accepts only the EnterpriseGlue-authoritative v1 mode', () => {
    expect(EngineRuntimeAuthorizationModeSchema.parse('enterpriseglue_authoritative'))
      .toBe('enterpriseglue_authoritative');

    const result = EngineRuntimeAuthorizationModeSchema.safeParse('engine_native_authority');
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues[0]).toMatchObject({
      code: 'invalid_value',
      message: UnsupportedEngineRuntimeAuthorizationModeMessage,
    });
  });

  it('publishes named mode and validation-error schemas on the settings update operation', () => {
    const document = generateOpenApi();
    const schemas = document.components?.schemas;
    const response = document.paths?.['/api/admin/settings']?.put?.responses?.['400'];

    expect(schemas?.EngineRuntimeAuthorizationMode).toMatchObject({
      type: 'string',
      enum: ['enterpriseglue_authoritative'],
    });
    expect(schemas?.UnsupportedEngineRuntimeAuthorizationModeError).toBeDefined();
    expect(response?.content?.['application/json']?.schema)
      .toEqual(schemas?.UnsupportedEngineRuntimeAuthorizationModeError);

    expect(UnsupportedEngineRuntimeAuthorizationModeErrorSchema.safeParse({
      error: 'Validation failed',
      issues: [{
        path: 'engineRuntimeAuthorizationMode',
        message: UnsupportedEngineRuntimeAuthorizationModeMessage,
        code: 'invalid_value',
      }],
    }).success).toBe(true);
  });
});
