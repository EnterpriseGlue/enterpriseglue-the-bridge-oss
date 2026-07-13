import { describe, expect, it } from 'vitest';
import { EngineSchema } from '@enterpriseglue/shared/schemas/mission-control/engine.js';

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
});
