import { describe, expect, it } from 'vitest';
import {
  AccessibleEngineSummarySchema,
  CreateEngineRequestSchema,
  EndpointAuthenticationPolicyErrorSchema,
  EndpointAuthenticationPolicyMessages,
  EngineSchema,
  EngineConnectionHealthResponseSchema,
  EngineInventoryQuerySchema,
  EngineTenancyConfigurationSchema,
  EngineTenancyErrorCodeSchema,
  EngineTenancyErrorResponseSchema,
  EngineTenancyTransitionApplyRequestSchema,
  EngineTenancyTransitionPreviewResponseSchema,
  EngineTenantMappingSchema,
  EngineTenantReferenceSchema,
  ExternalEngineTenantMappingsUpsertRequestSchema,
  ExternalEngineTenantMappingsUpsertResponseSchema,
  ExternalEngineRegistrationRequestSchema,
  UpdateEngineRequestSchema,
} from '@enterpriseglue/shared/schemas/mission-control/engine.js';
import { ConfigEngineSchema } from '@enterpriseglue/shared/schemas/platform-admin/config-bundle.js';

describe('EngineSchema', () => {
  it('keeps manageable shared-engine collection widening explicit and bounded', () => {
    expect(EngineInventoryQuerySchema.parse({})).toEqual({});
    expect(EngineInventoryQuerySchema.parse({ includeManageableShared: 'true' })).toEqual({
      includeManageableShared: 'true',
    });
    expect(EngineInventoryQuerySchema.safeParse({ includeManageableShared: 'yes' }).success).toBe(false);
    expect(EngineInventoryQuerySchema.safeParse({
      includeManageableShared: 'true',
      unknown: 'x',
    }).success).toBe(false);
  });

  it('accepts the stable authorization-filtered engine list fields without discarding permitted metadata', () => {
    expect(AccessibleEngineSummarySchema.parse({
      id: 'engine-1',
      name: 'Operations',
      lifecycleStatus: null,
      myRole: 'operator',
    })).toMatchObject({
      id: 'engine-1',
      name: 'Operations',
      lifecycleStatus: null,
      myRole: 'operator',
    });
  });

  it('documents the sanitized inventory fields without treating the display role as a grant', () => {
    const engine = AccessibleEngineSummarySchema.parse({
      id: 'engine-1',
      name: 'Operations',
      baseUrl: 'https://operations.example.test/engine-rest',
      type: 'operaton',
      authType: 'basic',
      username: null,
      passwordEnc: null,
      hasCredential: true,
      environmentTagId: 'production',
      runtimeAccessScope: 'resource_aware',
      governance: { accountableOwnerId: 'user-owner', delegateId: null },
      myRole: 'operator',
      capabilities: {
        type: 'operaton',
        compatibilityProfile: 'camunda7-rest',
        supportLevel: 'compatible',
        operations: ['engine.read'],
        queryCapabilities: { processDefinitionKey: true },
      },
    });

    expect(engine).toMatchObject({
      passwordEnc: null,
      hasCredential: true,
      myRole: 'operator',
      runtimeAccessScope: 'resource_aware',
      governance: { accountableOwnerId: 'user-owner', delegateId: null },
    });
  });

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

  it('shares the live connection-test and stored-health response shape', () => {
    expect(EngineConnectionHealthResponseSchema.parse({
      id: 'health-1',
      engineId: 'engine-1',
      status: 'connected',
      latencyMs: 12,
      message: null,
      version: '7.20.0',
      checkedAt: 10,
      transport: {
        connectionMode: 'customer_sidecar',
        upstreamHop: 'enterpriseglue_to_sidecar',
        endpointAuthentication: 'oauth2-client-credentials',
        downstreamAuthentication: 'customer_managed',
      },
    })).toMatchObject({ status: 'connected', version: '7.20.0' });
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

  it('defines one strict dedicated/shared tenancy contract before provisioning exposes it', () => {
    expect(EngineTenancyConfigurationSchema.parse({
      mode: 'dedicated',
      tenantRef: { type: 'request_context' },
    })).toEqual({
      mode: 'dedicated',
      tenantRef: { type: 'request_context' },
    });
    expect(EngineTenancyConfigurationSchema.parse({
      mode: 'shared',
      mappingStrategy: 'engine_tenant_id',
    })).toEqual({
      mode: 'shared',
      mappingStrategy: 'engine_tenant_id',
      unmappedPolicy: 'deny',
    });
    expect(EngineTenancyConfigurationSchema.safeParse({
      mode: 'shared',
      mappingStrategy: 'engine_tenant_id',
      unmappedPolicy: 'default_tenant',
    }).success).toBe(false);
    expect(EngineTenancyConfigurationSchema.safeParse({
      mode: 'dedicated',
      mappingStrategy: 'explicit',
    }).success).toBe(false);
  });

  it('exposes the canonical tenancy contract on manual, update, and external provisioning requests', () => {
    expect(CreateEngineRequestSchema.parse({
      name: 'Shared manual',
      baseUrl: 'https://manual.example.test/engine-rest',
      runtimeAccessScope: 'resource_aware',
      tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id' },
    }).tenancy).toEqual({
      mode: 'shared',
      mappingStrategy: 'engine_tenant_id',
      unmappedPolicy: 'deny',
    });
    expect(UpdateEngineRequestSchema.parse({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'default' } },
    }).tenancy).toEqual({
      mode: 'dedicated',
      tenantRef: { type: 'default' },
    });
    expect(ExternalEngineRegistrationRequestSchema.parse({
      name: 'External shared',
      baseUrl: 'https://external.example.test/engine-rest',
      externalId: 'central-1',
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
    }).tenancy).toMatchObject({ mode: 'shared', mappingStrategy: 'explicit' });
    expect(CreateEngineRequestSchema.safeParse({
      name: 'Invalid',
      baseUrl: 'https://manual.example.test/engine-rest',
      tenancy: { mode: 'shared', mappingStrategy: 'unknown' },
    }).success).toBe(false);
  });

  it('publishes stable sanitized tenancy errors', () => {
    const stableCodes = [
      'ENGINE_TENANCY_UNRESOLVED',
      'ENGINE_TENANCY_CONFLICT',
      'ENGINE_TENANCY_TRANSITION_REQUIRED',
      'ENGINE_TENANCY_PREVIEW_STALE',
      'ENGINE_TENANCY_PREVIEW_EXPIRED',
      'ENGINE_TENANCY_ACKNOWLEDGEMENT_REQUIRED',
      'ENGINE_SHARED_REQUIRES_RESOURCE_AWARE',
      'ENGINE_TENANT_MAPPING_NOT_FOUND',
      'ENGINE_TENANT_MAPPING_VERSION_CONFLICT',
      'ENGINE_TENANT_REFERENCE_FORBIDDEN',
      'RUNTIME_RESOURCE_TENANT_UNRESOLVED',
    ] as const;
    expect(EngineTenancyErrorCodeSchema.options).toEqual(stableCodes);
    for (const code of stableCodes) {
      expect(EngineTenancyErrorResponseSchema.parse({
        error: 'Sanitized engine tenancy error',
        code,
        field: 'tenancy',
      })).toEqual({
        error: 'Sanitized engine tenancy error',
        code,
        field: 'tenancy',
      });
    }
    expect(EngineTenancyErrorResponseSchema.safeParse({
      error: 'internal details',
      code: 'UNKNOWN_INTERNAL_ERROR',
    }).success).toBe(false);
  });

  it('requires an expiring preview hash and explicit acknowledgements for topology apply', () => {
    const transition = {
      engineId: 'engine-1',
      kind: 'dedicated_to_shared',
      current: {
        mode: 'dedicated',
        tenantId: 'tenant-a',
        mappingStrategy: null,
        mappingVersion: 0,
        resolutionStatus: 'ready',
        runtimeAccessScope: 'engine_wide',
      },
      proposed: {
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'explicit',
        mappingVersion: 1,
        resolutionStatus: 'incomplete',
        runtimeAccessScope: 'resource_aware',
      },
      effects: {
        roleAssignments: 0,
        tenantMappings: 0,
        runtimeResources: 1,
        engineSetMemberships: 0,
        deploymentTargets: 0,
        deploymentReceipts: 0,
        visibility: {
          becomeVisible: 0,
          becomeHidden: 1,
          becomeUnmapped: 1,
          becomeConflicting: 0,
        },
      },
      requiredAcknowledgements: [
        'acknowledge_topology_change',
        'acknowledge_resource_quarantine',
        'acknowledge_access_change',
      ],
      previewHash: 'a'.repeat(64),
      previewExpiresAt: 300_000,
    };
    expect(EngineTenancyTransitionPreviewResponseSchema.parse(transition)).toEqual(transition);
    expect(EngineTenancyTransitionApplyRequestSchema.parse({
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      previewHash: transition.previewHash,
      previewExpiresAt: transition.previewExpiresAt,
      acknowledgements: transition.requiredAcknowledgements,
    })).toMatchObject({
      tenancy: { mode: 'shared', mappingStrategy: 'explicit', unmappedPolicy: 'deny' },
      acknowledgements: transition.requiredAcknowledgements,
    });
    expect(EngineTenancyTransitionApplyRequestSchema.safeParse({
      tenancy: { mode: 'shared', mappingStrategy: 'explicit' },
      previewHash: 'not-a-hash',
      previewExpiresAt: transition.previewExpiresAt,
      acknowledgements: [],
    }).success).toBe(false);
  });

  it('accepts only explicit tenant-reference kinds and stable lowercase keys', () => {
    for (const reference of [
      { type: 'request_context' },
      { type: 'default' },
      { type: 'key', key: 'tenant.team-a' },
      { type: 'id', id: 'tenant-default' },
    ]) {
      expect(EngineTenantReferenceSchema.safeParse(reference).success).toBe(true);
    }
    expect(EngineTenantReferenceSchema.safeParse({ type: 'key', key: 'Team A' }).success).toBe(false);
    expect(EngineTenantReferenceSchema.safeParse({ type: 'id', id: '' }).success).toBe(false);
    expect(EngineTenantReferenceSchema.safeParse({ type: 'slug', slug: 'default' }).success).toBe(false);
  });

  it('bounds atomic external mapping batches and publishes sanitized results', () => {
    const request = ExternalEngineTenantMappingsUpsertRequestSchema.parse({
      mappings: [{
        externalTenantId: 'native-team-a',
        tenantRef: { type: 'key', key: 'tenant.team-a' },
        strategy: 'engine_tenant_id',
        sourceRef: 'external-system:hr:tenant:native-team-a',
      }],
    });
    expect(request).toMatchObject({ atomic: true, dryRun: false });

    const response = ExternalEngineTenantMappingsUpsertResponseSchema.parse({
      engineId: 'engine-1',
      externalId: 'central-1',
      dryRun: true,
      mappingVersion: 3,
      created: 1,
      updated: 0,
      deactivated: 0,
      unchanged: 0,
      results: [{ index: 0, status: 'created', mappingId: 'mapping-1', code: null }],
      diagnostics: {
        mode: 'shared',
        tenantId: null,
        mappingStrategy: 'engine_tenant_id',
        mappingVersion: 3,
        resolutionStatus: 'ready',
        lastReconciledAt: null,
      },
    });
    expect(response.diagnostics).toMatchObject({
      mappedResourceCount: 0,
      unmappedResourceCount: 0,
      conflictingResourceCount: 0,
    });
    expect(ExternalEngineTenantMappingsUpsertRequestSchema.safeParse({ mappings: [] }).success).toBe(false);
  });

  it('describes persisted mapping provenance without accepting unknown fields', () => {
    const mapping = {
      id: 'mapping-1',
      engineId: 'engine-1',
      externalTenantId: 'native-team-a',
      enterpriseTenantId: 'tenant-a',
      strategy: 'engine_tenant_id',
      source: 'external',
      sourceRef: 'external-system:hr:tenant:native-team-a',
      ownershipMode: 'external_managed',
      sourceHash: null,
      lastAppliedAt: null,
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(EngineTenantMappingSchema.parse(mapping)).toEqual(mapping);
    expect(EngineTenantMappingSchema.safeParse({ ...mapping, accessToken: 'secret' }).success).toBe(false);
  });

  it('rejects undeclared sidecar transport fields instead of accepting downstream credentials', () => {
    const engine = {
      name: 'Payments sidecar',
      baseUrl: 'https://sidecar.example.test/engine-rest',
      type: 'ion',
      connectionMode: 'customer_sidecar',
      authType: 'none',
      customerDownstreamToken: 'must-not-be-stored',
    };
    const result = CreateEngineRequestSchema.safeParse(engine);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'unrecognized_keys', keys: ['customerDownstreamToken'] }),
      ]));
    }
    expect(ConfigEngineSchema.safeParse({
      ...engine,
      auth: { type: 'none' },
    }).success).toBe(false);
  });
});
