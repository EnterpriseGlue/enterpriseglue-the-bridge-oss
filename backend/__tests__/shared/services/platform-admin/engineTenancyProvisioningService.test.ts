import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@enterpriseglue/shared/middleware/errorHandler.js';
import {
  EngineTenancyProvisioningService,
  type EngineTenantReferenceResolver,
} from '@enterpriseglue/shared/services/platform-admin/EngineTenancyProvisioningService.js';

const service = new EngineTenancyProvisioningService();

function expectAppError(
  error: unknown,
  code: string,
  statusCode: number,
) {
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code, statusCode, field: 'tenancy' });
}

describe('EngineTenancyProvisioningService', () => {
  it('defaults omitted tenancy to a ready dedicated engine in the request or OSS default tenant', async () => {
    await expect(service.resolveForCreate({
      requestTenantId: ' default-tenant-id ',
      runtimeAccessScope: 'engine_wide',
      principalType: 'user',
      principalId: 'user-1',
    })).resolves.toEqual({
      tenancyMode: 'dedicated',
      tenantId: 'tenant-default',
      tenantMappingStrategy: null,
      tenantMappingVersion: 0,
      tenantResolutionStatus: 'ready',
      compatibilityDefaulted: true,
    });

    await expect(service.resolveForCreate({
      requestTenantId: null,
      principalType: 'api_client',
    })).resolves.toMatchObject({
      tenantId: 'tenant-default',
      compatibilityDefaulted: true,
    });
  });

  it('resolves dedicated request-context, default, and locally provable references', async () => {
    await expect(service.resolveForCreate({
      tenancy: { mode: 'dedicated' },
      requestTenantId: 'tenant-a',
      principalType: 'user',
    })).resolves.toMatchObject({ tenantId: 'tenant-a', compatibilityDefaulted: false });

    await expect(service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'default' } },
      requestTenantId: 'tenant-a',
      principalType: 'user',
    })).resolves.toMatchObject({ tenantId: 'tenant-default' });

    await expect(service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'id', id: 'tenant-a' } },
      requestTenantId: 'tenant-a',
      principalType: 'user',
    })).resolves.toMatchObject({ tenantId: 'tenant-a' });

    await expect(service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'id', id: 'default-tenant-id' } },
      principalType: 'system',
    })).resolves.toMatchObject({ tenantId: 'tenant-default' });

    for (const key of ['default', 'tenant.default']) {
      await expect(service.resolveForCreate({
        tenancy: { mode: 'dedicated', tenantRef: { type: 'key', key } },
        principalType: 'service_account',
      })).resolves.toMatchObject({ tenantId: 'tenant-default' });
    }
  });

  it('uses the enterprise resolver and sends principal context without trusting parsing alone', async () => {
    const resolve = vi.fn<EngineTenantReferenceResolver['resolve']>()
      .mockResolvedValueOnce({ tenantId: ' tenant-enterprise ', tenantKey: 'team-a', authorized: true })
      .mockResolvedValueOnce(null);
    const resolver: EngineTenantReferenceResolver = { resolve };

    await expect(service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'key', key: 'team-a' } },
      requestTenantId: 'tenant-request',
      principalType: 'api_client',
      principalId: 'client-1',
      resolver,
    })).resolves.toMatchObject({ tenantId: 'tenant-enterprise' });
    expect(resolve).toHaveBeenNthCalledWith(1, {
      reference: { type: 'key', key: 'team-a' },
      requestTenantId: 'tenant-request',
      principalType: 'api_client',
      principalId: 'client-1',
    });

    await expect(service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'default' } },
      principalType: 'system',
      resolver,
    })).resolves.toMatchObject({ tenantId: 'tenant-default' });
  });

  it('rejects denied, empty, or unprovable explicit tenant references', async () => {
    const denied: EngineTenantReferenceResolver = {
      resolve: vi.fn().mockResolvedValue({ tenantId: 'tenant-other', authorized: false }),
    };
    await service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'id', id: 'tenant-other' } },
      principalType: 'user',
      resolver: denied,
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectAppError(error, 'ENGINE_TENANT_REFERENCE_FORBIDDEN', 403),
    );

    const empty: EngineTenantReferenceResolver = {
      resolve: vi.fn().mockResolvedValue({ tenantId: ' ', authorized: true }),
    };
    await service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'key', key: 'team-b' } },
      principalType: 'user',
      resolver: empty,
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectAppError(error, 'ENGINE_TENANT_REFERENCE_FORBIDDEN', 403),
    );

    await service.resolveForCreate({
      tenancy: { mode: 'dedicated', tenantRef: { type: 'id', id: 'tenant-other' } },
      principalType: 'user',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectAppError(error, 'ENGINE_TENANT_REFERENCE_FORBIDDEN', 403),
    );
  });

  it('requires resource-aware authorization for shared engines and returns fail-closed state', async () => {
    await service.resolveForCreate({
      tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id', unmappedPolicy: 'deny' },
      runtimeAccessScope: 'engine_wide',
      principalType: 'user',
    }).then(
      () => { throw new Error('expected rejection'); },
      (error) => expectAppError(error, 'ENGINE_SHARED_REQUIRES_RESOURCE_AWARE', 400),
    );

    await expect(service.resolveForCreate({
      tenancy: { mode: 'shared', mappingStrategy: 'deployment_target', unmappedPolicy: 'deny' },
      runtimeAccessScope: 'resource_aware',
      requestTenantId: 'tenant-a',
      principalType: 'user',
    })).resolves.toEqual({
      tenancyMode: 'shared',
      tenantId: null,
      tenantMappingStrategy: 'deployment_target',
      tenantMappingVersion: 0,
      tenantResolutionStatus: 'incomplete',
      compatibilityDefaulted: false,
    });
  });

  it('preserves ordinary updates and accepts only topology-equivalent tenancy declarations', async () => {
    const existing = {
      tenancyMode: 'dedicated',
      tenantId: 'tenant-a',
      tenantMappingStrategy: null,
      tenantMappingVersion: 7,
      tenantResolutionStatus: 'ready',
    };
    await expect(service.validateUpdate(existing, {
      principalType: 'user',
    })).resolves.toBeNull();

    await expect(service.validateUpdate(existing, {
      tenancy: { mode: 'dedicated', tenantRef: { type: 'request_context' } },
      requestTenantId: 'tenant-a',
      principalType: 'user',
    })).resolves.toMatchObject({
      tenancyMode: 'dedicated',
      tenantId: 'tenant-a',
      tenantMappingVersion: 7,
      compatibilityDefaulted: false,
    });

    await expect(service.validateUpdate({
      tenancyMode: null,
      tenantId: null,
      tenantMappingStrategy: null,
      tenantMappingVersion: null,
      tenantResolutionStatus: null,
    }, {
      requestTenantId: null,
      principalType: 'api_client',
    }, { compatibilityOmissionMeansDedicated: true })).resolves.toMatchObject({
      tenancyMode: 'dedicated',
      tenantId: 'tenant-default',
      tenantMappingVersion: 0,
      compatibilityDefaulted: true,
    });
  });

  it('rejects topology, mapping-strategy, and dedicated-tenant changes outside a transition workflow', async () => {
    const cases = [
      {
        existing: { tenancyMode: 'dedicated', tenantId: 'tenant-a' },
        input: {
          tenancy: { mode: 'shared', mappingStrategy: 'explicit', unmappedPolicy: 'deny' } as const,
          runtimeAccessScope: 'resource_aware',
          requestTenantId: 'tenant-a',
        },
      },
      {
        existing: { tenancyMode: 'shared', tenantMappingStrategy: 'explicit', tenantMappingVersion: 3 },
        input: {
          tenancy: { mode: 'shared', mappingStrategy: 'engine_tenant_id', unmappedPolicy: 'deny' } as const,
          runtimeAccessScope: 'resource_aware',
        },
      },
      {
        existing: { tenancyMode: 'dedicated', tenantId: 'tenant-a' },
        input: {
          tenancy: { mode: 'dedicated', tenantRef: { type: 'id', id: 'tenant-b' } } as const,
          requestTenantId: 'tenant-b',
        },
      },
    ];

    for (const entry of cases) {
      await service.validateUpdate(entry.existing, {
        ...entry.input,
        principalType: 'user',
      }).then(
        () => { throw new Error('expected rejection'); },
        (error) => expectAppError(error, 'ENGINE_TENANCY_TRANSITION_REQUIRED', 409),
      );
    }
  });
});
