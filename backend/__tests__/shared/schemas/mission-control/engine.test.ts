import { describe, expect, it } from 'vitest';
import {
  CreateEngineRequestSchema,
  EndpointAuthenticationPolicyErrorSchema,
  EndpointAuthenticationPolicyMessages,
  EngineSchema,
  ExternalEngineRegistrationRequestSchema,
  UpdateEngineRequestSchema,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js';
import { ConfigEngineSchema } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';

describe('EngineSchema', () => {
  it('exposes persisted configuration ownership and central-engine defaults safely', () => {
    const engine = EngineSchema.parse({
      id: 'engine-1',
      name: 'Payments',
      baseUrl: 'https://payments.example.com/engine-rest',
      type: 'operaton',
      authType: 'basic',
      username: 'enterpriseglue',
      passwordEnc: 'enc:v1:opaque',
      active: true,
      version: null,
      createdAt: 1,
      updatedAt: 2,
      registrationSource: 'config',
      sourceRef: 'config_bundle:acme.authz',
      configKey: 'engine.prod-payments',
      ownershipMode: 'config_locked',
    });

    expect(engine).toMatchObject({
      configKey: 'engine.prod-payments',
      sourceRef: 'config_bundle:acme.authz',
      ownershipMode: 'config_locked',
      runtimeAccessScope: 'engine_wide',
      deploymentIntegration: 'enterpriseglue_proxy',
      metadataDiscoveryEnabled: true,
      pipelineReceiptEnabled: true,
      connectionMode: 'direct',
      hasCredential: true,
    });
    expect(engine.passwordEnc).toBeUndefined();
  });

  it('preserves explicit ingestion control opt-outs', () => {
    const engine = EngineSchema.parse({
      id: 'engine-2', name: 'Direct', baseUrl: 'https://direct.example.com/engine-rest', type: 'camunda7', authType: 'none', username: null, passwordEnc: null,
      active: true, version: null, createdAt: 1, updatedAt: 2, metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false,
    });
    expect(engine).toMatchObject({ metadataDiscoveryEnabled: false, pipelineReceiptEnabled: false });
  });

  it('keeps manual, external, and config registration connection modes aligned', () => {
    expect(CreateEngineRequestSchema.parse({
      name: 'Manual', baseUrl: 'https://manual.example.test/engine-rest',
    })).toMatchObject({ type: 'ion', connectionMode: 'direct' });
    expect(ExternalEngineRegistrationRequestSchema.parse({
      name: 'External', baseUrl: 'https://external.example.test/engine-rest', externalId: 'external-1',
      connectionMode: 'customer_sidecar',
    }).connectionMode).toBe('customer_sidecar');
    expect(ConfigEngineSchema.parse({
      key: 'engine.config', name: 'Config', type: 'operaton', baseUrl: 'https://config.example.test/engine-rest',
      connectionMode: 'customer_sidecar', auth: { type: 'none' },
    }).connectionMode).toBe('customer_sidecar');

    expect(CreateEngineRequestSchema.safeParse({
      name: 'Invalid', baseUrl: 'https://invalid.example.test', connectionMode: 'engine_proxy',
    }).success).toBe(false);
    expect(ExternalEngineRegistrationRequestSchema.safeParse({
      name: 'Invalid', baseUrl: 'https://invalid.example.test', externalId: 'external-2', connectionMode: 'engine_proxy',
    }).success).toBe(false);
  });

  it('keeps update requests partial and publishes the exact endpoint-policy error shape', () => {
    expect(UpdateEngineRequestSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    for (const error of EndpointAuthenticationPolicyMessages) {
      expect(EndpointAuthenticationPolicyErrorSchema.parse({
        error,
        code: 'VALIDATION_ERROR',
      })).toEqual({ error, code: 'VALIDATION_ERROR' });
    }
  });
});
